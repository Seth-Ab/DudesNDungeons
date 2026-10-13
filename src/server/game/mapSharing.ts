import { PLAYER_MAP_SHARE_RANGE } from "../../shared/constants/game.js";
import { distance } from "../../shared/game/movement.js";
import type { PlayerId } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { discoverTile, discoveredFor } from "./visibility.js";

/** How much of one player's discovery log another has already merged, and which log that was. */
interface MergeCursor {
  log: readonly number[];
  merged: number;
}

/** Per receiver, per giver. Weak so a player who leaves takes it along. */
const cursors = new WeakMap<SessionPlayer, Map<PlayerId, MergeCursor>>();

function canShare(player: SessionPlayer): boolean {
  return player.connected && !isDown(player);
}

/** Copies what `from` learned since `to` last asked into `to`'s memory. Geometry only. */
function mergeInto(session: Session, to: SessionPlayer, from: SessionPlayer): void {
  let byGiver = cursors.get(to);
  if (!byGiver) {
    byGiver = new Map();
    cursors.set(to, byGiver);
  }

  // A rebuilt world replaces the log, so a cursor into the old one starts over.
  let cursor = byGiver.get(from.id);
  if (!cursor || cursor.log !== from.discoveryLog) {
    cursor = { log: from.discoveryLog, merged: 0 };
    byGiver.set(from.id, cursor);
  }
  if (cursor.merged >= from.discoveryLog.length) return;

  const discovered = discoveredFor(to, session.dungeon.map);
  // Read the end up front: tiles `from` is handed in the other direction this pass are not news.
  const end = from.discoveryLog.length;
  for (let n = cursor.merged; n < end; n += 1) {
    discoverTile(session, to, discovered, from.discoveryLog[n]!);
  }
  cursor.merged = end;
}

/**
 * Merges the discovered tiles and rooms of players standing near each other, both ways.
 *
 * Each player's map is their own and only grows from their own light, so a party that splits ends
 * with unrelated maps. Within `PLAYER_MAP_SHARE_RANGE` of one another, standing and connected, two
 * players pool what they know, so exploring apart and regrouping is rewarded. Line of sight is not
 * required. Run once per tick, before snapshots are built, so merged tiles reach the client through
 * the ordinary discovery delta.
 *
 * What is shared is geometry alone: tiles and the rooms they belong to. Monsters, loot, other
 * players, and lit status come only from a viewer's own light, so a merge never shows a player
 * anything they could not already see. Knowledge is kept after the pair separates, lives on the
 * players' current world only, and is dropped by `resetPlayerForWorld`. A hub is fully lit, so
 * nothing is shared there.
 *
 * Cost follows what is new: each pair costs a comparison of two log lengths unless one of them
 * learned something, and then only the new entries are walked.
 */
export function shareDiscoveredMaps(session: Session): void {
  if (session.location !== "dungeon") return;

  const players = [...session.players.values()].filter(canShare);
  for (let a = 0; a < players.length; a += 1) {
    for (let b = a + 1; b < players.length; b += 1) {
      const first = players[a]!;
      const second = players[b]!;
      if (distance(first.position, second.position) > PLAYER_MAP_SHARE_RANGE) continue;

      mergeInto(session, first, second);
      mergeInto(session, second, first);
    }
  }
}
