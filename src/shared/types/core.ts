import { z } from "zod";
import {
  MAX_INVENTORY_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
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
 * The map as one viewer sees it.
 *
 * `width` and `height` are the whole world, while `tiles` is only the window around that viewer
 * that the snapshot carried, anchored at `originX`/`originY`. Row `r` of `tiles` is world row
 * `originY + r`, and its character `c` is world column `originX + c`. A world of 384x256 tiles is
 * far too much to ship twenty times a second, and nothing outside the window can be seen or reached
 * before the next snapshot arrives.
 *
 * The server's own dungeon holds the full map with an origin of (0, 0), so the same shape describes
 * both the authoritative world and a player's view of it.
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
});
export type MonsterState = z.infer<typeof monsterStateSchema>;

/**
 * What an item does. Torches equip separately and never consume one of the three inventory slots.
 */
export const itemKindSchema = z.enum(["key", "tonic", "ward", "torch"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const lootStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: itemKindSchema,
  position: vector2Schema,
  pickedUp: z.boolean(),
});
export type LootState = z.infer<typeof lootStateSchema>;

/** An item a player carries. It keeps the id it had as loot on the floor. */
export const inventoryItemSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: itemKindSchema,
});
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

export const dungeonStateSchema = z.object({
  map: dungeonMapSchema,
  /** Only rooms the viewer has discovered part of. An unexplored wing is not on their map. */
  rooms: z.array(roomStateSchema),
  monsters: z.array(monsterStateSchema),
  loot: z.array(lootStateSchema),
  doors: z.array(doorStateSchema),
  exits: z.array(exitStateSchema),
  lightSources: z.array(lightSourceStateSchema),
});
export type DungeonState = z.infer<typeof dungeonStateSchema>;

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
  /** Separate from inventory: forgetting to take one from the hub means entering the run without it. */
  carryingTorch: z.boolean(),
  /** Session-local until Backend step 11 persists a device profile. */
  bankedItems: z.array(inventoryItemSchema),
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
