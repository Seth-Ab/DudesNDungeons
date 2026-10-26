import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_FRAMES,
  CHARACTER_KEY_COLOURS,
  COSMETIC_KEY_COLOURS,
  HAT_IDS,
  CHARACTER_LAYERS,
  CHARACTER_SHEET_HEIGHT,
  CHARACTER_SHEET_WIDTH,
  bodyFrame,
  LYING_FRAME_HEIGHT,
  LYING_FRAME_WIDTH,
  SEATED_DROP_ROWS,
  characterFrameRect,
  downedFrame,
} from "../../src/client/rendering/characters.js";
import {
  CHARACTER_COLOURS,
  CHARACTER_SHEET_PATH,
  bakeCharacterSheet,
  readCharacterSourceArt,
  type CharacterSourceArt,
} from "../../scripts/characterSheet.js";
import { SHEET_PATH, SpriteSourceError } from "../../scripts/spriteSheet.js";

interface DecodedPng {
  width: number;
  height: number;
  /** `#rrggbb` per pixel, or `null` where fully transparent. */
  colourAt(x: number, y: number): string | null;
  alphaAt(x: number, y: number): number;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * Reads an 8-bit RGBA, non-interlaced PNG, which is what the baker writes. Undoes every filter type
 * rather than only the baker's filter 0, so a sheet repainted in an image editor still decodes.
 */
function decodePng(bytes: Buffer): DecodedPng {
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect([body[8], body[9], body[12]], "expected 8-bit RGBA, not interlaced").toEqual([8, 6, 0]);
    }
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = raw[y * (stride + 1) + 1 + i] as number;
      const left = i >= 4 ? (pixels[y * stride + i - 4] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + i] as number) : 0;
      const upLeft = y > 0 && i >= 4 ? (pixels[(y - 1) * stride + i - 4] as number) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) predictor = paeth(left, up, upLeft);
      pixels[y * stride + i] = (value + predictor) & 0xff;
    }
  }

  const at = (x: number, y: number): number => y * stride + x * 4;

  return {
    width,
    height,
    alphaAt: (x, y) => pixels[at(x, y) + 3] as number,
    colourAt: (x, y) => {
      const i = at(x, y);
      if (pixels[i + 3] === 0) return null;
      const hex = [pixels[i], pixels[i + 1], pixels[i + 2]].map((channel) =>
        (channel as number).toString(16).padStart(2, "0"),
      );
      return `#${hex.join("")}`;
    },
  };
}

function opaqueColours(image: DecodedPng): Set<string> {
  const colours = new Set<string>();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const colour = image.colourAt(x, y);
      if (colour) colours.add(colour);
    }
  }
  return colours;
}

const KEY_COLOURS: readonly string[] = [
  ...Object.values(CHARACTER_KEY_COLOURS).flat(),
  ...Object.values(COSMETIC_KEY_COLOURS).flat(),
];

/** A copy of the real source, so a test can break one thing and leave the rest valid. */
function source(): CharacterSourceArt {
  return structuredClone(readCharacterSourceArt());
}

describe("the committed character sheet", () => {
  it("matches the art it was baked from", () => {
    const baked = bakeCharacterSheet(readCharacterSourceArt());
    const committed = readFileSync(CHARACTER_SHEET_PATH);

    expect(
      baked.equals(committed),
      "assets/sprites/characters.png is stale; run `npm run build:sprites`",
    ).toBe(true);
  });

  it("is the size characters.ts lays out", () => {
    const sheet = decodePng(readFileSync(CHARACTER_SHEET_PATH));
    expect([sheet.width, sheet.height]).toEqual([CHARACTER_SHEET_WIDTH, CHARACTER_SHEET_HEIGHT]);
  });

  it("is drawn only in fixed colours and the key colours, with no partial alpha", () => {
    const sheet = decodePng(readFileSync(CHARACTER_SHEET_PATH));

    for (let y = 0; y < sheet.height; y += 1) {
      for (let x = 0; x < sheet.width; x += 1) {
        expect([0, 255]).toContain(sheet.alphaAt(x, y));
      }
    }

    const stray = [...opaqueColours(sheet)].filter((colour) => !CHARACTER_COLOURS.has(colour));
    expect(stray).toEqual([]);
  });

  it("uses every key colour, so each ramp has something to recolour", () => {
    const colours = opaqueColours(decodePng(readFileSync(CHARACTER_SHEET_PATH)));
    expect(KEY_COLOURS.filter((colour) => !colours.has(colour))).toEqual([]);
  });

  it("lifts one foot in each walk frame and leaves the rest of the body alone", () => {
    const sheet = decodePng(readFileSync(CHARACTER_SHEET_PATH));
    const frame = (name: string): (string | null)[] => {
      const rect = characterFrameRect(name);
      const pixels: (string | null)[] = [];
      for (let y = 0; y < CHARACTER_FRAME_HEIGHT; y += 1) {
        for (let x = 0; x < CHARACTER_FRAME_WIDTH; x += 1) {
          pixels.push(sheet.colourAt(rect.x + x, rect.y + y));
        }
      }
      return pixels;
    };
    const footRow = (pixels: (string | null)[]): (string | null)[] =>
      pixels.slice((CHARACTER_FRAME_HEIGHT - 1) * CHARACTER_FRAME_WIDTH);
    const aboveFeet = (pixels: (string | null)[]): (string | null)[] =>
      pixels.slice(0, (CHARACTER_FRAME_HEIGHT - 2) * CHARACTER_FRAME_WIDTH);

    const stand = frame(bodyFrame("guy", "down", "stand"));
    const walk1 = frame(bodyFrame("guy", "down", "walk1"));
    const walk2 = frame(bodyFrame("guy", "down", "walk2"));
    const half = CHARACTER_FRAME_WIDTH / 2;

    expect(footRow(walk1).slice(half).every((pixel) => pixel === null)).toBe(true);
    expect(footRow(walk1).slice(0, half)).toEqual(footRow(stand).slice(0, half));
    expect(footRow(walk2).slice(0, half).every((pixel) => pixel === null)).toBe(true);
    expect(footRow(walk2).slice(half)).toEqual(footRow(stand).slice(half));
    expect(aboveFeet(walk1)).toEqual(aboveFeet(stand));
    expect(aboveFeet(walk2)).toEqual(aboveFeet(stand));
  });
});

describe("the seated, attack and downed frames", () => {
  const sheet = decodePng(readFileSync(CHARACTER_SHEET_PATH));
  const pixels = (name: string, width: number, height: number): (string | null)[][] => {
    const rect = characterFrameRect(name);
    return Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => sheet.colourAt(rect.x + x, rect.y + y)),
    );
  };
  const standing = (name: string) => pixels(name, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT);
  const BODY_TOP = 8;

  it.each(["guy", "girl"] as const)("seats %s's head exactly the drop below a standing head", (body) => {
    for (const facing of ["down", "up", "side"] as const) {
      const stand = standing(bodyFrame(body, facing, "stand"));
      const seated = standing(bodyFrame(body, facing, "seated"));
      // The head and neck are the first nine body rows; hair, hats and cloaks follow them down.
      for (let row = BODY_TOP; row < BODY_TOP + 9; row += 1) {
        expect(seated[row + SEATED_DROP_ROWS], `${body} ${facing} row ${row}`).toEqual(stand[row]);
      }
    }
  });

  it.each(["guy", "girl"] as const)("keeps %s's head still through a swing, so hair and hats line up", (body) => {
    for (const facing of ["down", "up", "side"] as const) {
      const stand = standing(bodyFrame(body, facing, "stand"));
      for (const phase of ["windup", "strike", "recover"] as const) {
        const attack = standing(bodyFrame(body, facing, phase));
        // Rows above the shoulders are the head; the raised fist may sit beside it, never over it.
        for (let row = BODY_TOP; row < BODY_TOP + 8; row += 1) {
          expect(attack[row]!.slice(2, 12), `${body} ${facing} ${phase} row ${row}`).toEqual(
            stand[row]!.slice(2, 12),
          );
        }
        expect(attack, `${body} ${facing} ${phase} differs from standing`).not.toEqual(stand);
      }
    }
  });

  it.each(["guy", "girl"] as const)("turns %s onto their back for the downed frame, head to the left", (body) => {
    const stand = standing(bodyFrame(body, "down", "stand"));
    const downed = pixels(downedFrame(body), LYING_FRAME_WIDTH, LYING_FRAME_HEIGHT);
    // Standing (column c, row r) lies at (x = r, y = 15 - c). Only the eyes change, up to a girl's lashes: they are shut.
    let differing = 0;
    for (let r = 0; r < CHARACTER_FRAME_HEIGHT; r += 1) {
      for (let c = 0; c < CHARACTER_FRAME_WIDTH; c += 1) {
        if (downed[LYING_FRAME_HEIGHT - 1 - c]![r] !== stand[r]![c]) differing += 1;
      }
    }
    expect(differing).toBeGreaterThan(0);
    expect(differing).toBeLessThanOrEqual(8);
  });
});

describe("the tilesheet", () => {
  it("contains none of the character key colours", () => {
    // A key colour on the floor would be recoloured along with whoever stood on it.
    const colours = opaqueColours(decodePng(readFileSync(SHEET_PATH)));
    expect(KEY_COLOURS.filter((colour) => colours.has(colour))).toEqual([]);
  });
});

describe("characters.ts", () => {
  it("gives every frame its own cell inside the sheet", () => {
    const cells = new Set<string>();
    for (const frame of CHARACTER_FRAMES) {
      const rect = characterFrameRect(frame.name);
      expect(rect.x + frame.width).toBeLessThanOrEqual(CHARACTER_SHEET_WIDTH);
      expect(rect.y + frame.height).toBeLessThanOrEqual(CHARACTER_SHEET_HEIGHT);
      cells.add(`${rect.x},${rect.y}`);
    }
    expect(cells.size).toBe(CHARACTER_FRAMES.length);
  });

  it("declares a body and a hair layer per facing, a hat facing down and up, and three cloak parts", () => {
    // Each body also has a seated frame and three attack frames per facing, and one downed frame.
    expect(CHARACTER_LAYERS).toHaveLength(2 * 3 * 5 + 6 * 3 + HAT_IDS.length * 2 + 3 + 2);
  });

  it("gives the downed frames a band of their own, a lying frame's size, under the standing ones", () => {
    const downed = CHARACTER_FRAMES.filter((frame) => frame.height !== CHARACTER_FRAME_HEIGHT);
    expect(downed.map((frame) => frame.name)).toEqual(["body-guy-downed", "body-girl-downed"]);
    const standingBottom = Math.max(
      ...CHARACTER_FRAMES.filter((frame) => frame.height === CHARACTER_FRAME_HEIGHT).map(
        (frame) => characterFrameRect(frame.name).y + CHARACTER_FRAME_HEIGHT,
      ),
    );
    for (const frame of downed) {
      expect([frame.width, frame.height]).toEqual([LYING_FRAME_WIDTH, LYING_FRAME_HEIGHT]);
      expect(characterFrameRect(frame.name).y).toBeGreaterThanOrEqual(standingBottom);
    }
  });
});

describe("the character source art", () => {
  it("rejects frames that are not 16 x 24", () => {
    const art = { ...source(), frameHeight: 16 };
    expect(() => bakeCharacterSheet(art)).toThrow(SpriteSourceError);
    expect(() => bakeCharacterSheet(art)).toThrow(/frames are 16x16.*bakes 16x24/);
  });

  it("rejects a layer with the wrong number of rows, naming it", () => {
    const art = source();
    art.layers["hair-bun-up"] = { rows: ["16*0000000000000000"] };
    expect(() => bakeCharacterSheet(art)).toThrow(
      /layer 'hair-bun-up' expands to 16 rows but a frame is 24 pixels tall/,
    );
  });

  it("rejects a row of the wrong width, naming the layer", () => {
    const art = source();
    art.layers["body-girl-side"] = { rows: ["23*0000000000000000", "000000000000000"] };
    expect(() => bakeCharacterSheet(art)).toThrow(
      /layer 'body-girl-side' row 23 is 15 pixels wide, expected 16/,
    );
  });

  it("rejects a layer characters.ts lists but the source leaves out", () => {
    const art = source();
    delete art.layers["hair-shaved-side"];
    expect(() => bakeCharacterSheet(art)).toThrow(/declares layer 'hair-shaved-side'/);
  });

  it("rejects a layer the source defines but characters.ts never lists", () => {
    const art = source();
    art.layers["hair-mohawk-down"] = { rows: ["24*0000000000000000"] };
    expect(() => bakeCharacterSheet(art)).toThrow(/never asks for: hair-mohawk-down/);
  });

  it("rejects a palette colour that is neither fixed nor a key colour", () => {
    const art = source();
    // One step off the skin key, which would bake but never recolour.
    art.palette["S"] = "#ff61ff";
    expect(() => bakeCharacterSheet(art)).toThrow(/palette entry 'S' is #ff61ff/);
  });
});
