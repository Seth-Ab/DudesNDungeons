import { z } from "zod";
import {
  CONSUMABLE_ICONS,
  type CONSUMABLE_TARGETS,
  DEFAULT_MONSTER_WINDUP_MS,
  MAX_ITEM_DESCRIPTION_LENGTH,
  MAX_STACK_SIZE,
  MILESTONE_STATS,
  MONSTER_BEHAVIORS,
} from "../../shared/constants/game.js";
import {
  DEFAULT_MAP_THEME,
  FACEABLE_PROP_KINDS,
  GROUND_ROW_PATTERN,
  LIGHT_FIXTURES,
  LIGHT_TINTS,
  MAP_PROP_FACINGS,
  MAP_PROP_KINDS,
  MAP_THEMES,
  MAX_PROP_LABEL_LENGTH,
  SEAT_FACINGS,
  STALL_TINTS,
} from "../../shared/constants/scenery.js";

/**
 * The contract for everything under `content/`.
 *
 * Content is data, not code: a designer edits JSON and restarts the server. That only works if bad
 * content fails loudly, so every file is validated here at startup and a mistake names the file and
 * the field rather than surfacing later as a monster with no stats halfway through a run.
 *
 * These schemas describe authored content. They are not the wire protocol: `src/shared/types/core.ts`
 * owns what reaches a client, and generation is what turns one into the other.
 *
 * Two units appear here and mixing them up is the easy mistake. Every `x`, `y`, `width`, `height`,
 * and tile row is in authored tiles, which `src/server/game/scale.ts` multiplies by `TILE_SCALE` on
 * the way to the world - so a template stays a readable dozen characters wide while the room a party
 * walks into is fifty. Every distance - a light's radius, a monster's speed, its reach - is already
 * in world units and is used exactly as written. Halving a template's width halves the room; halving
 * a torch's radius does not.
 */

/** Content ids are slugs, not UUIDs: they are written by hand and read in diffs. */
export const contentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Content ids are lowercase kebab-case");
export type ContentId = z.infer<typeof contentIdSchema>;

/**
 * What a monster may leave behind. Each of `rolls` independently picks one entry by weight, or
 * nothing with probability `nothingWeight` out of the total, so a table with a single entry and no
 * `nothingWeight` is a guaranteed drop. Chests reuse this shape.
 */
export const lootTableSchema = z
  .object({
    rolls: z.number().int().positive().default(1),
    entries: z
      .array(z.object({ itemId: contentIdSchema, weight: z.number().positive() }))
      .min(1),
    nothingWeight: z.number().nonnegative().default(0),
  })
  .strict();
export type LootTable = z.infer<typeof lootTableSchema>;

/**
 * A named loot table under `content/loot-tables/`, for whatever refers to one by id rather than
 * carrying its own. Chests do: a template says which table a chest rolls, not what is in it.
 */
export const lootTableDefinitionSchema = lootTableSchema.extend({ id: contentIdSchema }).strict();
export type LootTableDefinition = z.infer<typeof lootTableDefinitionSchema>;

/** A ranged monster's bolt. World units, like every distance here. */
export const projectileStatsSchema = z
  .object({
    /** World units per second. */
    speed: z.number().positive(),
    /** Collision radius around the bolt's centre, added to a player's own radius. */
    radius: z.number().positive(),
    /** Raw damage, scaled by the victim's resistance through `damagePlayer`. */
    damage: z.number().int().positive(),
    /** How far it flies before it fizzles out. */
    range: z.number().positive(),
  })
  .strict();
export type ProjectileStats = z.infer<typeof projectileStatsSchema>;

/** A charger's dash. */
export const chargeStatsSchema = z
  .object({
    /** World units per second while dashing. */
    speed: z.number().positive(),
    /** Furthest it dashes in a straight line. */
    distance: z.number().positive(),
    /** How long it is helpless after hitting a wall: the punish window. */
    stunMs: z.number().int().positive(),
  })
  .strict();
export type ChargeStats = z.infer<typeof chargeStatsSchema>;

export const monsterTypeSchema = z
  .object({
  id: contentIdSchema,
  name: z.string().min(1),
  maxHealth: z.number().int().positive(),
  /** World units per second while chasing. */
  speed: z.number().positive(),
  /** Distance, in world units, at which the monster notices a player and starts chasing. */
  aggroRange: z.number().positive(),
  /** Center-to-center reach. Must exceed two player radii or the monster could never land a hit. */
  attackRange: z.number().positive(),
  damage: z.number().int().positive(),
  attackCooldownMs: z.number().int().positive(),
  /**
   * How long the monster telegraphs before a hit resolves. The hit lands on whoever is inside its
   * reach and arc when this elapses; the cooldown starts then, not when the wind-up begins.
   */
  windupMs: z.number().int().positive().default(DEFAULT_MONSTER_WINDUP_MS),
  /** Cosine of the hit's half-angle about the facing fixed at wind-up start. 0.5 is a 120 degree cone. */
  hitArcCos: z.number().min(-1).max(1).default(0.5),
  /** Reach of the resolved hit. Omitted, it equals `attackRange`. */
  hitRange: z.number().positive().optional(),
  /** Light a living monster gives off, in world units. Omitted for monsters that do not glow. */
  glowRadius: z.number().positive().optional(),
  /**
   * A boss seals every exit in its dungeon until it is defeated (`src/server/game/bosses.ts`). It
   * may only spawn in a boss room, and every boss room must always spawn one.
   */
  boss: z.boolean().default(false),
  /** Rolled once when a player kills the monster. Omitted, it drops nothing. */
  loot: lootTableSchema.optional(),
  /**
   * How the monster fights. `melee` walks up and swings. `ranged` keeps `preferredRange` from its
   * target and fires `projectile` from up to `attackRange`; its `damage` is unused in favour of
   * `projectile.damage`. `charger` winds up from within `attackRange`, then dashes `charge.distance`
   * in a straight line for `damage`, and is stunned if it hits a wall.
   */
  behavior: z.enum(MONSTER_BEHAVIORS).default("melee"),
  /** Ranged only: the gap it tries to hold. Must not exceed `attackRange`. */
  preferredRange: z.number().positive().optional(),
  projectile: projectileStatsSchema.optional(),
  charge: chargeStatsSchema.optional(),
  })
  .superRefine((monster, context) => {
    if (monster.behavior === "ranged") {
      if (!monster.projectile) {
        context.addIssue({
          code: "custom",
          path: ["projectile"],
          message: "A ranged monster needs projectile stats",
        });
      }
      if (monster.preferredRange !== undefined && monster.preferredRange > monster.attackRange) {
        context.addIssue({
          code: "custom",
          path: ["preferredRange"],
          message: "preferredRange cannot exceed attackRange",
        });
      }
    } else if (monster.projectile || monster.preferredRange !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["projectile"],
        message: "Only a ranged monster has projectile stats or a preferredRange",
      });
    }

    if (monster.behavior === "charger" && !monster.charge) {
      context.addIssue({
        code: "custom",
        path: ["charge"],
        message: "A charger needs charge stats",
      });
    } else if (monster.behavior !== "charger" && monster.charge) {
      context.addIssue({
        code: "custom",
        path: ["charge"],
        message: "Only a charger has charge stats",
      });
    }
  });
export type MonsterType = z.infer<typeof monsterTypeSchema>;

/**
 * A kind of trap. A trap fires when a standing, connected player comes within `radius` while it is
 * armed, and every effect is applied by the server through the shared vitals helpers.
 *
 * With no `rearmMs` a trap is single use and ends the run `disabled`; with one it rearms that long
 * after firing, once nobody is standing in reach, so lingering on a plate is not a damage loop.
 */
export const trapTypeSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().min(1),
    /** World units, like a light radius: it is not scaled with the map. */
    radius: z.number().positive(),
    /** Raw health damage, scaled by the victim's resistance like any other hit. */
    damage: z.number().int().nonnegative().default(0),
    /** Flat resistance removed. Resistance never regenerates, so this is the lasting cost. */
    resistanceLoss: z.number().int().nonnegative().default(0),
    /** Flat stamina removed, down to zero. */
    staminaDrain: z.number().int().nonnegative().default(0),
    rearmMs: z.number().int().positive().optional(),
  })
  .refine((trap) => trap.damage + trap.resistanceLoss + trap.staminaDrain > 0, {
    message: "A trap must have at least one effect",
  });
export type TrapType = z.infer<typeof trapTypeSchema>;

/**
 * A kind of cooperative puzzle: a set of pressure plates that must all be held at the same time,
 * each by a different standing, connected player, for `holdMs`. Releasing any plate (stepping off,
 * going down, disconnecting) resets the hold to zero. Solving it drops `rewardItemId` on the first
 * plate and leaves the puzzle solved for the rest of the run.
 *
 * Puzzle power is where `puzzlePowerBonus` skills land: the bonus of every player currently
 * holding a plate is summed, and each point shortens the required hold by `holdReductionMsPerPower`,
 * never below `minHoldMs`.
 */
export const puzzleTypeSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().min(1),
    /** World units, like a trap radius: it is not scaled with the map. */
    plateRadius: z.number().positive(),
    holdMs: z.number().int().positive(),
    minHoldMs: z.number().int().positive(),
    holdReductionMsPerPower: z.number().int().nonnegative().default(0),
    rewardItemId: contentIdSchema,
  })
  .refine((puzzle) => puzzle.minHoldMs <= puzzle.holdMs, {
    message: "minHoldMs must not exceed holdMs",
  });
export type PuzzleType = z.infer<typeof puzzleTypeSchema>;

const ordinaryItemDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.enum(["key", "torch"]),
});

/**
 * What a consumable does when used. Variants are explicit, like progression effects, so an unknown
 * effect type fails content validation instead of silently doing nothing in play.
 */
export const consumableEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heal"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("restoreResistance"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("restoreStamina"), amount: z.number().int().positive() }),
  /**
   * Puts a temporary light at the user's feet. `radius` is in world units, like any light, and the
   * dungeon removes it `durationMs` after it is placed.
   */
  z.object({
    type: z.literal("flare"),
    radius: z.number().positive(),
    durationMs: z.number().int().positive(),
  }),
  /**
   * Stands a downed ally in reach back up at `healthFraction` of max health, costing the user
   * `staminaCost`. The only targeted effect, so it must be a consumable's sole effect.
   */
  z.object({
    type: z.literal("revive"),
    healthFraction: z.number().positive().max(1),
    staminaCost: z.number().int().nonnegative(),
  }),
]);
export type ConsumableEffect = z.infer<typeof consumableEffectSchema>;

/**
 * Effects apply in order. Using the item is refused only when every one of them would be wasted,
 * so a misclick at full health cannot spend it; the item is otherwise consumed. A flare is never
 * wasted. A revive acts on someone else, so it stands alone rather than mixing with effects on the
 * user.
 */
const consumableDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.literal("consumable"),
  description: z.string().min(1).max(MAX_ITEM_DESCRIPTION_LENGTH),
  icon: z.enum(CONSUMABLE_ICONS).default("tonic"),
  effects: z
    .array(consumableEffectSchema)
    .min(1)
    .refine(
      (effects) => effects.length === 1 || effects.every((effect) => effect.type !== "revive"),
      { message: "A revive must be the consumable's only effect" },
    ),
});

/** Who a consumable is used on, from its effects: a revive needs a downed ally, the rest the user. */
export function consumableTarget(
  item: Extract<ItemDefinition, { kind: "consumable" }>,
): (typeof CONSUMABLE_TARGETS)[number] {
  return item.effects.some((effect) => effect.type === "revive") ? "downedAlly" : "self";
}

const skillScrollDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.literal("skillScroll"),
  skillId: contentIdSchema,
});

/**
 * A melee weapon's swing. Every stat is required, so a sword never silently inherits the unarmed
 * values: the file is the whole description of how it fights.
 */
const meleeWeaponStatsSchema = z
  .object({
    kind: z.literal("melee"),
    damage: z.number().int().positive(),
    /** Center-to-center reach, in world units. */
    range: z.number().positive(),
    /** Cosine of the half-angle the swing covers: 0.5 is 60 degrees either side. */
    arcCos: z.number().min(-1).max(1),
    cooldownMs: z.number().int().positive(),
    staminaCost: z.number().nonnegative(),
  })
  .strict();

/**
 * A bow. Drawing is held, not instant: the server times the draw itself, and the fraction of
 * `drawMs` it reaches (capped at 1) picks how far the arrow flies between `minRange` and
 * `maxRange`. Distances are world units, like every other distance in content.
 */
const rangedWeaponStatsSchema = z
  .object({
    kind: z.literal("ranged"),
    /** How long a full draw takes. Holding longer adds nothing. */
    drawMs: z.number().int().positive(),
    /** A release sooner than this fires nothing and costs nothing, so a tap is not a shot. */
    minDrawMs: z.number().int().nonnegative(),
    /** Range of the weakest shot, at the shortest draw that fires. */
    minRange: z.number().positive(),
    /** Range of a full draw, before any progression bonus. */
    maxRange: z.number().positive(),
    damage: z.number().int().positive(),
    /** World units per second. */
    projectileSpeed: z.number().positive(),
    /** Collision radius around the arrow, added to a body's own radius. */
    projectileRadius: z.number().positive(),
    /** Spent when the arrow is loosed, not when the draw starts, but needed in full to start. */
    staminaCost: z.number().nonnegative(),
    /** The ammo item one shot consumes. `loadContent` checks it names an ammo item. */
    ammoItemId: contentIdSchema,
  })
  .strict();

/**
 * The weapon block. Strict on purpose: an unknown field fails content validation, so each weapon
 * issue extends this shape with the stats it defines instead of authors guessing at them.
 */
const weaponStatsSchema = z.discriminatedUnion("kind", [
  meleeWeaponStatsSchema,
  rangedWeaponStatsSchema,
]);
export type MeleeWeaponStats = z.infer<typeof meleeWeaponStatsSchema>;
export type RangedWeaponStats = z.infer<typeof rangedWeaponStatsSchema>;

const weaponDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.literal("weapon"),
  weapon: weaponStatsSchema,
});

/**
 * Stackable ammo. A stack of any count up to `maxStack` takes one inventory slot, and a pickup
 * tops up a carried stack of the same item before it takes a free slot.
 */
const ammoDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: z.literal("ammo"),
  maxStack: z.number().int().positive().max(MAX_STACK_SIZE),
});

/** Mirrors the shared item kinds while requiring every skill scroll to name what it teaches. */
export const itemDefinitionSchema = z
  .discriminatedUnion("kind", [
    ordinaryItemDefinitionSchema,
    consumableDefinitionSchema,
    skillScrollDefinitionSchema,
    weaponDefinitionSchema,
    ammoDefinitionSchema,
  ])
  .superRefine((item, context) => {
    // Kept here rather than on the bow's own schema, which has to stay a plain object to sit in
    // the weapon union.
    if (item.kind !== "weapon" || item.weapon.kind !== "ranged") return;
    if (item.weapon.minRange > item.weapon.maxRange) {
      context.addIssue({
        code: "custom",
        path: ["weapon", "minRange"],
        message: "minRange cannot exceed maxRange",
      });
    }
    if (item.weapon.minDrawMs > item.weapon.drawMs) {
      context.addIssue({
        code: "custom",
        path: ["weapon", "minDrawMs"],
        message: "minDrawMs cannot exceed drawMs",
      });
    }
  });
export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;

/**
 * Passive effects that a skill stack may grant.
 *
 * These line up with the four skill areas called out in Backend step 11. Keeping the variants
 * explicit means the eventual gameplay implementation must handle every supported effect instead
 * of accepting an arbitrary stat name that silently does nothing.
 */
export const progressionEffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attackDamageBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("sightRadiusBonus"), amount: z.number().positive() }),
  z.object({ type: z.literal("resistanceBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("puzzlePowerBonus"), amount: z.number().int().positive() }),
]);
export type ProgressionEffect = z.infer<typeof progressionEffectSchema>;

/**
 * A permanent ability held on a player profile as a stack count, per decision 0014.
 *
 * `effects` is the first stack. `maxStacks` caps the count, or is null for a skill that keeps
 * stacking. A stacking skill adds exactly one of `stackEffects`, the explicit effects of stacks 2
 * to `maxStacks` and so only for a capped skill, or `perStackEffects`, added again for every stack
 * beyond the first and required when the skill is unlimited. `requires` names skills the player
 * must already hold a stack of before a scroll of this one can be used; the loader refuses unknown
 * ids and cycles, which a single definition cannot see. `conversionCoin` is what a scroll of this
 * skill converts to once the skill is at its limit; it must stay below the scroll's shop price.
 */
export const skillDefinitionSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    effects: z.array(progressionEffectSchema).min(1),
    maxStacks: z.number().int().positive().nullable(),
    requires: z.array(contentIdSchema).default([]),
    conversionCoin: z.number().int().positive(),
    stackEffects: z.array(z.array(progressionEffectSchema).min(1)).optional(),
    perStackEffects: z.array(progressionEffectSchema).min(1).optional(),
  })
  .superRefine((skill, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: "custom", path: [path], message });
    const { maxStacks, stackEffects, perStackEffects } = skill;

    if (stackEffects && perStackEffects) {
      issue("stackEffects", "a skill takes stackEffects or perStackEffects, not both");
    } else if (maxStacks === 1) {
      if (stackEffects || perStackEffects) {
        issue("maxStacks", "a skill with maxStacks 1 does not stack, so it takes no stack effects");
      }
    } else if (maxStacks === null) {
      if (stackEffects) {
        issue("stackEffects", "an unlimited skill uses perStackEffects instead");
      } else if (!perStackEffects) {
        issue("perStackEffects", "an unlimited skill needs perStackEffects");
      }
    } else if (stackEffects) {
      if (stackEffects.length !== maxStacks - 1) {
        issue(
          "stackEffects",
          `stackEffects must list ${maxStacks - 1} stacks, one per stack after the first`,
        );
      }
    } else if (!perStackEffects) {
      issue("maxStacks", "a stacking skill needs stackEffects or perStackEffects");
    }
  });
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

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
  /** Where the party vault is used. Only meaningful in the hub, the one place the vault opens. */
  "vault",
]);
export type RoomKind = z.infer<typeof roomKindSchema>;

export const localPointSchema = z.object({
  /** Authored tile coordinates within the template, before it is placed and scaled. */
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
  /** World units, not authored tiles. Compare against `FIXED_LIGHT_RADIUS`. */
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

export const trapSpawnRuleSchema = spawnCountSchema.and(z.object({ typeId: contentIdSchema }));

/** A puzzle in a room template: two or more plates, in authored tiles local to the template. */
export const puzzleSpawnRuleSchema = z.object({
  typeId: contentIdSchema,
  plates: z.array(localPointSchema).min(2),
});

export const lootSpawnRuleSchema = spawnCountSchema.and(
  z.object({
    itemId: contentIdSchema,
    /** Chance that this rule runs at all. Keeps rare loot rare without inventing empty items. */
    chance: z.number().min(0).max(1).default(1),
  }),
);

/**
 * A chest in a room template. Placed like loot, but what it holds is rolled from `lootTableId`
 * only when a player opens it. A `locked` chest takes a key to open, like a locked door.
 */
export const chestSpawnRuleSchema = spawnCountSchema.and(
  z.object({
    lootTableId: contentIdSchema,
    /** Chance that this rule runs at all, as for loot. */
    chance: z.number().min(0).max(1).default(1),
    locked: z.boolean().default(false),
  }),
);

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
  traps: z.array(trapSpawnRuleSchema).default([]),
  puzzles: z.array(puzzleSpawnRuleSchema).default([]),
  chests: z.array(chestSpawnRuleSchema).default([]),
});
export type RoomTemplate = z.infer<typeof roomTemplateSchema>;

/**
 * An entity placed by hand in an authored dungeon, at authored tile coordinates.
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

const placedLootSchema = placedEntitySchema.extend({
  itemId: contentIdSchema,
  /** Stack size, for ammo only. Checked against the item's `maxStack` by `loadContent`. */
  count: z.number().int().positive().optional(),
});

const placedTrapSchema = placedEntitySchema.extend({ typeId: contentIdSchema });

const placedPuzzleSchema = z.object({
  typeId: contentIdSchema,
  plates: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
  entityId: z.string().uuid().optional(),
});

const placedChestSchema = placedEntitySchema.extend({
  lootTableId: contentIdSchema,
  locked: z.boolean().default(false),
});

const placedDoorSchema = placedEntitySchema.extend({ locked: z.boolean().default(false) });

const placedExitSchema = placedEntitySchema.extend({ destination: z.string().min(1) });

/**
 * A training dummy. Its id is required rather than derived, so a dummy keeps the same id however the
 * placements around it are edited. `loadContent` checks it stands on floor and its id is unique.
 */
const placedDummySchema = z.object({
  x: z.number(),
  y: z.number(),
  entityId: z.string().uuid(),
});

const placedLightSchema = placedEntitySchema.extend({
  name: z.string().min(1),
  /** World units, not authored tiles. */
  radius: z.number().positive(),
  tint: z.enum(LIGHT_TINTS).optional(),
  fixture: z.enum(LIGHT_FIXTURES).optional(),
  flicker: z.number().min(0).max(1).optional(),
});

/**
 * Scenery, drawn and never collided with. `x`/`y` is the authored tile at the prop's top-left, and
 * may be fractional to nudge a small prop within its tile. `loadContent` checks that the whole of
 * its footprint (`MAP_PROP_SIZES`) is on the map.
 */
const placedPropSchema = z
  .object({
    kind: z.enum(MAP_PROP_KINDS),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    label: z.string().min(1).max(MAX_PROP_LABEL_LENGTH).optional(),
    /** A stall's awning colour. Only a stall has an awning. */
    tint: z.enum(STALL_TINTS).optional(),
    /** `north` for a stall or bench that faces north, drawn from behind. Only those have the art. */
    facing: z.enum(MAP_PROP_FACINGS).optional(),
  })
  .refine((prop) => prop.tint === undefined || prop.kind === "stall", {
    message: "Only a stall takes a tint",
    path: ["tint"],
  })
  .refine((prop) => prop.facing === undefined || FACEABLE_PROP_KINDS.includes(prop.kind), {
    message: `Only a ${FACEABLE_PROP_KINDS.join(" or ")} takes a facing`,
    path: ["facing"],
  });
export type PlacedProp = z.infer<typeof placedPropSchema>;

/**
 * Somewhere to sit, such as a place on a bench. `x`/`y` is where the sitter goes, in authored tiles,
 * and the tile it rounds to is the one sat on. The id is required, like a dummy's, so a seat keeps
 * it however the map is edited. `loadContent` checks the tile `facing` points at is floor, which
 * is where the sitter stands up, and that the id is unique.
 */
const placedSeatSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  entityId: z.string().uuid(),
  facing: z.enum(SEAT_FACINGS),
});

/**
 * A ready plate in front of the hub gate, centred at `x`/`y` in authored tiles. A half-tile position
 * lets a row of plates centre on a one-tile gate. `loadContent` checks every tile the plate covers is
 * floor, and that the id is unique.
 */
const placedReadyPlateSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  entityId: z.string().uuid(),
});

const authoredRoomSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  kind: roomKindSchema,
  /** Top-left authored tile of the room, with its size in authored tiles. */
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
  /** How the tiles are drawn; collision is the same either way. */
  theme: z.enum(MAP_THEMES).default(DEFAULT_MAP_THEME),
  props: z.array(placedPropSchema).default([]),
  /**
   * What each floor tile is drawn as, row for row with `tiles`: `g` grass, `c` cobble, `d` dirt,
   * `.` the theme's own floor. Optional; `loadContent` checks it is the same size as `tiles`.
   * Render-only, so it never changes where anyone can walk.
   */
  ground: z.array(z.string().regex(GROUND_ROW_PATTERN)).min(1).optional(),
  spawnPoints: z.array(localPointSchema).min(1),
  rooms: z.array(authoredRoomSchema).default([]),
  monsters: z.array(placedMonsterSchema).default([]),
  loot: z.array(placedLootSchema).default([]),
  traps: z.array(placedTrapSchema).default([]),
  puzzles: z.array(placedPuzzleSchema).default([]),
  chests: z.array(placedChestSchema).default([]),
  doors: z.array(placedDoorSchema).default([]),
  exits: z.array(placedExitSchema).default([]),
  dummies: z.array(placedDummySchema).default([]),
  lights: z.array(placedLightSchema).default([]),
  seats: z.array(placedSeatSchema).default([]),
  readyPlates: z.array(placedReadyPlateSchema).default([]),
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
  /**
   * Size of the world the rooms are placed into, in authored tiles. The world a party actually
   * explores is `TILE_SCALE` times this on each axis.
   */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  slots: z.array(roomSlotSchema).min(1),
  /** Light dropped along corridors, so a hallway is not pitch black end to end. */
  corridorLight: z
    .object({
      name: z.string().min(1),
      /** World units. */
      radius: z.number().positive(),
      /** One light per this many authored corridor tiles, so the spacing scales with the map. */
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

/**
 * A milestone achievement (decision 0014): when a profile's `stat` reaches `threshold`, the profile
 * is granted one stack of `skillId` straight away, with no scroll. The skill must exist and must
 * have no prerequisites, so a grant never has to wait; the loader checks both, since a single
 * definition cannot see the skills.
 */
export const milestoneDefinitionSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  stat: z.enum(MILESTONE_STATS),
  threshold: z.number().int().positive(),
  skillId: contentIdSchema,
});
export type MilestoneDefinition = z.infer<typeof milestoneDefinitionSchema>;
