import { normalizeDirection } from "../../shared/game/movement.js";
import type { RejectionReason, ServerMessage } from "../../shared/protocol/index.js";
import type { Vector2 } from "../../shared/types/core.js";

export const FLOATER_MS = 900;
export const SWING_MS = 200;
export const NOTICE_MS = 2500;

/** A damage number rising off whoever took the hit. */
export interface Floater {
  text: string;
  /** `hurt` when this client's own player was hit, so it reads differently from dealing damage. */
  tone: "damage" | "hurt";
  position: Vector2;
  startedAt: number;
}

export interface Swing {
  origin: Vector2;
  heading: Vector2;
  startedAt: number;
}

export interface Notice {
  text: string;
  startedAt: number;
}

/**
 * Short-lived feedback drawn over the dungeon. Kept apart from the session view because these are
 * reactions to events rather than state: a damage number means something only as it appears.
 */
export interface Effects {
  floaters: Floater[];
  swings: Swing[];
  notice: Notice | null;
}

export const noEffects: Effects = { floaters: [], swings: [], notice: null };

export interface Body {
  position: Vector2;
  facing: Vector2 | null;
}

export interface EffectContext {
  selfId: string | null;
  /** Where a player or monster is right now, or null when the client does not know it. */
  bodyOf(id: string): Body | null;
}

const REJECTION_TEXT: Record<RejectionReason, string> = {
  blocked: "Something is in the way.",
  outOfRange: "You need to get closer.",
  onCooldown: "Not ready yet.",
  notPermitted: "You can't do that right now.",
  targetMissing: "That isn't there anymore.",
};

export function describeRejection(reason: RejectionReason): string {
  return REJECTION_TEXT[reason];
}

export function withNotice(effects: Effects, text: string, now: number): Effects {
  return { ...effects, notice: { text, startedAt: now } };
}

/** Folds one server message into the effects on screen. `now` is `performance.now()`. */
export function applyEvent(
  effects: Effects,
  message: ServerMessage,
  context: EffectContext,
  now: number,
): Effects {
  if (message.type === "actionRejected") {
    // Moves and swings carry a sequence and bounce constantly while holding a key against a wall or
    // mashing attack. Only one-off actions (pickup, use, interact) are worth telling the player about.
    return message.sequence === null
      ? withNotice(effects, describeRejection(message.reason), now)
      : effects;
  }

  if (message.type !== "attackResolved") return effects;

  const attacker = context.bodyOf(message.attackerId);
  const target = message.targetId === null ? null : context.bodyOf(message.targetId);
  let next = effects;

  if (attacker) {
    const towardTarget =
      target &&
      normalizeDirection({
        x: target.position.x - attacker.position.x,
        y: target.position.y - attacker.position.y,
      });
    const heading = towardTarget ?? attacker.facing ?? { x: 0, y: 1 };
    next = {
      ...next,
      swings: [...next.swings, { origin: { ...attacker.position }, heading, startedAt: now }],
    };
  }

  if (target) {
    next = {
      ...next,
      floaters: [
        ...next.floaters,
        {
          text: message.targetDefeated ? `-${message.damage} KO` : `-${message.damage}`,
          tone: message.targetId === context.selfId ? "hurt" : "damage",
          position: { ...target.position },
          startedAt: now,
        },
      ],
    };
  }

  return next;
}

/** Drops finished effects. Returns the same object when nothing expired, so callers can skip work. */
export function pruneEffects(effects: Effects, now: number): Effects {
  const floaters = effects.floaters.filter((floater) => now - floater.startedAt < FLOATER_MS);
  const swings = effects.swings.filter((swing) => now - swing.startedAt < SWING_MS);
  const notice =
    effects.notice && now - effects.notice.startedAt < NOTICE_MS ? effects.notice : null;

  if (
    floaters.length === effects.floaters.length &&
    swings.length === effects.swings.length &&
    notice === effects.notice
  ) {
    return effects;
  }

  return { floaters, swings, notice };
}
