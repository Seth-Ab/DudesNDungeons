import { z } from "zod";

/**
 * The contract for everything under `content/`.
 *
 * Content is data, not code: a designer edits JSON and restarts the server. That only works if bad
 * content fails loudly, so every file is validated here at startup and a mistake names the file and
 * the field rather than surfacing later as a monster with no stats halfway through a run.
 *
 * These schemas describe authored content. They are not the wire protocol: `src/shared/types/core.ts`
 * owns what reaches a client, and generation is what turns one into the other.
 */

/** Content ids are slugs, not UUIDs: they are written by hand and read in diffs. */
export const contentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Content ids are lowercase kebab-case");
export type ContentId = z.infer<typeof contentIdSchema>;

export const monsterTypeSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  maxHealth: z.number().int().positive(),
  /** World units per second while chasing. */
  speed: z.number().positive(),
  /** Distance at which the monster notices a player and starts chasing. */
  aggroRange: z.number().positive(),
  /** Center-to-center reach. Must exceed two player radii or the monster could never land a hit. */
  attackRange: z.number().positive(),
  damage: z.number().int().positive(),
  attackCooldownMs: z.number().int().positive(),
  /** Light a living monster gives off, in world units. Omitted for monsters that do not glow. */
  glowRadius: z.number().positive().optional(),
  /** Bosses gate their room. The gating itself is Backend step 12; this marks which ones do it. */
  boss: z.boolean().default(false),
});
export type MonsterType = z.infer<typeof monsterTypeSchema>;

/** Mirrors `itemKindSchema` in shared types. Kept separate so content can gain kinds independently. */
export const itemDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.enum(["key", "tonic", "ward"]),
});
export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;

/**
 * What a room is for. Drives which templates a generator may pick for a slot, and later which
 * rules apply inside it: bosses gate, exits end the run, entrances hold the party spawn.
 */
export const roomKindSchema = z.enum([
  "entrance",
  "hall",
  "maze",
  "trap",
  "puzzle",
  "boss",
  "exit",
]);
export type RoomKind = z.infer<typeof roomKindSchema>;

export const localPointSchema = z.object({
  /** Tile coordinates within the template, before it is placed in the world. */
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

/**
 * Where a corridor may attach. `side` is which edge of the template the opening faces, so the
 * generator knows which direction to dig without inferring it from the tiles.
 */
export const doorwaySchema = localPointSchema.extend({
  side: z.enum(["north", "south", "east", "west"]),
});
export type Doorway = z.infer<typeof doorwaySchema>;

export const templateLightSchema = localPointSchema.extend({
  name: z.string().min(1),
  radius: z.number().positive(),
});

/** How many of something to scatter. The generator rolls once per rule, inclusive of both ends. */
export const spawnCountSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .refine((count) => count.max >= count.min, { message: "max must be at least min" });

export const monsterSpawnRuleSchema = spawnCountSchema.and(z.object({ typeId: contentIdSchema }));

export const lootSpawnRuleSchema = spawnCountSchema.and(z.object({ itemId: contentIdSchema }));

export const roomTemplateSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: roomKindSchema,
  /** Rows of `#` (wall) and `.` (floor). Every row must be the same length. */
  tiles: z.array(z.string().regex(/^[#.]+$/)).min(1),
  doorways: z.array(doorwaySchema).min(1),
  lights: z.array(templateLightSchema).default([]),
  monsters: z.array(monsterSpawnRuleSchema).default([]),
  loot: z.array(lootSpawnRuleSchema).default([]),
});
export type RoomTemplate = z.infer<typeof roomTemplateSchema>;

/**
 * An entity placed by hand in an authored dungeon, at world tile coordinates.
 *
 * `entityId` pins the id this placement gets on the wire. Authored dungeons want stable ids - the
 * Ember Vault's are asserted on directly by tests - while a generated dungeon draws them from its
 * seed instead. Left out, one is derived from the dungeon id and the placement's index.
 */
const placedEntitySchema = z.object({
  x: z.number(),
  y: z.number(),
  entityId: z.string().uuid().optional(),
});

const placedMonsterSchema = placedEntitySchema.extend({ typeId: contentIdSchema });

const placedLootSchema = placedEntitySchema.extend({ itemId: contentIdSchema });

const placedDoorSchema = placedEntitySchema.extend({ locked: z.boolean().default(false) });

const placedExitSchema = placedEntitySchema.extend({ destination: z.string().min(1) });

const placedLightSchema = placedEntitySchema.extend({
  name: z.string().min(1),
  radius: z.number().positive(),
});

const authoredRoomSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: roomKindSchema,
  /** Top-left tile of the room, with its size in tiles. */
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * A dungeon laid out by hand. Every entity sits where the author put it, so it needs no seed to be
 * reproducible. The Ember Vault is one, which is what lets the existing tests keep asserting on
 * known positions while generated dungeons vary from run to run.
 */
export const authoredDungeonSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  layout: z.literal("authored"),
  tiles: z.array(z.string().regex(/^[#.]+$/)).min(1),
  spawnPoints: z.array(localPointSchema).min(1),
  rooms: z.array(authoredRoomSchema).default([]),
  monsters: z.array(placedMonsterSchema).default([]),
  loot: z.array(placedLootSchema).default([]),
  doors: z.array(placedDoorSchema).default([]),
  exits: z.array(placedExitSchema).default([]),
  lights: z.array(placedLightSchema).default([]),
});
export type AuthoredDungeon = z.infer<typeof authoredDungeonSchema>;

/** One slot in a generated dungeon: which room kinds may fill it, and how many to place. */
export const roomSlotSchema = spawnCountSchema.and(
  z.object({ kinds: z.array(roomKindSchema).min(1) }),
);

/**
 * A dungeon stitched together from room templates at run time. The generator places an entrance
 * first, then each body slot in order, then an exit, joining neighbours with corridors. The slot
 * list is therefore the shape of a run from entrance to exit.
 */
export const generatedDungeonSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  layout: z.literal("generated"),
  /** Tile size of the world the rooms are placed into. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  slots: z.array(roomSlotSchema).min(1),
  /** Light dropped along corridors, so a hallway is not pitch black end to end. */
  corridorLight: z
    .object({
      name: z.string().min(1),
      radius: z.number().positive(),
      /** One light per this many corridor tiles. */
      everyTiles: z.number().int().positive(),
    })
    .optional(),
  exitDestination: z.string().min(1),
});
export type GeneratedDungeon = z.infer<typeof generatedDungeonSchema>;

export const dungeonDefinitionSchema = z.discriminatedUnion("layout", [
  authoredDungeonSchema,
  generatedDungeonSchema,
]);
export type DungeonDefinition = z.infer<typeof dungeonDefinitionSchema>;
