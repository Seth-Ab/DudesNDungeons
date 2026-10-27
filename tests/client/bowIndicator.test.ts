import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import type { InventoryItem, PlayerState } from "../../src/shared/types/core.js";
import { ALLY_CUE_SCALE, bowAims, drawMeterView, drawRange } from "../../src/client/state/bowIndicator.js";

const BOW = {
  id: "bow-1",
  name: "Hunting Bow",
  kind: "weapon",
  itemId: "hunting-bow",
  weaponKind: "ranged",
} as InventoryItem;
const SWORD = { ...BOW, id: "sword-1", itemId: "rusted-sword", weaponKind: "melee" } as InventoryItem;

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id,
    position: { x: 10, y: 10 },
    facing: { x: 1, y: 0 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    held: BOW,
    drawFraction: null,
    carryingTorch: false,
    torchLit: true,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    bankedItems: [],
    drawRange: overrides.drawFraction == null ? null : RANGE,
    ...overrides,
  } as PlayerState;
}

const RANGE = { minRange: 4, maxRange: 14 };

describe("drawRange", () => {
  it("runs from the minimum at no draw to the maximum at full draw", () => {
    expect(drawRange(RANGE, 0)).toBe(4);
    expect(drawRange(RANGE, 0.5)).toBe(9);
    expect(drawRange(RANGE, 1)).toBe(14);
  });

  it("clamps a fraction outside 0 to 1", () => {
    expect(drawRange(RANGE, -1)).toBe(4);
    expect(drawRange(RANGE, 2)).toBe(14);
  });

  it("draws the range the server sent, not a table of its own", () => {
    const range = { minRange: 6, maxRange: 20 };
    const aim = (fraction: number) =>
      bowAims(player("me", { drawFraction: fraction, drawRange: range }), { x: 0, y: 0 }, null, [])[0];
    expect(aim(0)?.length).toBe(range.minRange);
    expect(aim(1)?.length).toBe(range.maxRange);
    expect(aim(1)?.fullLength).toBe(range.maxRange);
  });

  it("still draws the line for a bow the client has never heard of", () => {
    const mystery = { ...BOW, itemId: "mystery-bow" } as InventoryItem;
    const aim = bowAims(player("me", { held: mystery, drawFraction: 0.5 }), { x: 0, y: 0 }, null, [])[0];
    expect(aim?.length).toBe(9);
  });
});

describe("bowAims", () => {
  it("has no cue while the player is not drawing", () => {
    expect(bowAims(player("me"), { x: 0, y: 0 }, null, [])).toEqual([]);
  });

  it("grows the line with the draw fraction, toward the held aim from the predicted position", () => {
    const mid = bowAims(player("me", { drawFraction: 0.5 }), { x: 3, y: 4 }, { x: 0, y: 1 }, [])[0];
    expect(mid).toMatchObject({ origin: { x: 3, y: 4 }, length: 9, fullLength: 14, full: false, own: true });
    expect(mid?.heading).toBeCloseTo(Math.PI / 2);
  });

  it("falls back to the facing when no key is held", () => {
    const aim = bowAims(player("me", { drawFraction: 0.2, facing: { x: -1, y: 0 } }), { x: 0, y: 0 }, null, [])[0];
    expect(aim?.heading).toBeCloseTo(Math.PI);
  });

  it("marks the full-draw state only at a full draw", () => {
    const almost = bowAims(player("me", { drawFraction: 0.99 }), { x: 0, y: 0 }, null, [])[0];
    const full = bowAims(player("me", { drawFraction: 1 }), { x: 0, y: 0 }, null, [])[0];
    expect(almost?.full).toBe(false);
    expect(full?.full).toBe(true);
  });

  it("hides the cue when the draw cancels or the arrow fires (fraction goes back to null)", () => {
    const drawing = player("me", { drawFraction: 0.7 });
    expect(bowAims(drawing, { x: 0, y: 0 }, null, [])).toHaveLength(1);
    expect(bowAims({ ...drawing, drawFraction: null }, { x: 0, y: 0 }, null, [])).toEqual([]);
  });

  it("hides the cue for a downed player or one no longer holding a bow", () => {
    expect(bowAims(player("me", { drawFraction: 0.5, health: 0 }), { x: 0, y: 0 }, null, [])).toEqual([]);
    expect(bowAims(player("me", { drawFraction: 0.5, held: SWORD, drawRange: null }), { x: 0, y: 0 }, null, [])).toEqual([]);
    expect(bowAims(player("me", { drawFraction: 0.5, held: null, drawRange: null }), { x: 0, y: 0 }, null, [])).toEqual([]);
  });

  it("shows a visible ally's draw as a shorter cue along their facing", () => {
    const ally = player("ally", { drawFraction: 1, position: { x: 20, y: 5 }, facing: { x: 0, y: -1 } });
    const [cue] = bowAims(player("me"), { x: 0, y: 0 }, null, [ally]);
    expect(cue).toMatchObject({ playerId: "ally", origin: { x: 20, y: 5 }, own: false, full: true });
    expect(cue?.length).toBe(14 * ALLY_CUE_SCALE);
    expect(cue?.heading).toBeCloseTo(-Math.PI / 2);
  });

  it("shows nothing for an ally who is not drawing, and only the players it is handed", () => {
    expect(bowAims(player("me"), { x: 0, y: 0 }, null, [player("idle")])).toEqual([]);
    // The caller passes only visible players, so a hidden ally is simply absent from the list.
    expect(bowAims(player("me"), { x: 0, y: 0 }, null, [])).toEqual([]);
  });
});

describe("drawMeterView", () => {
  it("is null when not drawing", () => {
    expect(drawMeterView(null)).toBeNull();
  });

  it("reads as a percentage while drawing and in words at full draw", () => {
    expect(drawMeterView(0.456)).toEqual({ percent: 46, full: false, label: "46%" });
    expect(drawMeterView(1)).toEqual({ percent: 100, full: true, label: "FULL DRAW" });
  });
});
