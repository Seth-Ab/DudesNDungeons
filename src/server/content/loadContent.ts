import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
  dungeonDefinitionSchema,
  itemDefinitionSchema,
  monsterTypeSchema,
  roomTemplateSchema,
  type DungeonDefinition,
  type ItemDefinition,
  type MonsterType,
  type RoomTemplate,
} from "./schema.js";

/**
 * Reads `content/` from disk and validates it.
 *
 * On disk rather than imported, so editing a monster's damage is a file change and a restart rather
 * than a rebuild. That is the point of `content/` existing separately from `src/`.
 *
 * Everything is loaded once at startup and shared by every session, because content is immutable:
 * generation copies out of it and never writes back.
 */

export interface GameContent {
  monsters: ReadonlyMap<string, MonsterType>;
  items: ReadonlyMap<string, ItemDefinition>;
  templates: ReadonlyMap<string, RoomTemplate>;
  dungeons: ReadonlyMap<string, DungeonDefinition>;
}

/**
 * Finds `content/` by walking up to the package root and taking `content/` from there.
 *
 * Anchored on `package.json` rather than on the first directory named `content`, because this file
 * lives in `src/server/content/` and would otherwise find its own directory. Works from `src/` under
 * tsx and from `dist/` under plain node. `CONTENT_DIR` overrides it for a deployment that ships
 * content somewhere else.
 */
export function resolveContentRoot(override = process.env.CONTENT_DIR): string {
  if (override) return resolve(override);

  const start = dirname(fileURLToPath(import.meta.url));
  let directory = start;

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, "package.json"))) {
      const candidate = join(directory, "content");
      if (!existsSync(candidate)) {
        throw new Error(`Package root ${directory} has no content/ directory. Set CONTENT_DIR.`);
      }
      return candidate;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(`Could not find a package root above ${start}. Set CONTENT_DIR.`);
}

function readJsonFiles(directory: string): { file: string; data: unknown }[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = join(directory, name);
      try {
        return { file, data: JSON.parse(readFileSync(file, "utf8")) as unknown };
      } catch (cause) {
        throw new Error(`${file} is not valid JSON: ${(cause as Error).message}`);
      }
    });
}

/**
 * Parses every file in a directory into a map keyed by id, failing with the offending file named.
 *
 * The schema's input type is `unknown` rather than `T`: several content schemas have defaults, so
 * what a file may contain is not what parsing produces.
 */
function loadCollection<T extends { id: string }>(
  directory: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Map<string, T> {
  const entries = new Map<string, T>();

  for (const { file, data } of readJsonFiles(directory)) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(`${file} is not valid content: ${detail}`);
    }

    if (entries.has(result.data.id)) {
      throw new Error(`${file} reuses the content id "${result.data.id}"`);
    }
    entries.set(result.data.id, result.data);
  }

  return entries;
}

/**
 * Every doorway must reach every other doorway through the template's own floor.
 *
 * A template whose doorways open into separate pockets builds a dungeon that cannot be finished: the
 * generator joins rooms doorway to doorway, so a party walks in one side and finds no way through.
 * It is invisible by eye on anything maze-shaped and costs a whole playthrough to discover, so it is
 * checked here instead.
 */
function assertDoorwaysConnect(label: string, tiles: readonly string[], doorways: readonly { x: number; y: number }[]): void {
  const floorAt = (x: number, y: number): boolean => tiles[y]?.[x] === ".";
  const key = (x: number, y: number): string => `${x},${y}`;

  // A doorway is cut out of the wall, so what matters is the floor tile just inside it.
  const insides = doorways.map((doorway) => {
    const neighbours = [
      { x: doorway.x + 1, y: doorway.y },
      { x: doorway.x - 1, y: doorway.y },
      { x: doorway.x, y: doorway.y + 1 },
      { x: doorway.x, y: doorway.y - 1 },
    ].filter((tile) => floorAt(tile.x, tile.y));

    if (neighbours.length === 0) {
      throw new Error(`${label} has a doorway at (${doorway.x}, ${doorway.y}) with no floor beside it`);
    }
    return neighbours[0]!;
  });

  const first = insides[0];
  if (!first) return;

  const seen = new Set<string>([key(first.x, first.y)]);
  const queue = [first];
  while (queue.length > 0) {
    const tile = queue.shift()!;
    for (const next of [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 },
    ]) {
      if (seen.has(key(next.x, next.y)) || !floorAt(next.x, next.y)) continue;
      seen.add(key(next.x, next.y));
      queue.push(next);
    }
  }

  const stranded = insides.find((inside) => !seen.has(key(inside.x, inside.y)));
  if (stranded) {
    throw new Error(
      `${label} has doorways that do not connect through its own floor: (${stranded.x}, ${stranded.y}) is walled off from (${first.x}, ${first.y})`,
    );
  }
}

/** Every tile row has to be the same length, or the map is ragged and collision reads past its end. */
function assertRectangular(label: string, tiles: readonly string[]): void {
  const width = tiles[0]?.length ?? 0;
  if (tiles.some((row) => row.length !== width)) {
    throw new Error(`${label} has rows of differing lengths`);
  }
}

/**
 * Catches the content mistakes a per-file schema cannot see: a template naming a monster that does
 * not exist, a doorway outside its own tiles, a ragged map. All of them would otherwise surface much
 * later, as a crash mid-run or a dungeon nobody can finish.
 */
function validateReferences(content: GameContent): void {
  for (const template of content.templates.values()) {
    const label = `Room template "${template.id}"`;
    assertRectangular(label, template.tiles);

    const height = template.tiles.length;
    const width = template.tiles[0]?.length ?? 0;

    for (const doorway of template.doorways) {
      if (doorway.x >= width || doorway.y >= height) {
        throw new Error(`${label} has a doorway at (${doorway.x}, ${doorway.y}) outside its tiles`);
      }
    }

    assertDoorwaysConnect(label, template.tiles, template.doorways);

    for (const light of template.lights) {
      if (light.x >= width || light.y >= height) {
        throw new Error(`${label} has a light at (${light.x}, ${light.y}) outside its tiles`);
      }
    }

    for (const rule of template.monsters) {
      if (!content.monsters.has(rule.typeId)) {
        throw new Error(`${label} spawns unknown monster type "${rule.typeId}"`);
      }
    }

    for (const rule of template.loot) {
      if (!content.items.has(rule.itemId)) {
        throw new Error(`${label} spawns unknown item "${rule.itemId}"`);
      }
    }
  }

  for (const dungeon of content.dungeons.values()) {
    const label = `Dungeon "${dungeon.id}"`;

    if (dungeon.layout === "authored") {
      assertRectangular(label, dungeon.tiles);

      for (const placed of dungeon.monsters) {
        if (!content.monsters.has(placed.typeId)) {
          throw new Error(`${label} places unknown monster type "${placed.typeId}"`);
        }
      }
      for (const placed of dungeon.loot) {
        if (!content.items.has(placed.itemId)) {
          throw new Error(`${label} places unknown item "${placed.itemId}"`);
        }
      }
      continue;
    }

    // A generated dungeon is unbuildable if any slot names a kind no template provides, so check it
    // here rather than failing at generation time with a half-built map.
    const kinds = new Set([...content.templates.values()].map((template) => template.kind));
    for (const slot of [...dungeon.slots, { kinds: ["entrance"] }, { kinds: ["exit"] }]) {
      if (!slot.kinds.some((kind) => kinds.has(kind as never))) {
        throw new Error(`${label} needs a template of kind ${slot.kinds.join(" or ")}, and none exists`);
      }
    }
  }
}

export function loadContent(contentRoot = resolveContentRoot()): GameContent {
  const content: GameContent = {
    monsters: loadCollection(join(contentRoot, "monsters"), monsterTypeSchema),
    items: loadCollection(join(contentRoot, "items"), itemDefinitionSchema),
    templates: loadCollection(join(contentRoot, "dungeons", "templates"), roomTemplateSchema),
    dungeons: loadCollection(join(contentRoot, "dungeons"), dungeonDefinitionSchema),
  };

  validateReferences(content);
  return content;
}

let cached: GameContent | null = null;

/** The process-wide catalog. Loaded on first use so a test can point at its own content first. */
export function gameContent(): GameContent {
  cached ??= loadContent();
  return cached;
}

/** Test seam. Passing null restores loading from disk on the next call. */
export function setGameContent(content: GameContent | null): void {
  cached = content;
}
