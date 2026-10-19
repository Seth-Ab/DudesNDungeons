import type { SessionView } from "../network/sessionState.js";
import type { Vector2 } from "../../shared/types/core.js";

/**
 * Floating damage numbers and monster health bars, kept free of the canvas so the node test
 * environment can drive them. The server broadcasts every `attackResolved` to the whole party,
 * visible or not, so a number is only drawn where the target can be placed from what this
 * client can see.
 */

/** One resolved attack as the session view keeps it. `seq` orders them across messages. */
export interface AttackRecord {
  seq: number;
  attackerId: string;
  targetId: string | null;
  damage: number;
  targetDefeated: boolean;
  /** The server-resolved geometry of a player's swing; null for monster attacks. */
  swing: SwingGeometry | null;
}

/** Mirrors the protocol's swing geometry: what the server resolved, drawn as given. */
export interface SwingGeometry {
  origin: Vector2;
  facing: Vector2;
  range: number;
  arcCos: number;
}

/** `dealt`: the local player hit something. `taken`: the local player was hit. `ally`: anyone else. */
export type DamagePopupKind = "dealt" | "taken" | "ally";

export interface DamagePopup {
  position: Vector2;
  text: string;
  kind: DamagePopupKind;
}

/**
 * Where and how to show one attack, or null when there is nothing to show: a miss, no damage, or a
 * target that is not in this client's visible frame (the server also sends fights the player
 * cannot see).
 */
export function damagePopup(
  view: SessionView,
  attack: AttackRecord,
  localPosition: Vector2,
): DamagePopup | null {
  if (attack.targetId === null || attack.damage <= 0) return null;

  const text = `${attack.damage}`;

  if (attack.targetId === view.selfId) {
    return { position: localPosition, text, kind: "taken" };
  }

  const struck = struckPosition(view, attack.targetId);
  if (struck) {
    return {
      position: struck,
      text,
      kind: attack.attackerId === view.selfId ? "dealt" : "ally",
    };
  }

  const visible = new Set(view.visiblePlayerIds);
  const ally = view.players.find((player) => player.id === attack.targetId && visible.has(player.id));
  if (ally) return { position: ally.position, text, kind: "ally" };

  return null;
}

export interface SwingArc {
  origin: Vector2;
  /** Direction of the arc's centre line, in radians. */
  heading: number;
  /** Half the arc's width, in radians. */
  halfArc: number;
  /** Reach in world units. */
  range: number;
  /** True when the swing connected, so it reads brighter than a miss. */
  hit: boolean;
  /** Where the impact flash goes on a hit; null on a miss. */
  impact: Vector2 | null;
}

/**
 * The arc to animate for one attack, or null when there is nothing to draw: a monster's attack, or
 * a swing by someone this client cannot see (the server sends every attack to the whole party).
 * The local player's own swing is always drawn.
 */
export function swingArc(view: SessionView, attack: AttackRecord): SwingArc | null {
  const swing = attack.swing;
  if (!swing) return null;
  if (attack.attackerId !== view.selfId && !view.visiblePlayerIds.includes(attack.attackerId)) {
    return null;
  }

  const hit = attack.targetId !== null && attack.damage > 0;
  return {
    origin: swing.origin,
    heading: Math.atan2(swing.facing.y, swing.facing.x),
    halfArc: Math.acos(Math.min(Math.max(swing.arcCos, -1), 1)),
    range: swing.range,
    hit,
    impact: hit && attack.targetId !== null ? struckPosition(view, attack.targetId) : null,
  };
}

/** Where a player's swing landed: a monster or a training dummy this client can see. */
function struckPosition(view: SessionView, targetId: string): Vector2 | null {
  const target =
    view.dungeon?.monsters.find((monster) => monster.id === targetId) ??
    view.dungeon?.dummies.find((dummy) => dummy.id === targetId);
  return target ? target.position : null;
}

/** Attacks the view has recorded since `lastSeq`, oldest first. */
export function newAttacks(view: SessionView, lastSeq: number): AttackRecord[] {
  return view.recentAttacks.filter((attack) => attack.seq > lastSeq);
}

export const POPUP_LIFETIME_MS = 900;
/** How far, in world units, a number drifts upward over its life. */
export const POPUP_RISE = 1.1;
const MAX_POPUPS = 24;

export interface ActivePopup extends DamagePopup {
  /** 0 when it appears, 1 when it is gone. */
  progress: number;
}

interface TimedPopup extends DamagePopup {
  bornAt: number;
}

/** The numbers currently floating. Time is passed in so tests do not wait. */
export function createPopupField() {
  let popups: TimedPopup[] = [];

  return {
    add(popup: DamagePopup, now: number): void {
      popups.push({ ...popup, bornAt: now });
      if (popups.length > MAX_POPUPS) popups = popups.slice(popups.length - MAX_POPUPS);
    },

    /** Drops the expired ones and returns the rest. */
    active(now: number): ActivePopup[] {
      popups = popups.filter((popup) => now - popup.bornAt < POPUP_LIFETIME_MS);
      return popups.map((popup) => ({
        position: popup.position,
        text: popup.text,
        kind: popup.kind,
        progress: Math.max(0, (now - popup.bornAt) / POPUP_LIFETIME_MS),
      }));
    },

    clear(): void {
      popups = [];
    },
  };
}

export const SWING_LIFETIME_MS = 180;
const MAX_SWINGS = 16;

export interface ActiveSwing extends SwingArc {
  /** 0 when the swing starts, 1 when it is gone. */
  progress: number;
}

interface TimedSwing extends SwingArc {
  bornAt: number;
}

/** The swings currently animating. Time is passed in so tests do not wait. */
export function createSwingField() {
  let swings: TimedSwing[] = [];

  return {
    add(arc: SwingArc, now: number): void {
      swings.push({ ...arc, bornAt: now });
      if (swings.length > MAX_SWINGS) swings = swings.slice(swings.length - MAX_SWINGS);
    },

    active(now: number): ActiveSwing[] {
      swings = swings.filter((swing) => now - swing.bornAt < SWING_LIFETIME_MS);
      return swings.map(({ bornAt, ...arc }) => ({
        ...arc,
        progress: Math.max(0, (now - bornAt) / SWING_LIFETIME_MS),
      }));
    },

    clear(): void {
      swings = [];
    },
  };
}

/** Health below this fraction turns a monster's bar red. */
export const MONSTER_LOW_HEALTH_RATIO = 0.35;

export interface MonsterBarView {
  ratio: number;
  low: boolean;
}

export function monsterBarView(health: number, maxHealth: number): MonsterBarView {
  const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  return { ratio, low: ratio < MONSTER_LOW_HEALTH_RATIO };
}
