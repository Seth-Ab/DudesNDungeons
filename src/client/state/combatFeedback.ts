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

  const monster = view.dungeon?.monsters.find((candidate) => candidate.id === attack.targetId);
  if (monster) {
    return {
      position: monster.position,
      text,
      kind: attack.attackerId === view.selfId ? "dealt" : "ally",
    };
  }

  const visible = new Set(view.visiblePlayerIds);
  const ally = view.players.find((player) => player.id === attack.targetId && visible.has(player.id));
  if (ally) return { position: ally.position, text, kind: "ally" };

  return null;
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
