import { describe, expect, it } from "vitest";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import { pickupItem, useItem } from "../../src/server/game/items.js";
import {
  advanceVitals,
  damageMultiplier,
  damagePlayer,
  drainStamina,
  restoreResistance,
  runStateFor,
  spendStamina,
} from "../../src/server/game/vitals.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import {
  ATTACK_STAMINA_COST,
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DECAY_GRACE_MS,
  RESISTANCE_DECAY_PER_SECOND,
  STAMINA_REGEN_PER_SECOND,
  WARD_RESISTANCE_AMOUNT,
} from "../../src/shared/constants/game.js";
import { ASH_IMP_ID, WARDING_SALVE_ID, at, testPlayer, testSession } from "./fixtures.js";

describe("resistance as damage reduction", () => {
  it("scales a hit with diminishing returns and never reaches immunity", () => {
    expect(damageMultiplier(0)).toBe(1);
    expect(damageMultiplier(100)).toBeCloseTo(0.5);
    expect(damageMultiplier(300)).toBeCloseTo(0.25);
    expect(damageMultiplier(PLAYER_MAX_RESISTANCE)).toBeGreaterThan(0);
  });

  it("applies the reduction inside damagePlayer and reports what landed", () => {
    const soft = testPlayer("soft", { resistance: 0 });
    const warded = testPlayer("warded", { resistance: 100 });

    expect(damagePlayer(soft, 20)).toBe(20);
    expect(damagePlayer(warded, 20)).toBe(10);
    expect(soft.health).toBe(80);
    expect(warded.health).toBe(90);
  });

  it("still costs a heavily warded player one point per hit", () => {
    const player = testPlayer("alpha", { resistance: PLAYER_MAX_RESISTANCE });

    expect(damagePlayer(player, 1)).toBe(1);
    expect(player.health).toBe(99);
  });

  it("never carries a hit past zero, and never hits a player already down", () => {
    const dying = testPlayer("dying", { health: 3, resistance: 0 });

    expect(damagePlayer(dying, 50)).toBe(3);
    expect(dying.health).toBe(0);
    expect(damagePlayer(dying, 50)).toBe(0);
  });
});

describe("raising resistance", () => {
  it("is capped, and refuses a consumable that would be wasted", () => {
    const player = testPlayer("alpha", { resistance: PLAYER_MAX_RESISTANCE - 5 });

    expect(restoreResistance(player, WARD_RESISTANCE_AMOUNT)).toBe(true);
    expect(player.resistance).toBe(PLAYER_MAX_RESISTANCE);
    expect(restoreResistance(player, WARD_RESISTANCE_AMOUNT)).toBe(false);
  });

  it("happens through a ward consumable, which is spent in doing it", () => {
    const player = testPlayer("alpha", { position: at(7, 1), resistance: 10 });
    const session = testSession([player]);

    expect(pickupItem(session, "alpha", WARDING_SALVE_ID)).toEqual({ ok: true });
    expect(useItem(session, "alpha", WARDING_SALVE_ID)).toEqual({ ok: true });
    expect(player.resistance).toBe(10 + WARD_RESISTANCE_AMOUNT);
    expect(player.inventory).toEqual([]);
  });

  it("does not happen by waiting: only consumables and skills raise it", () => {
    const player = testPlayer("alpha", { resistance: 5 });
    const session = testSession([player]);

    advanceVitals(session, 0, 0);
    advanceVitals(session, 60_000, 60_000);

    expect(player.resistance).toBe(5);
  });
});

describe("stamina", () => {
  it("refuses a cost the player cannot afford, and spends nothing doing so", () => {
    const player = testPlayer("alpha", { stamina: 10 });

    expect(spendStamina(player, 15)).toBe(false);
    expect(player.stamina).toBe(10);
    expect(spendStamina(player, 10)).toBe(true);
    expect(player.stamina).toBe(0);
  });

  it("drains continuously and reports when it could not pay in full", () => {
    const player = testPlayer("alpha", { stamina: 10 });

    expect(drainStamina(player, 6, 1000)).toBe(true);
    expect(player.stamina).toBe(4);
    expect(drainStamina(player, 6, 1000)).toBe(false);
    expect(player.stamina).toBe(0);
  });

  it("regenerates over time, capped at full", () => {
    const player = testPlayer("alpha", { stamina: 0 });
    const session = testSession([player]);

    advanceVitals(session, 1000, 1000);
    expect(player.stamina).toBeCloseTo(STAMINA_REGEN_PER_SECOND);

    advanceVitals(session, 60_000, 60_000);
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA);
  });

  it("does not regenerate for a downed player", () => {
    const player = testPlayer("alpha", { health: 0, stamina: 0 });
    const session = testSession([player]);

    advanceVitals(session, 5_000, 5_000);

    expect(player.stamina).toBe(0);
  });
});

describe("stamina gates attacking", () => {
  it("costs stamina per swing and refuses one the player cannot pay for", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -0.9), stamina: ATTACK_STAMINA_COST });
    const session = testSession([player]);
    const swing = (now: number) =>
      resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, ASH_IMP_ID, now);

    expect(swing(0).ok).toBe(true);
    expect(player.stamina).toBe(0);

    expect(swing(PLAYER_ATTACK_COOLDOWN_MS)).toEqual({ ok: false, reason: "exhausted" });
  });

  it("charges nothing for a swing refused for any other reason", () => {
    const player = testPlayer("alpha", { position: at(2, 2) });
    const session = testSession([player]);

    // Far out of reach of the imp.
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, ASH_IMP_ID, 0)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA);

    // Then still on cooldown from the swing that did land.
    resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);
    const afterOneSwing = player.stamina;
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
    expect(player.stamina).toBe(afterOneSwing);
  });

});

describe("the run timer", () => {
  const freshRun = () => {
    const player = testPlayer("alpha", { enteredDungeonAt: null });
    return { player, session: testSession([player]) };
  };

  it("starts the clock on the first simulation step, not on join", () => {
    const { player, session } = freshRun();

    advanceVitals(session, 5_000, 0);

    expect(player.enteredDungeonAt).toBe(5_000);
    expect(runStateFor(player, 5_000).elapsedMs).toBe(0);
  });

  it("leaves resistance alone for the whole grace period", () => {
    const { player, session } = freshRun();
    advanceVitals(session, 0, 0);

    for (let now = 1000; now <= RESISTANCE_DECAY_GRACE_MS; now += 1000) {
      advanceVitals(session, now, 1000);
    }

    expect(player.resistance).toBe(PLAYER_BASE_RESISTANCE);
  });

  it("decays only the part of a step that falls after the grace period", () => {
    const { player, session } = freshRun();
    advanceVitals(session, 0, 0);

    // One step straddling the boundary: only its last 500ms is outside the grace period.
    advanceVitals(session, RESISTANCE_DECAY_GRACE_MS + 500, RESISTANCE_DECAY_GRACE_MS + 500);

    expect(player.resistance).toBeCloseTo(
      PLAYER_BASE_RESISTANCE - RESISTANCE_DECAY_PER_SECOND * 0.5,
    );
  });

  it("wears resistance down to zero and no further", () => {
    const { player, session } = freshRun();
    advanceVitals(session, 0, 0);

    const runLengthMs = RESISTANCE_DECAY_GRACE_MS + 60 * 60_000;
    advanceVitals(session, runLengthMs, runLengthMs);

    expect(player.resistance).toBe(0);
  });

  it("tells the client when decay starts, so it can warn before it bites", () => {
    const { player, session } = freshRun();
    advanceVitals(session, 0, 0);

    expect(runStateFor(player, RESISTANCE_DECAY_GRACE_MS - 30_000)).toEqual({
      elapsedMs: RESISTANCE_DECAY_GRACE_MS - 30_000,
      decayStartsInMs: 30_000,
      decaying: false,
      decayPerSecond: 0,
    });

    expect(runStateFor(player, RESISTANCE_DECAY_GRACE_MS + 1000)).toMatchObject({
      decayStartsInMs: 0,
      decaying: true,
      decayPerSecond: RESISTANCE_DECAY_PER_SECOND,
    });
  });
});

describe("the broadcast player view", () => {
  it("rounds resistance and stamina, which move by fractions of a point per tick", () => {
    const player = testPlayer("alpha", { resistance: 39.94, stamina: 12.4 });

    expect(toPlayerState(player)).toMatchObject({ resistance: 40, stamina: 12 });
  });
});
