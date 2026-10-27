import { z } from "zod";
import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  PARTY_COLORS,
  SKIN_TONES,
} from "../constants/appearance.js";
import { COSMETIC_RARITIES, COSMETIC_SLOTS } from "../constants/cosmetics.js";
import {
  MONSTER_BEHAVIORS,
  CONSUMABLE_ICONS,
  CONSUMABLE_TARGETS,
  GENERIC_KEY_ITEM_ID,
  WEAPON_KINDS,
  MAX_ITEM_DESCRIPTION_LENGTH,
  MAX_INVENTORY_SIZE,
  MAX_STACK_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  MILESTONE_STATS,
  type MilestoneStat,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  PROFILE_SECRET_LENGTH,
  RESUME_TOKEN_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../constants/game.js";
import {
  GROUND_ROW_PATTERN,
  LIGHT_FIXTURES,
  LIGHT_TINTS,
  MAP_PROP_FACINGS,
  MAP_PROP_KINDS,
  MAP_THEMES,
  MAX_PROP_LABEL_LENGTH,
  SEAT_FACINGS,
  STALL_TINTS,
} from "../constants/scenery.js";

export const vector2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Vector2 = z.infer<typeof vector2Schema>;

export const entityIdSchema = z.string().uuid();
export type EntityId = z.infer<typeof entityIdSchema>;

export const playerIdSchema = z.string().uuid();
export type PlayerId = z.infer<typeof playerIdSchema>;

/**
 * The map as a holder of it sees it.
 *
 * `width` and `height` are the whole world, and `tiles` is anchored at `originX`/`originY`: row `r`
 * is world row `originY + r`, and its character `c` is world column `originX + c`. The server's own
 * dungeon holds the full map with an origin of (0, 0). A client holds the same shape, rebuilt from
 * the discovery deltas in snapshots (`mapDiscoverySchema`), with undiscovered tiles as spaces.
 */
export const mapThemeSchema = z.enum(MAP_THEMES);
export type MapTheme = z.infer<typeof mapThemeSchema>;

export const mapPropKindSchema = z.enum(MAP_PROP_KINDS);
export type MapPropKind = z.infer<typeof mapPropKindSchema>;

/**
 * Scenery drawn over the map: a fountain, a stall, a tree. Render-only; collision is the tiles.
 * `x`/`y` is the world tile at the sprite's top-left, and its size is `MAP_PROP_SIZES[kind]`.
 */
export const mapPropSchema = z.object({
  kind: mapPropKindSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  /** A caption drawn over the prop, such as the name of a stall. */
  label: z.string().min(1).max(MAX_PROP_LABEL_LENGTH).optional(),
  /** A stall's awning colour. Absent means `ember`; content only allows it on a stall. */
  tint: z.enum(STALL_TINTS).optional(),
  /** Which way it faces. Absent means `south`; content only allows it on a stall or a bench. */
  facing: z.enum(MAP_PROP_FACINGS).optional(),
});
export type MapProp = z.infer<typeof mapPropSchema>;

/**
 * Somewhere a player can sit: a place on a bench or the fountain rim. `x`/`y` is where a sitter is
 * put, in world units, on the solid tile they sit on and close enough to its edge that they are seen
 * from the floor beside it. They stand up onto the floor `facing` points at. Who sits where is each
 * player's `seatId`, so a seat itself never changes.
 */
export const mapSeatSchema = z.object({
  id: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  facing: z.enum(SEAT_FACINGS),
});
export type MapSeat = z.infer<typeof mapSeatSchema>;

/**
 * A ready plate in front of the hub gate. `x`/`y` is its centre in world units, and a player whose
 * position is within `READY_PLATE_SIZE / 2` of it on both axes stands on it. Who holds which is
 * each player's `readyPlateId`, so a plate itself never changes.
 */
export const mapReadyPlateSchema = z.object({
  id: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
});
export type MapReadyPlate = z.infer<typeof mapReadyPlateSchema>;

export const dungeonMapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Size of the whole world in tiles, not of `tiles`. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** World coordinates of `tiles[0][0]`. */
  originX: z.number().int().nonnegative(),
  originY: z.number().int().nonnegative(),
  tiles: z.array(z.string().min(1)).min(1),
  /** How the tiles are drawn. Absent means `stone`. */
  theme: mapThemeSchema.optional(),
  /** Scenery the holder knows of. A client holds only props it has discovered part of. */
  props: z.array(mapPropSchema).optional(),
  /**
   * What each floor tile is drawn as, row for row with `tiles`: `g` grass, `c` cobble, `d` dirt, `.`
   * the theme's own floor. A client's rows hold spaces where it has discovered nothing. Absent means
   * every tile is `.`. Render-only: collision is `tiles`.
   */
  ground: z.array(z.string()).optional(),
  /** Seats the holder knows of. A client holds only seats on tiles it has discovered. */
  seats: z.array(mapSeatSchema).optional(),
  /** Ready plates the holder knows of, like `seats`. */
  readyPlates: z.array(mapReadyPlateSchema).optional(),
});
export type DungeonMapState = z.infer<typeof dungeonMapSchema>;

/** A content id, such as `ash-imp`. Not a UUID: these name a kind of thing, not an instance. */
export const contentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Content ids are lowercase kebab-case");
export type ContentId = z.infer<typeof contentIdSchema>;

export const monsterStateSchema = z.object({
  id: entityIdSchema,
  /**
   * Which kind of monster this is. Stats hang off this on the server, so two monsters may share a
   * display name without colliding - which keying by name could not survive.
   */
  typeId: contentIdSchema,
  name: z.string().min(1),
  position: vector2Schema,
  health: z.number().int().nonnegative(),
  maxHealth: z.number().int().positive(),
  alive: z.boolean(),
  /**
   * A boss seals every exit in its dungeon until it falls. Only ever sent for a monster the viewer
   * can see, so it says what this monster is, never where an unseen boss is waiting.
   */
  boss: z.boolean(),
  /**
   * An elite is a stat-boosted roster monster that carries the vault key. Public so the client can
   * mark it; the key it drops is the server's business.
   */
  elite: z.boolean(),
  /**
   * `windingUp` while the monster is committed to a swing it has not yet resolved. The swing lands
   * on whoever is inside its reach and arc when `windupProgress` reaches 1, so a player can step out.
   */
  action: z.enum(["idle", "windingUp", "charging", "stunned"]),
  /** How this monster fights, so the client can shape its telegraph. Never a stat. */
  behavior: z.enum(MONSTER_BEHAVIORS),
  /** Fraction of the wind-up elapsed, 0 while idle. Drives the client's telegraph. */
  windupProgress: z.number().min(0).max(1),
  /** Direction the monster is swinging, fixed when the wind-up starts. Unit length. */
  facing: vector2Schema,
  /** Reach of the swing, in world units, so the client can draw the area it will cover. */
  hitRange: z.number().positive(),
  /** Cosine of the swing's half-angle about `facing`. */
  hitArcCos: z.number().min(-1).max(1),
});
export type MonsterState = z.infer<typeof monsterStateSchema>;

/**
 * A bolt in flight. The server moves it and decides what it hits; damage, remaining range, and who
 * fired it stay server-side. Sent only to players who can see its tile.
 */
export const projectileStateSchema = z.object({
  id: entityIdSchema,
  position: vector2Schema,
  /** Unit direction of travel. */
  direction: vector2Schema,
  radius: z.number().positive(),
});
export type ProjectileState = z.infer<typeof projectileStateSchema>;

/**
 * What an item does. Torches equip separately and never consume one of the three inventory slots.
 * A weapon is carried in the hand slot (`PlayerState.held`) or, when the hand is full, an
 * inventory slot. Ammo is a stack: one entry, and so one slot, carrying a `count`.
 */
export const itemKindSchema = z.enum(["key", "consumable", "torch", "skillScroll", "weapon", "ammo", "ballast", "idol"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const consumableIconSchema = z.enum(CONSUMABLE_ICONS);
export type ConsumableIcon = z.infer<typeof consumableIconSchema>;

/**
 * What a consumable shows the client. The effects themselves stay in content on the server: the
 * client needs words and a picture, never magnitudes it could mistake for authority.
 */
const consumableFields = {
  kind: z.literal("consumable"),
  /** Content id of the definition whose effects the server applies on use. */
  itemId: contentIdSchema,
  description: z.string().min(1).max(MAX_ITEM_DESCRIPTION_LENGTH),
  icon: consumableIconSchema,
  /** Who it is used on. Defaults to `self` so an item banked before targets existed still parses. */
  useOn: z.enum(CONSUMABLE_TARGETS).default("self"),
};

/** How a weapon is used. Each weapon issue extends this with the stats it needs. */
export const weaponKindSchema = z.enum(WEAPON_KINDS);
export type WeaponKind = z.infer<typeof weaponKindSchema>;

/**
 * What a weapon shows the client. Its stats stay in content on the server, looked up by `itemId`
 * at each swing, so editing the file retunes a weapon already in someone's hand.
 */
const weaponFields = {
  kind: z.literal("weapon"),
  /** Content id of the definition whose stats the server applies. */
  itemId: contentIdSchema,
  weaponKind: weaponKindSchema,
};

/**
 * A stack of ammo. `maxStack` stays in content on the server, the only side that merges stacks.
 * `count` defaults to 1 so a stored entry written without one still parses.
 */
const ammoFields = {
  kind: z.literal("ammo"),
  /** Content id of the definition, which is also what decides whether two stacks merge. */
  itemId: contentIdSchema,
  count: z.number().int().positive().max(MAX_STACK_SIZE).default(1),
};

/**
 * A key. `itemId` is the content id of the definition, which is what a door's lock matches. It
 * defaults to the generic key so a key banked before keys were typed still parses.
 */
const keyFields = {
  kind: z.literal("key"),
  itemId: contentIdSchema.default(GENERIC_KEY_ITEM_ID),
};

const ordinaryLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.enum(["torch", "ballast", "idol"]),
  position: vector2Schema,
  pickedUp: z.boolean(),
});

const keyLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...keyFields,
  position: vector2Schema,
  pickedUp: z.boolean(),
});

const consumableLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...consumableFields,
  position: vector2Schema,
  pickedUp: z.boolean(),
});

const weaponLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...weaponFields,
  position: vector2Schema,
  pickedUp: z.boolean(),
});

const ammoLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...ammoFields,
  position: vector2Schema,
  pickedUp: z.boolean(),
});

const skillScrollLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.literal("skillScroll"),
  skillId: contentIdSchema,
  position: vector2Schema,
  pickedUp: z.boolean(),
});

export const lootStateSchema = z.discriminatedUnion("kind", [
  ordinaryLootStateSchema,
  keyLootStateSchema,
  consumableLootStateSchema,
  skillScrollLootStateSchema,
  weaponLootStateSchema,
  ammoLootStateSchema,
]);
export type LootState = z.infer<typeof lootStateSchema>;

/** An item a player carries. It keeps the id it had as loot on the floor. */
const ordinaryInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.enum(["torch", "ballast", "idol"]),
});

const keyInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...keyFields,
});

const consumableInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...consumableFields,
});

const skillScrollInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.literal("skillScroll"),
  /** Skill content id learned by using this scroll. The scroll itself is consumed. */
  skillId: contentIdSchema,
});

const weaponInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...weaponFields,
});

const ammoInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  ...ammoFields,
});

export const inventoryItemSchema = z.discriminatedUnion("kind", [
  ordinaryInventoryItemSchema,
  keyInventoryItemSchema,
  consumableInventoryItemSchema,
  skillScrollInventoryItemSchema,
  weaponInventoryItemSchema,
  ammoInventoryItemSchema,
]);
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

/**
 * What a closed door wants. A `key` lock takes only the key item whose content id is `keyItemId`
 * and refuses every other key, keeping it. `seal` and `hidden` locks are part of the contract but
 * no door carries one yet; the server refuses to open them by interaction. `null` is an unlocked
 * door. The client never sends a key id: it sends an interact intent and the server picks the key.
 */
export const doorLockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("key"), keyItemId: contentIdSchema }),
  z.object({ type: z.literal("seal"), groupId: contentIdSchema }),
  z.object({ type: z.literal("hidden") }),
]);
export type DoorLock = z.infer<typeof doorLockSchema>;

export const doorStateSchema = z.object({
  id: entityIdSchema,
  /** Centre of the doorway. */
  position: vector2Schema,
  /**
   * How many world tiles across the doorway is, centred on `position`.
   *
   * A door is authored as one tile and becomes a `TILE_SCALE` block in the world, and a closed one
   * has to fill all of it. Storing the span rather than assuming a single tile is what stops a
   * party walking around a locked door through the fifteen world tiles beside it.
   */
  size: z.number().positive(),
  open: z.boolean(),
  lock: doorLockSchema.nullable(),
});
export type DoorState = z.infer<typeof doorStateSchema>;

/**
 * A chest placed by a room template. Its contents are not chosen until it is opened: the server
 * rolls `lootTableId` then and spills the result beside it as ordinary loot, so a client learns
 * what was inside only by seeing it on the floor. A locked chest takes a key, like a locked door.
 */
export const chestStateSchema = z.object({
  id: entityIdSchema,
  /** Content id of the loot table it rolls. The table's entries stay on the server. */
  lootTableId: contentIdSchema,
  position: vector2Schema,
  opened: z.boolean(),
  locked: z.boolean(),
  /**
   * A Twin-lock Chest has two keyholes and opens only when two different players interact with it
   * within a second of each other. Defaulted so a run saved before it existed still loads.
   */
  twinLock: z.boolean().default(false),
  /**
   * Who turned one keyhole of a twin lock, while it waits for a second player; null otherwise. Public
   * so the turner is told to wait and an ally is told to turn the other.
   */
  keyTurnedBy: playerIdSchema.nullable().default(null),
  /**
   * A Mimic Chest is a monster wearing a chest's sprite: opening it wakes a mimic instead of rolling
   * the table. Server-only. A snapshot always sends false, so a client cannot tell one from a chest.
   */
  mimic: z.boolean().default(false),
});
export type ChestState = z.infer<typeof chestStateSchema>;

/**
 * A shrine altar offering skill scrolls. The party takes one: the server drops it as ordinary loot
 * and `taken` records which, and the rest of `offer` stay caged for the run. `offer` lists content
 * item ids (always skill scrolls); `taken` is null until a take succeeds.
 */
export const altarStateSchema = z.object({
  id: entityIdSchema,
  position: vector2Schema,
  offer: z.array(contentIdSchema).min(2),
  taken: contentIdSchema.nullable(),
});
export type AltarState = z.infer<typeof altarStateSchema>;

export const exitStateSchema = z.object({
  id: entityIdSchema,
  position: vector2Schema,
  destination: z.string().min(1),
  /**
   * True while a boss in this dungeon still lives, and the server refuses the escape. It says the
   * way out is barred, not by what or from where: a boss is only on a client's map once seen.
   */
  sealed: z.boolean(),
});
export type ExitState = z.infer<typeof exitStateSchema>;

/**
 * What a room is for. The client may draw a boss room differently from a corridor junction, and the
 * server gates on it: exits end a run, entrances hold the party spawn, bosses gate their room.
 */
export const roomKindSchema = z.enum([
  "entrance",
  "hall",
  "maze",
  "trap",
  "puzzle",
  "boss",
  "exit",
  "corridor",
  /** The hub's party vault: standing inside one is what lets a player take from or store in it. */
  "vault",
  /** The hub's skill shop: standing inside one is what lets a player buy a scroll. */
  "shop",
  /** The hub's wardrobe stall: standing inside one is what lets a player buy a cosmetic. */
  "wardrobe",
  /** A resting place on the way down. */
  "camp",
  /** A room with an altar or boon to find. */
  "shrine",
  /** A room off the map until found. */
  "secret",
  /** A room fought in the open, with no way to slip past. */
  "arena",
  /** An irregular cave in place of a built hall. */
  "cavern",
]);
export type RoomKind = z.infer<typeof roomKindSchema>;

/**
 * A named region of the map. Nothing in the model knew what a room was before generation existed,
 * and visibility, boss gating, and template stitching all need one. Bounds are the top-left tile
 * plus a size in tiles, inclusive of the room's own walls.
 */
export const roomStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: roomKindSchema,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type RoomState = z.infer<typeof roomStateSchema>;

/**
 * `flare` is a short-lived light a player put down. Like `fixed` it stays where it was placed, but
 * it burns out, so the server lights it fresh every tick rather than caching what it reveals.
 */
export const lightSourceKindSchema = z.enum(["fixed", "carriedTorch", "monsterGlow", "flare"]);
export type LightSourceKind = z.infer<typeof lightSourceKindSchema>;

export const lightSourceStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: lightSourceKindSchema,
  position: vector2Schema,
  radius: z.number().positive(),
  /** How a fixed light glows. Absent means `warm`. */
  tint: z.enum(LIGHT_TINTS).optional(),
  /** What a fixed light is drawn as. Absent means `pillar`. */
  fixture: z.enum(LIGHT_FIXTURES).optional(),
  /**
   * How much a fixed light's reach wavers, from 0 (steady) to 1. Absent means steady. Render-only:
   * the client derives the waver from the wall clock and this light's id, so every client agrees.
   */
  flicker: z.number().min(0).max(1).optional(),
});
export type LightSourceState = z.infer<typeof lightSourceStateSchema>;

/**
 * `armed` can fire when a standing player is in reach, `triggered` has fired and is waiting to
 * rearm, and `disabled` is spent for the rest of the run.
 */
export const trapPhaseSchema = z.enum(["armed", "triggered", "disabled"]);
export type TrapPhase = z.infer<typeof trapPhaseSchema>;

/**
 * A server-resolved hazard. The client sees where it is and what phase it is in, never what it does:
 * damage, resistance loss, and stamina drain are content the server applies on a trigger.
 */
export const trapStateSchema = z.object({
  id: entityIdSchema,
  typeId: contentIdSchema,
  name: z.string().min(1),
  position: vector2Schema,
  /** Reach of the trigger in world units, so a client can draw the footprint it must avoid. */
  radius: z.number().positive(),
  phase: trapPhaseSchema,
});
export type TrapState = z.infer<typeof trapStateSchema>;

/** `idle` is still waiting on its plates; `solved` has paid out its reward for the rest of the run. */
export const puzzlePhaseSchema = z.enum(["idle", "solved"]);
export type PuzzlePhase = z.infer<typeof puzzlePhaseSchema>;

export const puzzlePlateStateSchema = z.object({
  position: vector2Schema,
  /**
   * True while the plate is held: by a standing, connected player or a Ballast Stone lying on it,
   * or, on an Idol Carry altar, by the idol set on it.
   */
  held: z.boolean(),
});
export type PuzzlePlateState = z.infer<typeof puzzlePlateStateSchema>;

/**
 * A server-resolved cooperative puzzle: every plate must be held by a different player at once,
 * and kept held for a while. The client sees the plates, whether each is held, and how far the
 * hold has got; the hold time, the reward, and who counts as holding are the server's.
 */
export const puzzleStateSchema = z.object({
  id: entityIdSchema,
  typeId: contentIdSchema,
  name: z.string().min(1),
  /** Reach of each plate in world units, so a client can draw the footprint to stand in. */
  radius: z.number().positive(),
  /**
   * What holds a plate: players (and Ballast Stones), or only a Heavy Idol set on it, which makes
   * the one plate an Idol Carry altar. Defaulted, so a run saved before idols still loads.
   */
  heldBy: z.enum(["players", "idol"]).default("players"),
  phase: puzzlePhaseSchema,
  /** Only plates on tiles the viewer can currently see. */
  plates: z.array(puzzlePlateStateSchema),
  /** Fraction of the required hold completed, 0 to 1. Resets to 0 the moment a plate is released. */
  progress: z.number().min(0).max(1),
});
export type PuzzleState = z.infer<typeof puzzleStateSchema>;

/** One attacker's share of a training dummy's readout. */
export const dummyAttackerSchema = z.object({
  // A player id; `playerIdSchema` is declared further down this file, and both are UUIDs.
  playerId: entityIdSchema,
  /** Damage this attacker's hits would have done over the rolling window. */
  recentDamage: z.number().int().nonnegative(),
  dps: z.number().nonnegative(),
});
export type DummyAttacker = z.infer<typeof dummyAttackerSchema>;

/**
 * A training dummy in the hub. It is struck like a monster but never takes damage, never dies,
 * never moves, and never attacks, so a hit on one reports `targetHealth: 0` and is never a defeat.
 * The readout covers the last `TRAINING_DUMMY_WINDOW_MS` of hits, per attacker, and empties once
 * that long passes without one. `recentDamage` and `dps` are the sums over `attackers`.
 */
export const dummyStateSchema = z.object({
  id: entityIdSchema,
  position: vector2Schema,
  recentDamage: z.number().int().nonnegative(),
  dps: z.number().nonnegative(),
  attackers: z.array(dummyAttackerSchema),
});
export type DummyState = z.infer<typeof dummyStateSchema>;

export const dungeonStateSchema = z.object({
  map: dungeonMapSchema,
  /** Only rooms the viewer has discovered part of. An unexplored wing is not on their map. */
  rooms: z.array(roomStateSchema),
  monsters: z.array(monsterStateSchema),
  /** Only projectiles on tiles the viewer can currently see. */
  projectiles: z.array(projectileStateSchema),
  loot: z.array(lootStateSchema),
  /** Only chests on tiles the viewer can currently see, like loot. */
  chests: z.array(chestStateSchema),
  /** Only altars on tiles the viewer can currently see, like chests. */
  altars: z.array(altarStateSchema),
  doors: z.array(doorStateSchema),
  exits: z.array(exitStateSchema),
  /** Only traps on tiles the viewer can currently see, like loot. */
  traps: z.array(trapStateSchema),
  /** Only puzzles with a plate on a tile the viewer can currently see. */
  puzzles: z.array(puzzleStateSchema),
  lightSources: z.array(lightSourceStateSchema),
  /** Only dummies on tiles the viewer can currently see, like loot. */
  dummies: z.array(dummyStateSchema),
});
export type DungeonState = z.infer<typeof dungeonStateSchema>;

/**
 * A stretch of newly discovered geometry on one world row: `tiles[i]` is world tile `(x + i, y)`,
 * `#` for wall and `.` for anything walkable. Lit versus remembered is not part of it; that travels
 * separately, in `lit`.
 */
export const discoveredRunSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    tiles: z.string().min(1).regex(/^[#.]+$/),
    /**
     * The ground under the same tiles, one character each (see `DungeonMapState.ground`). Sent only
     * for a map with a ground grid, and only when some of the run is not `.`.
     */
    ground: z.string().min(1).regex(GROUND_ROW_PATTERN).optional(),
  })
  .refine((run) => run.ground === undefined || run.ground.length === run.tiles.length, {
    message: "A run's ground must cover exactly its tiles",
    path: ["ground"],
  });
export type DiscoveredRun = z.infer<typeof discoveredRunSchema>;

/**
 * A stretch of tiles the viewer's light reaches right now, on one world row: `[x, y, length]` covers
 * world tiles `(x, y)` to `(x + length - 1, y)`. A tuple rather than an object because a snapshot
 * carries a few dozen of these twenty times a second.
 */
export const litRunSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().positive(),
]);
export type LitRun = z.infer<typeof litRunSchema>;

/**
 * What a snapshot says about the map: which world it is, and the geometry this viewer has newly
 * discovered since the last snapshot. The client accumulates these into a `DungeonMapState`.
 *
 * `reset` marks a baseline rather than a change: the client drops whatever geometry it held and
 * rebuilds from `discovered`, which then carries everything the viewer has discovered. The server
 * sets it on a viewer's first snapshot, after a reconnect, and when the world is rebuilt.
 */
export const mapDiscoverySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Size of the whole world in tiles. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  reset: z.boolean(),
  discovered: z.array(discoveredRunSchema),
  /**
   * Every tile the viewer's light reaches this snapshot, in full rather than as a delta. Any other
   * discovered tile is remembered and draws dark. Only ever tiles the viewer has discovered.
   */
  lit: z.array(litRunSchema),
  /** How the map is drawn. Absent means `stone`. */
  theme: mapThemeSchema.optional(),
  /**
   * Props the viewer has newly discovered part of, or all they know of on a `reset`. Each arrives
   * once, with the first of its tiles, so scenery deep in an unexplored wing stays off their map.
   */
  props: z.array(mapPropSchema).optional(),
  /** Seats on tiles the viewer has newly discovered, or all they know of on a `reset`; like `props`. */
  seats: z.array(mapSeatSchema).optional(),
  /** Ready plates whose centre tile the viewer has newly discovered; like `seats`. */
  readyPlates: z.array(mapReadyPlateSchema).optional(),
});
export type MapDiscovery = z.infer<typeof mapDiscoverySchema>;

/** A dungeon as a snapshot carries it: everything in `DungeonState`, with the map as a delta. */
export const dungeonSnapshotSchema = dungeonStateSchema.omit({ map: true }).extend({
  map: mapDiscoverySchema,
});
export type DungeonSnapshot = z.infer<typeof dungeonSnapshotSchema>;

/** The whole party shares one place; fresh players may only join while it is the hub. */
export const sessionLocationSchema = z.enum(["hub", "dungeon"]);
export type SessionLocation = z.infer<typeof sessionLocationSchema>;

export const sessionIdSchema = z.string().uuid();
export type SessionId = z.infer<typeof sessionIdSchema>;

export const roomCodeSchema = z
  .string()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`), "Room code contains unsupported characters");
export type RoomCode = z.infer<typeof roomCodeSchema>;

export const playerNameSchema = z.string().trim().min(1).max(MAX_PLAYER_NAME_LENGTH);
export type PlayerName = z.infer<typeof playerNameSchema>;

/**
 * Bearer credential for reclaiming a player slot after a disconnect. It is only ever sent to the
 * player it belongs to; broadcasting one would let any party member impersonate another.
 */
export const resumeTokenSchema = z
  .string()
  .length(RESUME_TOKEN_LENGTH)
  .regex(/^[0-9a-f]+$/, "Resume token must be lowercase hex");
export type ResumeToken = z.infer<typeof resumeTokenSchema>;

/** A roguelite profile, which outlives the session a player banked its items in. */
export const profileIdSchema = z.string().uuid();
export type ProfileId = z.infer<typeof profileIdSchema>;

/**
 * Bearer credential naming a profile. The device that holds one owns everything that profile has
 * banked and unlocked, so it is issued once, sent only to its owner, and never broadcast.
 *
 * The server keeps only a hash of it, which is why a client that loses its copy cannot be told
 * what it was: it starts a new profile instead.
 */
export const profileSecretSchema = z
  .string()
  .length(PROFILE_SECRET_LENGTH)
  .regex(/^[0-9a-f]+$/, "Profile secret must be lowercase hex");
export type ProfileSecret = z.infer<typeof profileSecretSchema>;

/**
 * Stack counts per skill content id, each at least 1; a skill with no stacks is simply absent.
 * Used for permanent, provisional and active stacks alike.
 */
export const skillStacksSchema = z.record(contentIdSchema, z.number().int().positive());
export type SkillStacks = z.infer<typeof skillStacksSchema>;

/** A count for every milestone stat; a stat never earned is zero rather than absent. */
export const milestoneStatsSchema = z.object(
  Object.fromEntries(
    MILESTONE_STATS.map((stat) => [stat, z.number().int().nonnegative()]),
  ) as Record<MilestoneStat, z.ZodNumber>,
);
export type MilestoneStats = z.infer<typeof milestoneStatsSchema>;

export const cosmeticSlotSchema = z.enum(COSMETIC_SLOTS);
export type CosmeticSlot = z.infer<typeof cosmeticSlotSchema>;

export const cosmeticRaritySchema = z.enum(COSMETIC_RARITIES);
export type CosmeticRarity = z.infer<typeof cosmeticRaritySchema>;

/**
 * The cosmetic content id worn in each slot, or null for none. A null dye wears the party colour,
 * a null trail draws only the swing, and a null flame is the default hearth flame.
 * Strict, so a slot added later is a protocol change rather than a field quietly dropped.
 */
export const equippedCosmeticsSchema = z
  .object({
    hat: contentIdSchema.nullable(),
    cloak: contentIdSchema.nullable(),
    dye: contentIdSchema.nullable(),
    trail: contentIdSchema.nullable(),
    flame: contentIdSchema.nullable(),
  })
  .strict();
export type EquippedCosmetics = z.infer<typeof equippedCosmeticsSchema>;

/** Nothing worn: where a new profile, or one older than cosmetics, starts. */
export const NO_COSMETICS: EquippedCosmetics = { hat: null, cloak: null, dye: null, trail: null, flame: null };

/**
 * A profile as its owner sees it, sent on join and to nobody else.
 *
 * `bankedItems` repeats what `playerState` carries for this player, because the two are read at
 * different moments: this is what the profile held before the session touched it, and the player
 * state is what it holds now.
 */
export const profileStateSchema = z.object({
  id: profileIdSchema,
  displayName: playerNameSchema,
  bankedItems: z.array(inventoryItemSchema),
  /** Permanent stacks of `content/skills/` ids, extracted from a run or acquired in the hub. */
  skillStacks: skillStacksSchema,
  /** How many runs this profile has escaped from, and how many it went down in. */
  runsEscaped: z.number().int().nonnegative(),
  runsLost: z.number().int().nonnegative(),
  /** Banked progression currency; only the server changes it. */
  coin: z.number().int().nonnegative(),
  /** Lifetime stats milestones are measured against. */
  stats: milestoneStatsSchema,
  /** Ids of the milestones this profile has earned. */
  earnedMilestones: z.array(contentIdSchema),
  /** Cosmetic content ids this profile owns, the starter items included. */
  ownedCosmeticIds: z.array(contentIdSchema),
  /** What this profile wears; the same as its player's public `cosmetics`. */
  equippedCosmetics: equippedCosmeticsSchema,
});
export type ProfileState = z.infer<typeof profileStateSchema>;

/** What a skill stack does, as the owner's UI needs to describe it. Mirrors `content/`. */
export const progressionEffectViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attackDamageBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("sightRadiusBonus"), amount: z.number().positive() }),
  z.object({ type: z.literal("resistanceBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("puzzlePowerBonus"), amount: z.number().int().positive() }),
]);

/**
 * A skill as content defines it. `effects` is the first stack; `stackEffects` lists stacks 2 to
 * `maxStacks` when the skill spells them out, and `perStackEffects` is what every stack after the
 * first adds otherwise. Whichever the skill does not use is empty. `maxStacks` is null for a skill
 * that keeps stacking, and `requires` names skills needed before a scroll of this one can be used.
 */
export const skillViewSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  effects: z.array(progressionEffectViewSchema),
  maxStacks: z.number().int().positive().nullable(),
  requires: z.array(contentIdSchema),
  /** Coin a scroll of this skill converts to once the skill is at its `maxStacks`. */
  conversionCoin: z.number().int().positive(),
  stackEffects: z.array(z.array(progressionEffectViewSchema)),
  perStackEffects: z.array(progressionEffectViewSchema),
});
export type SkillView = z.infer<typeof skillViewSchema>;

/** A milestone as content defines it: reach `threshold` in `stat` to be granted `skillId`. */
export const milestoneViewSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  stat: z.enum(MILESTONE_STATS),
  threshold: z.number().int().positive(),
  skillId: contentIdSchema,
});
export type MilestoneView = z.infer<typeof milestoneViewSchema>;

export const bodyTypeSchema = z.enum(BODY_TYPES);
export type BodyType = z.infer<typeof bodyTypeSchema>;

export const skinToneSchema = z.enum(SKIN_TONES);
export type SkinTone = z.infer<typeof skinToneSchema>;

export const hairStyleSchema = z.enum(HAIR_STYLES);
export type HairStyle = z.infer<typeof hairStyleSchema>;

export const hairColorSchema = z.enum(HAIR_COLORS);
export type HairColor = z.infer<typeof hairColorSchema>;

export const partyColorSchema = z.enum(PARTY_COLORS);
export type PartyColor = z.infer<typeof partyColorSchema>;

/**
 * A designed character: one id from each shared list in `constants/appearance.ts`. Strict, because
 * it is client-sent in `setAppearance`, and a field the server does not know is a malformed look
 * rather than one to quietly trim.
 */
export const playerAppearanceSchema = z
  .object({
    body: bodyTypeSchema,
    skinTone: skinToneSchema,
    hairStyle: hairStyleSchema,
    hairColor: hairColorSchema,
  })
  .strict();
export type PlayerAppearance = z.infer<typeof playerAppearanceSchema>;

/**
 * The server's view of a player, broadcast to clients. Clients never author this shape: position,
 * health, and inventory are server-owned outputs, not inputs.
 */
export const playerStateSchema = z.object({
  id: playerIdSchema,
  name: playerNameSchema,
  position: vector2Schema,
  facing: vector2Schema,
  /** Zero means downed: the player cannot act until revived or returned to the hub. */
  health: z.number().int().min(0).max(PLAYER_MAX_HEALTH),
  /**
   * General damage reduction. Raised only by consumables and unlocked skills, never by resting or
   * returning to the hub, and worn down by time spent in the dungeon.
   */
  resistance: z.number().int().min(0).max(PLAYER_MAX_RESISTANCE),
  /** Spent on attacking, lifting, and carrying; regenerates on its own. */
  stamina: z.number().int().min(0).max(PLAYER_MAX_STAMINA),
  ready: z.boolean(),
  connected: z.boolean(),
  inventory: z.array(inventoryItemSchema).max(MAX_INVENTORY_SIZE),
  /**
   * The item in hand, independent of the three inventory slots and of the torch: a full inventory
   * plus a held item is valid. Only a weapon is picked up into it; `swapHeld` moves items between
   * the hand and the inventory.
   */
  held: inventoryItemSchema.nullable(),
  /**
   * How far through its draw the held bow is, from 0 to 1, or null while the player is not drawing.
   * The server times the draw, so this is its figure (refreshed every tick) rather than the
   * client's: a draw indicator can read it, and every viewer can see who is drawing.
   */
  drawFraction: z.number().min(0).max(1).nullable(),
  /**
   * What the held bow reaches for this player, in world units, or null while not drawing: the arrow
   * flies `minRange` at no draw and `maxRange` at a full one. Computed by the server from the bow and
   * the player's bonuses, so the indicator shows the range the shot will have, never a client guess.
   */
  drawRange: z.object({ minRange: z.number().min(0), maxRange: z.number().min(0) }).nullable(),
  /** Separate from inventory: forgetting to take one from the hub means entering the run without it. */
  carryingTorch: z.boolean(),
  /** Whether the carried torch is burning. An unlit torch is still carried but lights nothing. */
  torchLit: z.boolean(),
  /** The downed party member this player is carrying, or null. Spent by Backend step 12. */
  carryingPlayerId: playerIdSchema.nullable(),
  /** The player carrying this one, or null. Set only while this player is downed. */
  carriedByPlayerId: playerIdSchema.nullable(),
  /**
   * The seat (`MapSeat.id`) this player is sitting on, or null while they stand. Public, so every
   * client draws them seated. Set only by the server, and cleared by any move, an attack, being
   * lifted, a disconnect, or a change of world.
   */
  seatId: entityIdSchema.nullable(),
  /**
   * The ready plate (`MapReadyPlate.id`) this player holds, or null. Public, so every client lights
   * it in their party colour. Set only by the server, and only in the hub.
   */
  readyPlateId: entityIdSchema.nullable(),
  /**
   * The look this player designed, public to the whole party. Null while they are still designing
   * it: such a player holds a slot but is not in the world yet, so clients do not draw them, and
   * they can neither act nor ready up until `setAppearance` succeeds.
   */
  appearance: playerAppearanceSchema.nullable(),
  /** Assigned by the server on join, unique in the session, and kept for the life of the slot. */
  partyColor: partyColorSchema,
  /**
   * What this player wears, public to the whole party. Owned by the profile rather than the run, so
   * it is unchanged by death or a wipe, and changed only by `equipCosmetic` in the hub.
   */
  cosmetics: equippedCosmeticsSchema,
  /**
   * What this player's profile holds. Owned by the profile, so it survives a restart, and owner
   * data: present only on the receiving player's own entry, absent from every teammate's.
   */
  bankedItems: z.array(inventoryItemSchema).optional(),
});
export type PlayerState = z.infer<typeof playerStateSchema>;

/**
 * The run clock for the receiving player, carried on every snapshot. Snapshots are already
 * per-player, so this is that player's own time in the dungeon rather than a party-wide number.
 * It exists so a client can warn before resistance decay starts instead of only after it bites.
 */
export const runStateSchema = z.object({
  /** How long this player has been in the dungeon. */
  elapsedMs: z.number().nonnegative(),
  /** How long into this run before resistance starts falling; an omen can shorten it. */
  decayGraceMs: z.number().positive(),
  /** Time left before resistance starts falling. Zero once it has. */
  decayStartsInMs: z.number().nonnegative(),
  decaying: z.boolean(),
  /** Resistance lost per second while decaying. Zero before decay starts. */
  decayPerSecond: z.number().nonnegative(),
});
export type RunState = z.infer<typeof runStateSchema>;
