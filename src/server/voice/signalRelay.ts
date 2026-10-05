import { VOICE_SIGNAL_BURST, VOICE_SIGNAL_REFILL_PER_SECOND } from "../../shared/constants/game.js";
import {
  voiceSignalSchema,
  type ServerMessage,
  type VoiceSignal,
} from "../../shared/protocol/index.js";
import type { PlayerId } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

type VoiceSignalRelay = Extract<ServerMessage, { type: "voiceSignalRelay" }>;

export type SignalTargetResult =
  | { ok: true; target: SessionPlayer }
  | { ok: false; message: string };

/**
 * Who a voice signal may reach: another connected member of the sender's own dungeon. Routing is
 * read from the session at send time rather than kept in a table of its own, so leaving, timing
 * out, and reconnecting cannot leave a stale route behind.
 *
 * A player in another dungeon is simply absent from `session.players`, so it is refused with the
 * same message as an id that names nobody, and a client cannot probe other parties with it.
 */
export function resolveSignalTarget(
  session: Session,
  senderId: PlayerId,
  targetId: PlayerId,
): SignalTargetResult {
  if (targetId === senderId) {
    return { ok: false, message: "A voice signal cannot target its sender" };
  }

  const target = session.players.get(targetId);
  if (!target) {
    return { ok: false, message: "No such player in this dungeon" };
  }

  if (!target.connected) {
    return { ok: false, message: "That player is disconnected" };
  }

  return { ok: true, target };
}

/**
 * The relayed message: the sender's id and the handshake, nothing else. The signal is rebuilt
 * through its schema, which drops unknown keys, rather than forwarded by reference, so the relay
 * stays clean even if a caller hands it something other than a freshly parsed message.
 */
export function signalRelayFor(senderId: PlayerId, signal: VoiceSignal): VoiceSignalRelay {
  return {
    type: "voiceSignalRelay",
    fromPlayerId: senderId,
    signal: voiceSignalSchema.parse(signal),
  };
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-player token bucket for voice signals. Keyed by player rather than socket, so reconnecting
 * does not refill it; `forget` drops a player once they leave the session for good.
 */
export class SignalRateLimiter {
  readonly #buckets = new Map<PlayerId, Bucket>();
  readonly #burst: number;
  readonly #refillPerMs: number;

  constructor(
    burst: number = VOICE_SIGNAL_BURST,
    refillPerSecond: number = VOICE_SIGNAL_REFILL_PER_SECOND,
  ) {
    this.#burst = burst;
    this.#refillPerMs = refillPerSecond / 1000;
  }

  /** Spends one signal from the player's budget, or returns false if it is empty. */
  tryConsume(playerId: PlayerId, now: number): boolean {
    const bucket = this.#buckets.get(playerId) ?? { tokens: this.#burst, updatedAt: now };
    // A clock that steps backwards earns nothing rather than draining the bucket.
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(this.#burst, bucket.tokens + elapsed * this.#refillPerMs);
    bucket.updatedAt = now;
    this.#buckets.set(playerId, bucket);

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  forget(playerId: PlayerId): void {
    this.#buckets.delete(playerId);
  }

  clear(): void {
    this.#buckets.clear();
  }

  get trackedPlayers(): number {
    return this.#buckets.size;
  }
}
