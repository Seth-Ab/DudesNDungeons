import {
  TRAINING_DUMMY_MIN_SPAN_MS,
  TRAINING_DUMMY_WINDOW_MS,
} from "../../shared/constants/game.js";
import type { DummyAttacker, DummyState, EntityId, PlayerId } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";

/**
 * Training dummies: targets a swing can land on that never take damage, never die, never move, and
 * never attack. They are kept out of `dungeon.monsters` entirely, so monster AI, loot drops, boss
 * gating, and run results never see them, and nothing here touches a profile.
 *
 * What a dummy does have is a readout. Each hit is logged server-side with the damage it would have
 * done, and `refreshDummies` turns the last `TRAINING_DUMMY_WINDOW_MS` of that log into the
 * per-attacker `recentDamage` and `dps` every viewer of the dummy is sent.
 */

/** One logged hit on a dummy. Server-side only; clients see the readout, not the log. */
export interface DummyHit {
  attackerId: PlayerId;
  damage: number;
  at: number;
}

/** Logs a hit and refreshes that dummy's readout at once, so the next snapshot already shows it. */
export function recordDummyHit(
  session: Session,
  dummy: DummyState,
  attackerId: PlayerId,
  damage: number,
  now: number,
): void {
  const hits = session.dummyHits.get(dummy.id) ?? [];
  hits.push({ attackerId, damage, at: now });
  session.dummyHits.set(dummy.id, hits);
  refreshDummy(session, dummy, now);
}

/** Drops hits that have aged out of the window and recomputes every dummy's readout. */
export function refreshDummies(session: Session, now: number): void {
  for (const dummy of session.dungeon.dummies) refreshDummy(session, dummy, now);
}

function refreshDummy(session: Session, dummy: DummyState, now: number): void {
  const hits = (session.dummyHits.get(dummy.id) ?? []).filter(
    (hit) => now - hit.at < TRAINING_DUMMY_WINDOW_MS,
  );
  if (hits.length === 0) {
    session.dummyHits.delete(dummy.id);
  } else {
    session.dummyHits.set(dummy.id, hits);
  }

  const attackers = readout(hits, now);
  dummy.attackers = attackers;
  dummy.recentDamage = attackers.reduce((total, attacker) => total + attacker.recentDamage, 0);
  dummy.dps = roundDps(attackers.reduce((total, attacker) => total + attacker.dps, 0));
}

/**
 * Each attacker's damage in the window, and that damage averaged over the time since their first
 * hit in it: at least `TRAINING_DUMMY_MIN_SPAN_MS`, so one hit reads as its own damage per second.
 * Attackers are listed in the order they first hit within the window.
 */
function readout(hits: readonly DummyHit[], now: number): DummyAttacker[] {
  const byAttacker = new Map<PlayerId, { damage: number; firstAt: number }>();
  for (const hit of hits) {
    const entry = byAttacker.get(hit.attackerId);
    if (entry) {
      entry.damage += hit.damage;
    } else {
      byAttacker.set(hit.attackerId, { damage: hit.damage, firstAt: hit.at });
    }
  }

  return [...byAttacker].map(([playerId, { damage, firstAt }]) => {
    const spanMs = Math.max(now - firstAt, TRAINING_DUMMY_MIN_SPAN_MS);
    return { playerId, recentDamage: damage, dps: roundDps((damage * 1000) / spanMs) };
  });
}

/** One decimal place: what the plate shows, and small enough on the wire. */
function roundDps(dps: number): number {
  return Math.round(dps * 10) / 10;
}

export function findDummy(session: Session, id: EntityId): DummyState | undefined {
  return session.dungeon.dummies.find((dummy) => dummy.id === id);
}
