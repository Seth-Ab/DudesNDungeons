import { TILE_SCALE } from "../../shared/constants/game.js";
import type { Vector2 } from "../../shared/types/core.js";
import type { BuiltDungeon } from "./dungeonBuilder.js";

/**
 * Blows an authored dungeon up to world scale.
 *
 * Content is authored small and played large. A room template is a dozen characters wide because
 * that is what a person can read in a diff and reason about while placing doorways; the world it
 * becomes is `TILE_SCALE` times finer on each axis, so that same room is roughly fifty world tiles
 * across and a party of four can spread out inside it.

 * Doing it here, on the built dungeon, rather than inside the generator is what keeps the two
 * apart. Generation lays out rooms, routes corridors, and scatters loot entirely in authored tiles,
 * where a corridor is one tile wide and the breadth-first search over room padding is cheap. This
 * runs once at the end and is the only place that knows the world is bigger than the page.
 *
 * Only coordinates and sizes scale. A light's radius, a monster's speed, and a player's reach are
 * authored in world units already and are not touched here, which is what lets `LIGHT_SCALE` differ
 * from `TILE_SCALE` and the dungeon come out darker than it was rather than merely larger.
 */

/**
 * Where an authored tile's centre lands in the world.
 *
 * Authored tile `a` becomes world tiles `a * scale` through `a * scale + scale - 1`, so its centre
 * sits half a tile in from each end of that block. At a scale of four that is a half-integer, which
 * is the exact middle of the block: loot, torches, and doors come out centred in the space they
 * were authored to occupy rather than pushed into a corner of it.
 */
export function scalePoint(point: Vector2, scale = TILE_SCALE): Vector2 {
  const offset = (scale - 1) / 2;
  return { x: point.x * scale + offset, y: point.y * scale + offset };
}

/** One authored row becomes `scale` identical world rows, each character repeated `scale` times. */
function scaleTiles(tiles: readonly string[], scale: number): string[] {
  const scaled: string[] = [];

  for (const row of tiles) {
    const wide = [...row].map((tile) => tile.repeat(scale)).join("");
    for (let repeat = 0; repeat < scale; repeat += 1) scaled.push(wide);
  }

  return scaled;
}

export function scaleDungeon(built: BuiltDungeon, scale = TILE_SCALE): BuiltDungeon {
  if (scale === 1) return built;

  const { dungeon } = built;
  const point = (position: Vector2): Vector2 => scalePoint(position, scale);

  return {
    dungeon: {
      map: {
        ...dungeon.map,
        // Every tile of the source map is present, so the window starts at the world's own origin.
        originX: 0,
        originY: 0,
        width: dungeon.map.width * scale,
        height: dungeon.map.height * scale,
        tiles: scaleTiles(dungeon.map.tiles, scale),
      },
      // Room bounds are a block of whole tiles rather than a point, so they scale at both corners:
      // the top-left moves out and the size grows with it, leaving the room flush with its walls.
      rooms: dungeon.rooms.map((room) => ({
        ...room,
        x: room.x * scale,
        y: room.y * scale,
        width: room.width * scale,
        height: room.height * scale,
      })),
      monsters: dungeon.monsters.map((monster) => ({ ...monster, position: point(monster.position) })),
      loot: dungeon.loot.map((loot) => ({ ...loot, position: point(loot.position) })),
      // A door spans its whole authored tile, so its span grows with the tile. Scaling the centre
      // alone would leave a locked door plugging one world tile of the sixteen it used to fill.
      doors: dungeon.doors.map((door) => ({
        ...door,
        position: point(door.position),
        size: door.size * scale,
      })),
      exits: dungeon.exits.map((exit) => ({ ...exit, position: point(exit.position) })),
      lightSources: dungeon.lightSources.map((light) => ({ ...light, position: point(light.position) })),
    },
    spawnPoints: built.spawnPoints.map(point),
    seed: built.seed,
  };
}
