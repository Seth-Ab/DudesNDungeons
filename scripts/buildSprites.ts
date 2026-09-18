/**
 * Bakes `assets/sprites/source/dungeon.tiles.json` into `assets/sprites/dungeon.png`.
 *
 * Run with `npm run build:sprites` after editing the source art, and commit the PNG alongside it.
 * `tests/client/spriteSheet.test.ts` fails if the two ever disagree.
 *
 * The bake itself lives in `spriteSheet.ts`; this is only the command around it.
 */

import { writeFileSync } from "node:fs";

import { SHEET_HEIGHT, SHEET_WIDTH, SPRITE_NAMES } from "../src/client/rendering/tiles.js";
import { bakeSheet, readSourceArt, SHEET_PATH, SpriteSourceError } from "./spriteSheet.js";

try {
  const png = bakeSheet(readSourceArt());
  writeFileSync(SHEET_PATH, png);

  console.log(
    `buildSprites: wrote a ${SHEET_WIDTH}x${SHEET_HEIGHT} sheet of ${SPRITE_NAMES.length} sprites ` +
      `(${png.length} bytes) to assets/sprites/dungeon.png`,
  );
} catch (error) {
  if (!(error instanceof SpriteSourceError)) throw error;
  console.error(`buildSprites: ${error.message}`);
  process.exit(1);
}
