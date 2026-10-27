import { INTERACT_RANGE } from "../../shared/constants/game.js";
import { carriesIdol, distance } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { InventoryItem, PuzzleState, Vector2 } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";

/**
 * Server-resolved Heavy Idols, the item an Idol Carry puzzle's altar waits for.
 *
 * An idol is lifted like a body, for `IDOL_STAMINA_COST`, into an inventory slot. While a player
 * carries one they move at half speed, cannot attack, and are the monsters' first target; the rules
 * themselves live where movement, combat and monster targeting are resolved, and all of them read
 * `carriesIdol`. It is set down with `dropItem`, or on the altar by interacting with the puzzle.
 * It never leaves the dungeon: a carrier who drops, goes down or leaves lets go of it where they
 * stand, so the party can always pick it up again.
 */

export type IdolResult = { ok: true } | { ok: false; reason: RejectionReason };

const isIdol = (item: InventoryItem): boolean => item.kind === "idol";

/** Puts an idol on the floor as loot with its own id, replacing the picked-up entry it came from. */
function layDown(session: Session, item: InventoryItem, position: Vector2): void {
  session.dungeon.loot = session.dungeon.loot.filter((loot) => loot.id !== item.id);
  session.dungeon.loot.push({ id: item.id, name: item.name, kind: "idol", position: { ...position }, pickedUp: false });
}

/** Sets down every idol this player has, at their feet. Does nothing for a player who has none. */
export function setDownIdols(session: Session, player: SessionPlayer): void {
  if (!carriesIdol(player)) return;

  for (const item of player.inventory.filter(isIdol)) layDown(session, item, player.position);
  if (player.held && isIdol(player.held)) layDown(session, player.held, player.position);
  player.inventory = player.inventory.filter((item) => !isIdol(item));
  if (player.held && isIdol(player.held)) player.held = null;
}

/**
 * Lets go of the idol for any carrier who is no longer standing and connected. Run every tick, so a
 * dropped connection or a downed carrier never takes the puzzle's only idol with them.
 */
export function resolveIdols(session: Session): void {
  if (session.location !== "dungeon") return;

  for (const player of session.players.values()) {
    if (!player.connected || isDown(player)) setDownIdols(session, player);
  }
}

/**
 * Sets the idol a player carries on an Idol Carry altar they can reach. The puzzle resolves the
 * hold from there, exactly as if it had been dropped on the plate. Refused, changing nothing, for a
 * puzzle that is not an altar or is already solved, or a player without an idol.
 */
export function placeIdol(session: Session, player: SessionPlayer, puzzle: PuzzleState): IdolResult {
  const altar = puzzle.plates[0];
  if (puzzle.heldBy !== "idol" || puzzle.phase === "solved" || !altar) return { ok: false, reason: "notPermitted" };
  const item = player.inventory.find(isIdol) ?? (player.held && isIdol(player.held) ? player.held : undefined);
  if (!item) return { ok: false, reason: "notPermitted" };
  if (distance(player.position, altar.position) > INTERACT_RANGE) return { ok: false, reason: "outOfRange" };

  if (player.held === item) player.held = null;
  else player.inventory = player.inventory.filter((candidate) => candidate !== item);
  layDown(session, item, altar.position);
  return { ok: true };
}
