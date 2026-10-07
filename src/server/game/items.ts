import {
  INTERACT_RANGE,
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_RESISTANCE,
} from "../../shared/constants/game.js";
import { distance, distanceToDoor } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type {
  DoorState,
  EntityId,
  InventoryItem,
  LootState,
  PlayerId,
  Vector2,
} from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { contentForSession, learnSkill, progressionEffectTotal } from "./progression.js";
import { returnToHub, startRun } from "./runLifecycle.js";
import { healPlayer, restoreResistance, restoreStamina } from "./vitals.js";

export type ItemResult = { ok: true } | { ok: false; reason: RejectionReason };

const OK: ItemResult = { ok: true };

function reject(reason: RejectionReason): ItemResult {
  return { ok: false, reason };
}

function withinReach(player: SessionPlayer, position: Vector2): boolean {
  return distance(player.position, position) <= INTERACT_RANGE;
}

/**
 * Whether a player standing at the face of a doorway can reach it.
 *
 * The geometry is `distanceToDoor` in `src/shared/game/movement.ts`, so the client picks its
 * interact target by the same rule the server judges it against.
 */
function withinReachOfDoor(player: SessionPlayer, door: DoorState): boolean {
  return distanceToDoor(player.position, door) <= INTERACT_RANGE;
}

/** The acting player, or null when they are missing or downed and so cannot act at all. */
function actor(session: Session, playerId: PlayerId): SessionPlayer | null {
  const player = session.players.get(playerId);
  return player && !isDown(player) ? player : null;
}

function inventoryItemFromLoot(loot: LootState): InventoryItem {
  const { id, name } = loot;
  switch (loot.kind) {
    case "skillScroll":
      return { id, name, kind: loot.kind, skillId: loot.skillId };
    case "consumable":
      return {
        id,
        name,
        kind: loot.kind,
        itemId: loot.itemId,
        description: loot.description,
        icon: loot.icon,
      };
    default:
      return { id, name, kind: loot.kind };
  }
}

export function pickupItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const loot = session.dungeon.loot.find((candidate) => candidate.id === itemId && !candidate.pickedUp);
  if (!loot) return reject("targetMissing");
  if (!withinReach(player, loot.position)) return reject("outOfRange");
  if (loot.kind === "torch") {
    if (player.carryingTorch) return reject("notPermitted");

    loot.pickedUp = true;
    player.carryingTorch = true;
    return OK;
  }

  if (player.inventory.length >= MAX_INVENTORY_SIZE) return reject("notPermitted");

  loot.pickedUp = true;
  player.inventory.push(inventoryItemFromLoot(loot));
  return OK;
}

export function useItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const item = player.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return reject("targetMissing");

  switch (item.kind) {
    case "consumable":
      if (!applyConsumable(session, player, item.itemId)) return reject("notPermitted");
      break;
    case "skillScroll":
      // The scroll is consumed only when it teaches something. An already-known skill leaves the
      // item available to give away or, later, use as an upgrade source.
      if (!learnSkill(session, player, item.skillId)) return reject("notPermitted");
      break;
    case "key":
    case "torch":
      // Keys are spent by interacting with a locked door, not used on their own.
      // Torches equip directly when picked up and never enter inventory.
      return reject("notPermitted");
  }

  player.inventory = player.inventory.filter((candidate) => candidate !== item);
  return OK;
}

/**
 * Applies a consumable's authored effects through the vitals helpers. Returns false, changing
 * nothing, when the definition is gone or every effect would be wasted, so a misclick at full
 * health cannot spend the only tonic.
 */
function applyConsumable(session: Session, player: SessionPlayer, itemId: string): boolean {
  const content = contentForSession(session);
  const definition = content.items.get(itemId);
  if (definition?.kind !== "consumable") return false;

  let applied = false;
  for (const effect of definition.effects) {
    switch (effect.type) {
      case "heal":
        applied = healPlayer(player, effect.amount) || applied;
        break;
      case "restoreResistance":
        // Consumables are one of only two ways resistance ever goes up; the other is unlocked skills.
        applied =
          restoreResistance(
            player,
            effect.amount,
            PLAYER_MAX_RESISTANCE - progressionEffectTotal(player, "resistanceBonus", content),
          ) || applied;
        break;
      case "restoreStamina":
        applied = restoreStamina(player, effect.amount) || applied;
        break;
    }
  }
  return applied;
}

/** Opens a door, or uses the current world's exit to transition the whole party. */
export function interact(
  session: Session,
  playerId: PlayerId,
  targetId: EntityId,
  now = 0,
): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const door = session.dungeon.doors.find((candidate) => candidate.id === targetId);
  if (door) return openDoor(player, door);

  const exit = session.dungeon.exits.find((candidate) => candidate.id === targetId);
  if (exit) {
    if (!withinReach(player, exit.position)) return reject("outOfRange");
    if (session.location === "hub") return startRun(session, now);
    // A living boss bars the way out. Refused before anything is banked or rebuilt, so trying the
    // exit early costs nothing and changes nothing.
    if (exit.sealed) return reject("notPermitted");

    returnToHub(session, true);
    return OK;
  }

  return reject("targetMissing");
}

function openDoor(player: SessionPlayer, door: DoorState): ItemResult {
  if (!withinReachOfDoor(player, door)) return reject("outOfRange");
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
