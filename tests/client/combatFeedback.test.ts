import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import {
  applyServerMessage,
  initialSessionView,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import {
  createPopupField,
  createSwingField,
  damagePopup,
  monsterBarView,
  newAttacks,
  POPUP_LIFETIME_MS,
  SWING_LIFETIME_MS,
  swingArc,
  type AttackRecord,
} from "../../src/client/state/combatFeedback.js";
import type { DungeonState, MonsterState, PlayerState } from "../../src/shared/types/core.js";

const SELF = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY = "9a2e7c1f-7b5b-4a3f-8e2d-3c4b5d6e7f80";
const MONSTER = "a1111111-1111-4111-8111-111111111111";
const HIDDEN_MONSTER = "b2222222-2222-4222-8222-222222222222";
const DUMMY = "c3333333-3333-4333-8333-333333333333";

function player(id: string, x: number): PlayerState {
  return {
    id,
    name: id === SELF ? "Me" : "Ally",
    position: { x, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    bankedItems: [],
  };
}

function monster(id: string, x: number): MonsterState {
  return { id, name: "Ghoul", position: { x, y: 5 }, health: 10, maxHealth: 20, alive: true } as MonsterState;
}

function view(overrides: Partial<SessionView> = {}): SessionView {
  return {
    ...initialSessionView,
    phase: "inSession",
    selfId: SELF,
    players: [player(SELF, 1), player(ALLY, 3)],
    visiblePlayerIds: [SELF, ALLY],
    dungeon: {
      monsters: [monster(MONSTER, 7)],
      dummies: [{ id: DUMMY, position: { x: 4, y: 2 }, recentDamage: 0, dps: 0, attackers: [] }],
    } as unknown as DungeonState,
    ...overrides,
  };
}

function attack(overrides: Partial<AttackRecord>): AttackRecord {
  return { seq: 1, attackerId: SELF, targetId: MONSTER, damage: 5, targetDefeated: false, swing: null, ...overrides };
}

const here = { x: 1.5, y: 0.5 };

describe("damagePopup", () => {
  it("shows the local player's hit on a monster at the monster", () => {
    expect(damagePopup(view(), attack({}), here)).toEqual({
      position: { x: 7, y: 5 },
      text: "5",
      kind: "dealt",
    });
  });

  it("shows a hit on a training dummy at the dummy", () => {
    expect(damagePopup(view(), attack({ targetId: DUMMY, damage: 9 }), here)).toEqual({
      position: { x: 4, y: 2 },
      text: "9",
      kind: "dealt",
    });
    expect(damagePopup(view(), attack({ attackerId: ALLY, targetId: DUMMY }), here)?.kind).toBe("ally");
  });

  it("shows an ally's hit as an ally number", () => {
    expect(damagePopup(view(), attack({ attackerId: ALLY }), here)?.kind).toBe("ally");
  });

  it("shows damage to the local player at the predicted position", () => {
    expect(damagePopup(view(), attack({ attackerId: MONSTER, targetId: SELF }), here)).toEqual({
      position: here,
      text: "5",
      kind: "taken",
    });
  });

  it("shows damage to a visible ally but not to one out of sight", () => {
    const hit = attack({ attackerId: MONSTER, targetId: ALLY });
    expect(damagePopup(view(), hit, here)?.position).toEqual({ x: 3, y: 0 });
    expect(damagePopup(view({ visiblePlayerIds: [SELF] }), hit, here)).toBeNull();
  });

  it("ignores misses, zero damage, and targets the client cannot see", () => {
    expect(damagePopup(view(), attack({ targetId: null, damage: 0 }), here)).toBeNull();
    expect(damagePopup(view(), attack({ damage: 0 }), here)).toBeNull();
    expect(damagePopup(view(), attack({ targetId: HIDDEN_MONSTER }), here)).toBeNull();
  });
});

describe("recorded attacks", () => {
  const message = (damage: number) =>
    ({
      type: "attackResolved",
      attackerId: SELF,
      targetId: MONSTER,
      damage,
      targetHealth: 1,
      targetDefeated: false,
      swing: null,
    }) as const;

  it("numbers each attackResolved so none is shown twice", () => {
    let next = applyServerMessage(initialSessionView, message(3));
    next = applyServerMessage(next, message(4));

    expect(next.attackSeq).toBe(2);
    expect(newAttacks(next, 0).map((record) => [record.seq, record.damage])).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(newAttacks(next, 1).map((record) => record.seq)).toEqual([2]);
    expect(newAttacks(next, 2)).toEqual([]);
  });

  it("keeps only the latest attacks", () => {
    let next = initialSessionView;
    for (let index = 0; index < 100; index += 1) next = applyServerMessage(next, message(1));

    expect(next.attackSeq).toBe(100);
    expect(next.recentAttacks.length).toBeLessThan(100);
    expect(next.recentAttacks.at(-1)?.seq).toBe(100);
  });
});

describe("popup field", () => {
  const popup = { position: { x: 1, y: 1 }, text: "5", kind: "dealt" } as const;

  it("reports progress and drops numbers once their lifetime ends", () => {
    const field = createPopupField();
    field.add(popup, 1000);

    expect(field.active(1000)[0]?.progress).toBe(0);
    expect(field.active(1000 + POPUP_LIFETIME_MS / 2)[0]?.progress).toBeCloseTo(0.5);
    expect(field.active(1000 + POPUP_LIFETIME_MS)).toEqual([]);
  });

  it("caps how many numbers can pile up and can be cleared", () => {
    const field = createPopupField();
    for (let index = 0; index < 100; index += 1) field.add(popup, 0);
    expect(field.active(0).length).toBeLessThanOrEqual(24);

    field.clear();
    expect(field.active(0)).toEqual([]);
  });
});

describe("monsterBarView", () => {
  it("clamps the ratio and flags low health", () => {
    expect(monsterBarView(20, 20)).toEqual({ ratio: 1, low: false });
    expect(monsterBarView(7, 20)).toEqual({ ratio: 0.35, low: false });
    expect(monsterBarView(6, 20).low).toBe(true);
    expect(monsterBarView(-3, 20).ratio).toBe(0);
    expect(monsterBarView(5, 0).ratio).toBe(0);
  });
});

describe("swingArc", () => {
  const geometry = { origin: { x: 1, y: 0 }, facing: { x: 0, y: 1 }, range: 2.5, arcCos: 0.5 };
  const swung = (overrides: Partial<AttackRecord> = {}) => attack({ swing: geometry, ...overrides });

  it("turns facing, range and arcCos into a heading, half-angle and reach", () => {
    const arc = swingArc(view(), swung());

    expect(arc?.origin).toEqual({ x: 1, y: 0 });
    expect(arc?.heading).toBeCloseTo(Math.PI / 2);
    expect(arc?.halfArc).toBeCloseTo(Math.PI / 3);
    expect(arc?.range).toBe(2.5);
  });

  it("clamps a degenerate arcCos instead of producing NaN", () => {
    expect(swingArc(view(), swung({ swing: { ...geometry, arcCos: -1 } }))?.halfArc).toBeCloseTo(Math.PI);
    expect(swingArc(view(), swung({ swing: { ...geometry, arcCos: 1 } }))?.halfArc).toBeCloseTo(0);
  });

  it("marks a hit with an impact point and a miss without one", () => {
    expect(swingArc(view(), swung())).toMatchObject({ hit: true, impact: { x: 7, y: 5 } });
    expect(swingArc(view(), swung({ targetId: null, damage: 0 }))).toMatchObject({
      hit: false,
      impact: null,
    });
  });

  it("puts the impact of a hit on a training dummy at the dummy", () => {
    expect(swingArc(view(), swung({ targetId: DUMMY }))).toMatchObject({ hit: true, impact: { x: 4, y: 2 } });
  });

  it("draws the local player's swing and a visible teammate's", () => {
    expect(swingArc(view(), swung({ attackerId: SELF }))).not.toBeNull();
    expect(swingArc(view(), swung({ attackerId: ALLY }))).not.toBeNull();
  });

  it("draws nothing for an attacker outside the visible frame", () => {
    expect(swingArc(view({ visiblePlayerIds: [SELF] }), swung({ attackerId: ALLY }))).toBeNull();
  });

  it("draws nothing for an attack without swing geometry", () => {
    expect(swingArc(view(), attack({ swing: null }))).toBeNull();
  });
});

describe("swing field", () => {
  const arc = swingArc(
    view(),
    attack({ swing: { origin: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, range: 1, arcCos: 0 } }),
  )!;

  it("animates a swing and drops it once it has faded", () => {
    const field = createSwingField();
    field.add(arc, 1000);

    expect(field.active(1000 + SWING_LIFETIME_MS / 2)[0]?.progress).toBeCloseTo(0.5);
    expect(field.active(1000 + SWING_LIFETIME_MS)).toEqual([]);
  });
});
