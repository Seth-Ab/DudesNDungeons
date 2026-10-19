import { describe, expect, it } from "vitest";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import {
  clampPlate,
  distanceToProp,
  LABEL_FADE,
  LABEL_RANGE,
  labelMode,
  labelOpacity,
  safeArea,
  type Rect,
} from "../../src/client/rendering/propLabels.js";

describe("label mode", () => {
  it("shows a full plate within range, and an icon for a stall or nothing for the rest beyond it", () => {
    expect(labelMode("stall", 0)).toBe("full");
    expect(labelMode("stall", LABEL_RANGE)).toBe("full");
    expect(labelMode("stall", LABEL_RANGE + 0.1)).toBe("icon");
    expect(labelMode("fountain", LABEL_RANGE + 0.1)).toBe("hidden");
    expect(labelMode("quest-board", 100)).toBe("hidden");
  });

  it("cross-fades the plate with the icon over half a tile around the range", () => {
    expect(labelOpacity(0)).toEqual({ plate: 1, icon: 0 });
    expect(labelOpacity(LABEL_RANGE - LABEL_FADE / 2).plate).toBe(1);
    expect(labelOpacity(LABEL_RANGE).plate).toBeCloseTo(0.5);
    expect(labelOpacity(LABEL_RANGE + LABEL_FADE / 2).plate).toBe(0);
    expect(labelOpacity(100)).toEqual({ plate: 0, icon: 1 });
    expect(LABEL_FADE).toBe(TILE_SCALE / 2);
  });
});

describe("distance to a prop", () => {
  const stall = { kind: "stall", x: 10, y: 10, label: "Torch Supply" } as const;

  it("is zero inside the footprint and measured from its nearest edge outside", () => {
    // A stall is 8 by 4 world tiles from half a tile before its x/y.
    expect(distanceToProp(stall, { x: 12, y: 11 })).toBe(0);
    expect(distanceToProp(stall, { x: 9.5 + 8 + 3, y: 11 })).toBe(3);
    expect(distanceToProp(stall, { x: 12, y: 9.5 - 4 })).toBe(4);
  });
});

describe("safe area", () => {
  const viewport: Rect = { left: 0, top: 0, right: 1200, bottom: 800 };
  const panels: Rect[] = [
    { left: 8, top: 8, right: 200, bottom: 100 },
    { left: 952, top: 8, right: 1192, bottom: 300 },
    { left: 8, top: 700, right: 400, bottom: 792 },
    { left: 800, top: 700, right: 1192, bottom: 792 },
  ];

  it("excludes every panel, at a wide and a narrow window", () => {
    for (const bounds of [viewport, { left: 0, top: 0, right: 640, bottom: 480 }]) {
      const area = safeArea(
        bounds,
        panels.filter((panel) => panel.right <= bounds.right && panel.bottom <= bounds.bottom),
      );
      for (const panel of panels) {
        if (panel.right > bounds.right || panel.bottom > bounds.bottom) continue;
        const overlaps =
          panel.left < area.right && panel.right > area.left && panel.top < area.bottom && panel.bottom > area.top;
        expect(overlaps).toBe(false);
      }
      expect(area.right - area.left).toBeGreaterThan(0);
    }
  });

  it("leaves the whole viewport when nothing covers it", () => {
    expect(safeArea(viewport, [])).toEqual(viewport);
  });
});

describe("clamping a plate", () => {
  const safe: Rect = { left: 100, top: 100, right: 500, bottom: 400 };

  it("keeps a plate where it is when it fits", () => {
    expect(clampPlate({ x: 300, y: 250 }, 100, 26, safe)).toEqual({ left: 250, top: 237 });
  });

  it("pulls a plate off every edge back inside", () => {
    expect(clampPlate({ x: 0, y: 0 }, 100, 26, safe)).toEqual({ left: 100, top: 100 });
    expect(clampPlate({ x: 900, y: 900 }, 100, 26, safe)).toEqual({ left: 400, top: 374 });
  });

  it("pins a plate wider than the area to its start", () => {
    expect(clampPlate({ x: 300, y: 250 }, 600, 26, safe).left).toBe(100);
  });
});
