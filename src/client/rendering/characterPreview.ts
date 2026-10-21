import type { PartyColor } from "../../shared/types/core.js";
import { PARTY_PALETTES } from "./characterPalettes.js";
import { buildCharacterComposite, CHARACTER_SHEET_URL } from "./characterSprites.js";
import {
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  compositeCell,
  createCompositeCache,
  flickerPhase,
  type CharacterFacing,
  type CharacterLook,
  type WalkPose,
} from "./characters.js";

/**
 * Draws characters for the design screen: one at a time at any scale, over a ring if wanted.
 *
 * It builds the same recoloured composites the world renderer does, from the same pure helpers, so
 * the preview cannot disagree with what a teammate sees.
 */

/** The four turns the preview steps through, in order. Left is `side` mirrored. */
export const PREVIEW_TURNS = [
  { name: "down", facing: "down", mirror: false },
  { name: "right", facing: "side", mirror: false },
  { name: "up", facing: "up", mirror: false },
  { name: "left", facing: "side", mirror: true },
] as const satisfies readonly { name: string; facing: CharacterFacing; mirror: boolean }[];

export interface PreviewPose {
  facing: CharacterFacing;
  mirror: boolean;
  pose: WalkPose;
  blinking: boolean;
}

/** The 13 x 5 party ring at a character's feet, the same one the world draws. */
export function drawPartyRing(
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

export function createCharacterPreview(onReady: () => void) {
  let sheet: HTMLImageElement | null = null;
  const image = new Image();
  image.decoding = "async";
  image.onload = (): void => {
    sheet = image;
    onReady();
  };
  image.onerror = (): void => {
    console.error(`Could not load the character sheet from ${CHARACTER_SHEET_URL}.`);
  };
  image.src = CHARACTER_SHEET_URL;

  const composites = createCompositeCache((look, phase) => buildCharacterComposite(sheet!, look, phase));

  return {
    get ready(): boolean {
      return sheet !== null;
    },

    /**
     * Stamps one frame with its top-left at (`left`, `top`), `px` screen pixels per art pixel. A
     * `crop` draws only those frame rows, for the head-only hair tiles.
     */
    draw(
      ctx: CanvasRenderingContext2D,
      look: CharacterLook,
      pose: PreviewPose,
      left: number,
      top: number,
      px: number,
      crop?: { fromRow: number; rows: number },
    ): void {
      if (!sheet) return;
      const cell = compositeCell(pose.facing, pose.pose, pose.blinking);
      const fromRow = crop?.fromRow ?? 0;
      const rows = crop?.rows ?? CHARACTER_FRAME_HEIGHT;
      const width = CHARACTER_FRAME_WIDTH * px;
      const height = rows * px;
      const source = composites.get(look, flickerPhase(look, performance.now()));
      ctx.imageSmoothingEnabled = false;
      if (pose.mirror) {
        ctx.save();
        ctx.translate(left + width, top);
        ctx.scale(-1, 1);
        ctx.drawImage(source, cell.x, cell.y + fromRow, CHARACTER_FRAME_WIDTH, rows, 0, 0, width, height);
        ctx.restore();
      } else {
        ctx.drawImage(source, cell.x, cell.y + fromRow, CHARACTER_FRAME_WIDTH, rows, left, top, width, height);
      }
    },

    ringColor(partyColor: PartyColor): string {
      return PARTY_PALETTES[partyColor].ring;
    },
  };
}

export type CharacterPreview = ReturnType<typeof createCharacterPreview>;
