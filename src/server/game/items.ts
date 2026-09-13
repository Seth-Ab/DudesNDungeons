import {
  INTERACT_RANGE,
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_HEALTH,
  TONIC_HEAL_AMOUNT,
} from "../../shared/constants/game.js";
import { distance } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { DoorState, EntityId, PlayerId, Vector2 } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";

export type ItemResult = { ok: true } | { ok: false; reason: RejectionReason };

const OK: ItemResult = { ok: true };

function reject(reason: RejectionReason): ItemResult {
  return { ok: false, reason };
}

function withinReach(player: SessionPlayer, position: Vector2): boolean {
  return distance(player.position, position) <= INTERACT_RANGE;
}

/** The acting player, or null when they are missing or downed and so cannot act at all. */
function actor(session: Session, playerId: PlayerId): SessionPlayer | null {
  const player = session.players.get(playerId);
  return player && !isDown(player) ? player : null;
}

export function pickupItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const loot = session.dungeon.loot.find((candidate) => candidate.id === itemId && !candidate.pickedUp);
  if (!loot) return reject("targetMissing");
  if (!withinReach(player, loot.position)) return reject("outOfRange");
  if (player.inventory.length >= MAX_INVENTORY_SIZE) return reject("notPermitted");

  loot.pickedUp = true;
  player.inventory.push({ id: loot.id, name: loot.name, kind: loot.kind });
  return OK;
}

export function useItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const item = player.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return reject("targetMissing");

  switch (item.kind) {
    case "tonic":
      // Refused at full health, so a misclick cannot waste the only tonic.
      if (player.health >= PLAYER_MAX_HEALTH) return reject("notPermitted");
      player.health = Math.min(PLAYER_MAX_HEALTH, player.health + TONIC_HEAL_AMOUNT);
      break;
    case "key":
      // Keys are spent by interacting with a locked door, not used on their own.
      return reject("notPermitted");
  }

  player.inventory = player.inventory.filter((candidate) => candidate !== item);
  return OK;
}

/** Opens a door, spending a key if it is locked, or uses an exit to clear the dungeon. */
export function interact(session: Session, playerId: PlayerId, targetId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const door = session.dungeon.doors.find((candidate) => candidate.id === targetId);
  if (door) return openDoor(player, door);

  const exit = session.dungeon.exits.find((candidate) => candidate.id === targetId);
  if (exit) {
    if (!withinReach(player, exit.position)) return reject("outOfRange");
    session.dungeon.cleared = true;
    return OK;
  }

  return reject("targetMissing");
}

function openDoor(player: SessionPlayer, door: DoorState): ItemResult {
  if (!withinReach(player, door.position)) return reject("outOfRange");
  if (door.open) return reject("notPermitted");

  if (door.locked) {
    const key = player.inventory.find((candidate) => candidate.kind === "key");
    if (!key) return reject("notPermitted");

    player.inventory = player.inventory.filter((candidate) => candidate !== key);
    door.locked = false;
  }

  door.open = true;
  return OK;
}
