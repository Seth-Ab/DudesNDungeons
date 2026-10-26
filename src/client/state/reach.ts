import { INTERACT_RANGE } from "../../shared/constants/game.js";
import { distance, distanceToDoor } from "../../shared/game/movement.js";
import type { DoorLock, EntityId, InventoryItem, PlayerState, Vector2 } from "../../shared/types/core.js";
import type { SessionView } from "../network/sessionState.js";
import { nearestOfferedSlot } from "./altars.js";

/**
 * What a player at `position` could act on right now, from data already in the snapshot. The
 * server stays the judge: a guess that is wrong comes back as `actionRejected`.
 */

export interface ReachTarget {
  id: EntityId;
  name: string;
}

function closest<T extends { gap: number }>(targets: T[]): T | null {
  const reachable = targets.filter((target) => target.gap <= INTERACT_RANGE);
  return reachable.sort((a, b) => a.gap - b.gap)[0] ?? null;
}

export function nearestDownedAlly(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number }) | null {
  return closest(
    view.players
      .filter((p) => p.id !== view.selfId && p.health <= 0 && !p.carriedByPlayerId)
      .map((p) => ({ id: p.id, name: p.name, gap: distance(position, p.position) })),
  );
}

/** A downed, connected ally nobody is carrying: the only kind smelling salts can revive. */
export function nearestRevivableAlly(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number }) | null {
  return closest(
    view.players
      .filter((p) => p.id !== view.selfId && p.health <= 0 && !p.carriedByPlayerId && p.connected)
      .map((p) => ({ id: p.id, name: p.name, gap: distance(position, p.position) })),
  );
}

/** Whether an item is used on a downed ally rather than on its holder. */
export function usedOnDownedAlly(item: InventoryItem | undefined): boolean {
  return item?.kind === "consumable" && item.useOn === "downedAlly";
}

/** A standing, connected party member with a character, the only kind `giveItem` accepts. */
export function nearestStandingAlly(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number }) | null {
  return closest(
    view.players
      .filter((p) => p.id !== view.selfId && p.health > 0 && p.connected && p.appearance !== null)
      .map((p) => ({ id: p.id, name: p.name, gap: distance(position, p.position) })),
  );
}

export function nearestLoot(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number; count: number | null }) | null {
  if (!view.dungeon) return null;
  return closest(
    view.dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .map((loot) => ({
        id: loot.id,
        name: loot.name,
        gap: distance(position, loot.position),
        // A stack's size, so the prompt can say how many are on the floor.
        count: loot.kind === "ammo" ? loot.count : null,
      })),
  );
}

/**
 * A door is measured to the nearest point of its span, the way the server judges reach; measured
 * to the centre, no locked door could be opened from the UI. An opened chest is spent and is no
 * longer a target, and neither is a taken altar. A seat is one only while nobody is on it and the viewer is standing: the server
 * refuses a taken seat, and a sitter has to stand up before taking another.
 */
export function nearestInteraction(
  view: SessionView,
  position: Vector2,
): (ReachTarget & {
  gap: number;
  kind: "door" | "exit" | "chest" | "seat" | "altar";
  locked: boolean;
  lock: DoorLock | null;
  /** For an altar, the scroll nearest the viewer, which a take names; null for every other kind. */
  choiceItemId: string | null;
}) | null {
  if (!view.dungeon) return null;
  const taken = new Set(view.players.map((p) => p.seatId));
  const sitting = view.players.some((p) => p.id === view.selfId && p.seatId !== null);
  return closest([
    ...view.dungeon.chests
      .filter((chest) => !chest.opened)
      .map((chest) => ({
        id: chest.id,
        name: "chest",
        kind: "chest" as const,
        locked: chest.locked,
        lock: null,
        choiceItemId: null,
        gap: distance(position, chest.position),
      })),
    ...view.dungeon.doors
      .filter((door) => !door.open)
      .map((door) => ({
        id: door.id,
        name: "door",
        kind: "door" as const,
        locked: door.lock !== null,
        lock: door.lock,
        choiceItemId: null,
        gap: distanceToDoor(position, door),
      })),
    ...view.dungeon.exits.map((exit) => ({
      id: exit.id,
      name: "exit",
      kind: "exit" as const,
      locked: false,
      lock: null,
      choiceItemId: null,
      gap: distance(position, exit.position),
    })),
    // A spent altar is no longer a target: its scrolls are caged for the run.
    ...view.dungeon.altars.flatMap((altar) => {
      const slot = nearestOfferedSlot(altar, position);
      if (!slot) return [];
      return [
        {
          id: altar.id,
          name: "altar",
          kind: "altar" as const,
          locked: false,
          lock: null,
          choiceItemId: slot.itemId,
          gap: distance(position, altar.position),
        },
      ];
    }),
    ...(sitting ? [] : (view.dungeon.map.seats ?? []))
      .filter((seat) => !taken.has(seat.id))
      .map((seat) => ({
        id: seat.id,
        name: "seat",
        kind: "seat" as const,
        locked: false,
        lock: null,
        choiceItemId: null,
        gap: distance(position, seat),
      })),
  ]);
}

export function carriedAlly(view: SessionView, self: PlayerState | null): PlayerState | null {
  if (!self?.carryingPlayerId) return null;
  return view.players.find((p) => p.id === self.carryingPlayerId) ?? null;
}
