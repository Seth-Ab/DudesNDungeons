import { describe, expect, it } from "vitest";

import { HAIR_COLORS, PARTY_COLORS, SKIN_TONES } from "../../src/shared/constants/appearance.js";
import {
  HAIR_RAMPS,
  PARTY_PALETTES,
  SKIN_RAMPS,
} from "../../src/client/rendering/characterPalettes.js";
import {
  BLINK_MS,
  CHARACTER_BODIES,
  CHARACTER_FACINGS,
  CHARACTER_FIXED_COLOURS,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_KEY_COLOURS,
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  PORTRAIT_SIZE,
  SILHOUETTE_COLOUR,
  WALK_HOLD_MS,
  WALK_POSES,
  bodyLayer,
  characterLookKey,
  characterSwaps,
  closeEyes,
  compositeCell,
  createBlinkClock,
  createCompositeCache,
  createMotionTracker,
  pickCharacterPose,
  portraitRect,
  recolourPixels,
  silhouettePixels,
  walkPose,
  type CharacterLook,
} from "../../src/client/rendering/characters.js";
import { readCharacterSourceArt } from "../../scripts/characterSheet.js";

const LOOK: CharacterLook = {
  body: "guy",
  skinTone: "porcelain",
  hairStyle: "crop",
  hairColor: "black",
  partyColor: "ember",
};

function pixelsOf(colours: readonly (string | null)[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colours.length * 4);
  colours.forEach((colour, index) => {
    if (colour === null) return;
    const value = Number.parseInt(colour.slice(1), 16);
    data.set([value >> 16, (value >> 8) & 0xff, value & 0xff, 255], index * 4);
  });
  return data;
}

function colourAt(data: Uint8ClampedArray, index: number): string {
  const [r, g, b] = data.subarray(index * 4, index * 4 + 3);
  return `#${[r, g, b].map((channel) => channel!.toString(16).padStart(2, "0")).join("")}`;
}

describe("character recolour", () => {
  const keys = [
    ...CHARACTER_KEY_COLOURS.skin,
    ...CHARACTER_KEY_COLOURS.hair,
    ...CHARACTER_KEY_COLOURS.tunic,
  ];
  const fixed = Object.values(CHARACTER_FIXED_COLOURS);

  it("maps every key colour to the matching step of the look's ramps", () => {
    for (const skinTone of SKIN_TONES) {
      for (const hairColor of HAIR_COLORS) {
        for (const partyColor of PARTY_COLORS) {
          const data = pixelsOf(keys);
          recolourPixels(data, characterSwaps({ ...LOOK, skinTone, hairColor, partyColor }));

          const expected = [
            ...SKIN_RAMPS[skinTone],
            ...HAIR_RAMPS[hairColor],
            ...PARTY_PALETTES[partyColor].tunic,
          ];
          expect(keys.map((_, index) => colourAt(data, index))).toEqual(expected);
        }
      }
    }
  });

  it("leaves fixed colours and transparent pixels untouched", () => {
    const data = pixelsOf([...fixed, null]);
    const before = data.slice();
    recolourPixels(data, characterSwaps({ ...LOOK, skinTone: "deep", partyColor: "plum" }));
    expect(data).toEqual(before);
  });

  it("has a ramp for every shared id", () => {
    expect(Object.keys(SKIN_RAMPS).sort()).toEqual([...SKIN_TONES].sort());
    expect(Object.keys(HAIR_RAMPS).sort()).toEqual([...HAIR_COLORS].sort());
    expect(Object.keys(PARTY_PALETTES).sort()).toEqual([...PARTY_COLORS].sort());
  });
});

describe("closeEyes", () => {
  const source = readCharacterSourceArt();
  const expand = (rows: string[]): string[] =>
    rows.flatMap((row) => {
      const match = /^(\d+)\*(.*)$/.exec(row);
      return match ? Array<string>(Number(match[1])).fill(match[2]!) : [row];
    });

  it.each(CHARACTER_BODIES.flatMap((body) => CHARACTER_FACINGS.map((facing) => bodyLayer(body, facing))))(
    "closes exactly the authored eye pixels of %s",
    (layer) => {
      const rows = expand(source.layers[layer]!.rows);
      const characters = rows.flatMap((row) => [...row]);
      const data = pixelsOf(
        characters.map((character) => {
          const colour = source.palette[character]!;
          return colour === "transparent" ? null : colour;
        }),
      );

      closeEyes(data, CHARACTER_FRAME_WIDTH, 0, 0);

      characters.forEach((character, index) => {
        const colour = source.palette[character]!;
        if (character === "e") {
          expect(colourAt(data, index), `eye pixel ${index}`).toBe(CHARACTER_KEY_COLOURS.skin[1]);
        } else if (colour !== "transparent") {
          expect(colourAt(data, index), `pixel ${index}`).toBe(colour.toLowerCase());
        }
      });
      // A back view has no face to blink.
      if (!layer.endsWith("-up")) expect(characters).toContain("e");
    },
  );
});

describe("portraits", () => {
  it("crops the head and shoulders of the open-eyed front stand", () => {
    const rect = portraitRect();
    expect(rect).toEqual({ x: compositeCell("down", "stand", false).x, y: 4 });
    expect(rect.y + PORTRAIT_SIZE).toBeLessThanOrEqual(CHARACTER_FRAME_HEIGHT);
  });

  it("flattens every opaque pixel to the silhouette grey and leaves transparency alone", () => {
    const data = pixelsOf([CHARACTER_KEY_COLOURS.skin[0], null, CHARACTER_FIXED_COLOURS.outline]);
    silhouettePixels(data, SILHOUETTE_COLOUR);

    expect(colourAt(data, 0)).toBe(SILHOUETTE_COLOUR);
    expect(colourAt(data, 2)).toBe(SILHOUETTE_COLOUR);
    expect([...data.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
  });
});

describe("composite cache", () => {
  it("returns the same composite for the same look and a new one when any part changes", () => {
    let built = 0;
    const cache = createCompositeCache(() => ({ id: (built += 1) }));
    const first = cache.get(LOOK);

    expect(cache.get({ ...LOOK })).toBe(first);
    expect(built).toBe(1);

    const changes: Partial<CharacterLook>[] = [
      { body: "girl" },
      { skinTone: "tan" },
      { hairStyle: "bun" },
      { hairColor: "silver" },
      { partyColor: "azure" },
    ];
    for (const change of changes) {
      const other = cache.get({ ...LOOK, ...change });
      expect(other, JSON.stringify(change)).not.toBe(first);
      expect(cache.get({ ...LOOK, ...change })).toBe(other);
    }
    expect(built).toBe(1 + changes.length);
  });

  it("keys on every field of the look", () => {
    expect(characterLookKey(LOOK)).toBe("guy|porcelain|crop|black|ember");
  });
});

describe("composite layout", () => {
  it("gives every facing, pose and blink its own cell inside the composite", () => {
    const cells = CHARACTER_FACINGS.flatMap((facing) =>
      WALK_POSES.flatMap((pose) => [false, true].map((blink) => compositeCell(facing, pose, blink))),
    );
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length);
    for (const { x, y } of cells) {
      expect(x + CHARACTER_FRAME_WIDTH).toBeLessThanOrEqual(COMPOSITE_WIDTH);
      expect(y + CHARACTER_FRAME_HEIGHT).toBeLessThanOrEqual(COMPOSITE_HEIGHT);
    }
  });
});

describe("frame picker", () => {
  it.each([
    [{ x: 0, y: 1 }, "down", false],
    [{ x: 0, y: -1 }, "up", false],
    [{ x: 1, y: 0 }, "side", false],
    [{ x: -1, y: 0 }, "side", true],
    [{ x: -0.7, y: 0.7 }, "side", true],
    [{ x: 0.3, y: -0.9 }, "up", false],
    [{ x: 0, y: 0 }, "down", false],
  ] as const)("faces %o as %s, mirrored %s", (direction, facing, mirror) => {
    expect(pickCharacterPose(direction, false, 0)).toEqual({ facing, mirror, pose: "stand" });
  });

  it("walks stand, walk1, stand, walk2 at 8 fps while moving", () => {
    expect([0, 125, 250, 375, 500, 625].map((time) => walkPose(true, time))).toEqual([
      "stand",
      "walk1",
      "stand",
      "walk2",
      "stand",
      "walk1",
    ]);
  });

  it("stands still when not moving", () => {
    expect([0, 125, 375].map((time) => walkPose(false, time))).toEqual(["stand", "stand", "stand"]);
    expect(pickCharacterPose({ x: -1, y: 0 }, true, 125)).toEqual({
      facing: "side",
      mirror: true,
      pose: "walk1",
    });
  });
});

describe("blink clock", () => {
  it("blinks for 120 ms, then waits 3 to 5 seconds", () => {
    const clock = createBlinkClock(() => 0.5);
    // First blink at 0.5 * 5000.
    expect(clock.blinking("a", 0)).toBe(false);
    expect(clock.blinking("a", 2499)).toBe(false);
    expect(clock.blinking("a", 2500)).toBe(true);
    expect(clock.blinking("a", 2500 + BLINK_MS - 1)).toBe(true);
    // Next at 2620 + 3000 + 0.5 * 2000.
    expect(clock.blinking("a", 2500 + BLINK_MS)).toBe(false);
    expect(clock.blinking("a", 6619)).toBe(false);
    expect(clock.blinking("a", 6620)).toBe(true);
  });

  it("gives each character its own phase", () => {
    const draws = [0.1, 0.9];
    const clock = createBlinkClock(() => draws.shift() ?? 0);
    clock.blinking("a", 0);
    clock.blinking("b", 0);
    expect(clock.blinking("a", 500)).toBe(true);
    expect(clock.blinking("b", 500)).toBe(false);
  });
});

describe("motion tracker", () => {
  it("walks while the drawn position changes and stops shortly after", () => {
    const motion = createMotionTracker();
    expect(motion.moving("a", { x: 1, y: 1 }, 0)).toBe(false);
    expect(motion.moving("a", { x: 1.1, y: 1 }, 16)).toBe(true);
    expect(motion.moving("a", { x: 1.1, y: 1 }, 16 + WALK_HOLD_MS - 1)).toBe(true);
    expect(motion.moving("a", { x: 1.1, y: 1 }, 16 + WALK_HOLD_MS)).toBe(false);
    expect(motion.moving("b", { x: 1.1, y: 1 }, 20)).toBe(false);
  });
});
