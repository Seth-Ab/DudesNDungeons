import { z } from "zod";
import {
  dungeonStateSchema,
  entityIdSchema,
  playerIdSchema,
  playerStateSchema,
  resumeTokenSchema,
  roomCodeSchema,
  runStateSchema,
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
  /** The action costs more stamina than the player has. Distinct from a cooldown: waiting is longer. */
  "exhausted",
]);
export type RejectionReason = z.infer<typeof rejectionReasonSchema>;

/**
 * Terminal reasons only. A dropped socket does not remove a player: the slot is held for
 * `RECONNECT_GRACE_MS` and reported with `playerConnectionChanged`, becoming `timedOut` only if
 * nobody reclaims it.
 */
export const playerLeftReasonSchema = z.enum(["left", "timedOut"]);
export type PlayerLeftReason = z.infer<typeof playerLeftReasonSchema>;

/**
 * Sent only to the joining player. `resumeToken` is a credential for reclaiming this slot after a
 * disconnect, so this message must never be broadcast to the rest of the party. `resumed` tells the
 * client whether it reclaimed an existing slot or was given a fresh one.
 */
export const sessionJoinedSchema = z.object({
  type: z.literal("sessionJoined"),
  sessionId: sessionIdSchema,
  roomCode: roomCodeSchema,
  playerId: playerIdSchema,
  resumeToken: resumeTokenSchema,
  resumed: z.boolean(),
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

/** A party member dropped or came back while keeping their slot. Not a join and not a leave. */
export const playerConnectionChangedSchema = z.object({
  type: z.literal("playerConnectionChanged"),
  playerId: playerIdSchema,
  connected: z.boolean(),
});

export const playerReadyChangedSchema = z.object({
  type: z.literal("playerReadyChanged"),
  playerId: playerIdSchema,
  ready: z.boolean(),
});

/**
 * Authoritative world state. Clients render from this rather than from their own predictions.
 *
 * Per-player since protocol v4: this is the receiving player's visible frame, and `run` is that
 * player's own run clock.
 */
export const stateSnapshotSchema = z.object({
  type: z.literal("stateSnapshot"),
  tick: z.number().int().nonnegative(),
  players: z.array(playerStateSchema),
  dungeon: dungeonStateSchema,
  run: runStateSchema,
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
  playerConnectionChangedSchema,
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
