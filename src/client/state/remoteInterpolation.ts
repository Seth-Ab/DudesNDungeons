import { distance, MOVE_INTERVAL_MS } from "../../shared/game/movement.js";
import type { Vector2 } from "../../shared/types/core.js";

/** Anything drawn from a buffered track: a remote player or a monster. */
export interface InterpolatedEntity {
  id: string;
  position: Vector2;
}

/**
 * How far in the past remote players and monsters are drawn. Two move intervals: one for the slide between
 * authoritative positions, one of headroom so a late or bunched snapshot lands before the render
 * clock reaches it, rather than leaving the player stopped and then lurching.
 */
export const REMOTE_RENDER_DELAY_MS = 2 * MOVE_INTERVAL_MS;

/**
 * Each new position is placed one move interval after the one before it, so steps play at an even
 * pace whatever their arrival spacing. These bound how far that schedule may run from arrival
 * times: a sample may land up to `LATE_SLACK_MS` before it arrived, which absorbs a late snapshot,
 * and up to `MAX_SCHEDULE_AHEAD_MS` after, which spaces out a burst. Both stay well inside the
 * render delay, and tracking arrivals within them keeps clock drift from piling up latency.
 */
const LATE_SLACK_MS = MOVE_INTERVAL_MS / 2;
const MAX_SCHEDULE_AHEAD_MS = MOVE_INTERVAL_MS;

/** How long an entity keeps moving along their last step when nothing new has arrived. */
export const MAX_EXTRAPOLATION_MS = MOVE_INTERVAL_MS;

/**
 * Beyond this distance a new position is a teleport or a large correction, not a step to slide
 * across. Well past anything a single tick of ordinary movement can cover, so a hub/run
 * transition, a reconnect, or a server correction snaps instead of sliding across the map.
 */
const SNAP_DISTANCE = 2;

/**
 * How long a player who dropped out of the visible frame keeps their track. One who reappears
 * within it carries on sliding from where they were drawn instead of restarting with a snap.
 */
const ABSENT_TRACK_GRACE_MS = 10 * MOVE_INTERVAL_MS;

interface Sample {
  /** Local time this position is drawn at, before the render delay is applied. */
  at: number;
  position: Vector2;
}

/** In ascending `at` order; never empty. */
type Samples = readonly [Sample, ...Sample[]];

interface RemoteTrack {
  /** Holds only what the render clock has not yet passed, plus the one it is leaving. */
  samples: Samples;
  /** Latest authoritative position, which the snap check measures against. */
  latest: Vector2;
  /** Per-millisecond velocity of the latest step, used only to extrapolate a dry buffer. */
  velocity: Vector2;
  /** Arrival time of the snapshot that last changed this player's position. */
  changedAt: number;
  /** Arrival time of the latest snapshot that included this player. */
  heardAt: number;
}

export type RemoteInterpolationState = ReadonlyMap<string, RemoteTrack>;

export const emptyRemoteInterpolation: RemoteInterpolationState = new Map();

const STILL: Vector2 = { x: 0, y: 0 };

function snapTrack(position: Vector2, now: number): RemoteTrack {
  return {
    samples: [{ at: now, position }],
    latest: position,
    velocity: STILL,
    changedAt: now,
    heardAt: now,
  };
}

function samePosition(a: Vector2, b: Vector2): boolean {
  return a.x === b.x && a.y === b.y;
}

function velocityBetween(from: Sample, to: Sample): Vector2 {
  const span = to.at - from.at;
  if (span <= 0) return STILL;
  return {
    x: (to.position.x - from.position.x) / span,
    y: (to.position.y - from.position.y) / span,
  };
}

/**
 * A player is known to be standing still once a snapshot arrived a full move interval after their
 * last change: a moving player would have produced a new position by then.
 */
function confirmedStill(track: RemoteTrack): boolean {
  return track.heardAt - track.changedAt >= MOVE_INTERVAL_MS;
}

/** Index of the last sample at or before `time`, or 0 when every sample is later. */
function currentIndex(samples: Samples, time: number): number {
  let current = 0;
  samples.forEach((sample, i) => {
    if (sample.at <= time) current = i;
  });
  return current;
}

function positionAt(track: RemoteTrack, time: number): Vector2 {
  const { samples } = track;
  const i = currentIndex(samples, time);
  const from = samples[i] ?? samples[0];
  if (time < from.at) return from.position;

  const to = samples[i + 1];
  if (to) {
    const t = (time - from.at) / (to.at - from.at);
    return {
      x: from.position.x + (to.position.x - from.position.x) * t,
      y: from.position.y + (to.position.y - from.position.y) * t,
    };
  }

  // The buffer has run dry. Carry on briefly along the last step rather than freezing, unless the
  // server has already confirmed the player stopped, then hold.
  if (confirmedStill(track)) return from.position;
  const elapsed = Math.min(time - from.at, MAX_EXTRAPOLATION_MS);
  return {
    x: from.position.x + track.velocity.x * elapsed,
    y: from.position.y + track.velocity.y * elapsed,
  };
}

/** Drops samples the render clock has fully passed, keeping the one it is currently leaving. */
function pruned(samples: Samples, renderTime: number): Samples {
  const i = currentIndex(samples, renderTime);
  return [samples[i] ?? samples[0], ...samples.slice(i + 1)];
}

function advanceTrack(track: RemoteTrack, position: Vector2, now: number): RemoteTrack {
  if (distance(track.latest, position) > SNAP_DISTANCE) return snapTrack(position, now);

  const renderTime = now - REMOTE_RENDER_DELAY_MS;
  const samples = pruned(track.samples, renderTime);
  const last = samples[samples.length - 1] ?? samples[0];
  const dry = renderTime >= last.at;

  if (samePosition(position, track.latest)) {
    // A repeat only confirms the player is where they were. If the buffer ran dry and the player
    // was extrapolated past it, settle back over one step instead of snapping.
    const heard = { ...track, samples, heardAt: now };
    if (!dry) return heard;
    const drawn = positionAt(track, renderTime);
    if (samePosition(drawn, track.latest)) return { ...heard, velocity: STILL };
    return {
      ...heard,
      samples: [
        { at: renderTime, position: drawn },
        { at: renderTime + MOVE_INTERVAL_MS, position: track.latest },
      ],
      velocity: STILL,
    };
  }

  if (dry) {
    // Nothing left to draw toward: continue from exactly where the player is drawn now. A player
    // starting from rest holds there until one move interval before this arrival, so their first
    // step plays at full speed instead of stretched across the whole render delay.
    const anchor: Sample = { at: renderTime, position: positionAt(track, renderTime) };
    const next: Sample = { at: now, position };
    const hold: Sample = {
      at: Math.max(renderTime, now - MOVE_INTERVAL_MS),
      position: anchor.position,
    };
    const still = confirmedStill(track);
    return {
      samples: still ? [anchor, hold, next] : [anchor, next],
      latest: position,
      velocity: velocityBetween(still ? hold : anchor, next),
      changedAt: now,
      heardAt: now,
    };
  }

  // Space each step one move interval after the last, so a late, early, or bunched snapshot is
  // drawn at the same speed as a steady stream. Not dry means `last.at` is still ahead of the render
  // clock, so the new sample is too.
  const at = Math.max(
    last.at + 1,
    now - LATE_SLACK_MS,
    Math.min(last.at + MOVE_INTERVAL_MS, now + MAX_SCHEDULE_AHEAD_MS),
  );
  const next: Sample = { at, position };
  return {
    samples: [...samples, next],
    latest: position,
    velocity: velocityBetween(last, next),
    changedAt: now,
    heardAt: now,
  };
}

/** Snaps every given player to their current position, discarding any prior buffer. */
export function resetRemoteInterpolation(
  players: readonly InterpolatedEntity[],
  now: number,
): RemoteInterpolationState {
  const next = new Map<string, RemoteTrack>();
  for (const player of players) {
    next.set(player.id, snapTrack(player.position, now));
  }
  return next;
}

/**
 * Folds one authoritative snapshot, arriving at `now`, into each remote player's buffer. A player
 * seen for the first time, or one whose new position is a large correction, snaps; otherwise the
 * position is queued to be drawn `REMOTE_RENDER_DELAY_MS` later, spaced from the one before it.
 */
export function updateRemoteInterpolation(
  state: RemoteInterpolationState,
  players: readonly InterpolatedEntity[],
  now: number,
  absentGraceMs: number = ABSENT_TRACK_GRACE_MS,
): RemoteInterpolationState {
  const next = new Map<string, RemoteTrack>();

  for (const player of players) {
    const previous = state.get(player.id);
    next.set(
      player.id,
      previous ? advanceTrack(previous, player.position, now) : snapTrack(player.position, now),
    );
  }

  // Keep a briefly absent player's track, so one flickering at the edge of view does not snap.
  // Monsters pass no grace: one that died or left view must not slide from a stale position.
  for (const [playerId, track] of state) {
    if (!next.has(playerId) && now - track.heardAt < absentGraceMs) {
      next.set(playerId, track);
    }
  }

  return next;
}

/** Where to draw a remote player right now: their buffered position `REMOTE_RENDER_DELAY_MS` ago. */
export function remoteInterpolatedPosition(
  state: RemoteInterpolationState,
  playerId: string,
  now: number,
  fallback: Vector2,
): Vector2 {
  const track = state.get(playerId);
  if (!track) return fallback;
  return positionAt(track, now - REMOTE_RENDER_DELAY_MS);
}

/**
 * Folds a snapshot's living, visible monsters into their buffers. Unlike a player, a monster that
 * is absent loses its track at once: it died or left view, and if it reappears it snaps.
 */
export function updateMonsterInterpolation(
  state: RemoteInterpolationState,
  monsters: readonly (InterpolatedEntity & { alive: boolean })[],
  now: number,
): RemoteInterpolationState {
  return updateRemoteInterpolation(
    state,
    monsters.filter((monster) => monster.alive),
    now,
    0,
  );
}
