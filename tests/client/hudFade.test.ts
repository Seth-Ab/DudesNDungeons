import { describe, expect, it } from "vitest";
import {
  HUD_FADE_COMBAT_HOLD_MS,
  HUD_FADE_QUIET_MS,
  createHudFade,
  type HudFadeInput,
} from "../../src/client/state/hudFade.js";

const NONE: HudFadeInput = { pinned: new Set() };

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
    const pinned: HudFadeInput = { pinned: new Set(["vitals"]) };
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
});
