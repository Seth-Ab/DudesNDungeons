import type { PlayerState, Vector2 } from "../../shared/types/core.js";

/**
 * What a drawn bow looks like to the client. The strength is the server's (`PlayerState.drawFraction`);
 * this only turns it into geometry and a meter reading, so nothing here decides what an arrow hits.
 */

/** An ally's cue is drawn at this share of the range: a hint that they are drawing, not a sight. */
export const ALLY_CUE_SCALE = 0.5;

/** The distance an arrow would travel for a draw fraction: `minRange` at nothing, `maxRange` at full. */
export function drawRange(range: { minRange: number; maxRange: number }, fraction: number): number {
  const weakest = Math.min(range.minRange, range.maxRange);
  return weakest + (range.maxRange - weakest) * Math.min(1, Math.max(0, fraction));
}

export interface BowAim {
  playerId: string;
  /** Where the arrow would leave from, in world units. */
  origin: Vector2;
  /** Aim direction in radians. */
  heading: number;
  /** How far the cue reaches now, and how far a full draw would reach, in world units. */
  length: number;
  fullLength: number;
  fraction: number;
  full: boolean;
  /** The local player's own draw, as opposed to an ally's. */
  own: boolean;
}

function aimOf(
  player: PlayerState,
  origin: Vector2,
  direction: Vector2,
  scale: number,
  own: boolean,
): BowAim | null {
  const fraction = player.drawFraction;
  if (fraction === null || player.health <= 0) return null;
  if (player.held?.kind !== "weapon") return null;
  const range = player.drawRange;
  if (!range) return null;
  if (direction.x === 0 && direction.y === 0) return null;

  return {
    playerId: player.id,
    origin,
    heading: Math.atan2(direction.y, direction.x),
    length: drawRange(range, fraction) * scale,
    fullLength: range.maxRange * scale,
    fraction,
    full: fraction >= 1,
    own,
  };
}

/**
 * The aim cues to draw: the local player's (toward `selfAim`, drawn from where they are predicted
 * to be) and each visible ally's, toward the facing the server last sent. `others` must already be
 * the players this client can see, so a hidden ally is never shown.
 */
export function bowAims(
  self: PlayerState | null,
  localPosition: Vector2,
  selfAim: Vector2 | null,
  others: readonly PlayerState[],
): BowAim[] {
  const aims: BowAim[] = [];
  if (self) {
    const own = aimOf(self, localPosition, selfAim ?? self.facing, 1, true);
    if (own) aims.push(own);
  }
  for (const other of others) {
    const cue = aimOf(other, other.position, other.facing, ALLY_CUE_SCALE, false);
    if (cue) aims.push(cue);
  }
  return aims;
}

export interface DrawMeterView {
  percent: number;
  full: boolean;
  /** Words as well as fill, so the full-draw state does not depend on colour. */
  label: string;
}

/** The meter reading for a draw fraction, or null when the player is not drawing. */
export function drawMeterView(fraction: number | null): DrawMeterView | null {
  if (fraction === null) return null;

  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return { percent, full: fraction >= 1, label: fraction >= 1 ? "FULL DRAW" : `${percent}%` };
}
