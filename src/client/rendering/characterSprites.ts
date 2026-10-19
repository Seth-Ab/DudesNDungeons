import { PLAYER_RADIUS } from "../../shared/game/movement.js";
import type { Vector2 } from "../../shared/types/core.js";
import { PARTY_PALETTES } from "./characterPalettes.js";
import {
  CHARACTER_FACINGS,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  WALK_POSES,
  bodyFrame,
  characterFrameRect,
  characterSwaps,
  closeEyes,
  compositeCell,
  createBlinkClock,
  createCompositeCache,
  createMotionTracker,
  hairFrame,
  pickCharacterPose,
  recolourPixels,
  type CharacterLook,
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

/** How transparent a downed or disconnected player is drawn, until there is a downed frame. */
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
  /** Downed or disconnected. */
  faded: boolean;
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

export function createCharacterSprites(onReady?: () => void) {
  let sheet: HTMLImageElement | null = null;

  const image = new Image();
  image.decoding = "async";
  image.onload = (): void => {
    sheet = image;
    onReady?.();
  };
  image.onerror = (): void => {
    // Not fatal: players keep a flat party-coloured stand-in, which is playable.
    console.error(`Could not load the character sheet from ${CHARACTER_SHEET_URL}.`);
  };
  image.src = CHARACTER_SHEET_URL;

  /**
   * One canvas per look holding every frame it can show, already recoloured, with hair over the
   * body and a blinking copy of each. Drawing a player is then a single stamp.
   */
  const composites = createCompositeCache((look): HTMLCanvasElement => {
    const { canvas, context } = createSurface(COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    const cells = CHARACTER_FACINGS.flatMap((facing) =>
      WALK_POSES.flatMap((pose) =>
        [false, true].map((blinking) => ({ facing, pose, blinking })),
      ),
    );
    const stamp = (frame: string, x: number, y: number): void => {
      const rect = characterFrameRect(frame);
      context.drawImage(
        sheet!,
        rect.x,
        rect.y,
        CHARACTER_FRAME_WIDTH,
        CHARACTER_FRAME_HEIGHT,
        x,
        y,
        CHARACTER_FRAME_WIDTH,
        CHARACTER_FRAME_HEIGHT,
      );
    };

    for (const { facing, pose, blinking } of cells) {
      const cell = compositeCell(facing, pose, blinking);
      stamp(bodyFrame(look.body, facing, pose), cell.x, cell.y);
    }

    // Eyes close on the bare body, before hair could cover a pixel beside one.
    const bodies = context.getImageData(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    for (const { facing, pose, blinking } of cells) {
      if (!blinking) continue;
      const cell = compositeCell(facing, pose, blinking);
      closeEyes(bodies.data, COMPOSITE_WIDTH, cell.x, cell.y);
    }
    context.putImageData(bodies, 0, 0);

    for (const { facing, pose, blinking } of cells) {
      const cell = compositeCell(facing, pose, blinking);
      stamp(hairFrame(look.hairStyle, facing), cell.x, cell.y);
    }

    const pixels = context.getImageData(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT);
    recolourPixels(pixels.data, characterSwaps(look));
    context.putImageData(pixels, 0, 0);
    return canvas;
  });

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
      const ordered = [...players].sort((a, b) => a.position.y - b.position.y);
      const feet = ordered.map((player) =>
        toScreen({ x: player.position.x, y: player.position.y + PLAYER_RADIUS }),
      );

      ordered.forEach((player, index) => {
        const at = feet[index]!;
        const left = Math.round(at.x - ANCHOR_X * px);
        const top = Math.round(at.y - (ANCHOR_ROW + 1) * px);
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

        const pose = pickCharacterPose(player.facing, moving, now);
        const cell = compositeCell(pose.facing, pose.pose, blinks.blinking(player.id, now));
        const width = CHARACTER_FRAME_WIDTH * px;
        const height = CHARACTER_FRAME_HEIGHT * px;
        const composite = composites.get(player.look);

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
