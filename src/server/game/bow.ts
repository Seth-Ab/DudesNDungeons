import { randomUUID } from "node:crypto";
import { normalizeDirection } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { PlayerId, Vector2 } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { RangedWeaponStats } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { consumeFromStack } from "./items.js";
import { contentForSession, progressionEffectTotal } from "./progression.js";
import { standUp } from "./seats.js";
import { spendStamina } from "./vitals.js";

/**
 * Drawing a bow. The server owns the draw clock: `beginDraw` records when it started, and the
 * strength of a shot is worked out from that and the release time, never from anything a client
 * sends. Nothing is spent until the arrow leaves the bow, so every way a draw can end early (a
 * swap, a drop, going down, a disconnect, a tap that is too short) costs nothing.
 */

/** A draw in progress. Lives on the player; absent when they are not drawing. */
export interface Draw {
  /** The held item (its instance id) the draw began with. Another item in the hand ends it. */
  heldId: string;
  startedAt: number;
  /** 0 to 1, refreshed every tick for the snapshot. */
  fraction: number;
  /** What the bow reaches for this player now, refreshed every tick for the snapshot's indicator. */
  reach: DrawReach;
}

/** The two ends of a draw's range, as `shotRange` uses them: no draw reaches `minRange`, a full one `maxRange`. */
export interface DrawReach {
  minRange: number;
  maxRange: number;
}

export type DrawResult = { ok: true; fired: boolean } | { ok: false; reason: RejectionReason };

/** The bow in a player's hand, with its stats read from content now, or null if it is not one. */
function heldBow(player: SessionPlayer, content: GameContent): RangedWeaponStats | null {
  const held = player.held;
  if (held?.kind !== "weapon") return null;

  const definition = content.items.get(held.itemId);
  return definition?.kind === "weapon" && definition.weapon.kind === "ranged" ? definition.weapon : null;
}

/**
 * The furthest a full draw reaches for this player. Every range goes through here, so a later
 * progression upgrade (`bowRangeBonus`) raises it in one place without touching the shot logic.
 */
export function bowMaxRange(bow: RangedWeaponStats, _player: SessionPlayer, _content: GameContent): number {
  return bow.maxRange;
}

/** The range a draw runs between for this player: the figures the snapshot sends and `shotRange` flies. */
export function drawReach(bow: RangedWeaponStats, player: SessionPlayer, content: GameContent): DrawReach {
  const maxRange = bowMaxRange(bow, player, content);
  return { minRange: Math.min(bow.minRange, maxRange), maxRange };
}

/** How far through its draw a bow is `heldMs` after it began: 0 to 1, flat once fully drawn. */
export function drawFractionAfter(bow: RangedWeaponStats, heldMs: number): number {
  return Math.min(1, Math.max(0, heldMs / bow.drawMs));
}

/** How far an arrow flies for a draw fraction: `minRange` at nothing, `maxRange` at a full draw. */
export function shotRange(bow: RangedWeaponStats, maxRange: number, fraction: number): number {
  const weakest = Math.min(bow.minRange, maxRange);
  return weakest + (maxRange - weakest) * Math.min(1, Math.max(0, fraction));
}

function arrowsOf(player: SessionPlayer, bow: RangedWeaponStats) {
  return player.inventory.find((item) => item.kind === "ammo" && item.itemId === bow.ammoItemId);
}

/** Whether a draw is still legitimate: the same bow in hand, and a player who can act. */
function drawIsValid(player: SessionPlayer, draw: Draw): boolean {
  return player.connected && !isDown(player) && player.held?.id === draw.heldId;
}

/**
 * Starts a draw toward `direction`. Refused, with nothing recorded, unless the player holds a bow,
 * carries at least one of its arrows, and has the stamina for a shot. Drawing while already
 * drawing starts over, so a lost release cannot wedge a bow.
 */
export function beginDraw(
  session: Session,
  playerId: PlayerId,
  direction: Vector2,
  now: number,
): DrawResult {
  const player = session.players.get(playerId);
  if (!player || isDown(player)) return { ok: false, reason: "notPermitted" };

  const heading = normalizeDirection(direction);
  if (!heading) return { ok: false, reason: "outOfRange" };

  const content = contentForSession(session);
  const bow = heldBow(player, content);
  if (!bow) return { ok: false, reason: "notPermitted" };
  if (!arrowsOf(player, bow)) return { ok: false, reason: "targetMissing" };
  if (player.stamina < bow.staminaCost) return { ok: false, reason: "exhausted" };

  standUp(session, player);
  player.facing = heading;
  player.draw = { heldId: player.held?.id ?? "", startedAt: now, fraction: 0, reach: drawReach(bow, player, content) };
  return { ok: true, fired: false };
}

/**
 * Looses the draw. The draw always ends here, fired or not. Too short a draw fires nothing and
 * costs nothing; so does a draw that cannot be paid for any more (the arrows were dropped, the
 * stamina spent elsewhere). Otherwise one arrow and the bow's stamina are spent and a player-owned
 * projectile is spawned with the range the held time earned.
 */
export function releaseDraw(
  session: Session,
  playerId: PlayerId,
  direction: Vector2,
  now: number,
): DrawResult {
  const player = session.players.get(playerId);
  if (!player) return { ok: false, reason: "notPermitted" };

  const draw = player.draw;
  player.draw = null;
  if (!draw || !drawIsValid(player, draw)) return { ok: false, reason: "notPermitted" };

  const heading = normalizeDirection(direction);
  if (!heading) return { ok: false, reason: "outOfRange" };

  const content = contentForSession(session);
  const bow = heldBow(player, content);
  if (!bow) return { ok: false, reason: "notPermitted" };

  const heldMs = now - draw.startedAt;
  if (heldMs < bow.minDrawMs) return { ok: true, fired: false };

  const arrows = arrowsOf(player, bow);
  if (!arrows) return { ok: false, reason: "targetMissing" };
  if (player.stamina < bow.staminaCost) return { ok: false, reason: "exhausted" };

  consumeFromStack(player, arrows.id, 1);
  spendStamina(player, bow.staminaCost);

  const range = shotRange(bow, drawReach(bow, player, content).maxRange, drawFractionAfter(bow, heldMs));
  const id = randomUUID();
  player.facing = heading;
  session.dungeon.projectiles.push({
    id,
    position: { ...player.position },
    direction: { ...heading },
    radius: bow.projectileRadius,
  });
  session.projectileRuns.set(id, {
    ownerId: player.id,
    damage: bow.damage + progressionEffectTotal(player, "attackDamageBonus", content),
    speed: bow.projectileSpeed,
    remaining: range,
  });
  return { ok: true, fired: true };
}

/** Ends a draw without firing, spending nothing. */
export function cancelDraw(player: SessionPlayer): void {
  player.draw = null;
}

/**
 * Each tick: ends the draws that stopped being valid (the bow left the hand, the player went down
 * or dropped off) and advances the fraction of the rest. Run before anything else in `simulate` so
 * the snapshot never shows a draw the release would refuse.
 */
export function settleDraws(session: Session, now: number): void {
  const content = contentForSession(session);
  for (const player of session.players.values()) {
    const draw = player.draw;
    if (!draw) continue;

    const bow = heldBow(player, content);
    if (!bow || !drawIsValid(player, draw)) {
      player.draw = null;
      continue;
    }
    draw.fraction = drawFractionAfter(bow, now - draw.startedAt);
    draw.reach = drawReach(bow, player, content);
  }
}
