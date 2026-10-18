import { randomUUID } from "node:crypto";
import type { Vector2 } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";

/**
 * Flares: temporary fixed lights a player puts down.
 *
 * A flare belongs to the dungeon, not to whoever lit it, so it keeps burning if they walk off, go
 * down, or disconnect. It lives in `dungeon.lightSources` with kind `flare`, which visibility lights
 * every tick rather than caching like a `fixed` light, since it is due to go out. When it goes out is
 * server-side only, in `session.flareExpiresAt`.
 */

/** Lights a flare at `position` that goes out `durationMs` after `now`. */
export function placeFlare(
  session: Session,
  position: Vector2,
  radius: number,
  durationMs: number,
  now: number,
): void {
  const id = randomUUID();
  session.dungeon.lightSources.push({
    id,
    name: "Flare",
    kind: "flare",
    position: { ...position },
    radius,
  });
  session.flareExpiresAt.set(id, now + durationMs);
}

/** Removes every flare whose time is up. Cheap when none are burning, which is nearly always. */
export function expireFlares(session: Session, now: number): void {
  if (session.flareExpiresAt.size === 0) return;

  const expired = new Set<string>();
  for (const [id, expiresAt] of session.flareExpiresAt) {
    if (now >= expiresAt) expired.add(id);
  }
  if (expired.size === 0) return;

  session.dungeon.lightSources = session.dungeon.lightSources.filter((light) => !expired.has(light.id));
  for (const id of expired) session.flareExpiresAt.delete(id);
}
