import { z } from "zod";
import {
  MONSTER_BEHAVIORS,
  CONSUMABLE_ICONS,
  WEAPON_KINDS,
  MAX_ITEM_DESCRIPTION_LENGTH,
  MAX_INVENTORY_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  PROFILE_SECRET_LENGTH,
  RESUME_TOKEN_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../constants/game.js";

export const vector2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type Vector2 = z.infer<typeof vector2Schema>;

export const entityIdSchema = z.string().uuid();
export type EntityId = z.infer<typeof entityIdSchema>;

/**
 * The map as a holder of it sees it.
 *
 * `width` and `height` are the whole world, and `tiles` is anchored at `originX`/`originY`: row `r`
 * is world row `originY + r`, and its character `c` is world column `originX + c`. The server's own
 * dungeon holds the full map with an origin of (0, 0). A client holds the same shape, rebuilt from
 * the discovery deltas in snapshots (`mapDiscoverySchema`), with undiscovered tiles as spaces.
 */
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
 * inventory slot.
 */
export const itemKindSchema = z.enum(["key", "consumable", "torch", "skillScroll", "weapon"]);
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
};

/** How a weapon is used. Each weapon issue extends this with the stats it needs. */
export const weaponKindSchema = z.enum(WEAPON_KINDS);
export type WeaponKind = z.infer<typeof weaponKindSchema>;

const weaponFields = {
  kind: z.literal("weapon"),
  weaponKind: weaponKindSchema,
};

const ordinaryLootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.enum(["key", "torch"]),
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
  consumableLootStateSchema,
  skillScrollLootStateSchema,
  weaponLootStateSchema,
]);
export type LootState = z.infer<typeof lootStateSchema>;

/** An item a player carries. It keeps the id it had as loot on the floor. */
const ordinaryInventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: z.enum(["key", "torch"]),
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

export const inventoryItemSchema = z.discriminatedUnion("kind", [
  ordinaryInventoryItemSchema,
  consumableInventoryItemSchema,
  skillScrollInventoryItemSchema,
  weaponInventoryItemSchema,
]);
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

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
  locked: z.boolean(),
});
export type DoorState = z.infer<typeof doorStateSchema>;

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

export const lightSourceKindSchema = z.enum(["fixed", "carriedTorch", "monsterGlow"]);
export type LightSourceKind = z.infer<typeof lightSourceKindSchema>;

export const lightSourceStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: lightSourceKindSchema,
  position: vector2Schema,
  radius: z.number().positive(),
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
  /** True while a standing, connected player is on this plate. */
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
  phase: puzzlePhaseSchema,
  /** Only plates on tiles the viewer can currently see. */
  plates: z.array(puzzlePlateStateSchema),
  /** Fraction of the required hold completed, 0 to 1. Resets to 0 the moment a plate is released. */
  progress: z.number().min(0).max(1),
});
export type PuzzleState = z.infer<typeof puzzleStateSchema>;

export const dungeonStateSchema = z.object({
  map: dungeonMapSchema,
  /** Only rooms the viewer has discovered part of. An unexplored wing is not on their map. */
  rooms: z.array(roomStateSchema),
  monsters: z.array(monsterStateSchema),
  /** Only projectiles on tiles the viewer can currently see. */
  projectiles: z.array(projectileStateSchema),
  loot: z.array(lootStateSchema),
  doors: z.array(doorStateSchema),
  exits: z.array(exitStateSchema),
  /** Only traps on tiles the viewer can currently see, like loot. */
  traps: z.array(trapStateSchema),
  /** Only puzzles with a plate on a tile the viewer can currently see. */
  puzzles: z.array(puzzleStateSchema),
  lightSources: z.array(lightSourceStateSchema),
});
export type DungeonState = z.infer<typeof dungeonStateSchema>;

/**
 * A stretch of newly discovered geometry on one world row: `tiles[i]` is world tile `(x + i, y)`,
 * `#` for wall and `.` for anything walkable. Lit versus remembered is not part of it; the light
 * sources in the snapshot already say what is lit.
 */
export const discoveredRunSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  tiles: z.string().min(1).regex(/^[#.]+$/),
});
export type DiscoveredRun = z.infer<typeof discoveredRunSchema>;

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

export const playerIdSchema = z.string().uuid();
export type PlayerId = z.infer<typeof playerIdSchema>;

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
  /** Content ids from `content/skills/` that this profile extracted or acquired in the hub. */
  unlockedSkillIds: z.array(contentIdSchema),
  /** Content ids from `content/upgrades/`. Acquisition is still future work. */
  unlockedUpgradeIds: z.array(contentIdSchema),
  /** How many runs this profile has escaped from, and how many it went down in. */
  runsEscaped: z.number().int().nonnegative(),
  runsLost: z.number().int().nonnegative(),
});
export type ProfileState = z.infer<typeof profileStateSchema>;

/** What a skill or upgrade does, as the owner's UI needs to describe it. Mirrors `content/`. */
export const progressionEffectViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attackDamageBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("sightRadiusBonus"), amount: z.number().positive() }),
  z.object({ type: z.literal("resistanceBonus"), amount: z.number().int().positive() }),
  z.object({ type: z.literal("puzzlePowerBonus"), amount: z.number().int().positive() }),
]);

export const skillViewSchema = z.object({
  id: contentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  effects: z.array(progressionEffectViewSchema),
});
export type SkillView = z.infer<typeof skillViewSchema>;

export const upgradeViewSchema = z.object({
  id: contentIdSchema,
  skillId: contentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  tier: z.number().int().positive(),
  requires: z.array(contentIdSchema),
  effects: z.array(progressionEffectViewSchema),
});
export type UpgradeView = z.infer<typeof upgradeViewSchema>;

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
  /** Separate from inventory: forgetting to take one from the hub means entering the run without it. */
  carryingTorch: z.boolean(),
  /** The downed party member this player is carrying, or null. Spent by Backend step 12. */
  carryingPlayerId: playerIdSchema.nullable(),
  /** The player carrying this one, or null. Set only while this player is downed. */
  carriedByPlayerId: playerIdSchema.nullable(),
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
  /** Time left before resistance starts falling. Zero once it has. */
  decayStartsInMs: z.number().nonnegative(),
  decaying: z.boolean(),
  /** Resistance lost per second while decaying. Zero before decay starts. */
  decayPerSecond: z.number().nonnegative(),
});
export type RunState = z.infer<typeof runStateSchema>;
