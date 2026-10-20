import type { SessionView } from "../network/sessionState.js";
import { selfOf } from "../network/sessionState.js";
import { itemSprite, type SpriteName } from "../rendering/tiles.js";
import type { InventoryItem, LootState, PlayerState, Vector2 } from "../../shared/types/core.js";

/** A hotbar slot by inventory index, the hand slot, or the torch pip. */
export type FeedbackSlot = number | "held" | "torch";

/**
 * What changed in this player's slots between two views, as the HUD should show it. Both come from
 * server snapshots, so a use the server refused never changes a slot and never becomes an event.
 */
export type ItemFeedbackEvent =
  | { type: "use"; slot: FeedbackSlot }
  /** `from` is where the item was in the world, or null when nothing on screen says where. */
  | { type: "pickup"; slot: FeedbackSlot; sprite: SpriteName; from: Vector2 | null };

interface Carried {
  item: InventoryItem;
  slot: FeedbackSlot;
}

function carried(player: PlayerState): Carried[] {
  const slots: Carried[] = player.inventory.map((item, slot) => ({ item, slot }));
  if (player.held) slots.push({ item: player.held, slot: "held" });
  return slots;
}

function carries(player: PlayerState, itemId: string): boolean {
  return player.held?.id === itemId || player.inventory.some((item) => item.id === itemId);
}

function activeLoot(view: SessionView): LootState[] {
  return (view.dungeon?.loot ?? []).filter((loot) => !loot.pickedUp);
}

function stackCount(item: InventoryItem): number {
  return item.kind === "ammo" ? item.count : 1;
}

/**
 * Where an item that arrived came from: the floor entry with its id, the ally who carried it, or,
 * for ammo whose stack got a fresh id or merged into one already carried, the nearest pile of the
 * same ammo that shrank or went away.
 */
function originOf(item: InventoryItem, previous: SessionView, next: SessionView, self: PlayerState): Vector2 | null {
  const before = activeLoot(previous);
  const exact = before.find((loot) => loot.id === item.id);
  if (exact) return exact.position;

  const others = previous.players.filter((player) => player.id !== self.id);
  const giver = others.find((player) => carries(player, item.id));
  if (giver) return giver.position;
  if (item.kind !== "ammo") return null;

  const after = new Map(activeLoot(next).map((loot) => [loot.id, loot]));
  const shrunk = before.filter((loot) => {
    if (loot.kind !== "ammo" || loot.itemId !== item.itemId) return false;
    const remaining = after.get(loot.id);
    return remaining?.kind !== "ammo" || remaining.count < loot.count;
  });
  const distance = (at: Vector2) => Math.hypot(at.x - self.position.x, at.y - self.position.y);
  const nearest = shrunk.sort((a, b) => distance(a.position) - distance(b.position))[0];
  if (nearest) return nearest.position;

  const stackGiver = others.find((player) =>
    carried(player).some(({ item: stack }) => stack.kind === "ammo" && stack.itemId === item.itemId),
  );
  return stackGiver?.position ?? null;
}

/**
 * Diffs two views into slot feedback for the viewer:
 *
 * - an inventory item that is gone, and is neither on the floor (dropped) nor carried by an ally
 *   (given), was used, and pulses the slot it was in;
 * - a stack whose count went down was spent, and pulses where it now sits;
 * - an item whose id is new, or a stack whose count went up, was picked up or received, and flies
 *   into its slot. A pickup refused for a full inventory changes nothing, so it shows nothing;
 * - an item that only moved (a swap with the hand, or the shuffle after a slot empties) is quiet.
 *
 * Nothing is reported across a hub/run transition, where the server banks or clears inventories.
 */
export function itemFeedbackEvents(previous: SessionView, next: SessionView): ItemFeedbackEvent[] {
  const before = selfOf(previous);
  const after = selfOf(next);
  if (!before || !after || before.id !== after.id) return [];
  if (previous.location === null || previous.location !== next.location) return [];

  const events: ItemFeedbackEvent[] = [];
  const beforeById = new Map(carried(before).map((entry) => [entry.item.id, entry]));
  const afterIds = new Set(carried(after).map((entry) => entry.item.id));

  for (const { item, slot } of carried(before)) {
    if (slot === "held" || afterIds.has(item.id)) continue;
    const dropped = activeLoot(next).some((loot) => loot.id === item.id);
    const given = next.players.some((player) => player.id !== after.id && carries(player, item.id));
    if (!dropped && !given) events.push({ type: "use", slot });
  }

  for (const { item, slot } of carried(after)) {
    const was = beforeById.get(item.id);
    const change = was ? stackCount(item) - stackCount(was.item) : 1;
    if (change < 0) events.push({ type: "use", slot });
    if (change > 0) {
      events.push({ type: "pickup", slot, sprite: itemSprite(item), from: originOf(item, previous, next, after) });
    }
  }

  if (!before.carryingTorch && after.carryingTorch) {
    const remaining = new Set(activeLoot(next).map((loot) => loot.id));
    const torch = activeLoot(previous).find((loot) => loot.kind === "torch" && !remaining.has(loot.id));
    events.push({ type: "pickup", slot: "torch", sprite: "loot-torch", from: torch?.position ?? null });
  }

  return events;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Where a fly-in starts on screen: over the item's world position, mapped the way the renderer
 * maps it (the camera is the player's predicted position at the viewport's centre), or the centre
 * itself when the position is unknown or off-screen.
 */
export function flyInStart(
  from: Vector2 | null,
  camera: Vector2,
  viewport: Viewport,
  pixelsPerWorldUnit: number,
): Vector2 {
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  if (!from) return centre;
  const x = centre.x + (from.x - camera.x) * pixelsPerWorldUnit;
  const y = centre.y + (from.y - camera.y) * pixelsPerWorldUnit;
  const onScreen = x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
  return onScreen ? { x, y } : centre;
}
