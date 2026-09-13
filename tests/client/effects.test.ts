import { describe, expect, it } from "vitest";
import {
  FLOATER_MS,
  NOTICE_MS,
  SWING_MS,
  applyEvent,
  noEffects,
  pruneEffects,
  withNotice,
  type Body,
  type EffectContext,
} from "../../src/client/state/effects.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";

const SELF = "self";
const IMP = "imp";

const bodies: Record<string, Body> = {
  [SELF]: { position: { x: 2, y: 2 }, facing: { x: -1, y: 0 } },
  [IMP]: { position: { x: 3, y: 2 }, facing: null },
};

const context: EffectContext = {
  selfId: SELF,
  bodyOf: (id) => bodies[id] ?? null,
};

function attack(overrides: Partial<Extract<ServerMessage, { type: "attackResolved" }>>): ServerMessage {
  return {
    type: "attackResolved",
    attackerId: SELF,
    targetId: IMP,
    damage: 6,
    targetHealth: 6,
    targetDefeated: false,
    ...overrides,
  };
}

describe("attack effects", () => {
  it("swings from the attacker toward the target and floats the damage off the target", () => {
    const effects = applyEvent(noEffects, attack({}), context, 100);

    expect(effects.swings).toEqual([
      { origin: { x: 2, y: 2 }, heading: { x: 1, y: 0 }, startedAt: 100 },
    ]);
    expect(effects.floaters).toEqual([
      { text: "-6", tone: "damage", position: { x: 3, y: 2 }, startedAt: 100 },
    ]);
  });

  it("marks damage to this client's own player as hurt", () => {
    const effects = applyEvent(noEffects, attack({ attackerId: IMP, targetId: SELF, damage: 8 }), context, 0);

    expect(effects.floaters[0]).toMatchObject({ text: "-8", tone: "hurt", position: { x: 2, y: 2 } });
  });

  it("calls out a knockout", () => {
    const effects = applyEvent(noEffects, attack({ targetDefeated: true }), context, 0);

    expect(effects.floaters[0]?.text).toBe("-6 KO");
  });

  it("swings along the attacker's facing when the swing hits nothing", () => {
    const effects = applyEvent(noEffects, attack({ targetId: null, damage: 0 }), context, 0);

    expect(effects.swings[0]?.heading).toEqual({ x: -1, y: 0 });
    expect(effects.floaters).toEqual([]);
  });

  it("skips bodies the client does not know about", () => {
    const effects = applyEvent(noEffects, attack({ attackerId: "stranger", targetId: "ghost" }), context, 0);

    expect(effects).toEqual(noEffects);
  });
});

describe("refusals", () => {
  it("explains a refused one-off action", () => {
    const effects = applyEvent(
      noEffects,
      { type: "actionRejected", sequence: null, reason: "outOfRange" },
      context,
      50,
    );

    expect(effects.notice).toEqual({ text: "You need to get closer.", startedAt: 50 });
  });

  it("stays quiet about refused moves and swings, which carry a sequence", () => {
    const effects = applyEvent(
      noEffects,
      { type: "actionRejected", sequence: 12, reason: "onCooldown" },
      context,
      0,
    );

    expect(effects).toBe(noEffects);
  });

  it("ignores messages that are not events", () => {
    expect(
      applyEvent(noEffects, { type: "playerReadyChanged", playerId: SELF, ready: true }, context, 0),
    ).toBe(noEffects);
  });
});

describe("pruneEffects", () => {
  it("drops each effect once its duration has passed", () => {
    const effects = withNotice(applyEvent(noEffects, attack({}), context, 0), "Hello", 0);

    expect(pruneEffects(effects, SWING_MS).swings).toEqual([]);
    expect(pruneEffects(effects, SWING_MS).floaters).toHaveLength(1);
    expect(pruneEffects(effects, FLOATER_MS).floaters).toEqual([]);
    expect(pruneEffects(effects, NOTICE_MS - 1).notice?.text).toBe("Hello");
    expect(pruneEffects(effects, NOTICE_MS).notice).toBeNull();
  });

  it("returns the same object when nothing expired", () => {
    const effects = applyEvent(noEffects, attack({}), context, 0);

    expect(pruneEffects(effects, 1)).toBe(effects);
  });
});
