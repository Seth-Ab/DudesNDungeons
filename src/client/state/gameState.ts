import {
  INTERACT_RANGE,
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_HEALTH,
} from "../../shared/constants/game.js";
import { distance, isOpen, stepFrom } from "../../shared/game/movement.js";
import type {
  DungeonState,
  EntityId,
  InventoryItem,
  PlayerState,
  Vector2,
} from "../../shared/types/core.js";

export type MoveDirection = "north" | "south" | "east" | "west";

/** Unit headings for each movement key. The server normalizes whatever sum it receives. */
export const MOVE_VECTORS: Record<MoveDirection, Vector2> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/** Drawn behind the lobby before the first snapshot arrives. Movement never runs against it. */
export const PLACEHOLDER_TILES: readonly string[] = [
  "################",
  "#..............#",
  "#..####........#",
  "#.......##.....#",
  "#..........#####",
  "#.....###..#...#",
  "#..............#",
  "################",
];

/** Sums the held movement keys into one heading. Null when nothing is held or opposites cancel. */
export function headingFrom(held: Iterable<MoveDirection>): Vector2 | null {
  let x = 0;
  let y = 0;
  for (const direction of new Set(held)) {
    x += MOVE_VECTORS[direction].x;
    y += MOVE_VECTORS[direction].y;
  }
  return x === 0 && y === 0 ? null : { x, y };
}

/**
 * Predicts one step using the server's own movement rules from `src/shared/game/movement.ts`, so a
 * move the server will accept shows up immediately and one it will refuse never shows up at all.
 */
export function predictMove(
  dungeon: DungeonState,
  others: readonly PlayerState[],
  from: Vector2,
  direction: Vector2,
): Vector2 {
  const step = stepFrom(from, direction);
  if (!step) return from;

  // Downed players block nobody on the server, so they must not block the prediction either.
  const positions = others.filter((player) => player.health > 0).map((player) => player.position);
  return isOpen(dungeon, positions, step.next, from) ? step.next : from;
}

/** Once no intent has been sent for this long, every in-flight move has been answered. */
export const PREDICTION_SETTLE_MS = 250;

/** Beyond this distance a prediction is wrong rather than merely ahead, e.g. a refused move. */
export const MAX_PREDICTION_ERROR = 1;

/**
 * Where to draw the local player when a snapshot arrives. Snapshots trail the prediction by the
 * round trip, so adopting each one while moving would pull the player backwards every tick. The
 * prediction is kept while intents are in flight and close to the server; otherwise the server wins.
 */
export function reconcile(
  predicted: Vector2,
  authoritative: Vector2,
  msSinceLastIntent: number,
): Vector2 {
  if (msSinceLastIntent >= PREDICTION_SETTLE_MS) return { ...authoritative };

  const error = Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y);
  return error > MAX_PREDICTION_ERROR ? { ...authoritative } : predicted;
}

/** What the interact key would do. */
export interface Interaction {
  action: "pickup" | "interact";
  targetId: EntityId;
  position: Vector2;
  label: string;
  /**
   * Why the server would refuse it, when the client can already tell. Shown to the player instead of
   * sending a message that is certain to bounce with a vague reason.
   */
  refusal: string | null;
}

/**
 * The nearest loot, closed door, or exit within the server's reach of `position`, so the prompt never
 * offers something the server will refuse for distance.
 */
export function nearestInteraction(
  dungeon: DungeonState,
  self: PlayerState,
  position: Vector2,
): Interaction | null {
  const key = self.inventory.find((item) => item.kind === "key");
  const packFull = self.inventory.length >= MAX_INVENTORY_SIZE;

  const candidates: Interaction[] = [
    ...dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .map((loot): Interaction => ({
        action: "pickup",
        targetId: loot.id,
        position: loot.position,
        label: `Pick up ${loot.name}`,
        refusal: packFull ? "Your pack is full." : null,
      })),
    ...dungeon.doors
      .filter((door) => !door.open)
      .map((door): Interaction => {
        if (!door.locked) {
          return { action: "interact", targetId: door.id, position: door.position, label: "Open door", refusal: null };
        }
        return key
          ? {
              action: "interact",
              targetId: door.id,
              position: door.position,
              label: `Unlock with ${key.name}`,
              refusal: null,
            }
          : {
              action: "interact",
              targetId: door.id,
              position: door.position,
              label: "Locked door",
              refusal: "Locked. Find a key to open it.",
            };
      }),
    ...(dungeon.cleared
      ? []
      : dungeon.exits.map((exit): Interaction => ({
          action: "interact",
          targetId: exit.id,
          position: exit.position,
          label: "Take the exit",
          refusal: null,
        }))),
  ];

  let nearest: Interaction | null = null;
  let nearestDistance = INTERACT_RANGE;
  for (const candidate of candidates) {
    const gap = distance(candidate.position, position);
    if (gap <= nearestDistance) {
      nearest = candidate;
      nearestDistance = gap;
    }
  }

  return nearest;
}

export type UsePlan = { itemId: EntityId } | { refusal: string };

/** Whether using `item` would work, checked before sending so the player gets a specific reason. */
export function planUse(
  self: PlayerState,
  item: InventoryItem | undefined,
  missing = "Nothing in that slot.",
): UsePlan {
  if (!item) return { refusal: missing };
  if (item.kind === "key") return { refusal: "Keys open doors. Stand by one and press E." };
  if (self.health >= PLAYER_MAX_HEALTH) return { refusal: "Already at full health." };
  return { itemId: item.id };
}
