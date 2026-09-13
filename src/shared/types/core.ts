import { z } from "zod";
import {
  MAX_INVENTORY_SIZE,
  MAX_PLAYER_NAME_LENGTH,
  PLAYER_MAX_HEALTH,
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

export const dungeonMapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.array(z.string().min(1)).min(1),
});
export type DungeonMapState = z.infer<typeof dungeonMapSchema>;

export const monsterStateSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  position: vector2Schema,
  health: z.number().int().nonnegative(),
  maxHealth: z.number().int().positive(),
  alive: z.boolean(),
});
export type MonsterState = z.infer<typeof monsterStateSchema>;

/** What an item does. Keys open locked doors; tonics restore health. */
export const itemKindSchema = z.enum(["key", "tonic"]);
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
  position: vector2Schema,
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

export const dungeonStateSchema = z.object({
  map: dungeonMapSchema,
  monsters: z.array(monsterStateSchema),
  loot: z.array(lootStateSchema),
  doors: z.array(doorStateSchema),
  exits: z.array(exitStateSchema),
  /** True once a player has used an exit. */
  cleared: z.boolean(),
});
export type DungeonState = z.infer<typeof dungeonStateSchema>;

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
  /** Zero means downed: the player cannot act until the server respawns them. */
  health: z.number().int().min(0).max(PLAYER_MAX_HEALTH),
  ready: z.boolean(),
  connected: z.boolean(),
  inventory: z.array(inventoryItemSchema).max(MAX_INVENTORY_SIZE),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
