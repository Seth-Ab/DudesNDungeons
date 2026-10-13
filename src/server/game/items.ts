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
    case "weapon":
      return { id, name, kind: loot.kind, weaponKind: loot.weaponKind };
    default:
      return { id, name, kind: loot.kind };
  }
}

/** A carried item by id, whether it sits in the hand or in an inventory slot. */
function carriedItem(player: SessionPlayer, itemId: EntityId): InventoryItem | undefined {
  if (player.held?.id === itemId) return player.held;
  return player.inventory.find((candidate) => candidate.id === itemId);
}

/** Removes a carried item from wherever it is held. */
function removeCarried(player: SessionPlayer, item: InventoryItem): void {
  if (player.held === item) player.held = null;
  else player.inventory = player.inventory.filter((candidate) => candidate !== item);
}

/**
 * Where an item would go if `player` received it: a weapon fills an empty hand first, anything
 * else (or a weapon with a full hand) takes a free inventory slot. Null when there is no room.
 */
function destinationFor(player: SessionPlayer, item: InventoryItem): "held" | "inventory" | null {
  if (item.kind === "weapon" && player.held === null) return "held";
  return player.inventory.length < MAX_INVENTORY_SIZE ? "inventory" : null;
}

function receive(player: SessionPlayer, item: InventoryItem, destination: "held" | "inventory"): void {
  if (destination === "held") player.held = item;
  else player.inventory.push(item);
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

  const item = inventoryItemFromLoot(loot);
  const destination = destinationFor(player, item);
  if (!destination) return reject("notPermitted");

  loot.pickedUp = true;
  receive(player, item, destination);
  return OK;
}

function lootFromInventoryItem(item: InventoryItem, position: Vector2): LootState {
  const base = { id: item.id, name: item.name, position, pickedUp: false };
  switch (item.kind) {
    case "skillScroll":
      return { ...base, kind: item.kind, skillId: item.skillId };
    case "consumable":
      return {
        ...base,
        kind: item.kind,
        itemId: item.itemId,
        description: item.description,
        icon: item.icon,
      };
    case "weapon":
      return { ...base, kind: item.kind, weaponKind: item.weaponKind };
    default:
      return { ...base, kind: item.kind };
  }
}

/**
 * Puts a carried item on the floor at the player's feet as ordinary loot with the item's own id, so
 * it can be picked up again by anyone. Dropped loot lives in the dungeon, so it is lost at run end
 * and never banked.
 */
export function dropItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const item = carriedItem(player, itemId);
  if (!item) return reject("targetMissing");

  removeCarried(player, item);
  // The id may still name the picked-up entry this item came from; replace it rather than
  // leaving two loot entries sharing an id.
  session.dungeon.loot = session.dungeon.loot.filter((loot) => loot.id !== item.id);
  session.dungeon.loot.push(lootFromInventoryItem(item, { ...player.position }));
  return OK;
}

/**
 * Hands a carried item (inventory or hand) to a standing, connected party member within reach who
 * has room for it. A weapon goes to the target's empty hand first, like a pickup.
 */
export function giveItem(
  session: Session,
  playerId: PlayerId,
  itemId: EntityId,
  targetPlayerId: PlayerId,
): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");
  if (playerId === targetPlayerId) return reject("notPermitted");

  const item = carriedItem(player, itemId);
  if (!item) return reject("targetMissing");

  const target = session.players.get(targetPlayerId);
  if (!target) return reject("targetMissing");
  if (!target.connected || isDown(target)) return reject("notPermitted");
  if (!withinReach(player, target.position)) return reject("outOfRange");
  const destination = destinationFor(target, item);
  if (!destination) return reject("notPermitted");

  removeCarried(player, item);
  receive(target, item, destination);
  return OK;
}

/**
 * Swaps the hand item with a named inventory item, or stows the hand item into a free slot when
 * `itemId` is null. With an empty hand, naming an inventory item moves it into the hand. Only the
 * inventory is searched, so the held item itself is never a valid swap target.
 */
export function swapHeld(session: Session, playerId: PlayerId, itemId: EntityId | null): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  if (itemId === null) {
    if (!player.held) return reject("targetMissing");
    if (player.inventory.length >= MAX_INVENTORY_SIZE) return reject("notPermitted");

    player.inventory.push(player.held);
    player.held = null;
    return OK;
  }

  const index = player.inventory.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) return reject("targetMissing");

  const incoming = player.inventory[index] as InventoryItem;
  if (player.held) player.inventory[index] = player.held;
  else player.inventory.splice(index, 1);
  player.held = incoming;
  return OK;
}

export function useItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const item = player.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return reject(player.held?.id === itemId ? "notPermitted" : "targetMissing");

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
    case "weapon":
      // Keys are spent by interacting with a locked door, not used on their own.
      // Torches equip directly when picked up and never enter inventory. Weapons are used by
      // attacking, not by `useItem`.
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
