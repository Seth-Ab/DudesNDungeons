import type { DungeonMapState } from "../../shared/types/core.js";
import {
  floorSprite,
  LIT_FLOOR,
  LIT_WALL,
  SPRITE_TILE_SIZE,
  tileLook,
  UNKNOWN,
  wallMask,
  wallSprite,
} from "./tiles.js";

/**
 * The floor and wall sprites, stamped once into cached chunks instead of once per tile per frame.
 *
 * What a tile looks like depends only on whether it is wall, floor, or unseen, plus its neighbours
 * for a wall's edge and its own coordinates for a floor's variant. Whether it is lit or remembered
 * is the lightmap's business. So the picture changes when the player discovers something, not
 * every time a torch moves, and redrawing two thousand sprites sixty times a second to produce the
 * same picture was most of what the renderer spent on the map.
 *
 * Chunks are keyed by world position rather than by snapshot window, because the window slides with
 * the player and a cache laid out against it would be thrown away a tile at a time.
 */

/** Tiles along one side of a cached chunk. */
export const CHUNK_TILES = 32;

/** How many chunks are kept at once. A viewport touches at most a handful; the rest are rebuilt on demand. */
const MAX_CACHED_CHUNKS = 24;

const SURFACE_UNKNOWN = 0;
const SURFACE_FLOOR = 1;
const SURFACE_WALL = 2;

function surfaceOf(tile: string): number {
  const look = tileLook(tile);
  if (look === null) return SURFACE_UNKNOWN;
  return look.surface === "wall" ? SURFACE_WALL : SURFACE_FLOOR;
}

/** The character `wallMask` expects for each surface; it only needs to tell wall, floor, and unseen apart. */
const SURFACE_TILE = [UNKNOWN, LIT_FLOOR, LIT_WALL] as const;

/**
 * What the client knows of the world's surfaces, accumulated across snapshots.
 *
 * A snapshot carries only a window of the map, and the window moves. Merging each one in keeps what
 * was seen after it scrolls out of the window, which is also the truth: a remembered tile stays
 * remembered. Merging reports which chunks a change touches so only those are redrawn.
 */
export class SurfaceGrid {
  readonly width: number;
  readonly height: number;
  readonly chunksAcross: number;
  readonly chunksDown: number;
  readonly #surfaces: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.chunksAcross = Math.max(1, Math.ceil(width / CHUNK_TILES));
    this.chunksDown = Math.max(1, Math.ceil(height / CHUNK_TILES));
    this.#surfaces = new Uint8Array(Math.max(0, width * height));
  }

  /** Wall, floor, or unseen. Anything outside the world is unseen, which a wall edge treats as solid. */
  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return SURFACE_UNKNOWN;
    return this.#surfaces[y * this.width + x] ?? SURFACE_UNKNOWN;
  }

  chunkIndex(chunkX: number, chunkY: number): number {
    return chunkY * this.chunksAcross + chunkX;
  }

  /**
   * Folds a snapshot window in and returns the chunks whose picture changed.
   *
   * A changed tile dirties its own chunk, and the neighbouring chunk too when it sits on the edge:
   * a wall chooses its edge sprite from the tile beside it, and that tile may be across the border.
   */
  merge(map: DungeonMapState): Set<number> {
    const dirty = new Set<number>();

    for (let row = 0; row < map.tiles.length; row += 1) {
      const y = map.originY + row;
      const line = map.tiles[row] ?? "";
      if (y < 0 || y >= this.height) continue;

      for (let column = 0; column < line.length; column += 1) {
        const x = map.originX + column;
        if (x < 0 || x >= this.width) continue;

        const surface = surfaceOf(line[column] ?? UNKNOWN);
        const index = y * this.width + x;
        if (this.#surfaces[index] === surface) continue;

        this.#surfaces[index] = surface;
        this.#markDirty(dirty, x, y);
      }
    }

    return dirty;
  }

  #markDirty(dirty: Set<number>, x: number, y: number): void {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      dirty.add(this.chunkIndex(Math.floor(nx / CHUNK_TILES), Math.floor(ny / CHUNK_TILES)));
    }
  }
}

/**
 * What the cache needs from a drawing context. Structural rather than the DOM's own types, so this
 * file loads under node and its tests need no browser, the same split `tileset.ts` makes from
 * `tiles.ts`. The renderer passes real canvas contexts, which satisfy these as they are.
 */
export interface ChunkContext {
  clearRect(x: number, y: number, width: number, height: number): void;
}

/** One cached square of the world, drawn at sprite resolution and scaled up when it is blitted. */
export interface ChunkSurface<Image, Context extends ChunkContext> {
  readonly image: Image;
  readonly context: Context;
}

export interface BlitContext<Image> {
  drawImage(
    image: Image,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}

export interface TileLayerOptions<Image, Context extends ChunkContext> {
  /** Stamps a sprite into a destination rect on a chunk's own context, as `Tileset.draw` does. */
  tileset: {
    draw(ctx: Context, name: string, x: number, y: number, width: number, height: number): void;
  };
  /** Makes a square surface `size` pixels across. A parameter so tests can run without a DOM. */
  createSurface: (size: number) => ChunkSurface<Image, Context>;
}

export interface TileLayer<Image> {
  /**
   * Brings the cache up to date with a snapshot. `worldKey` names the world the map belongs to, so a
   * new dungeon starts clean rather than inheriting the last one's surfaces.
   */
  sync(map: DungeonMapState, worldKey: string): void;
  /**
   * Blits the chunks overlapping the given tile range.
   *
   * `toScreen` maps a world position to a screen pixel. Chunks are placed with both edges rounded
   * to whole pixels, as `Tileset.draw` does for a sprite, so neighbouring chunks meet exactly.
   */
  draw(
    ctx: BlitContext<Image>,
    range: { minX: number; maxX: number; minY: number; maxY: number },
    toScreen: (x: number, y: number) => { x: number; y: number },
    pixelsPerWorldUnit: number,
  ): void;
}

export function createTileLayer<Image, Context extends ChunkContext>({
  tileset,
  createSurface,
}: TileLayerOptions<Image, Context>): TileLayer<Image> {
  let grid: SurfaceGrid | null = null;
  let currentWorld = "";
  let lastTiles: readonly string[] | null = null;
  const chunks = new Map<number, ChunkSurface<Image, Context>>();
  const stale = new Set<number>();
  /** Chunks drawn this frame, so eviction never throws away one that is on screen. */
  const used = new Set<number>();

  const readSurfaceTile = (x: number, y: number): string | null => SURFACE_TILE[grid?.at(x, y) ?? SURFACE_UNKNOWN] ?? UNKNOWN;

  function rebuild(chunk: ChunkSurface<Image, Context>, chunkX: number, chunkY: number): void {
    if (!grid) return;
    const { context } = chunk;
    context.clearRect(0, 0, CHUNK_TILES * SPRITE_TILE_SIZE, CHUNK_TILES * SPRITE_TILE_SIZE);

    for (let row = 0; row < CHUNK_TILES; row += 1) {
      const y = chunkY * CHUNK_TILES + row;
      for (let column = 0; column < CHUNK_TILES; column += 1) {
        const x = chunkX * CHUNK_TILES + column;
        const surface = grid.at(x, y);
        if (surface === SURFACE_UNKNOWN) continue;

        const sprite = surface === SURFACE_WALL ? wallSprite(wallMask(readSurfaceTile, x, y)) : floorSprite(x, y);
        tileset.draw(context, sprite, column * SPRITE_TILE_SIZE, row * SPRITE_TILE_SIZE, SPRITE_TILE_SIZE, SPRITE_TILE_SIZE);
      }
    }
  }

  return {
    sync(map, worldKey) {
      const world = `${worldKey}:${map.width}x${map.height}`;
      if (grid === null || world !== currentWorld) {
        grid = new SurfaceGrid(map.width, map.height);
        currentWorld = world;
        chunks.clear();
        stale.clear();
        lastTiles = null;
      }

      // A snapshot replaces the row array whole, so an unchanged reference means nothing arrived.
      if (map.tiles === lastTiles) return;
      lastTiles = map.tiles;
      for (const index of grid.merge(map)) stale.add(index);
    },

    draw(ctx, range, toScreen, pixelsPerWorldUnit) {
      if (!grid) return;

      used.clear();
      const firstX = Math.max(0, Math.floor(range.minX / CHUNK_TILES));
      const lastX = Math.min(grid.chunksAcross - 1, Math.floor(range.maxX / CHUNK_TILES));
      const firstY = Math.max(0, Math.floor(range.minY / CHUNK_TILES));
      const lastY = Math.min(grid.chunksDown - 1, Math.floor(range.maxY / CHUNK_TILES));
      const side = CHUNK_TILES * pixelsPerWorldUnit;

      for (let chunkY = firstY; chunkY <= lastY; chunkY += 1) {
        for (let chunkX = firstX; chunkX <= lastX; chunkX += 1) {
          const index = grid.chunkIndex(chunkX, chunkY);
          let chunk = chunks.get(index);
          if (!chunk) {
            chunk = createSurface(CHUNK_TILES * SPRITE_TILE_SIZE);
            chunks.set(index, chunk);
            stale.add(index);
          }
          if (stale.delete(index)) rebuild(chunk, chunkX, chunkY);
          used.add(index);

          const origin = toScreen(chunkX * CHUNK_TILES - 0.5, chunkY * CHUNK_TILES - 0.5);
          const left = Math.round(origin.x);
          const top = Math.round(origin.y);
          ctx.drawImage(
            chunk.image,
            0,
            0,
            CHUNK_TILES * SPRITE_TILE_SIZE,
            CHUNK_TILES * SPRITE_TILE_SIZE,
            left,
            top,
            Math.round(origin.x + side) - left,
            Math.round(origin.y + side) - top,
          );
        }
      }

      for (const index of chunks.keys()) {
        if (chunks.size <= MAX_CACHED_CHUNKS) break;
        if (used.has(index)) continue;
        chunks.delete(index);
        stale.delete(index);
      }
    },
  };
}

