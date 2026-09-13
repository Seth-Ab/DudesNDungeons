import type { Vector2 } from "../../shared/types/core.js";

export type MoveDirection = "north" | "south" | "east" | "west";

/** Unit headings the server expects on `playerMoveIntent`. It normalizes and applies its own speed. */
export const MOVE_VECTORS: Record<MoveDirection, Vector2> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

export interface DungeonMap {
  tiles: string[];
  monsters: Vector2[];
}

/**
 * A placeholder map owned by the client. Backend step 3 makes the dungeon server-authoritative, at
 * which point this is replaced by map data that arrives over the socket.
 */
export function createPlaceholderDungeon(): DungeonMap {
  return {
    tiles: [
      "################",
      "#..............#",
      "#..####........#",
      "#.......##.....#",
      "#..............#",
      "#.....###......#",
      "#..............#",
      "################",
    ],
    monsters: [
      { x: 11, y: 2 },
      { x: 5, y: 5 },
    ],
  };
}

export const LOCAL_SPAWN: Vector2 = { x: 2, y: 2 };

export function stepPosition(position: Vector2, direction: MoveDirection): Vector2 {
  const delta = MOVE_VECTORS[direction];
  return { x: position.x + delta.x, y: position.y + delta.y };
}

export function isWalkable(dungeon: DungeonMap, position: Vector2): boolean {
  const row = dungeon.tiles[position.y];
  if (row === undefined) return false;
  return row[position.x] === ".";
}

/**
 * Local prediction so the game stays responsive. The server does not resolve movement until Backend
 * step 3; once it does, snapshot positions become the source of truth and this only smooths input.
 */
export function predictMove(
  dungeon: DungeonMap,
  position: Vector2,
  direction: MoveDirection,
): Vector2 {
  const next = stepPosition(position, direction);
  return isWalkable(dungeon, next) ? next : position;
}
