/**
 * What the character sheet contains and which cell a given character frame sits in.
 *
 * The counterpart of `tiles.ts` for `assets/sprites/characters.png`, and free of the DOM for the same
 * reason: `scripts/buildSprites.ts` imports it to decide what to bake and where, the renderer will
 * import it to decide what to stamp, and the tests drive it under node. One declaration, so the
 * baked sheet and the renderer's reads cannot drift.
 *
 * A character is drawn as layers stacked in one 16 x 24 frame: a cloak behind, the body, a cloak's
 * back, hair, a clasp, then a hat. Skin, hair, tunic, hats and cloaks are baked in key colours rather
 * than real ones, so a renderer can swap each for the player's skin tone, hair colour, party colour
 * or dye, hat and cloak without a sheet per combination.
 *
 * The pixel work and choices the renderer makes per player live here too, for the same reason: the
 * recolour, the blink, the composite cache and the frame picker are all tested under node. Only the
 * canvases they run on are in `characterSprites.ts`.
 */

import type { HairColor, PartyColor, PlayerState, SkinTone } from "../../shared/types/core.js";
import {
  CLOAK_PALETTES,
  DYE_RAMPS,
  HAIR_RAMPS,
  HAT_PALETTES,
  PARTY_PALETTES,
  SKIN_RAMPS,
  type ColourRamp,
  type CosmeticPalette,
} from "./characterPalettes.js";

/** A character frame, in art pixels. Taller than a tile so hair and hats clear the head. */
export const CHARACTER_FRAME_WIDTH = 16;
export const CHARACTER_FRAME_HEIGHT = 24;

/** The frame row a body's first row sits on. The eight rows above it are headroom for hair. */
export const CHARACTER_BODY_TOP = 8;

/** How many frames fit across the sheet: one body's three facings of three poses. */
const SHEET_COLUMNS = 9;

/** A lying figure: wider than it is tall, so it has its own band under the standing frames. */
export const LYING_FRAME_WIDTH = 24;
export const LYING_FRAME_HEIGHT = 16;

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

/** A swing's three frames, in order: wind-up, strike and recover. Only the arms and hands change. */
export const ATTACK_PHASES = ["windup", "strike", "recover"] as const;
export type AttackPhase = (typeof ATTACK_PHASES)[number];

/**
 * Every pose a standing-sized body frame has. `seated` is the figure sitting on a bench or rim; its
 * head sits `SEATED_DROP_ROWS` lower than a standing one, so hair, hats and cloaks follow it down.
 * A downed figure is lying down and has its own frame, not a pose.
 */
export type BodyPose = WalkPose | "seated" | AttackPhase;
export const BODY_POSES: readonly BodyPose[] = [...WALK_POSES, "seated", ...ATTACK_PHASES];

/** Rows a seated figure's head sits below a standing one's. */
export const SEATED_DROP_ROWS = 3;

/** How far, in art pixels, a carried player is drawn above the carrier. */
export const CARRIED_LIFT_PX = 6;

function isWalkPose(pose: BodyPose): pose is WalkPose {
  return (WALK_POSES as readonly string[]).includes(pose);
}

/** Frame rows the head, and so hair, hats and a cloak, is drawn below standing in this pose. */
export function headDrop(pose: BodyPose): number {
  return pose === "seated" ? SEATED_DROP_ROWS : 0;
}

/**
 * Hats the sheet has art for, by cosmetic content id. Content may list a hat the client has no art
 * for yet; that one is drawn as no hat rather than refused.
 */
export const HAT_IDS = [
  "leather-cap",
  "ranger-hood",
  "feathered-cap",
  "iron-helm",
  "mushroom-cap",
  "horned-helm",
  "wizard-hat",
  "ember-crown",
] as const;
export type HatId = (typeof HAT_IDS)[number];

/** Hair is hidden on every row: a hood covers it all. */
export const HIDE_ALL_HAIR = "all";

/**
 * The first frame row of hair each hat leaves showing; rows above it are under the hat. Null keeps
 * all of the hair (a crown sits on top of it), `HIDE_ALL_HAIR` none. The sprite bible's `clip`, plus
 * the eight headroom rows above the body.
 */
export const HAT_HAIR_CLIP_ROWS: Record<HatId, number | null | typeof HIDE_ALL_HAIR> = {
  "leather-cap": 13,
  "ranger-hood": HIDE_ALL_HAIR,
  "feathered-cap": 13,
  "iron-helm": 15,
  "mushroom-cap": 12,
  "horned-helm": 13,
  "wizard-hat": 13,
  "ember-crown": null,
};

export const CLOAK_IDS = ["traveler-cape", "night-cloak", "moth-cloak", "ember-cloak"] as const;
export type CloakId = (typeof CLOAK_IDS)[number];

/** Every cloak shares one shape, in three parts, recoloured per cloak. */
export const CLOAK_PARTS = ["behind", "back", "clasp"] as const;
export type CloakPart = (typeof CLOAK_PARTS)[number];

export const DYE_IDS = ["bone-dye", "ashen-dye", "midnight-dye", "crimson-dye", "gilded-dye"] as const;
export type DyeId = (typeof DYE_IDS)[number];

function isOneOf<T extends string>(ids: readonly T[], id: string | null): id is T {
  return id !== null && (ids as readonly string[]).includes(id);
}

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

/**
 * Cosmetic key colours, swapped per item. A hat is a three-colour ramp then four accents (the
 * bible's `1 2 3` and `r w y f`); a cloak is six colours. Each palette lists its colours in this order.
 */
export const COSMETIC_KEY_COLOURS = {
  hat: ["#ff8080", "#ff0000", "#a00000", "#8080ff", "#0000ff", "#0000a0", "#80ff80"],
  cloak: ["#c0ff80", "#80ff00", "#408000", "#00ff80", "#00a050", "#004020"],
} as const satisfies Record<string, readonly string[]>;

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
  pose: BodyPose,
): CharacterFrameName {
  if (isWalkPose(pose)) return `${bodyLayer(body, facing)}-${pose}`;
  return pose === "seated" ? `${bodyLayer(body, facing)}-seated` : `${bodyLayer(body, facing)}-attack-${pose}`;
}

/** The one downed frame, lying on its back with the head to the left. Hair and hats rotate to meet it. */
export function downedFrame(body: CharacterBody): CharacterFrameName {
  return `body-${body}-downed`;
}

/** Hair has one frame per facing, named after its layer. */
export function hairFrame(style: HairStyle, facing: CharacterFacing): CharacterFrameName {
  return hairLayer(style, facing);
}

/** A hat has art facing down and up. Side-on it wears its front, which every hat draws symmetric. */
export function hatFrame(hat: HatId, facing: CharacterFacing): CharacterFrameName {
  return `hat-${hat}-${facing === "up" ? "up" : "down"}`;
}

export function cloakFrame(part: CloakPart): CharacterFrameName {
  return `cloak-${part}`;
}

export interface CharacterFrame {
  name: CharacterFrameName;
  /** The authored layer this frame is baked from. */
  layer: CharacterLayerName;
  /** The walk pose the baker derives from the layer; every other frame is baked as authored. */
  pose: WalkPose;
  width: number;
  height: number;
}

interface StandingFrame {
  name: CharacterFrameName;
  layer: CharacterLayerName;
  pose: WalkPose;
}

const standing = (frames: readonly StandingFrame[]): CharacterFrame[] =>
  frames.map((frame) => ({ ...frame, width: CHARACTER_FRAME_WIDTH, height: CHARACTER_FRAME_HEIGHT }));

/**
 * Every frame the sheet holds, in packing order: each body's facings and poses, then each hair. The
 * downed frames come last, since they are the ones that are not a standing frame's size.
 */
export const CHARACTER_FRAMES: readonly CharacterFrame[] = [
  ...standing([
    ...CHARACTER_BODIES.flatMap((body) =>
      CHARACTER_FACINGS.flatMap((facing) => [
        ...WALK_POSES.map((pose) => ({
          name: bodyFrame(body, facing, pose),
          layer: bodyLayer(body, facing),
          pose,
        })),
        ...(["seated", ...ATTACK_PHASES] as const).map((pose) => ({
          name: bodyFrame(body, facing, pose),
          layer: bodyFrame(body, facing, pose),
          pose: "stand" as const,
        })),
      ]),
    ),
    ...HAIR_STYLES.flatMap((style) =>
      CHARACTER_FACINGS.map((facing) => ({
        name: hairFrame(style, facing),
        layer: hairLayer(style, facing),
        pose: "stand" as const,
      })),
    ),
    ...HAT_IDS.flatMap((hat) =>
      (["down", "up"] as const).map((facing) => ({
        name: hatFrame(hat, facing),
        layer: hatFrame(hat, facing),
        pose: "stand" as const,
      })),
    ),
    ...CLOAK_PARTS.map((part) => ({ name: cloakFrame(part), layer: cloakFrame(part), pose: "stand" as const })),
  ]),
  ...CHARACTER_BODIES.map((body) => ({
    name: downedFrame(body),
    layer: downedFrame(body),
    pose: "stand" as const,
    width: LYING_FRAME_WIDTH,
    height: LYING_FRAME_HEIGHT,
  })),
];

const STANDING_FRAME_COUNT = CHARACTER_FRAMES.filter((frame) => frame.height === CHARACTER_FRAME_HEIGHT).length;
const STANDING_BAND_HEIGHT = Math.ceil(STANDING_FRAME_COUNT / SHEET_COLUMNS) * CHARACTER_FRAME_HEIGHT;

/** Every layer the source art must author, each exactly once. The baker validates against this. */
export const CHARACTER_LAYERS: readonly CharacterLayerName[] = [
  ...new Set(CHARACTER_FRAMES.map((frame) => frame.layer)),
];

export const CHARACTER_SHEET_WIDTH = SHEET_COLUMNS * CHARACTER_FRAME_WIDTH;
export const CHARACTER_SHEET_HEIGHT = STANDING_BAND_HEIGHT + LYING_FRAME_HEIGHT;

export interface CharacterFrameRect {
  /** Left edge in the sheet, in art pixels. */
  x: number;
  /** Top edge in the sheet, in art pixels. */
  y: number;
}

const FRAME_RECTS = new Map<CharacterFrameName, CharacterFrameRect>([
  ...CHARACTER_FRAMES.filter((frame) => frame.height === CHARACTER_FRAME_HEIGHT).map(
    (frame, index): [CharacterFrameName, CharacterFrameRect] => [
      frame.name,
      {
        x: (index % SHEET_COLUMNS) * CHARACTER_FRAME_WIDTH,
        y: Math.floor(index / SHEET_COLUMNS) * CHARACTER_FRAME_HEIGHT,
      },
    ],
  ),
  ...CHARACTER_FRAMES.filter((frame) => frame.height !== CHARACTER_FRAME_HEIGHT).map(
    (frame, index): [CharacterFrameName, CharacterFrameRect] => [
      frame.name,
      { x: index * LYING_FRAME_WIDTH, y: STANDING_BAND_HEIGHT },
    ],
  ),
]);

/** Where a frame sits in the sheet. A standing frame is `CHARACTER_FRAME_WIDTH` by `_HEIGHT`, a downed one `LYING_FRAME_WIDTH` by `_HEIGHT`. */
export function characterFrameRect(name: CharacterFrameName): CharacterFrameRect {
  const rect = FRAME_RECTS.get(name);
  if (!rect) throw new Error(`Unknown character frame: ${name}`);
  return rect;
}

/**
 * The look a player's composite is built for: what they designed, the party colour the server gave
 * them, and the cosmetics they wear. A cosmetic id the client has no art for is drawn as none.
 */
export interface CharacterLook {
  body: CharacterBody;
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairColor: HairColor;
  partyColor: PartyColor;
  hat: string | null;
  cloak: string | null;
  dye: string | null;
}

/** How a player is drawn: their design, party colour and cosmetics. Null while still designing. */
export function lookOf(player: Pick<PlayerState, "appearance" | "partyColor" | "cosmetics">): CharacterLook | null {
  if (!player.appearance) return null;
  return { ...player.appearance, partyColor: player.partyColor, ...player.cosmetics };
}

/** Nothing worn: the cosmetics of a look built for a player wearing none. */
export const NO_COSMETIC_LOOK = { hat: null, cloak: null, dye: null } as const;

export interface DrawnCosmetics {
  hat: HatId | null;
  cloak: CloakId | null;
  dye: DyeId | null;
}

/** What a look actually draws: its cosmetics, with any the client has no art for dropped. */
export function drawnCosmetics(look: CharacterLook): DrawnCosmetics {
  return {
    hat: isOneOf(HAT_IDS, look.hat) ? look.hat : null,
    cloak: isOneOf(CLOAK_IDS, look.cloak) ? look.cloak : null,
    dye: isOneOf(DYE_IDS, look.dye) ? look.dye : null,
  };
}

/** One string per distinct composite. Every field that changes a pixel must be in it. */
export function characterLookKey(look: CharacterLook): string {
  const { hat, cloak, dye } = drawnCosmetics(look);
  return [
    look.body,
    look.skinTone,
    look.hairStyle,
    look.hairColor,
    look.partyColor,
    dye ?? "-",
    hat ?? "-",
    cloak ?? "-",
  ].join("|");
}

/**
 * Which colour each legendary flicker shows, as bits: 1 for the hat's lit colours, 2 for the
 * cloak's. Always zero for a look with nothing that flickers, so it keeps a single composite.
 */
export type FlickerPhase = number;

function flickerBit(palette: CosmeticPalette, timeMs: number): number {
  if (!palette.flicker) return 0;
  return Math.floor(timeMs / palette.flicker.periodMs) % 2;
}

/** The flicker phase of a look at a moment, each legendary item on its own period. */
export function flickerPhase(look: CharacterLook, timeMs: number): FlickerPhase {
  const { hat, cloak } = drawnCosmetics(look);
  const hatBit = hat ? flickerBit(HAT_PALETTES[hat], timeMs) : 0;
  const cloakBit = cloak ? flickerBit(CLOAK_PALETTES[cloak], timeMs) : 0;
  return hatBit | (cloakBit << 1);
}

/** The first hair row a look's hat leaves showing, `HIDE_ALL_HAIR`, or null to keep all of it. */
export function hairClipRow(look: CharacterLook): number | null | typeof HIDE_ALL_HAIR {
  const { hat } = drawnCosmetics(look);
  return hat ? HAT_HAIR_CLIP_ROWS[hat] : null;
}

function rgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/**
 * Each key colour, as `0xrrggbb`, mapped to the real colour this look swaps it for. Fixed colours
 * are absent, which is what leaves them drawn as baked.
 */
export function characterSwaps(look: CharacterLook, phase: FlickerPhase = 0): ReadonlyMap<number, number> {
  const { hat, cloak, dye } = drawnCosmetics(look);
  const ramps: Record<CharacterRamp, ColourRamp> = {
    skin: SKIN_RAMPS[look.skinTone],
    hair: HAIR_RAMPS[look.hairColor],
    // A dye replaces the tunic. The ring at the feet keeps the party colour.
    tunic: dye ? DYE_RAMPS[dye] : PARTY_PALETTES[look.partyColor].tunic,
  };
  const swaps = new Map<number, number>();
  for (const ramp of Object.keys(CHARACTER_KEY_COLOURS) as CharacterRamp[]) {
    CHARACTER_KEY_COLOURS[ramp].forEach((key, index) => swaps.set(rgb(key), rgb(ramps[ramp][index]!)));
  }

  const swapCosmetic = (keys: readonly string[], palette: CosmeticPalette, lit: boolean): void => {
    keys.forEach((key, index) => {
      const colour = (lit ? palette.flicker?.colours[index] : undefined) ?? palette.colours[index];
      if (colour) swaps.set(rgb(key), rgb(colour));
    });
  };
  if (hat) swapCosmetic(COSMETIC_KEY_COLOURS.hat, HAT_PALETTES[hat], (phase & 1) !== 0);
  if (cloak) swapCosmetic(COSMETIC_KEY_COLOURS.cloak, CLOAK_PALETTES[cloak], (phase & 2) !== 0);
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
const STANDING_COMPOSITE_WIDTH = CHARACTER_FACINGS.length * BODY_POSES.length * CHARACTER_FRAME_WIDTH;
export const COMPOSITE_WIDTH = STANDING_COMPOSITE_WIDTH + LYING_FRAME_WIDTH;
export const COMPOSITE_HEIGHT = 2 * CHARACTER_FRAME_HEIGHT;

export function compositeCell(
  facing: CharacterFacing,
  pose: BodyPose,
  blinking: boolean,
): CharacterFrameRect {
  const column = CHARACTER_FACINGS.indexOf(facing) * BODY_POSES.length + BODY_POSES.indexOf(pose);
  return {
    x: column * CHARACTER_FRAME_WIDTH,
    y: blinking ? CHARACTER_FRAME_HEIGHT : 0,
  };
}

/** Where the downed figure sits in a composite: after every standing cell, a lying frame's size. Eyes stay shut. */
export function lyingCell(): CharacterFrameRect {
  return { x: STANDING_COMPOSITE_WIDTH, y: 0 };
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
  ...NO_COSMETIC_LOOK,
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
export function createCompositeCache<T>(build: (look: CharacterLook, phase: FlickerPhase) => T) {
  const composites = new Map<string, T>();
  return {
    /** A legendary flicker is one more composite per phase, rather than a repaint every frame. */
    get(look: CharacterLook, phase: FlickerPhase = 0): T {
      const key = `${characterLookKey(look)}#${phase}`;
      let composite = composites.get(key);
      if (composite === undefined) {
        composite = build(look, phase);
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

/** What a character is doing beyond walking, in the order it takes over from standing. */
export interface CharacterStance {
  /** Downed: drawn lying. A carried player is downed too. */
  downed: boolean;
  seated: boolean;
  /** The swing in progress, from the server's resolved arc, or null. */
  swing: { heading: number; progress: number } | null;
}

export const STANDING: CharacterStance = { downed: false, seated: false, swing: null };

/** The attack frame at a point through a swing: its first third is the wind-up, then the strike, then the recover. */
export function attackPhase(progress: number): AttackPhase {
  const index = Math.floor(Math.min(Math.max(progress, 0), 0.999) * ATTACK_PHASES.length);
  return ATTACK_PHASES[index]!;
}

export type DrawnPose =
  | { lying: true }
  | { lying: false; facing: CharacterFacing; mirror: boolean; pose: BodyPose };

/**
 * What to draw for a character: lying if downed, otherwise a swing's attack frame facing the way it
 * was struck, otherwise seated, otherwise the walk pose. Downed beats everything, since a downed
 * player can neither sit nor swing.
 */
export function pickDrawnPose(
  direction: { x: number; y: number },
  moving: boolean,
  timeMs: number,
  stance: CharacterStance = STANDING,
): DrawnPose {
  if (stance.downed) return { lying: true };
  if (stance.swing) {
    const heading = { x: Math.cos(stance.swing.heading), y: Math.sin(stance.swing.heading) };
    return { lying: false, ...characterFacing(heading), pose: attackPhase(stance.swing.progress) };
  }
  if (stance.seated) return { lying: false, ...characterFacing(direction), pose: "seated" };
  return { lying: false, ...pickCharacterPose(direction, moving, timeMs) };
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
