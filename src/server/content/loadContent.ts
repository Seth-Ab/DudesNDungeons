import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { z } from "zod";
import { packageRoot } from "../paths.js";
import {
  dungeonDefinitionSchema,
  itemDefinitionSchema,
  monsterTypeSchema,
  roomTemplateSchema,
  skillDefinitionSchema,
  puzzleTypeSchema,
  trapTypeSchema,
  upgradeDefinitionSchema,
  type DungeonDefinition,
  type ItemDefinition,
  type MonsterType,
  type RoomTemplate,
  type SkillDefinition,
  type PuzzleType,
  type TrapType,
  type UpgradeDefinition,
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
  skills: ReadonlyMap<string, SkillDefinition>;
  upgrades: ReadonlyMap<string, UpgradeDefinition>;
  traps: ReadonlyMap<string, TrapType>;
  puzzles: ReadonlyMap<string, PuzzleType>;
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

  const root = packageRoot(import.meta.url);
  const candidate = join(root, "content");
  if (!existsSync(candidate)) {
    throw new Error(`Package root ${root} has no content/ directory. Set CONTENT_DIR.`);
  }
  return candidate;
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
  for (const item of content.items.values()) {
    if (item.kind === "skillScroll" && !content.skills.has(item.skillId)) {
      throw new Error(`Skill scroll "${item.id}" teaches unknown skill "${item.skillId}"`);
    }
  }

  for (const monster of content.monsters.values()) {
    for (const [index, entry] of (monster.loot?.entries ?? []).entries()) {
      if (!content.items.has(entry.itemId)) {
        throw new Error(
          `Monster "${monster.id}" field loot.entries.${index}.itemId names unknown item "${entry.itemId}"`,
        );
      }
    }
  }

  for (const puzzle of content.puzzles.values()) {
    if (!content.items.has(puzzle.rewardItemId)) {
      throw new Error(`Puzzle "${puzzle.id}" rewards unknown item "${puzzle.rewardItemId}"`);
    }
  }

  const skillTiers = new Set<string>();
  for (const upgrade of content.upgrades.values()) {
    const label = `Upgrade "${upgrade.id}"`;
    if (!content.skills.has(upgrade.skillId)) {
      throw new Error(`${label} belongs to unknown skill "${upgrade.skillId}"`);
    }

    const skillTier = `${upgrade.skillId}:${upgrade.tier}`;
    if (skillTiers.has(skillTier)) {
      throw new Error(`Skill "${upgrade.skillId}" has more than one tier ${upgrade.tier} upgrade`);
    }
    skillTiers.add(skillTier);

    for (const prerequisiteId of upgrade.requires) {
      const prerequisite = content.upgrades.get(prerequisiteId);
      if (!prerequisite) {
        throw new Error(`${label} requires unknown upgrade "${prerequisiteId}"`);
      }
      if (prerequisite.skillId !== upgrade.skillId) {
        throw new Error(`${label} requires an upgrade from a different skill`);
      }
      if (prerequisite.tier >= upgrade.tier) {
        throw new Error(`${label} must require only lower-tier upgrades`);
      }
    }
  }

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
      const type = content.monsters.get(rule.typeId);
      if (!type) {
        throw new Error(`${label} spawns unknown monster type "${rule.typeId}"`);
      }
      // A boss seals the exit wherever it stands, so one loose in a hall would gate the run on a
      // fight the party was never told was a boss fight.
      if (type.boss && template.kind !== "boss") {
        throw new Error(`${label} spawns boss "${rule.typeId}" outside a boss room`);
      }
    }

    // And the other way round: a boss room that can roll no boss is an empty room with a big name.
    if (
      template.kind === "boss" &&
      !template.monsters.some((rule) => rule.min > 0 && content.monsters.get(rule.typeId)?.boss)
    ) {
      throw new Error(`${label} is a boss room that does not always spawn a boss`);
    }

    for (const rule of template.traps) {
      if (!content.traps.has(rule.typeId)) {
        throw new Error(`${label} spawns unknown trap type "${rule.typeId}"`);
      }
    }

    for (const rule of template.puzzles) {
      if (!content.puzzles.has(rule.typeId)) {
        throw new Error(`${label} spawns unknown puzzle type "${rule.typeId}"`);
      }
      for (const plate of rule.plates) {
        if (template.tiles[plate.y]?.[plate.x] !== ".") {
          throw new Error(`${label} has a puzzle plate at (${plate.x}, ${plate.y}) that is not on floor`);
        }
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
        const type = content.monsters.get(placed.typeId);
        if (!type) {
          throw new Error(`${label} places unknown monster type "${placed.typeId}"`);
        }
        const inBossRoom = dungeon.rooms.some(
          (room) =>
            room.kind === "boss" &&
            placed.x >= room.x &&
            placed.x < room.x + room.width &&
            placed.y >= room.y &&
            placed.y < room.y + room.height,
        );
        if (type.boss && !inBossRoom) {
          throw new Error(`${label} places boss "${placed.typeId}" outside a boss room`);
        }
      }
      for (const placed of dungeon.traps) {
        if (!content.traps.has(placed.typeId)) {
          throw new Error(`${label} places unknown trap type "${placed.typeId}"`);
        }
      }
      for (const placed of dungeon.puzzles) {
        if (!content.puzzles.has(placed.typeId)) {
          throw new Error(`${label} places unknown puzzle type "${placed.typeId}"`);
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
    skills: loadCollection(join(contentRoot, "skills"), skillDefinitionSchema),
    upgrades: loadCollection(join(contentRoot, "upgrades"), upgradeDefinitionSchema),
    traps: loadCollection(join(contentRoot, "traps"), trapTypeSchema),
    puzzles: loadCollection(join(contentRoot, "puzzles"), puzzleTypeSchema),
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
