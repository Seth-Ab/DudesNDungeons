import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { z } from "zod";
import { packageRoot } from "../paths.js";
import { scalePoint } from "../game/scale.js";
import { READY_PLATE_SIZE, TILE_SCALE } from "../../shared/constants/game.js";
import { MAP_PROP_SIZES, SEAT_FACING_VECTORS } from "../../shared/constants/scenery.js";
import {
  GENERATOR_BOSS_LOCKS,
  biomeDefinitionSchema,
  dungeonDefinitionSchema,
  flowDefinitionSchema,
  omenDefinitionSchema,
  itemDefinitionSchema,
  lootTableDefinitionSchema,
  milestoneDefinitionSchema,
  monsterTypeSchema,
  roomTemplateSchema,
  shopDefinitionSchema,
  cosmeticDefinitionSchema,
  skillDefinitionSchema,
  puzzleTypeSchema,
  trapTypeSchema,
  type BiomeDefinition,
  type DungeonDefinition,
  type FlowDefinition,
  type OmenDefinition,
  type ItemDefinition,
  type LootTableDefinition,
  type MilestoneDefinition,
  type MonsterType,
  type RoomTemplate,
  type ShopDefinition,
  type CosmeticDefinition,
  type SkillDefinition,
  type PuzzleType,
  type TrapType,
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
  /** Achievements that grant a skill outright when a profile stat reaches a threshold. */
  milestones: ReadonlyMap<string, MilestoneDefinition>;
  /** Hub shops. The skill shop is `SKILL_SHOP_ID`; each sells scrolls for coin. */
  shops: ReadonlyMap<string, ShopDefinition>;
  /** Hats, cloaks and dyes: permanent profile unlocks sold at the wardrobe stall or earned. */
  cosmetics: ReadonlyMap<string, CosmeticDefinition>;
  traps: ReadonlyMap<string, TrapType>;
  puzzles: ReadonlyMap<string, PuzzleType>;
  /** Named tables that content refers to by id, such as the one a chest rolls when opened. */
  lootTables: ReadonlyMap<string, LootTableDefinition>;
  templates: ReadonlyMap<string, RoomTemplate>;
  dungeons: ReadonlyMap<string, DungeonDefinition>;
  /** The shapes a `delve` run may take: path, branches, loops and what locks the boss. */
  flows: ReadonlyMap<string, FlowDefinition>;
  /** What a `delve` run looks and fights like: roster, pools, light and room names. */
  biomes: ReadonlyMap<string, BiomeDefinition>;
  /** Run modifiers a `delve` run may roll: at most one warning and one anomaly. */
  omens: ReadonlyMap<string, OmenDefinition>;
}

/** The file each flow, biome and dungeon came from, so a reference error can name it. */
interface ContentSources {
  flows: ReadonlyMap<string, string>;
  biomes: ReadonlyMap<string, string>;
  omens: ReadonlyMap<string, string>;
  dungeons: ReadonlyMap<string, string>;
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
  sources?: Map<string, string>,
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
    sources?.set(result.data.id, file);
  }

  return entries;
}

/**
 * Every `requires` must name a skill that exists, and following them must never lead back to the
 * skill that started: a cycle would make every skill on it impossible to learn.
 */
function validateSkillPrerequisites(skills: ReadonlyMap<string, SkillDefinition>): void {
  for (const skill of skills.values()) {
    for (const requiredId of skill.requires) {
      if (!skills.has(requiredId)) {
        throw new Error(`Skill "${skill.id}" requires unknown skill "${requiredId}"`);
      }
    }
  }

  const finished = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (finished.has(id)) return;
    if (path.includes(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id].join(" -> ");
      throw new Error(`Skill prerequisites form a cycle: ${cycle}`);
    }
    for (const requiredId of skills.get(id)!.requires) visit(requiredId, [...path, id]);
    finished.add(id);
  };
  for (const id of skills.keys()) visit(id, []);
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
/**
 * The authored tiles a ready plate covers. It is centred where its authored position lands in the
 * world and `READY_PLATE_SIZE` world units across, so each corner is taken to world scale, onto the
 * world tile it falls in, and back to the authored tile that world tile belongs to.
 */
function readyPlateTiles(plate: { x: number; y: number }): { x: number; y: number }[] {
  const half = READY_PLATE_SIZE / 2;
  const centre = scalePoint(plate);
  const authored = (world: number): number => Math.floor(Math.round(world) / TILE_SCALE);
  const xs = new Set([authored(centre.x - half), authored(centre.x + half)]);
  const ys = new Set([authored(centre.y - half), authored(centre.y + half)]);
  return [...ys].flatMap((y) => [...xs].map((x) => ({ x, y })));
}

function validateReferences(content: GameContent, sources: ContentSources): void {
  for (const item of content.items.values()) {
    if (item.kind !== "weapon" || item.weapon.kind !== "ranged") continue;
    if (content.items.get(item.weapon.ammoItemId)?.kind !== "ammo") {
      throw new Error(`Weapon "${item.id}" fires "${item.weapon.ammoItemId}", which is not an ammo item`);
    }
  }
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

  for (const table of content.lootTables.values()) {
    for (const [index, entry] of table.entries.entries()) {
      if (!content.items.has(entry.itemId)) {
        throw new Error(
          `Loot table "${table.id}" field entries.${index}.itemId names unknown item "${entry.itemId}"`,
        );
      }
    }
  }

  for (const puzzle of content.puzzles.values()) {
    if (!content.items.has(puzzle.rewardItemId)) {
      throw new Error(`Puzzle "${puzzle.id}" rewards unknown item "${puzzle.rewardItemId}"`);
    }
  }

  validateSkillPrerequisites(content.skills);

  for (const flow of content.flows.values()) {
    const file = sources.flows.get(flow.id);
    const keySources = GENERATOR_BOSS_LOCKS[flow.bossLock];
    if (!keySources) {
      throw new Error(`${file} field bossLock asks for "${flow.bossLock}", which no generator stage supports`);
    }
    if (!keySources.includes(flow.keySource)) {
      throw new Error(
        `${file} field keySource "${flow.keySource}" cannot open a "${flow.bossLock}" lock; use ${keySources.join(" or ")}`,
      );
    }
  }

  const hasSkillScroll = [...content.items.values()].some((item) => item.kind === "skillScroll");
  for (const omen of content.omens.values()) {
    const file = sources.omens.get(omen.id);
    if (omen.corridorTraps !== undefined) {
      const trap = content.traps.get(omen.corridorTraps);
      if (!trap) throw new Error(`${file} field corridorTraps names unknown trap "${omen.corridorTraps}"`);
      // Corridors are one tile wide and a trap cannot be stepped around, so it must not repeat.
      if (trap.rearmMs !== undefined) {
        throw new Error(`${file} field corridorTraps names "${trap.id}", which rearms; use a single-use trap`);
      }
    }
    if (omen.shrine && !hasSkillScroll) throw new Error(`${file} field shrine needs a skill scroll item to place`);
  }

  for (const biome of content.biomes.values()) {
    const file = sources.biomes.get(biome.id);
    for (const [index, entry] of biome.roster.entries()) {
      const type = content.monsters.get(entry.typeId);
      if (!type) {
        throw new Error(`${file} field roster.${index}.typeId names unknown monster "${entry.typeId}"`);
      }
      // A boss seals the exit wherever it stands, so it can only come from the boss pool.
      if (type.boss) {
        throw new Error(`${file} field roster.${index}.typeId names boss "${entry.typeId}"; list it under bosses`);
      }
    }
    for (const [index, id] of biome.traps.entries()) {
      if (!content.traps.has(id)) throw new Error(`${file} field traps.${index} names unknown trap "${id}"`);
    }
    for (const [index, id] of biome.puzzles.entries()) {
      if (!content.puzzles.has(id)) throw new Error(`${file} field puzzles.${index} names unknown puzzle "${id}"`);
    }
    for (const [index, id] of biome.bosses.entries()) {
      const type = content.monsters.get(id);
      if (!type) throw new Error(`${file} field bosses.${index} names unknown monster "${id}"`);
      if (!type.boss) throw new Error(`${file} field bosses.${index} names "${id}", which is not a boss`);
    }
    if (!content.lootTables.has(biome.lootTableId)) {
      throw new Error(`${file} field lootTableId names unknown loot table "${biome.lootTableId}"`);
    }
  }

  for (const milestone of content.milestones.values()) {
    const skill = content.skills.get(milestone.skillId);
    if (!skill) {
      throw new Error(`Milestone "${milestone.id}" grants unknown skill "${milestone.skillId}"`);
    }
    // A grant goes straight to the profile, so it could never wait for a prerequisite.
    if (skill.requires.length > 0) {
      throw new Error(
        `Milestone "${milestone.id}" grants skill "${skill.id}", which has prerequisites`,
      );
    }
  }

  for (const shop of content.shops.values()) {
    for (const entry of [...shop.fixed, ...shop.rotating]) {
      const item = content.items.get(entry.itemId);
      if (item?.kind !== "skillScroll") {
        throw new Error(`Shop "${shop.id}" sells "${entry.itemId}", which is not a skill scroll item`);
      }
      // Buying a scroll to convert it must never pay (decision 0014).
      const conversion = content.skills.get(item.skillId)?.conversionCoin ?? 0;
      if (entry.price <= conversion) {
        throw new Error(
          `Shop "${shop.id}" sells "${entry.itemId}" for ${entry.price}, which is not above its ${conversion} coin conversion`,
        );
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

    for (const rule of template.chests) {
      if (!content.lootTables.has(rule.lootTableId)) {
        throw new Error(`${label} spawns a chest with unknown loot table "${rule.lootTableId}"`);
      }
    }
  }

  for (const dungeon of content.dungeons.values()) {
    const label = `Dungeon "${dungeon.id}"`;

    if (dungeon.layout === "delve") {
      const file = sources.dungeons.get(dungeon.id);
      for (const [index, id] of dungeon.flows.entries()) {
        if (!content.flows.has(id)) throw new Error(`${file} field flows.${index} names unknown flow "${id}"`);
      }
      for (const [index, id] of dungeon.biomes.entries()) {
        if (!content.biomes.has(id)) throw new Error(`${file} field biomes.${index} names unknown biome "${id}"`);
      }
      // A solo party draws from this list too, so it needs a flow that does not ask for company.
      if (!dungeon.flows.some((id) => content.flows.get(id)!.minParty <= 1)) {
        throw new Error(`${file} field flows has no flow a party of one can play`);
      }
      continue;
    }

    if (dungeon.layout === "authored") {
      assertRectangular(label, dungeon.tiles);

      const width = dungeon.tiles[0]?.length ?? 0;
      if (
        dungeon.ground &&
        (dungeon.ground.length !== dungeon.tiles.length || dungeon.ground.some((row) => row.length !== width))
      ) {
        throw new Error(`${label} has a ground grid that is not the same size as its tiles`);
      }

      for (const prop of dungeon.props) {
        const size = MAP_PROP_SIZES[prop.kind];
        // Footprints are in world tiles and placements in authored ones.
        const right = prop.x + size.tilesWide / TILE_SCALE;
        const bottom = prop.y + size.tilesHigh / TILE_SCALE;
        if (right > width || bottom > dungeon.tiles.length) {
          throw new Error(`${label} places a ${prop.kind} prop at (${prop.x}, ${prop.y}) that runs off the map`);
        }
      }

      const pinnedIds = new Set<string>();
      for (const placed of [
        ...dungeon.monsters,
        ...dungeon.loot,
        ...dungeon.traps,
        ...dungeon.puzzles,
        ...dungeon.chests,
        ...dungeon.doors,
        ...dungeon.exits,
        ...dungeon.lights,
      ]) {
        if (placed.entityId) pinnedIds.add(placed.entityId);
      }
      for (const placed of dungeon.dummies) {
        // A dummy is struck where it stands, so it has to stand somewhere a player can reach.
        const tile = dungeon.tiles[Math.round(placed.y)]?.[Math.round(placed.x)];
        if (tile === undefined) {
          throw new Error(`${label} places a training dummy at (${placed.x}, ${placed.y}) off the map`);
        }
        if (tile !== ".") {
          throw new Error(`${label} places a training dummy at (${placed.x}, ${placed.y}) on a wall`);
        }
        if (pinnedIds.has(placed.entityId)) {
          throw new Error(`${label} reuses entity id "${placed.entityId}" for a training dummy`);
        }
        pinnedIds.add(placed.entityId);
      }
      for (const seat of dungeon.seats) {
        // A sitter stands up onto the tile the seat faces, so that tile has to be floor.
        const tileX = Math.round(seat.x);
        const tileY = Math.round(seat.y);
        if (dungeon.tiles[tileY]?.[tileX] === undefined) {
          throw new Error(`${label} places a seat at (${seat.x}, ${seat.y}) off the map`);
        }
        const toward = SEAT_FACING_VECTORS[seat.facing];
        if (dungeon.tiles[tileY + toward.y]?.[tileX + toward.x] !== ".") {
          throw new Error(
            `${label} places a seat at (${seat.x}, ${seat.y}) facing ${seat.facing} onto no walkable floor`,
          );
        }
        if (pinnedIds.has(seat.entityId)) {
          throw new Error(`${label} reuses entity id "${seat.entityId}" for a seat`);
        }
        pinnedIds.add(seat.entityId);
      }
      for (const plate of dungeon.readyPlates) {
        // A plate is stood on, so every tile under it has to be floor a player can walk onto.
        const covered = readyPlateTiles(plate);
        if (covered.some(({ x, y }) => dungeon.tiles[y]?.[x] === undefined)) {
          throw new Error(`${label} places a ready plate at (${plate.x}, ${plate.y}) off the map`);
        }
        if (covered.some(({ x, y }) => dungeon.tiles[y]?.[x] !== ".")) {
          throw new Error(`${label} places a ready plate at (${plate.x}, ${plate.y}) on a wall`);
        }
        if (pinnedIds.has(plate.entityId)) {
          throw new Error(`${label} reuses entity id "${plate.entityId}" for a ready plate`);
        }
        pinnedIds.add(plate.entityId);
      }

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
      for (const placed of dungeon.chests) {
        if (!content.lootTables.has(placed.lootTableId)) {
          throw new Error(`${label} places a chest with unknown loot table "${placed.lootTableId}"`);
        }
      }
      for (const placed of dungeon.loot) {
        const item = content.items.get(placed.itemId);
        if (!item) {
          throw new Error(`${label} places unknown item "${placed.itemId}"`);
        }
        if (placed.count === undefined) continue;
        if (item.kind !== "ammo") {
          throw new Error(`${label} gives a count to "${placed.itemId}", which does not stack`);
        }
        if (placed.count > item.maxStack) {
          throw new Error(
            `${label} places ${placed.count} "${placed.itemId}", over its maxStack of ${item.maxStack}`,
          );
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
  const sources = { flows: new Map<string, string>(), biomes: new Map<string, string>(), omens: new Map<string, string>(), dungeons: new Map<string, string>() };
  const content: GameContent = {
    monsters: loadCollection(join(contentRoot, "monsters"), monsterTypeSchema),
    items: loadCollection(join(contentRoot, "items"), itemDefinitionSchema),
    skills: loadCollection(join(contentRoot, "skills"), skillDefinitionSchema),
    milestones: loadCollection(join(contentRoot, "milestones"), milestoneDefinitionSchema),
    shops: loadCollection(join(contentRoot, "shops"), shopDefinitionSchema),
    cosmetics: loadCollection(join(contentRoot, "cosmetics"), cosmeticDefinitionSchema),
    traps: loadCollection(join(contentRoot, "traps"), trapTypeSchema),
    puzzles: loadCollection(join(contentRoot, "puzzles"), puzzleTypeSchema),
    lootTables: loadCollection(join(contentRoot, "loot-tables"), lootTableDefinitionSchema),
    templates: loadCollection(join(contentRoot, "dungeons", "templates"), roomTemplateSchema),
    dungeons: loadCollection(join(contentRoot, "dungeons"), dungeonDefinitionSchema, sources.dungeons),
    flows: loadCollection(join(contentRoot, "flows"), flowDefinitionSchema, sources.flows),
    biomes: loadCollection(join(contentRoot, "biomes"), biomeDefinitionSchema, sources.biomes),
    omens: loadCollection(join(contentRoot, "omens"), omenDefinitionSchema, sources.omens),
  };

  validateReferences(content, sources);
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
