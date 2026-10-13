import { FIXED_LIGHT_RADIUS, TILE_SCALE } from "../../shared/constants/game.js";
import { isOpen, stepFrom } from "../../shared/game/movement.js";
import type { DungeonState, PlayerState, Vector2 } from "../../shared/types/core.js";

export type MoveDirection = "north" | "south" | "east" | "west";

/** Unit headings for each movement key. The server normalizes whatever sum it receives. */
export const MOVE_VECTORS: Record<MoveDirection, Vector2> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/**
 * Authored the same way a room template is, then blown up by `TILE_SCALE` exactly as the server
 * blows up real content. The preview is meant to look like the dungeon a player is about to enter,
 * and at world scale a hand-written 16x8 map would draw as a postage stamp in the middle of a black
 * screen instead.
 */
const PREVIEW_TILES = [
  "################",
  "#..............#",
  "#..####........#",
  "#.......##.....#",
  "#..............#",
  "#.....###......#",
  "#..............#",
  "################",
];

/** Centre of an authored tile once scaled, matching `scalePoint` on the server. */
function preview(x: number, y: number): Vector2 {
  const offset = (TILE_SCALE - 1) / 2;
  return { x: x * TILE_SCALE + offset, y: y * TILE_SCALE + offset };
}

/** Drawn before the first snapshot arrives. Movement never runs against it. */
export function createPlaceholderDungeon(): DungeonState {
  return {
    map: {
      id: "preview",
      name: "Preview",
      width: 16 * TILE_SCALE,
      height: 8 * TILE_SCALE,
      originX: 0,
      originY: 0,
      tiles: PREVIEW_TILES.flatMap((row) => {
        const wide = [...row].map((tile) => tile.repeat(TILE_SCALE)).join("");
        return Array.from({ length: TILE_SCALE }, () => wide);
      }),
    },
    monsters: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        typeId: "ash-imp",
        name: "Preview Imp",
        position: preview(11, 2),
        health: 10,
        maxHealth: 10,
        alive: true,
        boss: false,
        action: "idle",
        behavior: "melee",
        windupProgress: 0,
        facing: { x: 0, y: 1 },
        hitRange: 1,
        hitArcCos: 0.5,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        typeId: "cinder-slime",
        name: "Preview Slime",
        position: preview(5, 5),
        health: 14,
        maxHealth: 14,
        alive: true,
        boss: false,
        action: "idle",
        behavior: "melee",
        windupProgress: 0,
        facing: { x: 0, y: 1 },
        hitRange: 1,
        hitArcCos: 0.5,
      },
    ],
    lightSources: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Preview Torch",
        kind: "fixed",
        position: preview(3, 5),
        radius: FIXED_LIGHT_RADIUS,
      },
    ],
    rooms: [],
    projectiles: [],
    loot: [],
    traps: [],
    puzzles: [],
    doors: [],
    exits: [],
  };
}

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
