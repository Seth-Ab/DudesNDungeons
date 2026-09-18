# 0009 - Pixel-Art Tiles and Props

Date: 2026-09-18
Status: Accepted

## Context

Frontend step 7 left one item open: the renderer drew the dungeon as flat coloured rectangles, and
`GAMEDESCRIPTION.md` asks for pixel art and for a dungeon that "looks like a duengon, with varried
rooms with duengon themed decorations". Pixel art is a resolved opinion checkpoint.

Backend step 13 made the item worth much more. An authored `content/` tile became a 4x4 block of
world tiles, so it now draws at 128 screen pixels instead of 48. There is a real canvas where before
there was a flat square.

`assets/` held nothing but four `.gitkeep` files, so this had to decide where the art comes from as
much as how it is drawn.

## Decision

**The art is authored as text and baked to a PNG.** `assets/sprites/source/dungeon.tiles.json` holds
a palette and one character per pixel; `npm run build:sprites` writes `assets/sprites/dungeon.png`.
Both are committed and `tests/client/spriteSheet.test.ts` re-bakes and compares bytes.

The alternative was generating textures at runtime, which leaves `assets/sprites/` empty and gives a
human artist no file to replace, or committing opaque binaries, which cannot be reviewed or
regenerated. Text art is reviewable the way `content/` is: a pull request that moves a flagstone
shows which pixels moved. The PNG stays the artifact the browser loads, so an artist who prefers a
paint program can overwrite it and never read the JSON.

**One declaration of what the sheet holds.** `src/client/rendering/tiles.ts` owns the sprite list,
the packing, and the rules for choosing a sprite. It has no DOM references, so the baker, the
renderer, and the node test environment all read the same file. A sprite named there and missing
from the art fails the bake; a sprite in the art that nothing asks for fails it too.

**The sixteen wall cells are composed, not authored.** The baker builds them from one fill and four
edge strips, indexed by which sides continue as wall. Drawn by hand, the corner cells would have
drifted a pixel from the straight cells beside them, and it would only have surfaced on a stretch of
wall nobody had walked yet. The south face is painted over the side lips, which is why there are no
corner sprites at all.

**Scale.** 16 art pixels per world tile, drawn at 2x. `pixelsPerWorldUnit` is 32, exactly twice the
sprite size, so the art lands on a whole-pixel grid. Moving it off a multiple of 16 puts the tiles
back on fractional pixels.

**Scope.** Tiles and static props only. Players and monsters stay flat figures; Frontend step 6
already owns sprites, and directional character art is a larger job than this step's wording covers.

## Consequences

- No protocol change. Everything here reads state the client already receives.
- The sheet is 1.4 kB, under Vite's inline limit, so it ships as a data URI inside the bundle rather
  than as a second request.
- The renderer keeps its flat-colour path for the frames before the sheet decodes and for a sheet
  that never arrives, so a failed load is a plain dungeon rather than a black screen.
- Adding a tile character is a one-line change in `tileLook`. Until then an unrecognised character
  draws as lit floor, which is the forgiving direction: drawing a wall where there is none would
  tell a player they cannot walk somewhere the server will let them walk.

## Two bugs this found

Both are fallout from Backend step 13 turning single-tile things into 4x4 blocks, and both were
found by looking at the result in a browser rather than by reading the code.

**No closed door was ever sent to a client.** `isOpaque` treats every tile a closed door covers as
opaque, including the door's own. `hasLineOfSight` exempted the single target tile, which was right
while a door was one tile; with sixteen, the other fifteen stood between the viewer and the door's
centre. The centre tile never entered `discoveredTiles`, and the door filter in `visibilityFrame`
keys on exactly that tile. The exemption now covers the whole door being looked at. Sight still
stops at the door: `tests/server/visibility.test.ts` pins both halves.

**No locked door could be opened from the UI.** The server measures interact reach to the nearest
point of a door's span, which step 13 fixed deliberately. The client still measured to the door's
centre, two world units further in, so standing at the face it refused to send the interact the
server would have accepted. The geometry is now `distanceToDoor` in `src/shared/game/movement.ts`
and both sides call it, which is what `AGENTS.md` asks for and what would have prevented the drift.
