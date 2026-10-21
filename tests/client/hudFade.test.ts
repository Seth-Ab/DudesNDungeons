import { describe, expect, it } from "vitest";
import {
  HUD_FADE_COMBAT_HOLD_MS,
  HUD_FADE_QUIET_MS,
  HUD_DENSITY_RULES,
  HUD_FADE_OPACITY,
  createHudFade,
  type HudFadeInput,
} from "../../src/client/state/hudFade.js";

const NONE: HudFadeInput = { pinned: new Set(), density: "calm" };

describe("HUD fade", () => {
  it("fades a quiet module after the quiet period and not before", () => {
    const fade = createHudFade(["vitals", "hotbar"], 0);
    expect(fade.isFaded("vitals", HUD_FADE_QUIET_MS - 1, NONE)).toBe(false);
    expect(fade.isFaded("vitals", HUD_FADE_QUIET_MS, NONE)).toBe(true);
  });

  it("restores a module when it changes, leaving the others faded", () => {
    const fade = createHudFade(["vitals", "hotbar"], 0);
    fade.changed("vitals", 5000);
    expect(fade.isFaded("vitals", 5000, NONE)).toBe(false);
    expect(fade.isFaded("hotbar", 5000, NONE)).toBe(true);
    expect(fade.isFaded("vitals", 5000 + HUD_FADE_QUIET_MS, NONE)).toBe(true);
  });

  it("restores everything on a key press", () => {
    const fade = createHudFade(["vitals", "hotbar"], 0);
    fade.changedAll(6000);
    expect(fade.isFaded("vitals", 6000, NONE)).toBe(false);
    expect(fade.isFaded("hotbar", 6000, NONE)).toBe(false);
    expect(fade.isFaded("hotbar", 6000 + HUD_FADE_QUIET_MS, NONE)).toBe(true);
  });

  it("never fades a pinned module, and fades it once the pin is released", () => {
    const fade = createHudFade(["vitals", "hotbar"], 0);
    const pinned: HudFadeInput = { pinned: new Set(["vitals"]), density: "calm" };
    expect(fade.isFaded("vitals", 60_000, pinned)).toBe(false);
    expect(fade.isFaded("hotbar", 60_000, pinned)).toBe(true);
    expect(fade.isFaded("vitals", 60_000, NONE)).toBe(true);
  });

  it("holds every module at full opacity through combat, then lets them fade", () => {
    const fade = createHudFade(["vitals", "hotbar"], 0);
    fade.combat(10_000);
    expect(fade.isFaded("vitals", 10_000 + HUD_FADE_COMBAT_HOLD_MS - 1, NONE)).toBe(false);
    expect(fade.isFaded("hotbar", 10_000 + HUD_FADE_COMBAT_HOLD_MS - 1, NONE)).toBe(false);
    expect(fade.isFaded("vitals", 10_000 + HUD_FADE_COMBAT_HOLD_MS, NONE)).toBe(true);
  });

  it("extends the hold when combat continues", () => {
    const fade = createHudFade(["vitals"], 0);
    fade.combat(10_000);
    fade.combat(13_000);
    expect(fade.isFaded("vitals", 13_000 + HUD_FADE_COMBAT_HOLD_MS - 1, NONE)).toBe(false);
    expect(fade.isFaded("vitals", 13_000 + HUD_FADE_COMBAT_HOLD_MS, NONE)).toBe(true);
  });

  describe("density levels", () => {
    it("Full never fades, however long a module is quiet", () => {
      const fade = createHudFade(["vitals", "hotbar"], 0);
      expect(fade.isFaded("hotbar", 60_000, { ...NONE, density: "full" })).toBe(false);
      expect(HUD_DENSITY_RULES.full).toEqual({ fades: false, opacity: 1, hidesHints: false, showsNumbers: true });
    });

    it("Calm fades to the base opacity and keeps the key hints", () => {
      const fade = createHudFade(["hotbar"], 0);
      expect(fade.isFaded("hotbar", HUD_FADE_QUIET_MS, { ...NONE, density: "calm" })).toBe(true);
      expect(HUD_DENSITY_RULES.calm).toEqual({ fades: true, opacity: HUD_FADE_OPACITY,
        hidesHints: false,
        showsNumbers: true,
      });
    });

    it("Minimal fades lower than Calm and hides the key hints", () => {
      const fade = createHudFade(["hotbar"], 0);
      expect(fade.isFaded("hotbar", HUD_FADE_QUIET_MS, { ...NONE, density: "minimal" })).toBe(true);
      expect(HUD_DENSITY_RULES.minimal.opacity).toBeLessThan(HUD_DENSITY_RULES.calm.opacity);
      expect(HUD_DENSITY_RULES.minimal.hidesHints).toBe(true);
    });

    it("Minimal is the only level that hides the self frame's numbers", () => {
      expect(HUD_DENSITY_RULES.full.showsNumbers).toBe(true);
      expect(HUD_DENSITY_RULES.calm.showsNumbers).toBe(true);
      expect(HUD_DENSITY_RULES.minimal.showsNumbers).toBe(false);
    });

    it("keeps warnings lit at every level", () => {
      const fade = createHudFade(["vitals"], 0);
      for (const density of ["full", "calm", "minimal"] as const) {
        const pinned: HudFadeInput = { pinned: new Set(["vitals"]), density };
        expect(fade.isFaded("vitals", 60_000, pinned)).toBe(false);
      }
    });
  });
});
