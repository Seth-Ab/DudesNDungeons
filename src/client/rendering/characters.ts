/**
 * What the character sheet contains and which cell a given character frame sits in.
 *
 * The counterpart of `tiles.ts` for `assets/sprites/characters.png`, and free of the DOM for the same
 * reason: `scripts/buildSprites.ts` imports it to decide what to bake and where, the renderer will
 * import it to decide what to stamp, and the tests drive it under node. One declaration, so the
 * baked sheet and the renderer's reads cannot drift.
 *
 * A character is drawn as layers stacked in one 16 x 24 frame: a body, then hair over it. Skin, hair
 * and tunic are baked in key colours rather than real ones, so a renderer can swap each ramp for the
 * player's skin tone, hair colour and party colour without a sheet per combination.
 *
 * The pixel work and choices the renderer makes per player live here too, for the same reason: the
 * recolour, the blink, the composite cache and the frame picker are all tested under node. Only the
 * canvases they run on are in `characterSprites.ts`.
 */

import type { HairColor, PartyColor, SkinTone } from "../../shared/types/core.js";
import {
  HAIR_RAMPS,
  PARTY_PALETTES,
  SKIN_RAMPS,
  type ColourRamp,
} from "./characterPalettes.js";

/** A character frame, in art pixels. Taller than a tile so hair and hats clear the head. */
export const CHARACTER_FRAME_WIDTH = 16;
export const CHARACTER_FRAME_HEIGHT = 24;

/** The frame row a body's first row sits on. The eight rows above it are headroom for hair. */
export const CHARACTER_BODY_TOP = 8;

/** How many frames fit across the sheet: one body's three facings of three poses. */
const SHEET_COLUMNS = 9;

export const CHARACTER_BODIES = ["guy", "girl"] as const;
export type CharacterBody = (typeof CHARACTER_BODIES)[number];

export const HAIR_STYLES = ["crop", "spiky", "long", "ponytail", "bun", "shaved"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Left is drawn as `side` mirrored, so it has no frames of its own. */
export const CHARACTER_FACINGS = ["down", "up", "side"] as const;
export type CharacterFacing = (typeof CHARACTER_FACINGS)[number];

/**
 * A body's poses. The walk cycle is stand, `walk1`, stand, `walk2`: `walk1` lifts the foot on the
 * right half of the frame one row, `walk2` the left. Only bodies walk; hair is the same in every pose.
 */
export const WALK_POSES = ["stand", "walk1", "walk2"] as const;
export type WalkPose = (typeof WALK_POSES)[number];

/**
 * The recolourable ramps, light to dark, as they are baked. Deliberately garish and far from any
 * real skin, hair or cloth, so a key colour left unswapped is obvious on screen. None may appear in
 * `dungeon.png`, or recolouring a character would also recolour the floor it stands on.
 */
export const CHARACTER_KEY_COLOURS = {
  skin: ["#ffb0ff", "#ff60ff", "#c000c0"],
  hair: ["#b0ffff", "#00ffff", "#00a0a0"],
  tunic: ["#ffffa0", "#ffff00", "#a0a000"],
} as const satisfies Record<string, readonly [string, string, string]>;

export type CharacterRamp = keyof typeof CHARACTER_KEY_COLOURS;

/** Colours drawn as baked, the same on every character. */
export const CHARACTER_FIXED_COLOURS = {
  outline: "#17120c",
  belt: "#5c4930",
  buckle: "#d6a84c",
  trousers: "#2b3037",
  trousersShade: "#1f2329",
  boots: "#3b2f20",
  bootsShade: "#2a2016",
  ribbon: "#c23b2e",
} as const;

export type CharacterLayerName = string;
export type CharacterFrameName = string;

export function bodyLayer(body: CharacterBody, facing: CharacterFacing): CharacterLayerName {
  return `body-${body}-${facing}`;
}

export function hairLayer(style: HairStyle, facing: CharacterFacing): CharacterLayerName {
  return `hair-${style}-${facing}`;
}

export function bodyFrame(
  body: CharacterBody,
  facing: CharacterFacing,
  pose: WalkPose,
): CharacterFrameName {
  return `${bodyLayer(body, facing)}-${pose}`;
}

/** Hair has one frame per facing, named after its layer. */
export function hairFrame(style: HairStyle, facing: CharacterFacing): CharacterFrameName {
  return hairLayer(style, facing);
}

export interface CharacterFrame {
  name: CharacterFrameName;
  /** The authored layer this frame is baked from. */
  layer: CharacterLayerName;
  pose: WalkPose;
}

/** Every frame the sheet holds, in packing order: each body's facings and poses, then each hair. */
export const CHARACTER_FRAMES: readonly CharacterFrame[] = [
  ...CHARACTER_BODIES.flatMap((body) =>
    CHARACTER_FACINGS.flatMap((facing) =>
      WALK_POSES.map((pose) => ({
        name: bodyFrame(body, facing, pose),
        layer: bodyLayer(body, facing),
        pose,
      })),
    ),
  ),
  ...HAIR_STYLES.flatMap((style) =>
    CHARACTER_FACINGS.map((facing) => ({
      name: hairFrame(style, facing),
      layer: hairLayer(style, facing),
      pose: "stand" as const,
    })),
  ),
];

/** Every layer the source art must author, each exactly once. The baker validates against this. */
export const CHARACTER_LAYERS: readonly CharacterLayerName[] = [
  ...new Set(CHARACTER_FRAMES.map((frame) => frame.layer)),
];

export const CHARACTER_SHEET_WIDTH = SHEET_COLUMNS * CHARACTER_FRAME_WIDTH;
export const CHARACTER_SHEET_HEIGHT =
  Math.ceil(CHARACTER_FRAMES.length / SHEET_COLUMNS) * CHARACTER_FRAME_HEIGHT;

export interface CharacterFrameRect {
  /** Left edge in the sheet, in art pixels. */
  x: number;
  /** Top edge in the sheet, in art pixels. */
  y: number;
}

const FRAME_RECTS = new Map<CharacterFrameName, CharacterFrameRect>(
  CHARACTER_FRAMES.map((frame, index) => [
    frame.name,
    {
      x: (index % SHEET_COLUMNS) * CHARACTER_FRAME_WIDTH,
      y: Math.floor(index / SHEET_COLUMNS) * CHARACTER_FRAME_HEIGHT,
    },
  ]),
);

/** Where a frame sits in the sheet. Every frame is `CHARACTER_FRAME_WIDTH` by `_HEIGHT`. */
export function characterFrameRect(name: CharacterFrameName): CharacterFrameRect {
  const rect = FRAME_RECTS.get(name);
  if (!rect) throw new Error(`Unknown character frame: ${name}`);
  return rect;
}

/**
 * The look a player's composite is built for: what they designed and the party colour the server
 * gave them. Hats, cloaks and dyes will join it, and with them the cache key.
 */
export interface CharacterLook {
  body: CharacterBody;
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairColor: HairColor;
  partyColor: PartyColor;
}

/** One string per distinct composite. Every field that changes a pixel must be in it. */
export function characterLookKey(look: CharacterLook): string {
  return [look.body, look.skinTone, look.hairStyle, look.hairColor, look.partyColor].join("|");
}

function rgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/**
 * Each key colour, as `0xrrggbb`, mapped to the real colour this look swaps it for. Fixed colours
 * are absent, which is what leaves them drawn as baked.
 */
export function characterSwaps(look: CharacterLook): ReadonlyMap<number, number> {
  const ramps: Record<CharacterRamp, ColourRamp> = {
    skin: SKIN_RAMPS[look.skinTone],
    hair: HAIR_RAMPS[look.hairColor],
    tunic: PARTY_PALETTES[look.partyColor].tunic,
  };
  const swaps = new Map<number, number>();
  for (const ramp of Object.keys(CHARACTER_KEY_COLOURS) as CharacterRamp[]) {
    CHARACTER_KEY_COLOURS[ramp].forEach((key, index) => swaps.set(rgb(key), rgb(ramps[ramp][index]!)));
  }
  return swaps;
}

/**
 * Swaps key colours for real ones in RGBA pixels, in place. Exact matches only: the sheet is baked
 * without smoothing, so a pixel either is a key colour or is not. Transparent pixels are skipped,
 * since their colour channels mean nothing.
 */
export function recolourPixels(data: Uint8ClampedArray, swaps: ReadonlyMap<number, number>): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const swapped = swaps.get((data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!);
    if (swapped === undefined) continue;
    data[offset] = swapped >> 16;
    data[offset + 1] = (swapped >> 8) & 0xff;
    data[offset + 2] = swapped & 0xff;
  }
}

/** The body rows that are the head, where the eyes are. Below them is the tunic. */
const HEAD_ROWS = 8;

/**
 * Closes the eyes in one body frame of RGBA pixels, in place, by painting them over in mid skin,
 * which is what the sprite bible's blink does. The girl's lashes are eye pixels too and close with
 * them.
 *
 * The sheet bakes eyes in the outline colour, so they are found by where they sit rather than what
 * they are: an outline-coloured pixel in the head with no transparent pixel beside it. The head's
 * outline is its silhouette, which always borders transparency. Run it on a body frame before hair
 * goes over it, since hair would hide that border.
 */
export function closeEyes(
  data: Uint8ClampedArray,
  width: number,
  frameX: number,
  frameY: number,
): void {
  const outline = rgb(CHARACTER_FIXED_COLOURS.outline);
  const lid = rgb(CHARACTER_KEY_COLOURS.skin[1]);
  const opaque = (x: number, y: number): boolean => data[(y * width + x) * 4 + 3] !== 0;
  const colourAt = (x: number, y: number): number | null => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] === 0) return null;
    return (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!;
  };

  const eyes: number[] = [];
  const top = frameY + CHARACTER_BODY_TOP;
  for (let y = top; y < top + HEAD_ROWS; y += 1) {
    for (let x = frameX + 1; x < frameX + CHARACTER_FRAME_WIDTH - 1; x += 1) {
      if (colourAt(x, y) !== outline) continue;
      if (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1)) {
        eyes.push((y * width + x) * 4);
      }
    }
  }
  // Painted after the scan, so closing one eye pixel cannot change what its neighbour looks like.
  for (const offset of eyes) {
    data[offset] = lid >> 16;
    data[offset + 1] = (lid >> 8) & 0xff;
    data[offset + 2] = lid & 0xff;
  }
}

/**
 * Where each frame of a look sits in its composite: one column per facing and pose, an open-eyed
 * row and a blinking one beneath it.
 */
export const COMPOSITE_WIDTH = CHARACTER_FACINGS.length * WALK_POSES.length * CHARACTER_FRAME_WIDTH;
export const COMPOSITE_HEIGHT = 2 * CHARACTER_FRAME_HEIGHT;

export function compositeCell(
  facing: CharacterFacing,
  pose: WalkPose,
  blinking: boolean,
): CharacterFrameRect {
  const column = CHARACTER_FACINGS.indexOf(facing) * WALK_POSES.length + WALK_POSES.indexOf(pose);
  return {
    x: column * CHARACTER_FRAME_WIDTH,
    y: blinking ? CHARACTER_FRAME_HEIGHT : 0,
  };
}

/**
 * A party frame's portrait: the head and shoulders of the front-facing standing frame, frame rows
 * 4 to 19, cropped square as the sprite bible's `headCrop()` does.
 */
export const PORTRAIT_SIZE = 16;
const PORTRAIT_TOP = 4;

/** Where the portrait sits in a look's composite. Open-eyed: a portrait does not blink. */
export function portraitRect(): CharacterFrameRect {
  const cell = compositeCell("down", "stand", false);
  return { x: cell.x, y: cell.y + PORTRAIT_TOP };
}

/**
 * Who stands in for a player still designing: any body will do once it is flattened to one grey,
 * so this is the plain one the sprite bible's roster uses.
 */
export const SILHOUETTE_LOOK: CharacterLook = {
  body: "guy",
  skinTone: "porcelain",
  hairStyle: "shaved",
  hairColor: "black",
  partyColor: "ember",
};

export const SILHOUETTE_COLOUR = "#2b3037";

/** Paints every opaque pixel one colour, in place, leaving the shape and nothing else. */
export function silhouettePixels(data: Uint8ClampedArray, colour: string): void {
  const fill = rgb(colour);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    data[offset] = fill >> 16;
    data[offset + 1] = (fill >> 8) & 0xff;
    data[offset + 2] = fill & 0xff;
  }
}

/**
 * Builds each look's composite once and hands back the same one after. Composites are small, a
 * party has four looks, and a look changes only when someone redesigns, so nothing is evicted.
 */
export function createCompositeCache<T>(build: (look: CharacterLook) => T) {
  const composites = new Map<string, T>();
  return {
    get(look: CharacterLook): T {
      const key = characterLookKey(look);
      let composite = composites.get(key);
      if (composite === undefined) {
        composite = build(look);
        composites.set(key, composite);
      }
      return composite;
    },
  };
}

/** The walk cycle's frame rate and its order: stand, `walk1`, stand, `walk2`. */
export const WALK_FRAMES_PER_SECOND = 8;
const WALK_CYCLE: readonly WalkPose[] = ["stand", "walk1", "stand", "walk2"];

/**
 * Which way a character is drawn for a facing vector. Sideways wins a diagonal, so walking at an
 * angle shows the stride. Left is `side` mirrored; a zero vector faces the camera.
 */
export function characterFacing(direction: { x: number; y: number }): {
  facing: CharacterFacing;
  mirror: boolean;
} {
  const { x, y } = direction;
  if (x === 0 && y === 0) return { facing: "down", mirror: false };
  if (Math.abs(x) >= Math.abs(y)) return { facing: "side", mirror: x < 0 };
  return { facing: y < 0 ? "up" : "down", mirror: false };
}

/** The pose for a moment in time: the walk cycle while moving, otherwise standing still. */
export function walkPose(moving: boolean, timeMs: number): WalkPose {
  if (!moving) return "stand";
  const step = Math.floor((timeMs * WALK_FRAMES_PER_SECOND) / 1000);
  return WALK_CYCLE[((step % WALK_CYCLE.length) + WALK_CYCLE.length) % WALK_CYCLE.length]!;
}

export interface CharacterPose {
  facing: CharacterFacing;
  mirror: boolean;
  pose: WalkPose;
}

export function pickCharacterPose(
  direction: { x: number; y: number },
  moving: boolean,
  timeMs: number,
): CharacterPose {
  return { ...characterFacing(direction), pose: walkPose(moving, timeMs) };
}

export const BLINK_MS = 120;
const BLINK_GAP_MIN_MS = 3000;
const BLINK_GAP_MAX_MS = 5000;

/**
 * When each character blinks: for `BLINK_MS`, a random 3 to 5 seconds apart, starting at a random
 * point so a party standing together does not blink in unison.
 */
export function createBlinkClock(random: () => number = Math.random) {
  const nextBlink = new Map<string, number>();
  const gap = (): number => BLINK_GAP_MIN_MS + random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS);

  return {
    blinking(id: string, now: number): boolean {
      let at = nextBlink.get(id);
      if (at === undefined) {
        at = now + random() * BLINK_GAP_MAX_MS;
        nextBlink.set(id, at);
      }
      if (now >= at + BLINK_MS) {
        at = now + gap();
        nextBlink.set(id, at);
      }
      return now >= at;
    },
  };
}

/** How long a character keeps walking after its position last changed. Bridges gaps between steps. */
export const WALK_HOLD_MS = 150;

/**
 * Whether each character is walking, judged by whether where it is drawn has moved. A snapshot
 * carries no velocity, and the drawn position is what the walk has to match anyway.
 */
export function createMotionTracker(holdMs: number = WALK_HOLD_MS) {
  const last = new Map<string, { x: number; y: number; movedAt: number }>();

  return {
    moving(id: string, position: { x: number; y: number }, now: number): boolean {
      const seen = last.get(id);
      if (!seen) {
        last.set(id, { x: position.x, y: position.y, movedAt: -Infinity });
        return false;
      }
      if (Math.abs(seen.x - position.x) > 1e-4 || Math.abs(seen.y - position.y) > 1e-4) {
        seen.x = position.x;
        seen.y = position.y;
        seen.movedAt = now;
      }
      return now - seen.movedAt < holdMs;
    },
  };
}
