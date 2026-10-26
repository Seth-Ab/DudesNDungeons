import { describe, expect, it } from "vitest";

import { HAIR_COLORS, PARTY_COLORS, SKIN_TONES } from "../../src/shared/constants/appearance.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import {
  CLOAK_PALETTES,
  DYE_RAMPS,
  HAIR_RAMPS,
  HAT_PALETTES,
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
  CLOAK_IDS,
  COMPOSITE_HEIGHT,
  COSMETIC_KEY_COLOURS,
  DYE_IDS,
  HAT_HAIR_CLIP_ROWS,
  HAT_IDS,
  HIDE_ALL_HAIR,
  COMPOSITE_WIDTH,
  PORTRAIT_SIZE,
  SILHOUETTE_COLOUR,
  WALK_HOLD_MS,
  BODY_POSES,
  LYING_FRAME_HEIGHT,
  LYING_FRAME_WIDTH,
  STANDING,
  attackPhase,
  bodyFrame,
  bodyLayer,
  characterLookKey,
  characterSwaps,
  closeEyes,
  compositeCell,
  createBlinkClock,
  createCompositeCache,
  createMotionTracker,
  flickerPhase,
  hairClipRow,
  lookOf,
  lyingCell,
  pickCharacterPose,
  pickDrawnPose,
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
  hat: null,
  cloak: null,
  dye: null,
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
      { dye: "crimson-dye" },
      { hat: "wizard-hat" },
      { cloak: "night-cloak" },
    ];
    for (const change of changes) {
      const other = cache.get({ ...LOOK, ...change });
      expect(other, JSON.stringify(change)).not.toBe(first);
      expect(cache.get({ ...LOOK, ...change })).toBe(other);
    }
    expect(built).toBe(1 + changes.length);
  });

  it("keys on every field of the look", () => {
    expect(characterLookKey(LOOK)).toBe("guy|porcelain|crop|black|ember|-|-|-");
    expect(characterLookKey({ ...LOOK, dye: "bone-dye", hat: "iron-helm", cloak: "moth-cloak" })).toBe(
      "guy|porcelain|crop|black|ember|bone-dye|iron-helm|moth-cloak",
    );
  });

  it("draws a cosmetic it has no art for as none, sharing the plain look's composite", () => {
    let built = 0;
    const cache = createCompositeCache(() => ({ id: (built += 1) }));
    const plain = cache.get(LOOK);

    expect(cache.get({ ...LOOK, hat: "golden-toque", cloak: "shadow-cape", dye: "teal-dye" })).toBe(plain);
    expect(built).toBe(1);
  });

  it("builds one composite per flicker phase, and reuses each", () => {
    let built = 0;
    const cache = createCompositeCache((_look, phase) => ({ id: (built += 1), phase }));
    const crowned = { ...LOOK, hat: "ember-crown" };

    expect(cache.get(crowned, 0)).not.toBe(cache.get(crowned, 1));
    expect(cache.get(crowned, 1)).toBe(cache.get(crowned, 1));
    expect(built).toBe(2);
  });
});

describe("composite layout", () => {
  it("gives every facing, pose and blink its own cell inside the composite", () => {
    const cells = CHARACTER_FACINGS.flatMap((facing) =>
      BODY_POSES.flatMap((pose) => [false, true].map((blink) => compositeCell(facing, pose, blink))),
    );
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length);
    for (const { x, y } of cells) {
      expect(x + CHARACTER_FRAME_WIDTH).toBeLessThanOrEqual(COMPOSITE_WIDTH);
      expect(y + CHARACTER_FRAME_HEIGHT).toBeLessThanOrEqual(COMPOSITE_HEIGHT);
    }
  });

  it("puts the lying cell after every standing cell, inside the composite", () => {
    const { x, y } = lyingCell();
    const standingRight = Math.max(
      ...CHARACTER_FACINGS.flatMap((facing) =>
        BODY_POSES.map((pose) => compositeCell(facing, pose, false).x + CHARACTER_FRAME_WIDTH),
      ),
    );
    expect(x).toBeGreaterThanOrEqual(standingRight);
    expect(x + LYING_FRAME_WIDTH).toBeLessThanOrEqual(COMPOSITE_WIDTH);
    expect(y + LYING_FRAME_HEIGHT).toBeLessThanOrEqual(COMPOSITE_HEIGHT);
  });

  it("names a seated and an attack frame after the layer it bakes", () => {
    expect(bodyFrame("girl", "side", "seated")).toBe("body-girl-side-seated");
    expect(bodyFrame("guy", "up", "strike")).toBe("body-guy-up-attack-strike");
    expect(bodyFrame("guy", "down", "walk1")).toBe("body-guy-down-walk1");
  });
});

describe("pose by state", () => {
  const facingDown = { x: 0, y: 1 };

  it("splits a swing into wind-up, strike and recover thirds", () => {
    expect([0, 0.2, 0.34, 0.5, 0.67, 0.9, 1, 1.5].map(attackPhase)).toEqual([
      "windup",
      "windup",
      "strike",
      "strike",
      "recover",
      "recover",
      "recover",
      "recover",
    ]);
  });

  it("walks or stands when nothing else is going on", () => {
    expect(pickDrawnPose(facingDown, false, 0)).toEqual({ lying: false, facing: "down", mirror: false, pose: "stand" });
    expect(pickDrawnPose({ x: -1, y: 0 }, true, 125, STANDING)).toEqual({
      lying: false,
      facing: "side",
      mirror: true,
      pose: "walk1",
    });
  });

  it("sits a seated player facing where they look, ignoring a walk", () => {
    const stance = { ...STANDING, seated: true };
    expect(pickDrawnPose({ x: 1, y: 0 }, true, 125, stance)).toEqual({
      lying: false,
      facing: "side",
      mirror: false,
      pose: "seated",
    });
  });

  it("shows the attack frame for the swing's phase, facing the way it struck rather than the way they look", () => {
    const heading = -Math.PI / 2;
    const swing = (progress: number) => ({ ...STANDING, swing: { heading, progress } });
    expect(pickDrawnPose(facingDown, false, 0, swing(0.1))).toMatchObject({ facing: "up", pose: "windup" });
    expect(pickDrawnPose(facingDown, false, 0, swing(0.5))).toMatchObject({ facing: "up", pose: "strike" });
    expect(pickDrawnPose(facingDown, false, 0, swing(0.8))).toMatchObject({ facing: "up", pose: "recover" });
    expect(pickDrawnPose(facingDown, false, 0, { ...STANDING, swing: { heading: Math.PI, progress: 0.5 } })).toMatchObject({
      facing: "side",
      mirror: true,
    });
  });

  it("lays a downed player down over any other state", () => {
    const downed = { downed: true, seated: true, swing: { heading: 0, progress: 0.5 } };
    expect(pickDrawnPose(facingDown, true, 125, downed)).toEqual({ lying: true });
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

describe("cosmetics", () => {
  const recoloured = (look: CharacterLook, keys: readonly string[], phase = 0): string[] => {
    const data = pixelsOf(keys);
    recolourPixels(data, characterSwaps(look, phase));
    return keys.map((_, index) => colourAt(data, index));
  };

  it("swaps the tunic for a dye's ramp, and back to the party colour without one", () => {
    const tunic = CHARACTER_KEY_COLOURS.tunic;

    for (const dye of DYE_IDS) {
      expect(recoloured({ ...LOOK, dye }, tunic), dye).toEqual([...DYE_RAMPS[dye]]);
    }
    expect(recoloured(LOOK, tunic)).toEqual([...PARTY_PALETTES.ember.tunic]);
  });

  it("swaps a dye's tunic while leaving skin and hair as designed", () => {
    const keys = [...CHARACTER_KEY_COLOURS.skin, ...CHARACTER_KEY_COLOURS.hair];

    expect(recoloured({ ...LOOK, dye: "midnight-dye" }, keys)).toEqual([...SKIN_RAMPS.porcelain, ...HAIR_RAMPS.black]);
  });

  it("recolours a hat's and a cloak's keys from that item's palette", () => {
    const look = { ...LOOK, hat: "feathered-cap", cloak: "night-cloak" };

    expect(recoloured(look, COSMETIC_KEY_COLOURS.hat).slice(0, 4)).toEqual(HAT_PALETTES["feathered-cap"].colours.slice(0, 4));
    expect(recoloured(look, COSMETIC_KEY_COLOURS.cloak)).toEqual([...CLOAK_PALETTES["night-cloak"].colours]);
  });

  it("flickers only legendary items, each on its own period", () => {
    expect(flickerPhase({ ...LOOK, hat: "wizard-hat", cloak: "night-cloak" }, 250)).toBe(0);

    const crown = { ...LOOK, hat: "ember-crown" };
    expect(flickerPhase(crown, 0)).toBe(0);
    expect(flickerPhase(crown, 200)).toBe(1);
    expect(flickerPhase(crown, 400)).toBe(0);

    const hem = { ...LOOK, cloak: "ember-cloak" };
    expect(flickerPhase(hem, 160)).toBe(2);
    expect(flickerPhase({ ...hem, hat: "ember-crown" }, 200)).toBe(3);
  });

  it("lights the crown's embers and the cloak's hem in the flickering phase only", () => {
    const tips = COSMETIC_KEY_COLOURS.hat[6];
    const hem = COSMETIC_KEY_COLOURS.cloak[5];
    const look = { ...LOOK, hat: "ember-crown", cloak: "ember-cloak" };

    expect(recoloured(look, [tips, hem], 0)).toEqual(["#f0a83c", "#f0a83c"]);
    expect(recoloured(look, [tips, hem], 3)).toEqual(["#ffe6a3", "#ffe6a3"]);
  });

  it("clips hair under a hat, hides it all under a hood, and keeps it all under a crown", () => {
    expect(hairClipRow(LOOK)).toBeNull();
    expect(hairClipRow({ ...LOOK, hat: "leather-cap" })).toBe(13);
    expect(hairClipRow({ ...LOOK, hat: "ranger-hood" })).toBe(HIDE_ALL_HAIR);
    expect(hairClipRow({ ...LOOK, hat: "ember-crown" })).toBeNull();
    expect(hairClipRow({ ...LOOK, hat: "golden-toque" })).toBeNull();
    // Every clip falls between the first hair row and the bottom of the frame.
    for (const clip of Object.values(HAT_HAIR_CLIP_ROWS)) {
      if (typeof clip === "number") expect(clip).toBeGreaterThan(8);
      if (typeof clip === "number") expect(clip).toBeLessThan(CHARACTER_FRAME_HEIGHT);
    }
  });

  it("has art for every hat, cloak and dye content lists, and nothing content does not", () => {
    const content = [...loadContent().cosmetics.values()];
    const ids = (slot: string): string[] => content.filter((item) => item.slot === slot).map((item) => item.id).sort();

    expect([...HAT_IDS].sort()).toEqual(ids("hat"));
    expect([...CLOAK_IDS].sort()).toEqual(ids("cloak"));
    expect([...DYE_IDS].sort()).toEqual(ids("dye"));
    expect(Object.keys(HAT_PALETTES).sort()).toEqual(ids("hat"));
    expect(Object.keys(CLOAK_PALETTES).sort()).toEqual(ids("cloak"));
    expect(Object.keys(DYE_RAMPS).sort()).toEqual(ids("dye"));
  });

  it("builds a player's look from their design, party colour and what they wear", () => {
    const appearance = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "moss" } as const;
    const cosmetics = { hat: "wizard-hat", cloak: null, dye: "bone-dye", trail: null, flame: null };

    expect(lookOf({ appearance, partyColor: "plum", cosmetics })).toEqual({
      ...appearance,
      partyColor: "plum",
      ...cosmetics,
    });
    expect(lookOf({ appearance: null, partyColor: "plum", cosmetics })).toBeNull();
  });
});
