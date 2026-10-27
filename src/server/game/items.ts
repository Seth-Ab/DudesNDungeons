import { randomUUID } from "node:crypto";
import {
  BALLAST_STAMINA_COST,
  GENERIC_KEY_ITEM_ID,
  IDOL_STAMINA_COST,
  INTERACT_RANGE,
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
} from "../../shared/constants/game.js";
import { carriesIdol, distance, distanceToDoor } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type {
  AltarState,
  ChestState,
  DoorState,
  EntityId,
  InventoryItem,
  LootState,
  PlayerId,
  Vector2,
} from "../../shared/types/core.js";
import { consumableTarget, type ConsumableEffect } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { markVaultChanged } from "../vaults/partyVault.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { MIMIC_MONSTER_ID, monsterInstance } from "./dungeonBuilder.js";
import { placeFlare } from "./flares.js";
import { placeIdol } from "./idols.js";
import { dropItemNear, spillLootTable } from "./monsterLoot.js";
import { contentForSession, convertScrollSkill, learnSkill, progressionEffectTotal } from "./progression.js";
import { returnToHub, startRun } from "./runLifecycle.js";
import { seatById, sitOn } from "./seats.js";
import { turnTwinLock } from "./twinLocks.js";
import { inVaultArea, storeInVault } from "./vault.js";
import { healPlayer, restoreResistance, restoreStamina, spendStamina } from "./vitals.js";

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

/**
 * The acting player, or null when they are missing, downed or disconnected and so cannot act at
 * all. A dropped connection holds its slot but spends nothing, so it cannot spend a key.
 */
function actor(session: Session, playerId: PlayerId): SessionPlayer | null {
  const player = session.players.get(playerId);
  return player && player.connected && !isDown(player) ? player : null;
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
        useOn: loot.useOn,
      };
    case "weapon":
      return { id, name, kind: loot.kind, itemId: loot.itemId, weaponKind: loot.weaponKind };
    case "ammo":
      return { id, name, kind: loot.kind, itemId: loot.itemId, count: loot.count };
    case "key":
      return { id, name, kind: loot.kind, itemId: loot.itemId };
    default:
      return { id, name, kind: loot.kind };
  }
}

type AmmoStack = Extract<InventoryItem, { kind: "ammo" }>;

/** An ammo item's `maxStack` from content, or null when its definition is gone and it cannot merge. */
function maxStackOf(session: Session, itemId: string): number | null {
  const definition = contentForSession(session).items.get(itemId);
  return definition?.kind === "ammo" ? definition.maxStack : null;
}

/** Every carried stack of `itemId`, hand first. */
function carriedStacks(player: SessionPlayer, itemId: string): AmmoStack[] {
  return [player.held, ...player.inventory].filter(
    (item): item is AmmoStack => item?.kind === "ammo" && item.itemId === itemId,
  );
}

/** How many more of `itemId` the player's existing stacks could take without a new slot. */
function mergeRoom(player: SessionPlayer, itemId: string, maxStack: number): number {
  return carriedStacks(player, itemId).reduce((room, stack) => room + Math.max(0, maxStack - stack.count), 0);
}

/** Tops up the player's stacks of `itemId` with up to `count`, returning how many did not fit. */
function topUp(player: SessionPlayer, itemId: string, maxStack: number, count: number): number {
  let left = count;
  for (const stack of carriedStacks(player, itemId)) {
    const added = Math.min(left, Math.max(0, maxStack - stack.count));
    stack.count += added;
    left -= added;
  }
  return left;
}

/**
 * Picks up a stack: tops up carried stacks of the same item, then puts what is left in a free
 * slot. Whatever still does not fit stays on the floor as the same loot entry, with its count
 * reduced. Refused, changing nothing, when not even one would fit.
 */
function pickupStack(session: Session, player: SessionPlayer, loot: Extract<LootState, { kind: "ammo" }>): ItemResult {
  const maxStack = maxStackOf(session, loot.itemId);
  const room = maxStack === null ? 0 : mergeRoom(player, loot.itemId, maxStack);
  const freeSlot = player.inventory.length < MAX_INVENTORY_SIZE;
  if (room === 0 && !freeSlot) return reject("notPermitted");

  let left = maxStack === null ? loot.count : topUp(player, loot.itemId, maxStack, loot.count);
  if (left > 0 && freeSlot) {
    const taken = Math.min(left, maxStack ?? left);
    left -= taken;
    // The stack keeps the loot's id only when nothing is left on the floor still using it.
    const id = left === 0 ? loot.id : randomUUID();
    player.inventory.push({ id, name: loot.name, kind: "ammo", itemId: loot.itemId, count: taken });
  }

  if (left === 0) loot.pickedUp = true;
  else loot.count = left;
  return OK;
}

/**
 * Spends `amount` from a carried ammo stack, removing the entry when it reaches zero. Returns
 * false, changing nothing, when the stack is missing, is not ammo, or holds fewer than `amount`.
 */
export function consumeFromStack(player: SessionPlayer, stackId: EntityId, amount: number): boolean {
  const stack = carriedItem(player, stackId);
  if (stack?.kind !== "ammo" || !Number.isInteger(amount) || amount <= 0 || stack.count < amount) {
    return false;
  }

  stack.count -= amount;
  if (stack.count === 0) removeCarried(player, stack);
  return true;
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
    player.runStats.carriedTorch = true;
    return OK;
  }
  if (loot.kind === "ammo") return pickupStack(session, player, loot);

  const item = inventoryItemFromLoot(loot);
  const destination = destinationFor(player, item);
  if (!destination) return reject("notPermitted");
  // An idol is a load of its own: one at a time, and never while carrying a body.
  if (loot.kind === "idol" && (carriesIdol(player) || player.carryingPlayerId !== null)) return reject("notPermitted");
  // A stone or an idol is heavy: hefting it is what costs stamina, so a refusal leaves it where it lies.
  if (loot.kind === "ballast" && !spendStamina(player, BALLAST_STAMINA_COST)) return reject("exhausted");
  if (loot.kind === "idol" && !spendStamina(player, IDOL_STAMINA_COST)) return reject("exhausted");

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
        useOn: item.useOn,
      };
    case "weapon":
      return { ...base, kind: item.kind, itemId: item.itemId, weaponKind: item.weaponKind };
    case "ammo":
      return { ...base, kind: item.kind, itemId: item.itemId, count: item.count };
    case "key":
      return { ...base, kind: item.kind, itemId: item.itemId };
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
 * has room for it. A weapon goes to the target's empty hand first, like a pickup. A stack moves
 * whole: it tops up the target's stacks of the same item and the rest takes a free slot, or the
 * give is refused when it would not all fit.
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
  // An idol changes hands only by being set down and lifted again, which costs the lift.
  if (item.kind === "idol") return reject("notPermitted");

  const target = session.players.get(targetPlayerId);
  if (!target) return reject("targetMissing");
  if (!target.connected || isDown(target) || !isSpawned(target)) return reject("notPermitted");
  if (!withinReach(player, target.position)) return reject("outOfRange");
  if (item.kind === "ammo") {
    const maxStack = maxStackOf(session, item.itemId);
    const room = maxStack === null ? 0 : mergeRoom(target, item.itemId, maxStack);
    if (room < item.count && target.inventory.length >= MAX_INVENTORY_SIZE) return reject("notPermitted");

    removeCarried(player, item);
    const left = maxStack === null ? item.count : topUp(target, item.itemId, maxStack, item.count);
    if (left > 0) target.inventory.push({ ...item, count: left });
    return OK;
  }
  const destination = destinationFor(target, item);
  if (!destination) return reject("notPermitted");

  removeCarried(player, item);
  receive(target, item, destination);
  return OK;
}

/**
 * Takes an item out of the party vault. Hub only, from inside the vault area, by any standing party
 * member. A weapon fills an empty hand first, anything else a free slot. Ammo tops up carried stacks
 * and then takes a free slot, like a pickup, and whatever still does not fit stays in the vault as
 * the same entry with a smaller count. Refused, changing nothing, when not even one would fit.
 *
 * The vault is checked by id on every call, and messages are handled one at a time, so two players
 * asking for the same item resolve to one taker: the second finds it gone (`targetMissing`).
 */
export function withdrawVaultItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");
  if (session.location !== "hub") return reject("notPermitted");

  const vault = session.vault;
  const item = vault.items.find((candidate) => candidate.id === itemId);
  if (!item) return reject("targetMissing");
  if (!inVaultArea(session, player)) return reject("outOfRange");

  if (item.kind === "ammo") {
    const maxStack = maxStackOf(session, item.itemId);
    const room = maxStack === null ? 0 : mergeRoom(player, item.itemId, maxStack);
    const freeSlot = player.inventory.length < MAX_INVENTORY_SIZE;
    if (room === 0 && !freeSlot) return reject("notPermitted");

    let left = maxStack === null ? item.count : topUp(player, item.itemId, maxStack, item.count);
    if (left > 0 && freeSlot) {
      const taken = Math.min(left, maxStack ?? left);
      left -= taken;
      // The carried stack keeps the vault entry's id only when the entry is used up.
      player.inventory.push({ ...item, id: left === 0 ? item.id : randomUUID(), count: taken });
    }

    if (left === 0) vault.items = vault.items.filter((candidate) => candidate !== item);
    else item.count = left;
    markVaultChanged(vault);
    return OK;
  }

  const destination = destinationFor(player, item);
  if (!destination) return reject("notPermitted");

  vault.items = vault.items.filter((candidate) => candidate !== item);
  receive(player, item, destination);
  markVaultChanged(vault);
  return OK;
}

/**
 * Stores a carried item (inventory or hand) in the party vault, so it can wait for a later run or
 * for a teammate, such as a skill scroll its carrier cannot use yet. Same place rules as a
 * withdrawal; capacity is unlimited.
 */
export function depositVaultItem(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");
  if (session.location !== "hub") return reject("notPermitted");

  const item = carriedItem(player, itemId);
  if (!item) return reject("targetMissing");
  if (!inVaultArea(session, player)) return reject("outOfRange");

  removeCarried(player, item);
  storeInVault(session, item);
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

/**
 * Uses an inventory item. `targetPlayerId` is only for a consumable used on someone else (smelling
 * salts); naming one for anything else is refused, as is leaving it out for one that needs it.
 */
export function useItem(
  session: Session,
  playerId: PlayerId,
  itemId: EntityId,
  now = 0,
  targetPlayerId: PlayerId | null = null,
): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const item = player.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return reject(player.held?.id === itemId ? "notPermitted" : "targetMissing");
  if (targetPlayerId !== null && item.kind !== "consumable") return reject("notPermitted");

  switch (item.kind) {
    case "consumable": {
      const result = applyConsumable(session, player, item.itemId, now, targetPlayerId);
      if (!result.ok) return result;
      break;
    }
    case "skillScroll": {
      // The scroll is consumed only when it adds a stack. A maxed skill or missing prerequisites
      // leave it in the slot, to give to a teammate who qualifies or keep until this player does.
      const learned = learnSkill(session, player, item.skillId);
      if (learned === "unknownSkill") return reject("notPermitted");
      if (learned !== "learned") return reject(learned);
      break;
    }
    case "key":
    case "torch":
    case "ballast":
    case "idol":
    case "weapon":
    case "ammo":
      // Keys are spent by interacting with a locked door, not used on their own.
      // Torches equip directly when picked up and never enter inventory. Weapons are used by
      // attacking, not by `useItem`, and ammo is spent by the weapon that fires it.
      return reject("notPermitted");
  }

  player.inventory = player.inventory.filter((candidate) => candidate !== item);
  return OK;
}

/**
 * Converts a skill scroll into coin after the player confirmed it. Re-checks everything the
 * `useItem` refusal that prompted it said, because the client's confirmation proves nothing: the
 * scroll must be in this player's inventory and its skill at the limit for them. A scroll that is
 * not at its limit, or any other item, is refused with nothing changed.
 */
export function convertSkillScroll(session: Session, playerId: PlayerId, itemId: EntityId): ItemResult {
  const player = actor(session, playerId);
  if (!player || !isSpawned(player)) return reject("notPermitted");

  const item = player.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return reject(player.held?.id === itemId ? "notPermitted" : "targetMissing");
  if (item.kind !== "skillScroll") return reject("notPermitted");

  if (convertScrollSkill(session, player, item.skillId) !== "converted") return reject("notPermitted");

  player.inventory = player.inventory.filter((candidate) => candidate !== item);
  return OK;
}

/**
 * Applies a consumable's authored effects through the vitals helpers. Refused, changing nothing,
 * when the definition is gone or every effect would be wasted, so a misclick at full health cannot
 * spend the only tonic. A consumable used on a downed ally goes to `revive` instead.
 */
function applyConsumable(
  session: Session,
  player: SessionPlayer,
  itemId: string,
  now: number,
  targetPlayerId: PlayerId | null,
): ItemResult {
  const content = contentForSession(session);
  const definition = content.items.get(itemId);
  if (definition?.kind !== "consumable") return reject("notPermitted");

  if (consumableTarget(definition) === "downedAlly") {
    const [effect] = definition.effects;
    if (effect?.type !== "revive") return reject("notPermitted");
    if (targetPlayerId === null) return reject("targetMissing");
    return revive(session, player, targetPlayerId, effect);
  }
  if (targetPlayerId !== null) return reject("notPermitted");

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
      case "flare":
        // Lands at the user's feet, which is always open floor, and is never wasted.
        placeFlare(session, player.position, effect.radius, effect.durationMs, now);
        applied = true;
        break;
      case "revive":
        // The schema keeps a revive alone on its item, which is routed above.
        break;
    }
  }
  return applied ? OK : reject("notPermitted");
}

type ReviveEffect = Extract<ConsumableEffect, { type: "revive" }>;

/**
 * Stands a downed ally back up. The user is already known to be standing; the target must be
 * someone else in the party, downed, connected, not being carried, and within reach, and the user
 * must afford the stamina. Every check runs before anything changes, so a refusal keeps the item.
 */
function revive(
  session: Session,
  player: SessionPlayer,
  targetPlayerId: PlayerId,
  effect: ReviveEffect,
): ItemResult {
  if (targetPlayerId === player.id) return reject("notPermitted");

  const target = session.players.get(targetPlayerId);
  if (!target) return reject("targetMissing");
  if (!isDown(target) || !target.connected || target.carriedByPlayerId !== null) {
    return reject("notPermitted");
  }
  if (!withinReach(player, target.position)) return reject("outOfRange");
  if (!spendStamina(player, effect.staminaCost)) return reject("exhausted");

  // Never revived at zero, which would still count as downed.
  target.health = Math.max(1, Math.round(PLAYER_MAX_HEALTH * effect.healthFraction));
  return OK;
}

/**
 * Opens a door or a chest, takes a scroll from a shrine altar, sits on a seat, or uses the current
 * world's exit to transition the whole party. `choiceItemId` is only for an altar, which needs it.
 */
export function interact(
  session: Session,
  playerId: PlayerId,
  targetId: EntityId,
  now = 0,
  choiceItemId?: string,
): ItemResult {
  const player = actor(session, playerId);
  if (!player) return reject("notPermitted");

  const altar = session.dungeon.altars.find((candidate) => candidate.id === targetId);
  if (altar) return takeFromAltar(session, player, altar, choiceItemId);
  // A choice means nothing anywhere else, so it is refused rather than ignored.
  if (choiceItemId !== undefined) return reject("notPermitted");

  const door = session.dungeon.doors.find((candidate) => candidate.id === targetId);
  if (door) return openDoor(player, door);

  const chest = session.dungeon.chests.find((candidate) => candidate.id === targetId);
  if (chest) return openChest(session, player, chest, now);

  const seat = seatById(session, targetId);
  if (seat) return sitOn(session, player, seat);

  // An Idol Carry altar takes the idol from whoever brings it.
  const puzzle = session.dungeon.puzzles.find((candidate) => candidate.id === targetId);
  if (puzzle) return placeIdol(session, player, puzzle);

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

/** Keeps a taken scroll off the altar it came from, like a chest's spill. */
const ALTAR_SPILL_CLEARANCE = 1.5;

/**
 * Takes one offered scroll from an altar: it drops beside the altar as ordinary loot and the rest
 * of the offer stays caged for the run. The first take wins; the check and the change happen in one
 * synchronous step, so two players reaching for it at once cannot both succeed.
 */
function takeFromAltar(
  session: Session,
  player: SessionPlayer,
  altar: AltarState,
  choiceItemId: string | undefined,
): ItemResult {
  if (!withinReach(player, altar.position)) return reject("outOfRange");
  if (altar.taken !== null) return reject("notPermitted");
  if (choiceItemId === undefined || !altar.offer.includes(choiceItemId)) return reject("notPermitted");

  dropItemNear(session, choiceItemId, altar.position, `Altar "${altar.id}"`, ALTAR_SPILL_CLEARANCE);
  altar.taken = choiceItemId;
  return OK;
}

function openDoor(player: SessionPlayer, door: DoorState): ItemResult {
  if (!withinReachOfDoor(player, door)) return reject("outOfRange");
  if (door.open) return reject("notPermitted");

  if (door.lock) {
    // Only a key lock opens by interacting; seal and hidden locks are opened some other way.
    if (door.lock.type !== "key") return reject("notPermitted");
    if (!spendKey(player, door.lock.keyItemId)) return reject("notPermitted");
    door.lock = null;
  }

  door.open = true;
  return OK;
}

/**
 * Removes one key of `keyItemId` from the player's inventory. False, changing nothing, when they
 * carry none: a key of another kind is refused and kept.
 */
function spendKey(player: SessionPlayer, keyItemId: string): boolean {
  const key = player.inventory.find((candidate) => candidate.kind === "key" && candidate.itemId === keyItemId);
  if (!key) return false;

  player.inventory = player.inventory.filter((candidate) => candidate !== key);
  return true;
}

/**
 * Keeps a chest's spill out from under its own sprite, which the client draws two world units
 * across: just past the corner of that square.
 */
const CHEST_SPILL_CLEARANCE = 1.5;

/**
 * Opens a chest once: rolls its table from the session's drop stream and spills the result beside
 * it as ordinary loot. An opened chest stays open and refuses every later try, so it pays out once
 * however many players reach it. A locked one spends a key first, exactly as a locked door does.
 * A twin-lock one only turns a keyhole until a second player turns the other inside the window.
 */
function openChest(session: Session, player: SessionPlayer, chest: ChestState, now: number): ItemResult {
  if (!withinReach(player, chest.position)) return reject("outOfRange");
  if (chest.opened) return reject("notPermitted");

  const table = contentForSession(session).lootTables.get(chest.lootTableId);
  if (!table) return reject("notPermitted");

  if (chest.twinLock && !turnTwinLock(session, player, chest, now)) return OK;

  if (chest.mimic) {
    const type = contentForSession(session).monsters.get(MIMIC_MONSTER_ID);
    if (!type) throw new Error(`Mimic chest needs monster "${MIMIC_MONSTER_ID}"`);
    chest.opened = true;
    session.dungeon.monsters.push(monsterInstance(type, chest.position, chest.id));
    return OK;
  }

  if (chest.locked) {
    if (!spendKey(player, GENERIC_KEY_ITEM_ID)) return reject("notPermitted");
    chest.locked = false;
  }

  chest.opened = true;
  spillLootTable(session, table, chest.position, `Loot table "${table.id}"`, CHEST_SPILL_CLEARANCE);
  return OK;
}
