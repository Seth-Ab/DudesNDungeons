import { READY_PLATE_SIZE } from "../../shared/constants/game.js";
import type { MapReadyPlate } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { partyReadyForRun } from "./runLifecycle.js";

/**
 * Readying up by standing on the plates in front of the hub gate.
 *
 * A plate is another way to press Ready, never a different rule: claiming one sets `ready` exactly
 * as `setReady` does, and the gate still asks only `partyReadyForRun`. Ready a plate set is undone
 * when its holder steps off, but ready from the button is left alone, so walking never cancels a
 * choice made with the button.
 *
 * Once the whole party is ready, plate-set ready is kept as though the button had been pressed.
 * The gate is out of reach of the plates, so without that the player who walked to it would
 * unready themselves on the way and the gate would refuse them.
 */

export interface ReadyPlateChange {
  player: SessionPlayer;
  /** True on the change that filled the last plate and made the whole party ready. */
  partyReady: boolean;
}

function standsOn(player: SessionPlayer, plate: MapReadyPlate): boolean {
  const half = READY_PLATE_SIZE / 2;
  return Math.abs(player.position.x - plate.x) <= half && Math.abs(player.position.y - plate.y) <= half;
}

/** Whether a player could hold a plate: connected, designed, standing, and nobody's burden. */
function canHoldPlate(player: SessionPlayer): boolean {
  return (
    player.connected &&
    isSpawned(player) &&
    !isDown(player) &&
    player.carriedByPlayerId === null &&
    player.seatId === null
  );
}

function plateUnder(session: Session, player: SessionPlayer): MapReadyPlate | undefined {
  if (!canHoldPlate(player)) return undefined;
  return session.dungeon.map.readyPlates?.find((plate) => standsOn(player, plate));
}

/** Lets go of a held plate, taking back the ready it set. True when that changed `ready`. */
function releasePlate(player: SessionPlayer): boolean {
  const unready = player.readyFromPlate;
  player.readyPlateId = null;
  player.readyFromPlate = false;
  if (unready) player.ready = false;
  return unready;
}

/**
 * The Ready button. It always wins over a plate: pressing it to unready while on one lets go of the
 * plate, and the plate stays declined until the player steps off it, so standing still does not
 * ready them again next tick. Pressing it to ready makes the ready the button's, which walking off
 * a plate never clears.
 */
export function pressReady(player: SessionPlayer, ready: boolean): void {
  if (!ready && player.readyPlateId !== null) {
    player.declinedPlateId = player.readyPlateId;
    player.readyPlateId = null;
  }
  if (ready) player.declinedPlateId = null;
  player.ready = ready;
  player.readyFromPlate = false;
}

/** Forgets every plate a player held or declined, for a disconnect or a change of world. */
export function clearReadyPlate(player: SessionPlayer): void {
  releasePlate(player);
  player.declinedPlateId = null;
}

/**
 * One tick of the hub's ready plates. Holders who stepped off, or can no longer hold one, let go
 * first, so a plate freed this tick can be claimed in the same tick. Then each player standing on a
 * free plate they have not declined claims it, readying if they were not already. Returns every
 * player whose `ready` changed, in party order, for the caller to broadcast.
 */
export function resolveReadyPlates(session: Session): ReadyPlateChange[] {
  if (session.location !== "hub" || !session.dungeon.map.readyPlates?.length) return [];

  const changed: SessionPlayer[] = [];
  const players = [...session.players.values()];

  for (const player of players) {
    const under = plateUnder(session, player);
    if (player.readyPlateId !== null && under?.id !== player.readyPlateId && releasePlate(player)) {
      changed.push(player);
    }
    if (player.declinedPlateId !== null && under?.id !== player.declinedPlateId) {
      player.declinedPlateId = null;
    }
  }

  const held = new Set(players.map((player) => player.readyPlateId).filter((id) => id !== null));
  let claimed: SessionPlayer | null = null;
  for (const player of players) {
    if (player.readyPlateId !== null) continue;
    const under = plateUnder(session, player);
    if (!under || held.has(under.id) || player.declinedPlateId === under.id) continue;

    player.readyPlateId = under.id;
    held.add(under.id);
    if (!player.ready) {
      player.ready = true;
      player.readyFromPlate = true;
      changed.push(player);
      claimed = player;
    }
  }

  const partyReady = partyReadyForRun(session);
  if (partyReady) {
    for (const player of players) player.readyFromPlate = false;
  }

  return changed.map((player) => ({ player, partyReady: partyReady && player === claimed }));
}
