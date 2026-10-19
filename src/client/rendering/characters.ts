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
 */

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
