import { randomUUID } from "node:crypto";
import { MAX_INVENTORY_SIZE } from "../../shared/constants/game.js";
import { roomAt } from "../../shared/game/rooms.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import type { EntityId, PlayerId } from "../../shared/types/core.js";
import type { ShopDefinition } from "../content/schema.js";
import { markProfileChanged } from "../profiles/profile.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { contentForSession, heldStacks } from "./progression.js";
import { createRng } from "./random.js";

/** The hub skill shop. The wardrobe stall sells cosmetics from their own content kind instead. */
export const SKILL_SHOP_ID = "scroll-shop";

export type ShopEntry = ShopDefinition["fixed"][number];
export interface StockEntry extends ShopEntry {
  rotating: boolean;
}

/** FNV-1a over a string: a stable 32-bit seed, so a rotation never depends on `Math.random`. */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The entries of a rotating pool that are in stock for one room's run count. A pure function of the
 * room code, the count and the pool (in id order, so file order does not matter): the same inputs
 * give the same entries on every call and after every restart. Shared by the cosmetics shop (#137).
 */
export function rotatingStock<T extends { itemId: string }>(
  pool: readonly T[],
  count: number,
  roomCode: string,
  runCount: number,
): T[] {
  const ordered = [...pool].sort((left, right) => left.itemId.localeCompare(right.itemId));
  const rng = createRng(seedOf(`${roomCode}:${runCount}`));
  return rng.shuffle(ordered).slice(0, count);
}

/** What the room's shop sells right now: the fixed entries, then this run count's rotation. */
export function stockFor(shop: ShopDefinition, roomCode: string, runCount: number): StockEntry[] {
  return [
    ...shop.fixed.map((entry) => ({ ...entry, rotating: false })),
    ...rotatingStock(shop.rotating, shop.rotatingCount, roomCode, runCount).map((entry) => ({
      ...entry,
      rotating: true,
    })),
  ];
}

/** The session's current skill-shop stock, or an empty list if content has no such shop. */
export function currentStock(session: Session): StockEntry[] {
  const shop = contentForSession(session).shops.get(SKILL_SHOP_ID);
  return shop ? stockFor(shop, session.roomCode, session.vault.runCount) : [];
}

/** The stock as the wire carries it: scroll names and skills resolved, never trusted back. */
export function skillShopStockMessage(session: Session): ServerMessage {
  const content = contentForSession(session);
  const entries = currentStock(session).flatMap((entry) => {
    const item = content.items.get(entry.itemId);
    if (item?.kind !== "skillScroll") return [];
    return [
      {
        itemId: entry.itemId,
        name: item.name,
        skillId: item.skillId,
        price: entry.price,
        rotating: entry.rotating,
      },
    ];
  });
  return { type: "skillShopStock", entries };
}

/** Whether a player may shop from where they stand: in the hub, inside a room of kind `shop`. */
export function inShopArea(session: Session, player: SessionPlayer): boolean {
  if (session.location !== "hub") return false;
  return roomAt(session.dungeon.rooms, player.position)?.kind === "shop";
}

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: "notPermitted" | "outOfRange" | "outOfStock" | "insufficientCoin" | "inventoryFull" | "skillMaxed" };

/**
 * Buys one scroll named by stock entry. The client never names a price: it is read from content
 * here. Every refusal returns before anything is touched, so a refused purchase changes neither the
 * profile's coin nor the inventory. A scroll whose prerequisites the buyer lacks is allowed, since
 * it can wait or go to a teammate.
 */
export function buySkillScroll(session: Session, playerId: PlayerId, itemId: EntityId | string): PurchaseResult {
  const player = session.players.get(playerId);
  if (!player || isDown(player) || !isSpawned(player) || session.location !== "hub") {
    return { ok: false, reason: "notPermitted" };
  }
  if (!inShopArea(session, player)) return { ok: false, reason: "outOfRange" };

  const stocked = currentStock(session).find((entry) => entry.itemId === itemId);
  const content = contentForSession(session);
  const item = stocked ? content.items.get(stocked.itemId) : undefined;
  if (!stocked || item?.kind !== "skillScroll") return { ok: false, reason: "outOfStock" };

  const skill = content.skills.get(item.skillId);
  if (!skill) return { ok: false, reason: "outOfStock" };
  if (skill.maxStacks !== null && heldStacks(player, skill.id) >= skill.maxStacks) {
    return { ok: false, reason: "skillMaxed" };
  }
  if (player.profile.coin < stocked.price) return { ok: false, reason: "insufficientCoin" };
  if (player.inventory.length >= MAX_INVENTORY_SIZE) return { ok: false, reason: "inventoryFull" };

  player.profile.coin -= stocked.price;
  markProfileChanged(player.profile);
  player.inventory.push({ id: randomUUID(), name: item.name, kind: "skillScroll", skillId: item.skillId });
  return { ok: true };
}
