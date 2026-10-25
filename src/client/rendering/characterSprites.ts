import { PLAYER_RADIUS } from "../../shared/game/movement.js";
import type { Vector2 } from "../../shared/types/core.js";
import { PARTY_PALETTES } from "./characterPalettes.js";
import {
  CHARACTER_FACINGS,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  HIDE_ALL_HAIR,
  PORTRAIT_SIZE,
  SILHOUETTE_COLOUR,
  SILHOUETTE_LOOK,
  BODY_POSES,
  CARRIED_LIFT_PX,
  LYING_FRAME_HEIGHT,
  LYING_FRAME_WIDTH,
  STANDING,
  bodyFrame,
  characterFrameRect,
  characterSwaps,
  cloakFrame,
  closeEyes,
  compositeCell,
  createBlinkClock,
  createCompositeCache,
  createMotionTracker,
  downedFrame,
  drawnCosmetics,
  flickerPhase,
  headDrop,
  lyingCell,
  hairClipRow,
  hairFrame,
  hatFrame,
  pickDrawnPose,
  portraitRect,
  recolourPixels,
  silhouettePixels,
  type CharacterLook,
  type CharacterStance,
  type FlickerPhase,
} from "./characters.js";

/**
 * Loads the character sheet and draws players from it.
 *
 * Split from `characters.ts` the way `tileset.ts` is split from `tiles.ts`: everything here needs a
 * canvas, and everything there runs under node. This module only moves pixels; which frame to
 * draw, what colour to swap and when to blink are decided there.
 */

/** Served by Vite from `assets/sprites/`, like the tilesheet. */
export const CHARACTER_SHEET_URL = new URL(
  "../../../assets/sprites/characters.png",
  import.meta.url,
).href;

/** How transparent a disconnected player is drawn. A downed one is drawn lying down, opaque. */
const FADED_ALPHA = 0.45;

/** The frame pixel a character stands on: bottom centre, on the last row. */
const ANCHOR_X = 8;
const ANCHOR_ROW = 23;

const labelColors = {
  outline: "#0b0b0b",
};

/** A player as the renderer wants them drawn this frame. */
export interface DrawnPlayer {
  id: string;
  look: CharacterLook;
  facing: Vector2;
  /** Where they are drawn, in world units: predicted for the local player, interpolated for others. */
  position: Vector2;
  label: string;
  /** Disconnected. */
  faded: boolean;
  /** Downed, seated or mid-swing; absent for a player just standing or walking. */
  stance?: CharacterStance;
  /** Carried by another player: drawn lifted above the carrier, and over them. */
  carried?: boolean;
}

function createSurface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

/**
 * The 13 x 5 ring at a character's feet, centred on the anchor pixel. Only the top and bottom of
 * the ellipse are drawn, so the floor shows through it. Ported from the sprite bible's `ring()`.
 */
function drawRing(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  px: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let x = -6; x <= 6; x += 1) {
    const rise = Math.round(2.4 * Math.sqrt(Math.max(0, 1 - (x / 6.6) ** 2)));
    ctx.fillRect(centerX + x * px, centerY - rise * px, px, px);
    ctx.fillRect(centerX + x * px, centerY + rise * px, px, px);
  }
}

/**
 * One canvas per look holding every frame it can show, already recoloured and layered back to
 * front, with a blinking copy of each. Drawing a player is then a single stamp. The design screen
 * and the wardrobe preview build theirs here too, so neither can disagree with the world.
 *
 * Layer order is the sprite bible's: a cloak behind (facing down), the body, a cloak's back (facing
 * up), hair clipped by the hat, a clasp (facing down), then the hat. Side-on a cloak is not drawn,
 * as in the bible, and a hat wears its front.
 */
export function buildCharacterComposite(
  sheet: CanvasImageSource,
  look: CharacterLook,
  phase: FlickerPhase = 0,
): HTMLCanvasElement {
  const { canvas, context } = createSurface(COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
  const { hat, cloak } = drawnCosmetics(look);
  const clip = hairClipRow(look);
  const cells = CHARACTER_FACINGS.flatMap((facing) =>
    BODY_POSES.flatMap((pose) =>
      [false, true].map((blinking) => ({
        facing,
        pose,
        blinking,
        cell: compositeCell(facing, pose, blinking),
        drop: headDrop(pose),
      })),
    ),
  );
  /**
   * Stamps frame rows `fromRow` to the bottom of one frame at a cell, `drop` rows lower. What the
   * drop would push past the cell's bottom is cut, so it never lands in the cell beneath.
   */
  const stamp = (frame: string, x: number, y: number, fromRow = 0, drop = 0, target = context): void => {
    const rect = characterFrameRect(frame);
    const rows = CHARACTER_FRAME_HEIGHT - fromRow - drop;
    if (rows <= 0) return;
    target.drawImage(sheet, rect.x, rect.y + fromRow, CHARACTER_FRAME_WIDTH, rows, x, y + fromRow + drop, CHARACTER_FRAME_WIDTH, rows);
  };

  for (const { facing, pose, cell } of cells) stamp(bodyFrame(look.body, facing, pose), cell.x, cell.y);

  const lying = lyingCell();
  const lyingRect = characterFrameRect(downedFrame(look.body));
  context.drawImage(sheet, lyingRect.x, lyingRect.y, LYING_FRAME_WIDTH, LYING_FRAME_HEIGHT, lying.x, lying.y, LYING_FRAME_WIDTH, LYING_FRAME_HEIGHT);

  // Eyes close on the bare body, before hair could cover a pixel beside one. A seated head is lower.
  const bodies = context.getImageData(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
  for (const { blinking, cell, drop } of cells) {
    if (blinking) closeEyes(bodies.data, COMPOSITE_WIDTH, cell.x, cell.y + drop);
  }
  context.putImageData(bodies, 0, 0);

  /**
   * Draws standing-frame layers turned onto their side into the downed cell, head to the left, so a
   * hat or a head of hair meets the downed body wherever it sits on the standing one.
   */
  const upright = createSurface(CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT);
  const stampLying = (draw: (target: CanvasRenderingContext2D) => void): void => {
    upright.context.clearRect(0, 0, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT);
    draw(upright.context);
    context.save();
    context.translate(lying.x, lying.y + LYING_FRAME_HEIGHT);
    context.rotate(-Math.PI / 2);
    context.drawImage(upright.canvas, 0, 0);
    context.restore();
  };

  if (cloak) {
    // Slipped in under the body already drawn, rather than drawn first, so the eye scan above saw
    // the body alone.
    context.globalCompositeOperation = "destination-over";
    for (const { facing, cell, drop } of cells) {
      if (facing === "down") stamp(cloakFrame("behind"), cell.x, cell.y, 0, drop);
    }
    stampLying((target) => stamp(cloakFrame("behind"), 0, 0, 0, 0, target));
    context.globalCompositeOperation = "source-over";
    for (const { facing, cell, drop } of cells) {
      if (facing === "up") stamp(cloakFrame("back"), cell.x, cell.y, 0, drop);
    }
  }

  if (clip !== HIDE_ALL_HAIR) {
    for (const { facing, cell, drop } of cells) stamp(hairFrame(look.hairStyle, facing), cell.x, cell.y, clip ?? 0, drop);
    stampLying((target) => stamp(hairFrame(look.hairStyle, "down"), 0, 0, clip ?? 0, 0, target));
  }

  for (const { facing, cell, drop } of cells) {
    if (cloak && facing === "down") stamp(cloakFrame("clasp"), cell.x, cell.y, 0, drop);
    if (hat) stamp(hatFrame(hat, facing), cell.x, cell.y, 0, drop);
  }
  stampLying((target) => {
    if (cloak) stamp(cloakFrame("clasp"), 0, 0, 0, 0, target);
    if (hat) stamp(hatFrame(hat, "down"), 0, 0, 0, 0, target);
  });

  const pixels = context.getImageData(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
  recolourPixels(pixels.data, characterSwaps(look, phase));
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** Loads the character sheet once per caller. The browser caches the file, so a second load is free. */
function loadCharacterSheet(onLoad: (sheet: HTMLImageElement) => void): void {
  const image = new Image();
  image.decoding = "async";
  image.onload = (): void => onLoad(image);
  image.onerror = (): void => {
    // Not fatal: players keep a flat party-coloured stand-in and portraits stay blank.
    console.error(`Could not load the character sheet from ${CHARACTER_SHEET_URL}.`);
  };
  image.src = CHARACTER_SHEET_URL;
}

export function createCharacterSprites(onReady?: () => void) {
  let sheet: HTMLImageElement | null = null;
  loadCharacterSheet((image) => {
    sheet = image;
    onReady?.();
  });

  const composites = createCompositeCache((look, phase) => buildCharacterComposite(sheet!, look, phase));

  const motion = createMotionTracker();
  const blinks = createBlinkClock();

  return {
    /**
     * Players in front overlap those behind: drawn by where their feet are, top to bottom, with
     * every name over every figure so a crowd stays legible.
     */
    draw(
      ctx: CanvasRenderingContext2D,
      players: readonly DrawnPlayer[],
      toScreen: (position: Vector2) => Vector2,
      pixelsPerWorldUnit: number,
      now: number,
    ): void {
      const px = pixelsPerWorldUnit / CHARACTER_FRAME_WIDTH;
      // Anyone carried is drawn last, over their carrier, whatever their row.
      const ordered = [...players].sort(
        (a, b) => Number(a.carried ?? false) - Number(b.carried ?? false) || a.position.y - b.position.y,
      );
      const feet = ordered.map((player) =>
        toScreen({ x: player.position.x, y: player.position.y + PLAYER_RADIUS }),
      );

      ordered.forEach((player, index) => {
        const at = feet[index]!;
        const lift = player.carried ? CARRIED_LIFT_PX * px : 0;
        const left = Math.round(at.x - ANCHOR_X * px);
        const top = Math.round(at.y - (ANCHOR_ROW + 1) * px - lift);
        const palette = PARTY_PALETTES[player.look.partyColor];
        const moving = motion.moving(player.id, player.position, now);

        ctx.globalAlpha = player.faded ? FADED_ALPHA : 1;
        drawRing(ctx, left + ANCHOR_X * px, top + ANCHOR_ROW * px, px, palette.ring);

        if (!sheet) {
          // A stand-in the size of the body until the sheet decodes.
          ctx.fillStyle = palette.tunic[1];
          ctx.fillRect(left + 3 * px, top + 8 * px, 10 * px, 16 * px);
          return;
        }

        const pose = pickDrawnPose(player.facing, moving, now, player.stance ?? STANDING);
        const composite = composites.get(player.look, flickerPhase(player.look, now));

        if (pose.lying) {
          // Head to the left, feet on the anchor row, centred on the character's own column.
          const cell = lyingCell();
          ctx.drawImage(
            composite,
            cell.x,
            cell.y,
            LYING_FRAME_WIDTH,
            LYING_FRAME_HEIGHT,
            Math.round(at.x - (LYING_FRAME_WIDTH / 2) * px),
            Math.round(at.y - LYING_FRAME_HEIGHT * px - lift),
            LYING_FRAME_WIDTH * px,
            LYING_FRAME_HEIGHT * px,
          );
          return;
        }

        const cell = compositeCell(pose.facing, pose.pose, blinks.blinking(player.id, now));
        const width = CHARACTER_FRAME_WIDTH * px;
        const height = CHARACTER_FRAME_HEIGHT * px;

        if (pose.mirror) {
          ctx.save();
          ctx.translate(left + width, top);
          ctx.scale(-1, 1);
          ctx.drawImage(composite, cell.x, cell.y, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT, 0, 0, width, height);
          ctx.restore();
        } else {
          ctx.drawImage(composite, cell.x, cell.y, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT, left, top, width, height);
        }
      });

      // Names stay a fixed size: a label is read, not inhabited, so it is not part of the world.
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = labelColors.outline;
      ordered.forEach((player, index) => {
        const at = feet[index]!;
        ctx.globalAlpha = player.faded ? FADED_ALPHA : 1;
        ctx.fillStyle = PARTY_PALETTES[player.look.partyColor].ring;
        ctx.strokeText(player.label, at.x, at.y + 16);
        ctx.fillText(player.label, at.x, at.y + 16);
      });
      ctx.globalAlpha = 1;
    },
  };
}

/**
 * Paints party-frame portraits from the same composites the world draws, so a portrait is the
 * player as teammates see them. `onReady` fires once the sheet decodes, since portraits asked for
 * before then are left blank and need repainting.
 */
export function createCharacterPortraits(onReady?: () => void) {
  let sheet: HTMLImageElement | null = null;
  loadCharacterSheet((image) => {
    sheet = image;
    onReady?.();
  });

  const composites = createCompositeCache((look, phase) => buildCharacterComposite(sheet!, look, phase));
  let silhouette: HTMLCanvasElement | null = null;

  const silhouetteComposite = (): HTMLCanvasElement => {
    if (silhouette) return silhouette;
    silhouette = buildCharacterComposite(sheet!, SILHOUETTE_LOOK);
    const context = silhouette.getContext("2d")!;
    const pixels = context.getImageData(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    silhouettePixels(pixels.data, SILHOUETTE_COLOUR);
    context.putImageData(pixels, 0, 0);
    return silhouette;
  };

  return {
    /** A canvas sized for one portrait, scaled up by CSS. */
    createCanvas(): HTMLCanvasElement {
      return createSurface(PORTRAIT_SIZE, PORTRAIT_SIZE).canvas;
    },

    /**
     * A null look is a player still designing, drawn as a grey silhouette. Until the sheet loads
     * this only clears.
     */
    paint(canvas: HTMLCanvasElement, look: CharacterLook | null): void {
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
      if (!sheet) return;

      const composite = look ? composites.get(look) : silhouetteComposite();
      const rect = portraitRect();
      context.drawImage(composite, rect.x, rect.y, PORTRAIT_SIZE, PORTRAIT_SIZE, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
    },
  };
}
