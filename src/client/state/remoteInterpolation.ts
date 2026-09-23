import { distance, MOVE_INTERVAL_MS } from "../../shared/game/movement.js";
import type { PlayerId, PlayerState, Vector2 } from "../../shared/types/core.js";

/** How long a remote player takes to slide from one authoritative position to the next. */
export const REMOTE_INTERPOLATION_MS = MOVE_INTERVAL_MS;

/**
 * Beyond this distance a new position is a teleport or a large correction, not a step to slide
 * across. Well past anything a single tick of ordinary movement can cover, so a hub/run
 * transition, a reconnect, or a server correction snaps instead of sliding across the map.
 */
const SNAP_DISTANCE = 2;

interface InterpolationTarget {
  from: Vector2;
  to: Vector2;
  startedAt: number;
}

export type RemoteInterpolationState = ReadonlyMap<PlayerId, InterpolationTarget>;

export const emptyRemoteInterpolation: RemoteInterpolationState = new Map();

/** Snaps every given player to their current position, discarding any prior slide. */
export function resetRemoteInterpolation(
  players: readonly PlayerState[],
  now: number,
): RemoteInterpolationState {
  const next = new Map<PlayerId, InterpolationTarget>();
  for (const player of players) {
    next.set(player.id, { from: player.position, to: player.position, startedAt: now });
  }
  return next;
}

/**
 * Folds one authoritative snapshot into the interpolation state. A player seen for the first time,
 * or one whose new position is a large correction from where it was headed, snaps; otherwise it
 * starts a new slide from wherever it is currently drawn, so an irregular snapshot interval never
 * produces a visible discontinuity.
 */
export function updateRemoteInterpolation(
  state: RemoteInterpolationState,
  players: readonly PlayerState[],
  now: number,
): RemoteInterpolationState {
  const next = new Map<PlayerId, InterpolationTarget>();

  for (const player of players) {
    const previous = state.get(player.id);
    if (!previous) {
      next.set(player.id, { from: player.position, to: player.position, startedAt: now });
      continue;
    }

    if (distance(previous.to, player.position) > SNAP_DISTANCE) {
      next.set(player.id, { from: player.position, to: player.position, startedAt: now });
      continue;
    }

    next.set(player.id, {
      from: remoteInterpolatedPosition(state, player.id, now, previous.to),
      to: player.position,
      startedAt: now,
    });
  }

  return next;
}

/** Where to draw a remote player right now. Never advances past its latest authoritative target. */
export function remoteInterpolatedPosition(
  state: RemoteInterpolationState,
  playerId: PlayerId,
  now: number,
  fallback: Vector2,
): Vector2 {
  const target = state.get(playerId);
  if (!target) return fallback;

  const t = Math.min(1, Math.max(0, (now - target.startedAt) / REMOTE_INTERPOLATION_MS));
  return {
    x: target.from.x + (target.to.x - target.from.x) * t,
    y: target.from.y + (target.to.y - target.from.y) * t,
  };
}
