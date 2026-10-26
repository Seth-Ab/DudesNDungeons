import {
  CARRY_STAMINA_DRAIN_PER_SECOND,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DAMAGE_SCALE,
  RESISTANCE_DECAY_GRACE_MS,
  RESISTANCE_DECAY_PER_SECOND,
  STAMINA_REGEN_PER_SECOND,
} from "../../shared/constants/game.js";
import type { RunState } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { effectiveResistance } from "./progression.js";

/**
 * Health, resistance, and stamina in one place.
 *
 * Every hit that lands on a player goes through `damagePlayer`, which is the only function that
 * subtracts from `player.health`. Resistance is applied there rather than at each call site, so a
 * new damage source — a trap, a boss, a hazard — cannot forget to apply it.
 *
 * Resistance never regenerates. Time in the dungeon takes it away; only consumables and, from
 * Backend step 11, unlocked skills put it back. That is what makes a slow run dangerous.
 */

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/** Multiplier a hit is scaled by. 1 at zero resistance, falling with diminishing returns. */
export function damageMultiplier(resistance: number): number {
  return RESISTANCE_DAMAGE_SCALE / (RESISTANCE_DAMAGE_SCALE + Math.max(0, resistance));
}

/**
 * Applies one hit to a player and returns the health actually lost.
 *
 * A hit that resistance scales below one point still costs one, so a heavily warded player is
 * slower to kill rather than invulnerable. A hit never carries past zero: the returned number is
 * what the target lost, which is what `attackResolved` reports.
 */
export function damagePlayer(
  player: SessionPlayer,
  rawDamage: number,
  content?: GameContent,
): number {
  if (rawDamage <= 0 || player.health <= 0) return 0;

  const scaled = rawDamage * damageMultiplier(effectiveResistance(player, content));
  const dealt = Math.min(Math.max(1, Math.round(scaled)), player.health);

  player.health -= dealt;
  if (player.health <= 0) player.runStats.downed = true;
  return dealt;
}

/** Notes that this player took or dealt damage at `now`, which `saveAndQuit` refuses on for a while. */
export function markCombat(player: SessionPlayer, now: number): void {
  player.lastCombatAt = now;
}

/** Raises health, capped. Returns false when the player is already at full health. */
export function healPlayer(player: SessionPlayer, amount: number): boolean {
  if (player.health >= PLAYER_MAX_HEALTH) return false;

  player.health = clamp(player.health + amount, PLAYER_MAX_HEALTH);
  return true;
}

/** Raises stamina, capped. Returns false when the bar is already full. */
export function restoreStamina(player: SessionPlayer, amount: number): boolean {
  if (player.stamina >= PLAYER_MAX_STAMINA) return false;

  player.stamina = clamp(player.stamina + amount, PLAYER_MAX_STAMINA);
  return true;
}

/** Raises resistance, capped. Returns false when the player is already at the cap. */
export function restoreResistance(
  player: SessionPlayer,
  amount: number,
  maximum = PLAYER_MAX_RESISTANCE,
): boolean {
  if (player.resistance >= maximum) return false;

  player.resistance = clamp(player.resistance + amount, maximum);
  return true;
}

/** Removes resistance outright, floored at zero. It never comes back by resting. */
export function reduceResistance(player: SessionPlayer, amount: number): number {
  const lost = Math.min(Math.max(0, amount), player.resistance);
  player.resistance -= lost;
  return lost;
}

/** Removes stamina outright, floored at zero. Unlike `spendStamina` it cannot be refused. */
export function loseStamina(player: SessionPlayer, amount: number): number {
  const lost = Math.min(Math.max(0, amount), player.stamina);
  player.stamina -= lost;
  return lost;
}

/** Pays a one-off stamina cost. Returns false and spends nothing when the player cannot afford it. */
export function spendStamina(player: SessionPlayer, cost: number): boolean {
  if (cost <= 0) return true;
  if (player.stamina < cost) return false;

  player.stamina -= cost;
  return true;
}

/**
 * Pays a continuous stamina cost, such as carrying. Unlike `spendStamina` this drains what is
 * there and reports whether the player could pay in full, so a carry can be dropped when it runs dry.
 */
export function drainStamina(player: SessionPlayer, perSecond: number, elapsedMs: number): boolean {
  const cost = (perSecond * elapsedMs) / 1000;
  const paid = Math.min(cost, player.stamina);
  player.stamina -= paid;
  return paid >= cost;
}

/** How long this player has been in the dungeon, in ms. */
export function timeInDungeon(player: SessionPlayer, now: number): number {
  return player.enteredDungeonAt === null ? 0 : Math.max(0, now - player.enteredDungeonAt);
}

/**
 * Advances stamina regeneration alone, for the hub: there is no clock there to decay resistance and
 * nobody to carry, but a swing still has to be paid back.
 */
export function regenerateStamina(session: Session, elapsedMs: number): void {
  if (elapsedMs <= 0) return;

  const regained = (STAMINA_REGEN_PER_SECOND * elapsedMs) / 1000;
  for (const player of session.players.values()) {
    if (player.health <= 0) continue;
    player.stamina = clamp(player.stamina + regained, PLAYER_MAX_STAMINA);
  }
}

/**
 * Advances stamina regeneration and resistance decay for every player by `elapsedMs`.
 *
 * Downed players are skipped: a player on the floor neither recovers stamina nor bleeds resistance,
 * so being downed is not also a second, invisible punishment.
 */
export function advanceVitals(session: Session, now: number, elapsedMs: number): void {
  if (session.location !== "dungeon") return;

  // Normal runs set this at the hub transition. Keep the fallback for deterministic unit fixtures
  // and imported sessions that begin directly in a dungeon.
  for (const player of session.players.values()) {
    if (player.enteredDungeonAt === null) player.enteredDungeonAt = now;
  }

  if (elapsedMs <= 0) return;

  const seconds = elapsedMs / 1000;

  for (const player of session.players.values()) {
    if (player.health <= 0) continue;

    // Carrying replaces regen with continuous drain, the same way being downed suspends it: a
    // carrier's stamina bar only ever falls while they haul someone, and a carrier who cannot pay
    // the drain in full is exhausted mid-carry. The target is set down where the carrier stands
    // rather than left in a state nothing can resolve.
    if (player.carryingPlayerId !== null) {
      const paidInFull = drainStamina(player, CARRY_STAMINA_DRAIN_PER_SECOND, elapsedMs);
      if (!paidInFull) {
        const carried = session.players.get(player.carryingPlayerId);
        if (carried) carried.carriedByPlayerId = null;
        player.carryingPlayerId = null;
      }
    } else {
      player.stamina = clamp(player.stamina + STAMINA_REGEN_PER_SECOND * seconds, PLAYER_MAX_STAMINA);
    }

    // Only the part of this step that falls after the grace period decays, so decay starts at the
    // right moment rather than at the first tick after it.
    // Sitting at a fire is a rest: the clock still runs, but resistance holds while they are seated.
    if (player.seatId !== null) continue;

    const elapsedInDungeon = timeInDungeon(player, now);
    const decayingMs = Math.min(elapsedMs, Math.max(0, elapsedInDungeon - RESISTANCE_DECAY_GRACE_MS));
    if (decayingMs <= 0) continue;

    player.resistance = clamp(
      player.resistance - (RESISTANCE_DECAY_PER_SECOND * decayingMs) / 1000,
      PLAYER_MAX_RESISTANCE,
    );
  }
}

/**
 * The run clock as the client sees it. Sent on every snapshot so a player can be warned before
 * resistance starts falling rather than discovering it from a bar that has already dropped.
 */
export function runStateFor(player: SessionPlayer, now: number): RunState {
  const elapsedMs = timeInDungeon(player, now);
  const decaying = elapsedMs >= RESISTANCE_DECAY_GRACE_MS;

  return {
    elapsedMs,
    decayStartsInMs: decaying ? 0 : RESISTANCE_DECAY_GRACE_MS - elapsedMs,
    decaying,
    decayPerSecond: decaying ? RESISTANCE_DECAY_PER_SECOND : 0,
  };
}
