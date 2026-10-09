import { INTERACT_RANGE } from "../../shared/constants/game.js";
import { distance, distanceToDoor } from "../../shared/game/movement.js";
import type { EntityId, PlayerState, Vector2 } from "../../shared/types/core.js";
import type { SessionView } from "../network/sessionState.js";

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

/** A standing, connected party member, the only kind `giveItem` accepts. */
export function nearestStandingAlly(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number }) | null {
  return closest(
    view.players
      .filter((p) => p.id !== view.selfId && p.health > 0 && p.connected)
      .map((p) => ({ id: p.id, name: p.name, gap: distance(position, p.position) })),
  );
}

export function nearestLoot(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number }) | null {
  if (!view.dungeon) return null;
  return closest(
    view.dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .map((loot) => ({ id: loot.id, name: loot.name, gap: distance(position, loot.position) })),
  );
}

/**
 * A door is measured to the nearest point of its span, the way the server judges reach; measured
 * to the centre, no locked door could be opened from the UI.
 */
export function nearestInteraction(
  view: SessionView,
  position: Vector2,
): (ReachTarget & { gap: number; kind: "door" | "exit" }) | null {
  if (!view.dungeon) return null;
  return closest([
    ...view.dungeon.doors
      .filter((door) => !door.open)
      .map((door) => ({
        id: door.id,
        name: "door",
        kind: "door" as const,
        gap: distanceToDoor(position, door),
      })),
    ...view.dungeon.exits.map((exit) => ({
      id: exit.id,
      name: "exit",
      kind: "exit" as const,
      gap: distance(position, exit.position),
    })),
  ]);
}

export function carriedAlly(view: SessionView, self: PlayerState | null): PlayerState | null {
  if (!self?.carryingPlayerId) return null;
  return view.players.find((p) => p.id === self.carryingPlayerId) ?? null;
}
