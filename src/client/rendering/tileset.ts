import { SHEET_HEIGHT, SHEET_WIDTH, spriteRect, type SpriteName } from "./tiles.js";

/**
 * Loads the baked tilesheet and stamps sprites out of it.
 *
 * Split from `tiles.ts` on purpose: everything here touches the DOM, and `tiles.ts` is imported by
 * both the node test environment and `scripts/buildSprites.ts`, neither of which has one.
 */

/**
 * Vite rewrites this to the hashed asset URL at build time and serves it from the repo at dev time,
 * so `assets/sprites/` stays the one place the art lives, per `AGENTS.md`.
 */
const SHEET_URL = new URL("../../../assets/sprites/dungeon.png", import.meta.url).href;

/**
 * How far discovered-but-unlit geometry is knocked back.
 *
 * Applied once at load to a second copy of the sheet rather than per draw. A per-tile
 * `globalAlpha` over a black background would do the same thing, but it costs a state change on
 * every tile in the viewport, and remembered geometry is most of the screen once a party has
 * explored a wing.
 */
const DIM_OVERLAY = "rgba(6, 7, 10, 0.74)";

export interface Tileset {
  /**
   * False until the sheet has decoded. The renderer keeps its flat-colour path for those first
   * frames, so a slow decode shows a plain dungeon rather than an empty screen.
   */
  readonly ready: boolean;
  /** Stamps a sprite into a destination rect in screen pixels. Rounds to whole pixels itself. */
  draw(
    ctx: CanvasRenderingContext2D,
    name: SpriteName,
    x: number,
    y: number,
    width: number,
    height: number,
    dim?: boolean,
  ): void;
}

function bakeDimmedCopy(sheet: CanvasImageSource): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, 0, 0);
  // `source-atop` leaves transparent pixels transparent, so a torch flame keeps its shape when the
  // player is only remembering the torch rather than looking at it.
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = DIM_OVERLAY;
  ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);

  return canvas;
}

export function loadTileset(onReady?: () => void): Tileset {
  let lit: CanvasImageSource | null = null;
  let dimmed: CanvasImageSource | null = null;

  const image = new Image();
  image.decoding = "async";
  image.onload = (): void => {
    lit = image;
    dimmed = bakeDimmedCopy(image) ?? image;
    onReady?.();
  };
  image.onerror = (): void => {
    // Not fatal. `ready` stays false and the renderer keeps drawing flat colours, which is a
    // playable dungeon rather than a black screen.
    console.error(`Could not load the tilesheet from ${SHEET_URL}; drawing flat tiles instead.`);
  };
  image.src = SHEET_URL;

  return {
    get ready(): boolean {
      return lit !== null;
    },

    draw(ctx, name, x, y, width, height, dim = false): void {
      const sheet = dim ? dimmed : lit;
      if (!sheet) return;

      const rect = spriteRect(name);
      // Snapped to whole pixels at both edges rather than rounding the origin and keeping the
      // width, so neighbouring tiles share an edge exactly. Rounding each independently leaves a
      // one-pixel gap wherever the two land on opposite sides of a boundary, which reads as a grid
      // of hairline cracks across the floor.
      const left = Math.round(x);
      const top = Math.round(y);

      ctx.drawImage(
        sheet,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        left,
        top,
        Math.round(x + width) - left,
        Math.round(y + height) - top,
      );
    },
  };
}
