import { z } from "zod";
import {
  entityIdSchema,
  playerIdSchema,
  playerNameSchema,
  resumeTokenSchema,
  roomCodeSchema,
  vector2Schema,
} from "../types/core.js";
import { voiceSignalSchema } from "./voice.js";

/**
 * `resumeToken` is the token from an earlier `sessionJoined` in the same room. Present, it asks the
 * server to reclaim that player slot with its position, health, and ready state intact. Absent or
 * no longer valid, the join is treated as a brand new player.
 */
export const joinSessionSchema = z.object({
  type: z.literal("joinSession"),
  protocolVersion: z.number().int().nonnegative(),
  roomCode: roomCodeSchema,
  playerName: playerNameSchema,
  resumeToken: resumeTokenSchema.nullish(),
});

export const leaveSessionSchema = z.object({
  type: z.literal("leaveSession"),
});

export const setReadySchema = z.object({
  type: z.literal("setReady"),
  ready: z.boolean(),
});

/**
 * Movement intent, never a position. `direction` is an unnormalized heading; the server normalizes
 * it, applies its own speed, and resolves collision. `sequence` lets the server tell the client
 * which intent a correction refers to.
 */
export const playerMoveIntentSchema = z.object({
  type: z.literal("playerMoveIntent"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
});

/** Target is optional: the hybrid combat model allows directional swings that hit whatever is there. */
export const playerAttackSchema = z.object({
  type: z.literal("playerAttack"),
  sequence: z.number().int().nonnegative(),
  direction: vector2Schema,
  targetId: entityIdSchema.nullable(),
});

export const playerInteractSchema = z.object({
  type: z.literal("playerInteract"),
  targetId: entityIdSchema,
});

export const pickupItemSchema = z.object({
  type: z.literal("pickupItem"),
  itemId: entityIdSchema,
});

export const useItemSchema = z.object({
  type: z.literal("useItem"),
  itemId: entityIdSchema,
});

export const voiceSignalMessageSchema = z.object({
  type: z.literal("voiceSignal"),
  targetPlayerId: playerIdSchema,
  signal: voiceSignalSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  joinSessionSchema,
  leaveSessionSchema,
  setReadySchema,
  playerMoveIntentSchema,
  playerAttackSchema,
  playerInteractSchema,
  pickupItemSchema,
  useItemSchema,
  voiceSignalMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];
