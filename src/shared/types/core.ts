import { z } from "zod";
import {
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
 * The server's view of a player, broadcast to clients. Clients never author this shape: position
 * and health are server-owned outputs, not inputs.
 */
export const playerStateSchema = z.object({
  id: playerIdSchema,
  name: playerNameSchema,
  position: vector2Schema,
  facing: vector2Schema,
  health: z.number().int().min(0).max(PLAYER_MAX_HEALTH),
  ready: z.boolean(),
  connected: z.boolean(),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
