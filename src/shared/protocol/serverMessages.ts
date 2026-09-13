import { z } from "zod";
import {
  entityIdSchema,
  playerIdSchema,
  playerStateSchema,
  roomCodeSchema,
  sessionIdSchema,
} from "../types/core.js";
import { voiceSignalSchema } from "./voice.js";

export const errorCodeSchema = z.enum([
  "protocolVersionMismatch",
  "invalidMessage",
  "sessionNotFound",
  "sessionFull",
  "notInSession",
  "alreadyInSession",
  "rateLimited",
  "notImplemented",
  "internalError",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const rejectionReasonSchema = z.enum([
  "blocked",
  "outOfRange",
  "onCooldown",
  "notPermitted",
  "targetMissing",
]);
export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

export const playerLeftReasonSchema = z.enum(["left", "disconnected", "timedOut"]);
export type PlayerLeftReason = z.infer<typeof playerLeftReasonSchema>;

export const sessionJoinedSchema = z.object({
  type: z.literal("sessionJoined"),
  sessionId: sessionIdSchema,
  roomCode: roomCodeSchema,
  playerId: playerIdSchema,
  tickRate: z.number().int().positive(),
  players: z.array(playerStateSchema),
});

export const playerJoinedSchema = z.object({
  type: z.literal("playerJoined"),
  player: playerStateSchema,
});

export const playerLeftSchema = z.object({
  type: z.literal("playerLeft"),
  playerId: playerIdSchema,
  reason: playerLeftReasonSchema,
});

export const playerReadyChangedSchema = z.object({
  type: z.literal("playerReadyChanged"),
  playerId: playerIdSchema,
  ready: z.boolean(),
});

/** Authoritative world state. Clients render from this rather than from their own predictions. */
export const stateSnapshotSchema = z.object({
  type: z.literal("stateSnapshot"),
  tick: z.number().int().nonnegative(),
  players: z.array(playerStateSchema),
});

export const attackResolvedSchema = z.object({
  type: z.literal("attackResolved"),
  attackerId: entityIdSchema,
  targetId: entityIdSchema.nullable(),
  damage: z.number().int().nonnegative(),
  targetHealth: z.number().int().nonnegative(),
  targetDefeated: z.boolean(),
});

/**
 * Per-peer distances for audio attenuation. Voice connections stay up for the whole session, so
 * this drives volume only, never connect or disconnect decisions.
 */
export const voiceRangeUpdatedSchema = z.object({
  type: z.literal("voiceRangeUpdated"),
  peers: z.array(
    z.object({
      playerId: playerIdSchema,
      distance: z.number().nonnegative(),
      volume: z.number().min(0).max(1),
    }),
  ),
});

export const voiceSignalRelaySchema = z.object({
  type: z.literal("voiceSignalRelay"),
  fromPlayerId: playerIdSchema,
  signal: voiceSignalSchema,
});

/** Tells the client a well-formed action was refused, so it can roll back its prediction. */
export const actionRejectedSchema = z.object({
  type: z.literal("actionRejected"),
  sequence: z.number().int().nonnegative().nullable(),
  reason: rejectionReasonSchema,
});

export const sessionErrorSchema = z.object({
  type: z.literal("sessionError"),
  code: errorCodeSchema,
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  sessionJoinedSchema,
  playerJoinedSchema,
  playerLeftSchema,
  playerReadyChangedSchema,
  stateSnapshotSchema,
  attackResolvedSchema,
  voiceRangeUpdatedSchema,
  voiceSignalRelaySchema,
  actionRejectedSchema,
  sessionErrorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageType = ServerMessage["type"];
