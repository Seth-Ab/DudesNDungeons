import { coversTile } from "../../shared/game/movement.js";
import type { DoorState, DungeonMapState, DungeonState } from "../../shared/types/core.js";

/**
 * What blocks sight, answered in one array read.
 *
 * Line of sight asks "is this tile solid?" for every tile every ray crosses, and a lit room casts a
 * ray at every tile in it. Answering by reading the map row and then scanning every door was most of
 * that cost, and it grew with the number of doors in the dungeon. This holds the answer instead: one
 * byte per tile for walls, which never change, and one door index per tile for the closed doors
 * standing on it, which change only when a door opens.
 */
export interface OpacityGrid {
  readonly width: number;
  readonly height: number;
  readonly doors: readonly DoorState[];
  /**
   * Which closed door fills this tile, as an index into `doors`, or -1 for none or off the map. A
   * closed door fills its whole doorway, so it is one object spread over `TILE_SCALE` squared tiles.
   */
  doorIndexAt(x: number, y: number): number;
  /** Open and closed doors as a string of 1s and 0s. Changes exactly when a door does. */
  readonly signature: string;
  /** Whether a tile blocks sight: wall, outside the map, or filled by a closed door. */
  isOpaque(x: number, y: number): boolean;
}

interface Tracked {
  grid: Grid;
  /** The `open` flag of each door as of the last sync, to notice a change without a setter. */
  openAtSync: boolean[];
  doorCount: number;
  /** False until the doors have been painted into the grid once. */
  painted: boolean;
}

class Grid implements OpacityGrid {
  signature = "";
  doors: readonly DoorState[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly walls: Uint8Array,
    readonly doorAt: Int16Array,
  ) {}

  isOpaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const index = y * this.width + x;
    return this.walls[index] === 1 || (this.doorAt[index] as number) >= 0;
  }

  doorIndexAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return this.doorAt[y * this.width + x] as number;
  }
}

/** Walls depend only on the map, which a dungeon never edits, so one copy serves every dungeon sharing it. */
const wallCache = new WeakMap<DungeonMapState, Uint8Array>();
const tracked = new WeakMap<DungeonState, Tracked>();

function wallsOf(map: DungeonMapState): Uint8Array {
  let walls = wallCache.get(map);
  if (walls) return walls;

  walls = new Uint8Array(map.width * map.height);
  for (let row = 0; row < map.tiles.length; row += 1) {
    const y = map.originY + row;
    const line = map.tiles[row] ?? "";
    if (y < 0 || y >= map.height) continue;
    for (let column = 0; column < line.length; column += 1) {
      const x = map.originX + column;
      if (x >= 0 && x < map.width && line[column] === "#") walls[y * map.width + x] = 1;
    }
  }

  wallCache.set(map, walls);
  return walls;
}

function paintDoors(grid: Grid, doors: readonly DoorState[]): void {
  grid.doorAt.fill(-1);
  doors.forEach((door, index) => {
    if (door.open) return;

    const half = door.size / 2;
    const firstX = Math.max(0, Math.floor(door.position.x - half));
    const lastX = Math.min(grid.width - 1, Math.ceil(door.position.x + half));
    const firstY = Math.max(0, Math.floor(door.position.y - half));
    const lastY = Math.min(grid.height - 1, Math.ceil(door.position.y + half));
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        // The first closed door to claim a tile keeps it, as the scan this replaced took the first match.
        const cell = y * grid.width + x;
        if (coversTile(door, x, y) && grid.doorAt[cell] === -1) grid.doorAt[cell] = index;
      }
    }
  });
}

/**
 * The opacity grid for a dungeon, brought up to date with its doors.
 *
 * Call this once per frame or per batch of questions, not per tile. It compares each door's `open`
 * flag with what the grid last saw, which is a handful of reads, and repaints the doors only when
 * one differs. Checking rather than being told is what keeps this correct for every way a door can
 * change, including a test or a future mechanic that sets `door.open` directly.
 */
export function opacityFor(dungeon: DungeonState): OpacityGrid {
  let entry = tracked.get(dungeon);
  const { map, doors } = dungeon;

  if (!entry || entry.doorCount !== doors.length) {
    const grid = new Grid(map.width, map.height, wallsOf(map), new Int16Array(map.width * map.height));
    entry = { grid, openAtSync: [], doorCount: doors.length, painted: false };
    tracked.set(dungeon, entry);
  }

  if (!entry.painted || doors.some((door, index) => door.open !== entry.openAtSync[index])) {
    entry.openAtSync = doors.map((door) => door.open);
    entry.grid.doors = doors;
    entry.grid.signature = doors.map((door) => (door.open ? "1" : "0")).join("");
    paintDoors(entry.grid, doors);
    entry.painted = true;
  }

  return entry.grid;
}
