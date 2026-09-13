import { PLAYER_MOVE_SPEED, SERVER_TICK_RATE_HZ } from "../constants/game.js";
import type { DungeonState, Vector2 } from "../types/core.js";

/**
 * Movement rules shared by the server, which resolves moves, and the client, which predicts them.
 * Keeping one copy is what stops a client's prediction from drifting away from what the server does.
 *
 * Positions are continuous world units, and an integer position is the center of its tile: tile
 * (x, y) covers x - 0.5 up to x + 0.5. That matches how the renderer draws, and puts spawn points and
 * entities in the middle of their tiles.
 */

export const PLAYER_RADIUS = 0.35;

/** Distance covered by one accepted move. */
export const PLAYER_STEP_DISTANCE = PLAYER_MOVE_SPEED / SERVER_TICK_RATE_HZ;

/**
 * Time one move is worth. One step per interval is what holds players to `PLAYER_MOVE_SPEED`;
 * without it, sending intents faster would move a player faster.
 */
export const MOVE_INTERVAL_MS = 1000 / SERVER_TICK_RATE_HZ;

/**
 * How far ahead of the steady pace a player may be. Network jitter can bunch two evenly sent intents
 * together, and refusing the second would drop a legitimate move. One interval of slack absorbs that
 * without raising the long-run speed.
 */
export const MOVE_BURST_TOLERANCE_MS = MOVE_INTERVAL_MS;

const MIN_DIRECTION_MAGNITUDE = 0.001;

/** Unit vector along `direction`, or null for a direction too small to have a heading. */
export function normalizeDirection(direction: Vector2): Vector2 | null {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude < MIN_DIRECTION_MAGNITUDE) return null;

  return { x: direction.x / magnitude, y: direction.y / magnitude };
}

export interface Step {
  /** Unit heading the player now faces. */
  heading: Vector2;
  /** Where the step would land, before collision. */
  next: Vector2;
}

/** Applies one step along an unnormalized direction. Null for a direction too small to have one. */
export function stepFrom(from: Vector2, direction: Vector2): Step | null {
  const heading = normalizeDirection(direction);
  if (!heading) return null;

  return {
    heading,
    next: {
      x: from.x + heading.x * PLAYER_STEP_DISTANCE,
      y: from.y + heading.y * PLAYER_STEP_DISTANCE,
    },
  };
}

/** The tile a position falls in. */
export function tileOf(position: Vector2): Vector2 {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

export function isFloor(dungeon: DungeonState, position: Vector2): boolean {
  const { x, y } = tileOf(position);
  if (x < 0 || y < 0 || x >= dungeon.map.width || y >= dungeon.map.height) return false;

  return dungeon.map.tiles[y]?.[x] === ".";
}

export function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceSquared(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

const MIN_SEPARATION_SQUARED = (PLAYER_RADIUS * 2) ** 2;

function overlaps(a: Vector2, b: Vector2): boolean {
  return distanceSquared(a, b) < MIN_SEPARATION_SQUARED;
}

/** A closed door fills its whole tile, like a wall, so nothing can slip past its corners. */
function isClosedDoorAt(dungeon: DungeonState, position: Vector2): boolean {
  const tile = tileOf(position);
  return dungeon.doors.some((door) => {
    if (door.open) return false;
    const doorTile = tileOf(door.position);
    return doorTile.x === tile.x && doorTile.y === tile.y;
  });
}

/**
 * Whether a body may stand at `position`.
 *
 * `others` are the positions of players who can block, which excludes downed players. `from` is
 * where the moving player stands now; omit it when placing someone new or moving a monster. With
 * `from`, another player only blocks a move that closes the gap, so players who already overlap can
 * step apart rather than being stuck.
 */
export function isOpen(
  dungeon: DungeonState,
  others: readonly Vector2[],
  position: Vector2,
  from?: Vector2,
): boolean {
  if (!isFloor(dungeon, position) || isClosedDoorAt(dungeon, position)) return false;
  if (dungeon.monsters.some((monster) => monster.alive && overlaps(monster.position, position))) {
    return false;
  }

  return !others.some(
    (other) =>
      overlaps(other, position) &&
      (from === undefined || distanceSquared(other, position) <= distanceSquared(other, from)),
  );
}
