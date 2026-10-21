import type { RoomState, Vector2 } from "../types/core.js";
import { tileOf } from "./movement.js";

/**
 * The room a position stands in. Bounds are a top-left tile plus a size, inclusive of the walls.
 * Shared so the server judges "inside the vault room" by the rule the client prompts with.
 */
export function roomAt(rooms: readonly RoomState[], position: Vector2): RoomState | null {
  const tile = tileOf(position);

  return (
    rooms.find(
      (room) =>
        tile.x >= room.x &&
        tile.x < room.x + room.width &&
        tile.y >= room.y &&
        tile.y < room.y + room.height,
    ) ?? null
  );
}
