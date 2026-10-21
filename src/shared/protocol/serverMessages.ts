import { z } from "zod";
import {
  dungeonSnapshotSchema,
  contentIdSchema,
  entityIdSchema,
  inventoryItemSchema,
  milestoneStatsSchema,
  milestoneViewSchema,
  partyColorSchema,
  playerIdSchema,
  playerNameSchema,
  playerStateSchema,
  profileSecretSchema,
  profileStateSchema,
  resumeTokenSchema,
  roomCodeSchema,
  runStateSchema,
  sessionLocationSchema,
  sessionIdSchema,
  skillStacksSchema,
  skillViewSchema,
  vector2Schema,
} from "../types/core.js";
import { emoteKindSchema } from "./clientMessages.js";
import { voiceSignalSchema } from "./voice.js";

export const errorCodeSchema = z.enum([
  "protocolVersionMismatch",
  "invalidMessage",
  "sessionNotFound",
  "sessionFull",
  "notInSession",
  "alreadyInSession",
  "runInProgress",
  /**
   * This profile is already playing somewhere. Two sessions sharing one bank would let a run's
   * loot be banked twice, or lost twice, so the second join is refused rather than reconciled.
   */
  "profileInUse",
  /**
   * A voice signal named a player it cannot reach: the sender, a disconnected party member, or
   * nobody in the sender's dungeon. Players in other dungeons are reported exactly like unknown ids.
   */
  "signalTargetUnavailable",
  /** A `setAppearance` with an unknown id, a missing field, or an extra one. */
  "invalidAppearance",
  /** A `setAppearance` from a player whose look is already set. It is fixed for the slot's life. */
  "appearanceLocked",
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
  /** A skill scroll whose skill the player already holds at its `maxStacks`. The scroll is kept. */
  "skillMaxed",
  /** A skill scroll whose `requires` the player does not hold yet. The scroll is kept. */
  "missingPrerequisites",
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
 * Sent only to the joining player. `resumeToken` and `profileSecret` are both credentials, so this
 * message must never be broadcast to the rest of the party. `resumed` tells the client whether it
 * reclaimed an existing slot or was given a fresh one.
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
  /**
   * True when this slot has no look yet: a fresh slot, or a resumed one whose player had not finished
   * designing. The client shows the character designer and sends `setAppearance`; until it does, the
   * player is not in the world. False on a resume of a slot that already has its look.
   */
  needsAppearance: z.boolean(),
  /** The profile this slot now plays as, whether it was recognised or created just now. */
  profile: profileStateSchema,
  /**
   * The profile secret, and only when the server has just issued one. Null on every later join,
   * because the server stores a hash and so cannot repeat a secret it did not generate this time.
   * A client that receives one stores it; a client that receives null keeps the one it sent.
   */
  profileSecret: profileSecretSchema.nullable(),
});

/**
 * The skill definitions this session plays with, including stack limits, per-stack effects and
 * prerequisites, for display. Static for the life of a
 * session, so it is sent once, right after `sessionJoined`, rather than with every change to
 * `progressionUpdated`. Owner-only like the rest of the progression contract, though it holds
 * nothing secret.
 */
export const progressionCatalogSchema = z.object({
  type: z.literal("progressionCatalog"),
  skills: z.array(skillViewSchema),
  milestones: z.array(milestoneViewSchema),
});

/**
 * What the receiving player has, and what is in force right now. Sent only to its owner: it is
 * never broadcast, because another player's unlocks are not that player's to see. Sent after
 * `sessionJoined` and again whenever any field changes, such as learning a scroll, extracting, or
 * losing a run, so a client never has to infer progression from other messages.
 *
 * `skillStacks` is permanent. `runSkillStacks` is provisional: in force for this run, and gone
 * unless the player gets back to the hub. `activeSkillStacks` is what the server's effects resolve
 * from: both added together, capped at each skill's current `maxStacks`, and without skills the
 * catalog no longer has. `coin` is the profile balance and `runCoin` the run purse (decision 0014).
 */
export const progressionUpdatedSchema = z.object({
  type: z.literal("progressionUpdated"),
  skillStacks: skillStacksSchema,
  runSkillStacks: skillStacksSchema,
  activeSkillStacks: skillStacksSchema,
  /** Banked coin on the profile. */
  coin: z.number().int().nonnegative(),
  /** The run purse: carried coin, credited on extraction and lost otherwise. Zero in the hub. */
  runCoin: z.number().int().nonnegative(),
  /** Lifetime milestone stats, credited when a run ends to players who extracted. */
  stats: milestoneStatsSchema,
  /** Ids of the milestones already earned, each granted at most once. */
  earnedMilestones: z.array(contentIdSchema),
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
  /**
   * Set on the change that filled the last hub ready plate and so made the whole party ready, as a
   * cue to head for the gate. Absent otherwise.
   */
  partyReady: z.literal(true).optional(),
});

/**
 * One party member as the roster lists them. Deliberately only what is safe to tell someone who
 * cannot see this member: no position, health, resistance, downed state or anything else about the
 * body. `.strict()` so a field added here is a decision, not an accident.
 */
export const partyRosterEntrySchema = z
  .object({
    playerId: playerIdSchema,
    name: playerNameSchema,
    partyColor: partyColorSchema,
    connected: z.boolean(),
  })
  .strict();
export type PartyRosterEntry = z.infer<typeof partyRosterEntrySchema>;

/**
 * Who is in the party, including members the receiver cannot see, so the HUD can keep a frame for
 * an ally who left sight. Sent to every connected member whenever the list changes, and once after
 * joining. Members who have not finished designing their character are not listed yet. Snapshots
 * remain the only source of live state: a member missing from the receiver's snapshot is out of
 * sight, and the client shows nothing about them but this entry.
 */
export const partyRosterSchema = z.object({
  type: z.literal("partyRoster"),
  members: z.array(partyRosterEntrySchema),
});

/**
 * What the party vault holds. The vault belongs to the room code rather than to anyone in it, so
 * every member gets the same list: once after joining, and again whenever it changes. Unlike the
 * legacy personal bank on `PlayerState.bankedItems`, this is shared party data.
 */
export const partyVaultSchema = z.object({
  type: z.literal("partyVault"),
  items: z.array(inventoryItemSchema),
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
  location: sessionLocationSchema,
  players: z.array(playerStateSchema),
  dungeon: dungeonSnapshotSchema,
  run: runStateSchema,
});

/**
 * Where a player's melee swing landed, as the server resolved it: the attacker's position and
 * facing, the held weapon's (or the unarmed) reach, and the cosine of the half-angle of its arc.
 * Clients draw exactly this and never recompute reach from content.
 */
export const swingGeometrySchema = z.object({
  origin: vector2Schema,
  facing: vector2Schema,
  range: z.number().positive(),
  arcCos: z.number().min(-1).max(1),
});

export const attackResolvedSchema = z.object({
  type: z.literal("attackResolved"),
  attackerId: entityIdSchema,
  targetId: entityIdSchema.nullable(),
  damage: z.number().int().nonnegative(),
  /** A training dummy has no health: a hit on one reports 0 here and is never a defeat. */
  targetHealth: z.number().int().nonnegative(),
  targetDefeated: z.boolean(),
  /** The swing's geometry, hit or miss. Null for monster attacks, which telegraph in snapshots. */
  swing: swingGeometrySchema.nullable(),
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

/**
 * A party member emoted. Sent only to the members whose visible frame holds the emoter when the
 * server accepted it, so an emote never gives away a position in the dark; the sender always gets
 * their own. `at` is the session tick it was accepted on.
 */
export const playerEmotedSchema = z.object({
  type: z.literal("playerEmoted"),
  playerId: playerIdSchema,
  kind: emoteKindSchema,
  at: z.number().int().nonnegative(),
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
  progressionCatalogSchema,
  progressionUpdatedSchema,
  playerJoinedSchema,
  playerLeftSchema,
  playerConnectionChangedSchema,
  playerReadyChangedSchema,
  partyRosterSchema,
  partyVaultSchema,
  stateSnapshotSchema,
  attackResolvedSchema,
  voiceRangeUpdatedSchema,
  voiceSignalRelaySchema,
  playerEmotedSchema,
  actionRejectedSchema,
  sessionErrorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageType = ServerMessage["type"];
