/**
 * Quiet HUD modules dim so the HUD stops out-shining the player's light pool. Kept free of the DOM
 * and the clock (callers pass `now`) so the node test environment can drive it.
 */

/** A module unchanged for this long, out of combat, fades. */
export const HUD_FADE_QUIET_MS = 4000;

/** Damage or an attack holds every module at full opacity for this long. */
export const HUD_FADE_COMBAT_HOLD_MS = 4000;

/** The opacity of a faded module; text must stay above the contrast floor at this value. */
export const HUD_FADE_OPACITY = 0.55;

export type HudModuleId = "vitals" | "party" | "hotbar" | "minimap" | "session" | "hints" | "actions";

export interface HudFadeInput {
  /** Modules that hold an unresolved warning, the open camp menu, or a focused control. */
  pinned: ReadonlySet<HudModuleId>;
}

export interface HudFade {
  /** Records a change to one module; its quiet timer restarts. */
  changed(id: HudModuleId, now: number): void;
  /** Records a change to every module, such as a key press. */
  changedAll(now: number): void;
  /** Damage taken or an attack: restores everything and holds it for `HUD_FADE_COMBAT_HOLD_MS`. */
  combat(now: number): void;
  /** True while the module should be dimmed. */
  isFaded(id: HudModuleId, now: number, input: HudFadeInput): boolean;
}

export function createHudFade(modules: readonly HudModuleId[], startedAt: number): HudFade {
  const lastChange = new Map<HudModuleId, number>(modules.map((id) => [id, startedAt]));
  let combatUntil = -Infinity;

  return {
    changed(id, now) {
      lastChange.set(id, now);
    },
    changedAll(now) {
      for (const id of lastChange.keys()) lastChange.set(id, now);
    },
    combat(now) {
      combatUntil = now + HUD_FADE_COMBAT_HOLD_MS;
      for (const id of lastChange.keys()) lastChange.set(id, now);
    },
    isFaded(id, now, input) {
      if (input.pinned.has(id) || now < combatUntil) return false;
      const changedAt = lastChange.get(id);
      return changedAt !== undefined && now - changedAt >= HUD_FADE_QUIET_MS;
    },
  };
}
