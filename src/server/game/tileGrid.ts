import type { RoomState } from "../../shared/types/core.js";

/**
 * Flat grids over a world's tiles, indexed `y * width + x`.
 *
 * Visibility runs for every player every tick over thousands of tiles. Keying those tiles as
 * `"x,y"` strings made each lookup allocate and hash, and made the per-player discovery memory grow
 * with everything explored: up to 98,304 strings on a 384x256 world. These hold the same answers in
 * a few bytes per tile, so the cost no longer depends on how much of the map a player has seen.
 */

/** A player's memory of discovered tiles: 1 once seen. Empty until a world's size is known. */
export type DiscoveredGrid = Uint8Array;

/** A fresh, empty memory sized for a `width` by `height` world. */
export function createDiscoveredGrid(width: number, height: number): DiscoveredGrid {
  return new Uint8Array(width * height);
}

/**
 * The tiles lit this frame, reusable from frame to frame.
 *
 * Marks carry a generation number, so starting a new frame is one increment rather than clearing
 * the grid. The lit tiles are also listed in the order they were first added, so discovery can walk
 * just what is lit instead of the whole map.
 */
export class LitTiles {
  readonly width: number;
  readonly height: number;
  #marks: Uint32Array;
  #generation = 1;
  #list: Int32Array;
  #count = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.#marks = new Uint32Array(width * height);
    this.#list = new Int32Array(width * height);
  }

  /** Whether this grid already fits a `width` by `height` world. */
  fits(width: number, height: number): boolean {
    return this.width === width && this.height === height;
  }

  /** Forgets every lit tile. Invalidates whatever the previous frame was read from. */
  begin(): this {
    this.#count = 0;
    this.#generation += 1;
    if (this.#generation > 0xffffffff) {
      this.#marks.fill(0);
      this.#generation = 1;
    }
    return this;
  }

  /** Number of lit tiles. */
  get size(): number {
    return this.#count;
  }

  /** The `n`th lit tile's index, in the order tiles were first lit. */
  indexAt(n: number): number {
    return this.#list[n]!;
  }

  addIndex(index: number): void {
    if (this.#marks[index] === this.#generation) return;

    this.#marks[index] = this.#generation;
    this.#list[this.#count] = index;
    this.#count += 1;
  }

  hasIndex(index: number): boolean {
    return this.#marks[index] === this.#generation;
  }

  /** Whether the tile at world `(x, y)` is lit. Tiles off the map are never lit. */
  hasAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;

    return this.#marks[y * this.width + x] === this.#generation;
  }

  /** Convenience for tests and debugging only; the hot path uses `hasAt` and never builds keys. */
  has(key: string): boolean {
    const comma = key.indexOf(",");
    return this.hasAt(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
  }
}

/** Maps each tile to the room containing it, built once per dungeon rather than scanned per tile. */
export interface RoomGrid {
  width: number;
  height: number;
  /** Room index per tile, or -1 outside every room. When rooms overlap, the first listed wins here. */
  roomOf: Int16Array;
  /** Tile index to every room index containing it, for the tiles where rooms overlap. */
  overlaps: Map<number, number[]>;
}

export function buildRoomGrid(width: number, height: number, rooms: readonly RoomState[]): RoomGrid {
  const roomOf = new Int16Array(width * height).fill(-1);
  const overlaps = new Map<number, number[]>();

  rooms.forEach((room, roomIndex) => {
    const lastX = Math.min(width, room.x + room.width);
    const lastY = Math.min(height, room.y + room.height);
    for (let y = Math.max(0, room.y); y < lastY; y += 1) {
      for (let x = Math.max(0, room.x); x < lastX; x += 1) {
        const index = y * width + x;
        const existing = roomOf[index]!;
        if (existing === -1) {
          roomOf[index] = roomIndex;
        } else {
          const all = overlaps.get(index) ?? [existing];
          all.push(roomIndex);
          overlaps.set(index, all);
        }
      }
    }
  });

  return { width, height, roomOf, overlaps };
}
