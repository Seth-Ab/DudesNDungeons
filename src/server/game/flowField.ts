import { coversTile, tileAt } from "../../shared/game/movement.js";
import type { DungeonMapState, DungeonState, Vector2 } from "../../shared/types/core.js";

/**
 * A breadth-first distance field over the world's tiles, for steering monsters around walls.
 *
 * Monsters run this twenty times a second, so it works on flat typed arrays and never allocates per
 * call: marks carry a generation number, so starting a new search is one increment rather than
 * clearing the grid, the same trick `LitTiles` uses.
 */

/** Neighbour offsets, orthogonal first so ties prefer a straight step. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Whether each world tile may be stood on, indexed `y * width + x`. 1 is walkable. */
export interface WalkableGrid {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
}

interface CachedWalkable {
  map: DungeonMapState;
  doors: string;
  grid: WalkableGrid;
}

const walkableCache = new WeakMap<DungeonState, CachedWalkable>();

/**
 * Every floor tile a monster may stand on: floor that no closed door fills. Cached per dungeon and
 * rebuilt only when a door opens or closes or the map is replaced.
 */
export function walkableGridFor(dungeon: DungeonState): WalkableGrid {
  const doors = dungeon.doors.map((door) => (door.open ? "1" : "0")).join("");
  const cached = walkableCache.get(dungeon);
  if (cached && cached.map === dungeon.map && cached.doors === doors) return cached.grid;

  const { width, height } = dungeon.map;
  const tiles = new Uint8Array(width * height);
  const closed = dungeon.doors.filter((door) => !door.open);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (tileAt(dungeon.map, x, y) !== ".") continue;
      if (closed.some((door) => coversTile(door, x, y))) continue;
      tiles[y * width + x] = 1;
    }
  }

  const grid = { width, height, tiles };
  walkableCache.set(dungeon, { map: dungeon.map, doors, grid });
  return grid;
}

export class FlowField {
  readonly width: number;
  readonly height: number;
  #marks: Uint32Array;
  #distances: Uint16Array;
  #queue: Int32Array;
  #generation = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.#marks = new Uint32Array(width * height);
    this.#distances = new Uint16Array(width * height);
    this.#queue = new Int32Array(width * height);
  }

  /** Whether this field already fits a `width` by `height` world. */
  fits(width: number, height: number): boolean {
    return this.width === width && this.height === height;
  }

  /**
   * Floods outward from `sources` over walkable tiles, stopping `maxSteps` tiles from the nearest
   * source. A diagonal step costs one, like an orthogonal one, but never cuts a wall's corner: both
   * tiles beside it must be walkable, because a monster is steered as a point and a point squeezed
   * through a corner would land in the wall.
   */
  compute(grid: WalkableGrid, sources: readonly Vector2[], maxSteps: number): void {
    this.#generation += 1;
    if (this.#generation > 0xffffffff) {
      this.#marks.fill(0);
      this.#generation = 1;
    }

    const { width, height, tiles } = grid;
    const queue = this.#queue;
    let head = 0;
    let tail = 0;

    for (const source of sources) {
      const x = Math.round(source.x);
      const y = Math.round(source.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;

      // A source standing where the grid says nothing may stand, such as a player in a doorway
      // frame, still seeds the field so monsters have somewhere to head.
      const index = y * width + x;
      if (this.#marks[index] === this.#generation) continue;
      this.#marks[index] = this.#generation;
      this.#distances[index] = 0;
      queue[tail] = index;
      tail += 1;
    }

    while (head < tail) {
      const index = queue[head]!;
      head += 1;
      const distance = this.#distances[index]!;
      if (distance >= maxSteps) continue;

      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const next = ny * width + nx;
        if (tiles[next] !== 1 || this.#marks[next] === this.#generation) continue;
        if (dx !== 0 && dy !== 0 && (tiles[y * width + nx] !== 1 || tiles[ny * width + x] !== 1)) {
          continue;
        }

        this.#marks[next] = this.#generation;
        this.#distances[next] = distance + 1;
        queue[tail] = next;
        tail += 1;
      }
    }
  }

  /** Steps from the nearest source, or `Infinity` for a tile the last search never reached. */
  distanceAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return Number.POSITIVE_INFINITY;

    const index = y * this.width + x;
    return this.#marks[index] === this.#generation
      ? this.#distances[index]!
      : Number.POSITIVE_INFINITY;
  }

  /**
   * Calls `visit` for each neighbour of `(x, y)` that is one step closer to a source, until `visit`
   * returns true, and reports whether any did. Nothing is allocated, and the corner-cutting rule
   * matches `compute`, so a step it offers is one a point can make.
   */
  descend(
    grid: WalkableGrid,
    x: number,
    y: number,
    visit: (tileX: number, tileY: number) => boolean,
  ): boolean {
    const here = this.distanceAt(x, y);
    if (here === 0 || here === Number.POSITIVE_INFINITY) return false;

    const wanted = here - 1;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.distanceAt(nx, ny) !== wanted) continue;
      if (
        dx !== 0 &&
        dy !== 0 &&
        (grid.tiles[y * grid.width + nx] !== 1 || grid.tiles[ny * grid.width + x] !== 1)
      ) {
        continue;
      }
      if (visit(nx, ny)) return true;
    }

    return false;
  }
}
