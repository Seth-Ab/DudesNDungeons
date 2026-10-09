import { z } from "zod";
import {
  entityIdSchema,
  playerIdSchema,
  playerNameSchema,
  profileSecretSchema,
  resumeTokenSchema,
  roomCodeSchema,
  vector2Schema,
} from "../types/core.js";
import { voiceSignalSchema } from "./voice.js";

/**
 * `resumeToken` is the token from an earlier `sessionJoined` in the same room. Present, it asks the
 * server to reclaim that player slot with its position, health, and ready state intact. Absent or
 * no longer valid, the join is treated as a brand new player.
 *
 * `profileSecret` names the roguelite profile this device already owns, from an earlier
 * `sessionJoined` in any room. Absent or unknown to the server, a fresh profile is created and its
 * secret comes back once. The two credentials answer different questions: the resume token says
 * which slot in this room, the profile secret says whose bank and unlocks.
 */
export const joinSessionSchema = z.object({
  type: z.literal("joinSession"),
  protocolVersion: z.number().int().nonnegative(),
  roomCode: roomCodeSchema,
  playerName: playerNameSchema,
  resumeToken: resumeTokenSchema.nullish(),
  profileSecret: profileSecretSchema.nullish(),
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

/** Puts a held item on the floor at the sender's feet as loot anyone can pick up again. */
export const dropItemSchema = z.object({
  type: z.literal("dropItem"),
  itemId: entityIdSchema,
});

/** Hands a held item to a standing, connected party member within reach who has a free slot. */
export const giveItemSchema = z.object({
  type: z.literal("giveItem"),
  itemId: entityIdSchema,
  targetPlayerId: playerIdSchema,
});

/** Lifts a downed party member within reach. Refused if either player is already carrying/carried. */
export const liftPlayerSchema = z.object({
  type: z.literal("liftPlayer"),
  targetPlayerId: playerIdSchema,
});

/** Explicitly drops whoever the sender is carrying. A no-op refusal if they are carrying nobody. */
export const dropCarrySchema = z.object({
  type: z.literal("dropCarry"),
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
  dropItemSchema,
  giveItemSchema,
  liftPlayerSchema,
  dropCarrySchema,
  voiceSignalMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];
