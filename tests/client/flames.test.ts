import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLAME_RAMPS, HEARTH_FLAME_RAMP, TRAIL_PALETTES } from "../../src/client/rendering/characterPalettes.js";
import { recolourPixels } from "../../src/client/rendering/characters.js";
import {
  flameHaloTint,
  flameRamp,
  flameSwaps,
  isRecolouredFlame,
  lightFlameId,
} from "../../src/client/rendering/flames.js";
import { sceneLights } from "../../src/client/rendering/lighting.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import { NO_COSMETICS, type LightSourceState } from "../../src/shared/types/core.js";

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

function pixel(colour: string): number[] {
  const value = Number.parseInt(colour.slice(1), 16);
  return [value >> 16, (value >> 8) & 0xff, value & 0xff, 255];
}

const LIGHTS: LightSourceState[] = [
  { id: "p1", name: "Torch", kind: "carriedTorch", position: { x: 4, y: 4 }, radius: 7 },
  { id: "p2", name: "Torch", kind: "carriedTorch", position: { x: 9, y: 4 }, radius: 6 },
  { id: "pillar", name: "Pillar", kind: "fixed", position: { x: 2, y: 8 }, radius: 5, flicker: 0.3 },
];

describe("torch flames", () => {
  it("is baked in the hearth ramp, so the default flame swaps nothing", () => {
    const sheet = JSON.parse(readFileSync("assets/sprites/source/dungeon.tiles.json", "utf8")) as {
      palette: Record<string, string>;
    };
    const { e, f, g, h } = sheet.palette;
    expect(HEARTH_FLAME_RAMP).toEqual({ e, f, g, h });
    expect(flameSwaps(null).size).toBe(0);
    expect(isRecolouredFlame(null)).toBe(false);
  });

  it("maps the flame sprite's e f g h to the equipped ramp", () => {
    for (const [id, ramp] of Object.entries(FLAME_RAMPS)) {
      const swaps = flameSwaps(id);
      expect(swaps.size).toBe(4);
      for (const key of ["e", "f", "g", "h"] as const) {
        expect(hex(swaps.get(Number.parseInt(HEARTH_FLAME_RAMP[key].slice(1), 16))!)).toBe(ramp[key]);
      }

      // Applied to the sprite's pixels, every flame colour changes and nothing else does.
      const outline = "#0b0b0b";
      const data = new Uint8ClampedArray([
        ...pixel(HEARTH_FLAME_RAMP.e),
        ...pixel(HEARTH_FLAME_RAMP.f),
        ...pixel(HEARTH_FLAME_RAMP.g),
        ...pixel(HEARTH_FLAME_RAMP.h),
        ...pixel(outline),
      ]);
      recolourPixels(data, swaps);
      expect([...data]).toEqual([...pixel(ramp.e), ...pixel(ramp.f), ...pixel(ramp.g), ...pixel(ramp.h), ...pixel(outline)]);
    }
  });

  it("draws an unknown flame as the hearth flame", () => {
    expect(flameRamp("rainbow-flame")).toBe(HEARTH_FLAME_RAMP);
    expect(flameRamp("toString")).toBe(HEARTH_FLAME_RAMP);
    expect(flameSwaps("rainbow-flame").size).toBe(0);
    expect(flameHaloTint("rainbow-flame")).toBeNull();
    expect(flameHaloTint("spirit-flame")).toBe("rgba(127, 176, 240, 0.22)");
  });

  it("recolours only a player's carried torch, by its bearer's flame", () => {
    const players = [
      { id: "p1", cosmetics: { ...NO_COSMETICS, flame: "witchfire" } },
      { id: "p2", cosmetics: NO_COSMETICS },
      { id: "pillar", cosmetics: { ...NO_COSMETICS, flame: "bonefire" } },
    ];
    expect(LIGHTS.map((light) => lightFlameId(light, players))).toEqual(["witchfire", null, null]);
    expect(lightFlameId({ id: "p3", kind: "carriedTorch" }, players)).toBeNull();
  });

  it("leaves the lightmap inputs unchanged", () => {
    const before = structuredClone(LIGHTS);
    const self = { id: "p1", position: { x: 4.25, y: 4.5 } };
    const others = [{ id: "p2", position: { x: 9.1, y: 4 } }];
    const plain = sceneLights(LIGHTS, self, others, 1234);

    // Wearing every flame there is changes nothing the lightmap is built from.
    for (const flame of Object.keys(FLAME_RAMPS)) {
      const wearing = [
        { ...self, cosmetics: { ...NO_COSMETICS, flame } },
        { ...others[0]!, cosmetics: { ...NO_COSMETICS, flame } },
      ];
      LIGHTS.forEach((light) => lightFlameId(light, wearing));
      flameSwaps(flame);
      flameHaloTint(flame);
      expect(sceneLights(LIGHTS, wearing[0]!, wearing.slice(1), 1234)).toEqual(plain);
    }
    expect(LIGHTS).toEqual(before);
    expect(plain.map((light) => light.radius).slice(0, 2)).toEqual([7, 6]);
  });

  it("has art for every trail and flame content lists, and nothing content does not", () => {
    const content = [...loadContent().cosmetics.values()];
    const ids = (slot: string): string[] => content.filter((item) => item.slot === slot).map((item) => item.id).sort();
    expect(Object.keys(TRAIL_PALETTES).sort()).toEqual(ids("trail"));
    expect(Object.keys(FLAME_RAMPS).sort()).toEqual(ids("flame"));
  });
});
