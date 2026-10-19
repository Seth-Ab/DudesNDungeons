import type { DummyState } from "../../shared/types/core.js";

/**
 * What a training dummy shows, kept free of the canvas so the node test environment can drive it.
 * The numbers are the server's: the client formats the readout a snapshot carried and never sums
 * hits of its own, so every client near a dummy shows the same plate.
 */

/** The damage-per-second plate over a dummy, or null while nobody has hit it in the window. */
export interface DummyPlate {
  /** The headline, such as `12.5 DPS`. */
  dps: string;
  /** What the window holds, such as `36 dmg in 5s`, with how many are hitting it when more than one. */
  detail: string;
}

export function dummyPlate(dummy: DummyState, windowMs: number): DummyPlate | null {
  if (dummy.recentDamage <= 0) return null;

  const seconds = Math.round(windowMs / 1000);
  const hitters = dummy.attackers.length > 1 ? ` · ${dummy.attackers.length} hitting` : "";
  return {
    dps: `${dummy.dps.toFixed(1)} DPS`,
    detail: `${dummy.recentDamage} dmg in ${seconds}s${hitters}`,
  };
}

export const WOBBLE_LIFETIME_MS = 600;
/** Peak lean of a struck dummy, in radians. */
const WOBBLE_AMPLITUDE = 0.32;
/** Swings back and forth this many times before settling. */
const WOBBLE_SWAYS = 3;

/** The lean of a dummy struck `elapsedMs` ago: a damped sway, 0 once it has settled. */
export function wobbleAngle(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= WOBBLE_LIFETIME_MS) return 0;

  const progress = elapsedMs / WOBBLE_LIFETIME_MS;
  return WOBBLE_AMPLITUDE * (1 - progress) * Math.sin(progress * WOBBLE_SWAYS * Math.PI * 2);
}

/** Which dummies are still swaying from a hit. Time is passed in so tests do not wait. */
export function createDummyWobbles() {
  const struckAt = new Map<string, number>();

  return {
    hit(dummyId: string, now: number): void {
      struckAt.set(dummyId, now);
    },

    /** Each swaying dummy's current lean; a dummy at rest is absent. */
    angles(now: number): Map<string, number> {
      const angles = new Map<string, number>();
      for (const [id, at] of struckAt) {
        if (now - at >= WOBBLE_LIFETIME_MS) {
          struckAt.delete(id);
          continue;
        }
        angles.set(id, wobbleAngle(now - at));
      }
      return angles;
    },

    clear(): void {
      struckAt.clear();
    },
  };
}
