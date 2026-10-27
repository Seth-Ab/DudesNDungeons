import { CARRY_MOVE_SPEED_MULTIPLIER, PLAYER_MOVE_SPEED, SERVER_TICK_RATE_HZ } from "../constants/game.js";
import type { DoorState, DungeonMapState, DungeonState, MonsterState, Vector2 } from "../types/core.js";

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

/** What a player carries, as far as the carry rules need it. */
export interface CarryingPlayer {
  readonly carryingPlayerId: string | null;
  readonly inventory: readonly { readonly kind: string }[];
  readonly held: { readonly kind: string } | null;
}

/** Whether a player has a Heavy Idol in a slot or in hand, which slows them and draws monsters. */
export function carriesIdol(player: Omit<CarryingPlayer, "carryingPlayerId">): boolean {
  return player.held?.kind === "idol" || player.inventory.some((item) => item.kind === "idol");
}

/**
 * The share of a step a player covers: `CARRY_MOVE_SPEED_MULTIPLIER` while carrying a body or an
 * idol, which never stack because nobody carries both, and a full step otherwise.
 */
export function carrySpeedMultiplier(player: CarryingPlayer): number {
  return player.carryingPlayerId !== null || carriesIdol(player) ? CARRY_MOVE_SPEED_MULTIPLIER : 1;
}

export interface Step {
  /** Unit heading the player now faces. */
  heading: Vector2;
  /** Where the step would land, before collision. */
  next: Vector2;
}

/**
 * Applies one step along an unnormalized direction. Null for a direction too small to have one.
 *
 * `speedMultiplier` scales the distance covered, not the pacing interval: a carrying player still
 * sends and is accepted one move per `MOVE_INTERVAL_MS`, they simply cover less ground each time.
 */
export function stepFrom(from: Vector2, direction: Vector2, speedMultiplier = 1): Step | null {
  const heading = normalizeDirection(direction);
  if (!heading) return null;

  const stepDistance = PLAYER_STEP_DISTANCE * speedMultiplier;
  return {
    heading,
    next: {
      x: from.x + heading.x * stepDistance,
      y: from.y + heading.y * stepDistance,
    },
  };
}

/** The tile a position falls in. */
export function tileOf(position: Vector2): Vector2 {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

/**
 * The map character at a world tile, or null when the tile is outside the world or outside the
 * window this map carries.
 *
 * The server holds the whole world, so its lookups never miss. A client holds only the window from
 * its last snapshot, and a tile beyond it is unknown rather than known-empty. The window reaches
 * far past both the screen and the light, so a player cannot reach its edge between snapshots.
 */
export function tileAt(map: DungeonMapState, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;

  return map.tiles[y - map.originY]?.[x - map.originX] ?? null;
}

/**
 * `,` is floor a client remembers but cannot currently see; the server's map never contains it.
 * Without it, a client predicting a step into the dark refused a move the server would accept and
 * froze in place until reconciliation snapped it forward.
 */
export function isFloor(dungeon: DungeonState, position: Vector2): boolean {
  const { x, y } = tileOf(position);
  const tile = tileAt(dungeon.map, x, y);
  return tile === "." || tile === ",";
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

/**
 * Whether a tile falls inside a doorway's span.
 *
 * A doorway is authored as a single tile and becomes a `TILE_SCALE` block in the world, so it is
 * tested as a square around its centre rather than as one tile. Testing the centre tile alone would
 * leave a closed door filling a sixteenth of its own opening.
 */
export function coversTile(door: DoorState, tileX: number, tileY: number): boolean {
  const half = door.size / 2;
  return Math.abs(tileX - door.position.x) < half && Math.abs(tileY - door.position.y) < half;
}

/**
 * How far a point is from the nearest part of a doorway, rather than from its centre.
 *
 * A door is authored as one tile and becomes a `TILE_SCALE` block, so its centre sits two world
 * units inside it while `INTERACT_RANGE` is a body's reach. Measured to the centre, a party walks
 * up to a locked door, is refused, and has to step into the doorway they cannot enter to open it.
 *
 * Shared because it was not: the server measured to the nearest point and the client measured to
 * the centre, so the client silently refused to send an interact the server would have accepted,
 * and no locked door could be opened from the UI at all. One definition, per `AGENTS.md`.
 */
export function distanceToDoor(position: Vector2, door: DoorState): number {
  const half = door.size / 2;
  const nearest = {
    x: Math.min(Math.max(position.x, door.position.x - half), door.position.x + half),
    y: Math.min(Math.max(position.y, door.position.y - half), door.position.y + half),
  };

  return distance(position, nearest);
}

/** A closed door fills its whole doorway, like a wall, so nothing can slip past its corners. */
export function isClosedDoorAt(dungeon: DungeonState, position: Vector2): boolean {
  const tile = tileOf(position);
  return dungeon.doors.some((door) => !door.open && coversTile(door, tile.x, tile.y));
}

/**
 * Whether a body may stand at `position`.
 *
 * `others` are the positions of players who can block, which excludes downed players. `from` is
 * where the moving player stands now; omit it when placing someone new or moving a monster. With
 * `from`, another player only blocks a move that closes the gap, so players who already overlap can
 * step apart rather than being stuck. `ignore` is a monster that does not block, so a monster can
 * ask whether it fits without being stopped by its own body.
 */
export function isOpen(
  dungeon: DungeonState,
  others: readonly Vector2[],
  position: Vector2,
  from?: Vector2,
  ignore?: MonsterState,
): boolean {
  if (!isFloor(dungeon, position) || isClosedDoorAt(dungeon, position)) return false;
  if (dungeon.monsters.some(
      (monster) => monster !== ignore && monster.alive && overlaps(monster.position, position),
    )) {
    return false;
  }

  return !others.some(
    (other) =>
      overlaps(other, position) &&
      (from === undefined || distanceSquared(other, position) <= distanceSquared(other, from)),
  );
}
