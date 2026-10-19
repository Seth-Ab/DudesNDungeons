/**
 * Bakes `assets/sprites/source/dungeon.tiles.json` into `assets/sprites/dungeon.png`, and
 * `assets/sprites/source/characters.tiles.json` into `assets/sprites/characters.png`.
 *
 * Run with `npm run build:sprites` after editing the source art, and commit the PNGs alongside it.
 * `tests/client/spriteSheet.test.ts` and `tests/client/characterSheet.test.ts` fail if they ever
 * disagree.
 *
 * The bakes themselves live in `spriteSheet.ts` and `characterSheet.ts`; this is only the command
 * around them.
 */

import { writeFileSync } from "node:fs";

import {
  CHARACTER_FRAMES,
  CHARACTER_SHEET_HEIGHT,
  CHARACTER_SHEET_WIDTH,
} from "../src/client/rendering/characters.js";
import { SHEET_HEIGHT, SHEET_WIDTH, SPRITE_NAMES } from "../src/client/rendering/tiles.js";
import {
  bakeCharacterSheet,
  CHARACTER_SHEET_PATH,
  readCharacterSourceArt,
} from "./characterSheet.js";
import { bakeSheet, readSourceArt, SHEET_PATH, SpriteSourceError } from "./spriteSheet.js";

try {
  // Both are baked before either is written, so a broken source leaves neither sheet half-updated.
  const tiles = bakeSheet(readSourceArt());
  const characters = bakeCharacterSheet(readCharacterSourceArt());

  writeFileSync(SHEET_PATH, tiles);
  console.log(
    `buildSprites: wrote a ${SHEET_WIDTH}x${SHEET_HEIGHT} sheet of ${SPRITE_NAMES.length} sprites ` +
      `(${tiles.length} bytes) to assets/sprites/dungeon.png`,
  );

  writeFileSync(CHARACTER_SHEET_PATH, characters);
  console.log(
    `buildSprites: wrote a ${CHARACTER_SHEET_WIDTH}x${CHARACTER_SHEET_HEIGHT} sheet of ` +
      `${CHARACTER_FRAMES.length} character frames (${characters.length} bytes) to ` +
      "assets/sprites/characters.png",
  );
} catch (error) {
  if (!(error instanceof SpriteSourceError)) throw error;
  console.error(`buildSprites: ${error.message}`);
  process.exit(1);
}
