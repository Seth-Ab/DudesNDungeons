import { describe, expect, it } from "vitest";
import {
  resolveSignalTarget,
  SignalRateLimiter,
  signalRelayFor,
} from "../../src/server/voice/signalRelay.js";
import {
  VOICE_SIGNAL_BURST,
  VOICE_SIGNAL_REFILL_PER_SECOND,
} from "../../src/shared/constants/game.js";
import type { VoiceSignal } from "../../src/shared/protocol/index.js";
import type { PlayerId } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

const id = (value: string) => value as PlayerId;

describe("voice signal targets", () => {
  const sender = testPlayer("sender");
  const peer = testPlayer("peer");
  const dropped = testPlayer("dropped", { connected: false, disconnectedAt: 0 });
  const session = testSession([sender, peer, dropped]);

  it("routes to a connected member of the sender's dungeon", () => {
    const result = resolveSignalTarget(session, id("sender"), id("peer"));
    expect(result.ok && result.target.id).toBe("peer");
  });

  it("refuses the sender itself", () => {
    expect(resolveSignalTarget(session, id("sender"), id("sender"))).toEqual({
      ok: false,
      message: "A voice signal cannot target its sender",
    });
  });

  it("refuses a disconnected party member whose slot is still held", () => {
    expect(resolveSignalTarget(session, id("sender"), id("dropped"))).toEqual({
      ok: false,
      message: "That player is disconnected",
    });
  });

  it("refuses a player in another dungeon exactly like an unknown id", () => {
    const elsewhere = testPlayer("elsewhere");
    testSession([elsewhere]);

    const crossSession = resolveSignalTarget(session, id("sender"), id("elsewhere"));
    const unknown = resolveSignalTarget(session, id("sender"), id("nobody"));

    expect(crossSession).toEqual({ ok: false, message: "No such player in this dungeon" });
    expect(crossSession).toEqual(unknown);
  });

  it("stops routing to a player once they leave the session", () => {
    const party = testSession([testPlayer("a"), testPlayer("b")]);
    party.players.delete(id("b"));

    expect(resolveSignalTarget(party, id("a"), id("b")).ok).toBe(false);
  });
});

describe("voice signal relay message", () => {
  it("carries the sender id and the handshake, and nothing else the client sent", () => {
    const smuggled = {
      kind: "iceCandidate",
      candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      resumeToken: "secret",
      profileSecret: "secret",
    } as unknown as VoiceSignal;

    expect(signalRelayFor(id("sender"), smuggled)).toStrictEqual({
      type: "voiceSignalRelay",
      fromPlayerId: "sender",
      signal: {
        kind: "iceCandidate",
        candidate: "candidate:1 1 udp 1 192.0.2.1 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
  });
});

describe("voice signal rate limit", () => {
  it("allows a full burst, then refuses until the bucket refills", () => {
    const limiter = new SignalRateLimiter(3, 1);
    const player = id("p");

    expect([1, 2, 3].map(() => limiter.tryConsume(player, 0))).toEqual([true, true, true]);
    expect(limiter.tryConsume(player, 0)).toBe(false);
    expect(limiter.tryConsume(player, 999)).toBe(false);
    expect(limiter.tryConsume(player, 1000)).toBe(true);
    expect(limiter.tryConsume(player, 1000)).toBe(false);
  });

  it("never refills past the burst", () => {
    const limiter = new SignalRateLimiter(2, 10);
    const player = id("p");

    limiter.tryConsume(player, 0);
    expect([1, 2, 3].map(() => limiter.tryConsume(player, 60_000))).toEqual([true, true, false]);
  });

  it("budgets each player separately", () => {
    const limiter = new SignalRateLimiter(1, 1);

    expect(limiter.tryConsume(id("a"), 0)).toBe(true);
    expect(limiter.tryConsume(id("a"), 0)).toBe(false);
    expect(limiter.tryConsume(id("b"), 0)).toBe(true);
  });

  it("earns nothing from a clock that steps backwards", () => {
    const limiter = new SignalRateLimiter(1, 1);
    const player = id("p");

    limiter.tryConsume(player, 5000);
    expect(limiter.tryConsume(player, 0)).toBe(false);
  });

  it("forgets a player who has left, leaving no state behind", () => {
    const limiter = new SignalRateLimiter(1, 1);
    limiter.tryConsume(id("a"), 0);
    limiter.tryConsume(id("b"), 0);

    limiter.forget(id("a"));
    expect(limiter.trackedPlayers).toBe(1);
    expect(limiter.tryConsume(id("a"), 0)).toBe(true);

    limiter.clear();
    expect(limiter.trackedPlayers).toBe(0);
  });

  it("covers a full party's handshake with the default budget", () => {
    const limiter = new SignalRateLimiter();
    const player = id("p");
    // An offer and ten ICE candidates to each of three peers.
    const handshake = 3 * 11;

    expect(VOICE_SIGNAL_BURST).toBeGreaterThanOrEqual(handshake);
    expect(VOICE_SIGNAL_REFILL_PER_SECOND).toBeGreaterThan(0);
    for (let sent = 0; sent < handshake; sent += 1) {
      expect(limiter.tryConsume(player, 0)).toBe(true);
    }
  });
});
