import {
  ESCAPE_REWARD_COIN,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  PLAYER_SPAWN_FACING,
} from "../../shared/constants/game.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { DungeonMapState } from "../../shared/types/core.js";
import { markProfileChanged } from "../profiles/profile.js";
import type { SessionPlayer, Session } from "../sessions/sessionStore.js";
import { buildDungeon, findSpawnPoint, HUB_DUNGEON_ID, isSpawned } from "./dungeonState.js";
import { lootRngFor } from "./monsterLoot.js";
import { bankRunCoin, bankRunSkills, discardRunCoin, discardRunSkills } from "./progression.js";
import { createDiscoveredGrid } from "./tileGrid.js";
import { storeInVault } from "./vault.js";

export type RunTransitionResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason };

/**
 * A run is party-wide: every reserved slot must be connected, designed, and ready before anyone can
 * start. A player still designing cannot ready up, so the appearance check is a second lock on the
 * same door rather than the only one.
 */
export function partyReadyForRun(session: Session): boolean {
  return (
    session.location === "hub" &&
    session.players.size > 0 &&
    [...session.players.values()].every(
      (player) => player.connected && player.ready && isSpawned(player),
    )
  );
}

/** True once nobody in the active run remains standing, including disconnected reserved slots. */
export function partyWiped(session: Session): boolean {
  return (
    session.location === "dungeon" &&
    session.players.size > 0 &&
    [...session.players.values()].every((player) => player.health <= 0)
  );
}

function resetPlayerForWorld(player: SessionPlayer, map: DungeonMapState): void {
  player.facing = { ...PLAYER_SPAWN_FACING };
  player.health = PLAYER_MAX_HEALTH;
  player.stamina = PLAYER_MAX_STAMINA;
  player.ready = false;
  // Sized for the world being installed, so nothing from the last one carries over.
  player.discoveredTiles = createDiscoveredGrid(map.width, map.height);
  player.discoveredRoomIds.clear();
  player.discoveryLog = [];
  player.pendingDiscovery = [];
  player.mapSyncedTo = null;
  player.nextMoveAt = null;
  player.nextAttackAt = null;
  player.draw = null;
  // Carrying does not cross a world transition: positions are about to be rebuilt from scratch, so
  // any carry link left standing would point at a location that no longer means anything.
  player.carryingPlayerId = null;
  player.carriedByPlayerId = null;
  // Seats belong to the world being replaced, like everything else about where a player was.
  player.seatId = null;
  // So are plates, and `ready` was just cleared above whoever set it.
  player.readyPlateId = null;
  player.readyFromPlate = false;
  player.declinedPlateId = null;
}

/** Places the whole party without letting their positions in the old world block new spawns. */
function placeParty(session: Session): void {
  const players = [...session.players.values()];
  for (const player of players) player.health = 0;

  for (const player of players) {
    player.position = findSpawnPoint(session);
    player.health = PLAYER_MAX_HEALTH;
  }
}

function installWorld(session: Session, dungeonId: string, now: number | null): void {
  const built = buildDungeon(
    dungeonId === HUB_DUNGEON_ID
      ? { dungeonId: HUB_DUNGEON_ID, content: session.runDungeon.content }
      : session.runDungeon,
  );

  session.dungeon = built.dungeon;
  session.spawnPoints = built.spawnPoints;
  session.seed = built.seed;
  session.lootRng = lootRngFor(built.seed, dungeonId);
  session.simulatedAt = null;
  session.monsterCooldowns.clear();
  session.monsterWindups.clear();
  session.monsterPosts.clear();
  session.monsterCharges.clear();
  session.projectileRuns.clear();
  session.trapRearmAt.clear();
  session.puzzleHeldSince.clear();
  session.flareExpiresAt.clear();
  session.dummyHits.clear();

  for (const player of session.players.values()) {
    resetPlayerForWorld(player, built.dungeon.map);
    player.enteredDungeonAt = now;
  }
  placeParty(session);
}

/** Uses the hub entrance. Torches are preserved only when a player deliberately picked one up. */
export function startRun(session: Session, now: number): RunTransitionResult {
  if (!partyReadyForRun(session)) return { ok: false, reason: "notPermitted" };

  // Defensive as well as semantic: provisional unlocks never cross from one run into another.
  for (const player of session.players.values()) {
    discardRunSkills(player);
    discardRunCoin(player);
  }
  installWorld(session, session.runDungeon.dungeonId ?? "vault-run", now);
  session.location = "dungeon";
  return { ok: true };
}

/**
 * Returns everyone to a rebuilt hub. Survivors deposit their carry in the party vault on escape; a
 * wipe or a downed player left behind loses it. Torches never cross back into the hub, so taking
 * one on the next run is a choice.
 *
 * A downed player being physically carried at the moment the party escapes counts as a survivor
 * too: that is the payoff for hauling them to the exit, distinct from and short of a full revive.
 *
 * The vault belongs to the room code and the skills, coin and run counts to each profile, and both
 * outlive the session, so this is the one moment a run leaves a mark a restart cannot clear. The
 * personal `bankedItems` list is legacy and no longer grows.
 */
export function returnToHub(session: Session, escaped: boolean): void {
  for (const player of session.players.values()) {
    const survived = escaped && (player.health > 0 || player.carriedByPlayerId !== null);
    if (survived) {
      for (const item of player.inventory) storeInVault(session, item);
      if (player.held) storeInVault(session, player.held);
      bankRunSkills(player);
      player.runCoin += ESCAPE_REWARD_COIN;
      bankRunCoin(player);
      player.profile.runsEscaped += 1;
    } else {
      discardRunSkills(player);
      discardRunCoin(player);
      player.profile.runsLost += 1;
    }
    markProfileChanged(player.profile);

    player.inventory = [];
    player.held = null;
    player.carryingTorch = false;
  }

  installWorld(session, HUB_DUNGEON_ID, null);
  session.location = "hub";
}
