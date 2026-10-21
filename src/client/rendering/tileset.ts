import { recolourPixels } from "./characters.js";
import { spriteRect, type SpriteName } from "./tiles.js";

/**
 * Loads the baked tilesheet and stamps sprites out of it.
 *
 * Split from `tiles.ts` on purpose: everything here touches the DOM, and `tiles.ts` is imported by
 * both the node test environment and `scripts/buildSprites.ts`, neither of which has one.
 *
 * Sprites are always stamped at full brightness. How dark a tile is - lit, remembered, or unseen -
 * is the renderer's lightmap's job, laid over the whole frame in one pass.
 */

/**
 * Vite rewrites this to the hashed asset URL at build time and serves it from the repo at dev time,
 * so `assets/sprites/` stays the one place the art lives, per `AGENTS.md`.
 */
export const SHEET_URL = new URL("../../../assets/sprites/dungeon.png", import.meta.url).href;

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
  ): void;
  /**
   * Stamps a sprite with some of its colours swapped, as `recolourPixels` takes them. `swapKey`
   * names the swap, so each recoloured sprite is built once and reused.
   */
  drawSwapped(
    ctx: CanvasRenderingContext2D,
    name: SpriteName,
    swapKey: string,
    swaps: ReadonlyMap<number, number>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
}

export function loadTileset(onReady?: () => void): Tileset {
  let sheet: CanvasImageSource | null = null;
  const swapped = new Map<string, HTMLCanvasElement>();

  const swappedSprite = (name: SpriteName, swapKey: string, swaps: ReadonlyMap<number, number>) => {
    const key = `${name}|${swapKey}`;
    const cached = swapped.get(key);
    if (cached || !sheet) return cached ?? null;

    const rect = spriteRect(name);
    const canvas = document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(sheet, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    const pixels = context.getImageData(0, 0, rect.width, rect.height);
    recolourPixels(pixels.data, swaps);
    context.putImageData(pixels, 0, 0);
    swapped.set(key, canvas);
    return canvas;
  };

  const image = new Image();
  image.decoding = "async";
  image.onload = (): void => {
    sheet = image;
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
      return sheet !== null;
    },

    draw(ctx, name, x, y, width, height): void {
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

    drawSwapped(ctx, name, swapKey, swaps, x, y, width, height): void {
      const sprite = swappedSprite(name, swapKey, swaps);
      if (!sprite) return;
      const left = Math.round(x);
      const top = Math.round(y);
      ctx.drawImage(sprite, left, top, Math.round(x + width) - left, Math.round(y + height) - top);
    },
  };
}
