# Sprites

`dungeon.png` is the tilesheet the client draws the dungeon with. It is a build product: the art is
authored as text in `source/dungeon.tiles.json` and baked with `npm run build:sprites`. Commit both,
and `tests/client/spriteSheet.test.ts` fails if they ever disagree.

Authoring as text is what makes the art reviewable. A pull request that moves a flagstone shows
which pixels moved, the same way `content/` shows which monster got faster.

An artist who would rather use a paint program can overwrite `dungeon.png` directly. Nothing in the
client reads the source JSON, so the only rule is that each sprite stays in the cell
`src/client/rendering/tiles.ts` reserves for it.

## The source format

```json
{
  "tileSize": 16,
  "palette": { "0": "transparent", "1": "#07080a" },
  "sprites": {
    "floor-0": { "tilesWide": 1, "tilesHigh": 1, "rows": ["6666...", "14*6777..."] }
  }
}
```

- One palette character per pixel. `0` is transparent by convention; every other character is
  opaque `#rrggbb`, or `#rrggbbaa` for a translucent shade laid over whatever is beneath it (the
  forest canopy's shadow is the only one so far).
- A row may be prefixed with `N*` to repeat it N times. A palette character is never `*`, so the
  prefix is unambiguous. This is what keeps regular masonry and the stairs readable.
- `tilesWide`/`tilesHigh` are in world tiles. A sprite's rows must expand to exactly
  `tilesWide * 16` by `tilesHigh * 16` pixels or the bake fails and names the sprite.

## What is in the sheet

`src/client/rendering/tiles.ts` is the one list of what the sheet holds and where each sprite sits.
The baker reads it, so adding a sprite means adding it there and authoring it here; a name in one
and not the other fails the bake rather than drawing a hole in the floor.

- `floor-0` to `floor-3`: flagstones. A tile picks one from a hash of its coordinates, weighted
  heavily to plain, so damage is rare enough to be worth noticing.
- `wall-0` to `wall-15`: **composed, not authored.** The baker builds all sixteen from `wall-fill`
  and the four `wall-edge-*` strips, indexed by which sides continue as wall. Composing guarantees
  the lip on a corner cell lines up with the lip on the straight cell beside it. The south face is
  painted last, over the side lips, which is why there are no separate corner sprites.
- `forest-0` to `forest-15`: the `forest` map theme's walls, which the hub uses, composed from
  `forest-fill` and `forest-edge-*` exactly as the stone ones are. `tiles.ts` names each theme's
  prefixes in `THEME_SPRITES`; the forest shares the stone floor, which the hub covers with ground.
  `forest-edge-s` is empty: the canopy overhang below carries that edge instead.
- `crypt-*`, `fungal-*` and `ossuary-*`: the biome themes' walls (`<theme>-0` to `-15`, composed from
  `<theme>-fill` and `-edge-*` like the stone ones) and their floors, `<theme>-floor-0` to `-3`.
  Crypt is drowned blue-grey with damp sheens, fungal is mossy earth with glowing spores, and ossuary
  is pale bone pressed into brown masonry. Their palette uses punctuation and Greek or Cyrillic letters, since the Latin ones ran out.
- Ground, for a map's `ground` grid (see `content/README.md`): `cobble-0` to `cobble-3`,
  `grass-0` to `grass-2` and `dirt-0` to `dirt-1`. Grass and dirt pick a variant from a weighted
  hash, like the flagstones. Cobble picks by checkerboard: even tiles take `cobble-0` or `-1` and
  odd tiles `-2` or `-3`, so no two tiles that share an edge are ever the same stone. The four
  cobbles share every stone within three pixels of their edges, which is what lets a stone cross a
  seam into whichever variant is next door, so the tile grid never shows as a line.
- `grass-edge-1` to `-15` and `forest-overhang-1` to `-15`: **composed, not authored**, like the
  walls, from four strips each (`grass-edge-n`/`-e`/`-s`/`-w`, `forest-overhang-n`/...). The number
  is the sides with something to draw, with the wall-mask bits (north 1, east 2, south 4, west 8);
  `tiles.ts` lists the sets in `EDGE_OVERLAY_SETS`. A grass edge is the ragged fringe grass lays
  one tile deep onto the cobble or dirt beside it, with `grass-corner-ne`/`-se`/`-sw`/`-nw` where
  grass only touches at a diagonal. An overhang is the forest canopy reaching half a tile out over
  any floor tile beside it, with a 25% strip of shade beyond. Translucent strips are composed
  before opaque ones, so one side's shade falls under another side's leaves, not across them.
- Map props, one per kind at the footprint `src/shared/constants/scenery.ts` gives it: `prop-fountain`
  (twelve tiles square: a basin, a pedestal and an upper bowl),
  `prop-stall-ember`/`-moss`/`-azure`/`-plum` (one per awning `tint`), `prop-quest-board`,
  `prop-tree`, `prop-bush`, `prop-dungeon-gate` (its opening sits over the exit tile, where the
  stairs are drawn on top of it) `prop-sign` and `prop-hanging-lantern` (one tile wide, two tall, hung from an awning), `prop-bench`, `prop-log` and `prop-campfire` (a ring of stones; the campfire light draws its logs and flame in the middle). Bench, log and campfire are four tiles square, the authored tile they stand on, with the picture across its middle. `campfire-logs` is the ground under a campfire light; its flame is `torch-flame`. Props stand on the ground with no backdrop or
  shadow of their own: the renderer draws each one's contact shadow, from `MAP_PROP_SHADOWS`.
- A stall or bench that faces north has its own sprite, drawn from behind, named with `-north`:
  `prop-stall-<tint>-north` keeps the front's awning over a back wall of planks, and
  `prop-bench-north` shows the seat beyond the backrest.

### The hub's colour ramps

Every ramp is hue-shifted rather than a tint of one colour: shadows lean cool, highlights warm, as
if all of it shared one warm light from above. Big surfaces keep their ramps close together and
quiet, so whatever a player can use carries the accent colour.

| Ramp            | Characters        | Shadow to highlight                                          |
| --------------- | ----------------- | ------------------------------------------------------------ |
| cobble          | `! % & ( ) +`     | gap `#3b2c3c`, plum-grey `#54464f` up to ochre `#a88c5e`      |
| grass           | `: ; < = >`       | teal `#284e4a` up to yellow-green `#8ea245`                   |
| dirt            | `? @ [ ]`         | plum `#3f3138` up to tan `#91714d`                            |
| forest          | `p q r t u`       | `#081216` to `#2a5243`: darker and cooler than the grass, so the boundary recedes |
| tree and bush   | `{ \| } ~ _`       | `#183632` to `#74983f`: between the forest and the grass       |
| fountain stone  | `$ - /`           | warm grey `#5e5059` to `#ab9c8a`, lit like the cobble          |
| canopy shade    | `^`               | `#0b0f1c40`: a cool near-black at 25%                          |
| stall awnings   | `Q R`, `W V`, `Y X`, `s Z` | ember, moss, azure and plum, each shadow then main, over the shared cream `S T` |
- Props: `torch-pillar`, `torch-flame`, `glow-mote`, `door-closed-h`/`-v`, `door-jamb-h`/`-v`,
  `door-lock`, `loot-key`, `loot-tonic`, `loot-ward`, `loot-draught`, `loot-flare`, `loot-salts`,
  `flare-lit` (a burning flare's light), `loot-skill-scroll`, `loot-weapon` (any weapon
  without its own art), `loot-rusted-sword`, `loot-arrow` (any ammo), `loot-torch`,
  `chest-closed`, `chest-open` (a locked chest adds `door-lock` over its face), `exit-stairs`.
  `torch-flame` uses only palette `e f g h`, the Hearth flame ramp: a torch flame cosmetic (#138)
  swaps exactly those four colours on a carried torch, so keep the flame to them and keep their
  values in step with `HEARTH_FLAME_RAMP` in `src/client/rendering/characterPalettes.ts`, which a
  test checks.

Monsters are still drawn as flat figures in game; their sprites are still to be designed (Frontend
step 6). Players are drawn from the character sheet below.

## The character sheet

`characters.png` holds the player characters, baked from `source/characters.tiles.json` by the same
`npm run build:sprites`, and `tests/client/characterSheet.test.ts` fails if the two disagree. The
pixel data is ported from the owner-approved `docs/design/character-sprite-bible.html`.

```json
{
  "frameWidth": 16,
  "frameHeight": 24,
  "palette": { "0": "transparent", "k": "#17120c", "S": "#ff60ff" },
  "layers": {
    "body-guy-down": { "rows": ["9*0000000000000000", "00000kkkkkk00000", "..."] }
  }
}
```

- A frame is **16 x 24**: a 16 x 16 body on frame rows 8 to 23, with the eight rows above it as
  headroom for hair and hats. Every layer is a whole frame, so its rows must expand to
  exactly 24 rows of 16 pixels or the bake fails and names the layer. Rows, `N*` and `0` work as in
  the tile source.
- Layers stack in one frame, body first and hair over it. `body-guy` and `body-girl`, and
  `hair-crop`, `-spiky`, `-long`, `-ponytail`, `-bun` and `-shaved`, each come in `down`, `up` and
  `side`. Facing left is `side` mirrored.
- Cosmetics (#137): `hat-<id>-down` and `hat-<id>-up` for each hat in `content/cosmetics/` (side-on
  a hat wears its `down` frame), and one cloak shape in three parts, `cloak-behind` (under the body,
  facing down), `cloak-back` (over the body, facing up) and `cloak-clasp` (at the neck, facing down).
  The renderer draws cloak behind, body, cloak back, hair, clasp, then hat, and hides the hair rows
  above each hat's `HAT_HAIR_CLIP_ROWS` entry in `characters.ts`. A dye has no art: it replaces the
  tunic ramp.
- Bodies are baked in three poses, `stand`, `walk1` and `walk2`, so the renderer only picks a frame.
  The walk frames are **derived, not authored**: `walk1` moves the boot pixels in the right half of
  the frame up one row onto the trousers, and `walk2` does the same for the left half. The cycle is
  stand, walk1, stand, walk2.
- `src/client/rendering/characters.ts` is the one list of layers and frame cells, the way `tiles.ts`
  is for the tilesheet. A layer in one and not the other fails the bake.
- Eyes are baked in the outline colour, so the renderer finds them by position for the blink: an
  outline-colour pixel in the head rows with no transparent neighbour. The girl's lashes count as
  eye pixels and close with them. Keep the head's outline on its silhouette, or a stray dark pixel
  inside the face will blink too.

### Key colours

Skin, hair and tunic are not baked in real colours. Each is baked in a three-step **key colour**
ramp (light, mid, shadow) that the renderer swaps for a player's skin tone, hair colour and party
colour, so one sheet covers every combination.

| Ramp  | Characters | Key colours                     |
| ----- | ---------- | ------------------------------- |
| skin  | `s S T`    | `#ffb0ff` `#ff60ff` `#c000c0`   |
| hair  | `h H G`    | `#b0ffff` `#00ffff` `#00a0a0`   |
| tunic | `C c d`    | `#ffffa0` `#ffff00` `#a0a000`   |

Hats and cloaks use **cosmetic key colours** (`COSMETIC_KEY_COLOURS`), swapped per item from
`HAT_PALETTES` and `CLOAK_PALETTES` in `characterPalettes.ts`, so every cloak shares one shape:

| Ramp  | Characters    | Key colours                                                         |
| ----- | ------------- | ------------------------------------------------------------------- |
| hat   | `7 8 9`       | `#ff8080` `#ff0000` `#a00000`, then accents `R W Y F`: `#8080ff` `#0000ff` `#0000a0` `#80ff80` |
| cloak | `1` to `6`    | `#c0ff80` `#80ff00` `#408000` `#00ff80` `#00a050` `#004020`         |

The bible's hats use `1 2 3` and `r w y f`; they are `7 8 9` and `R W Y F` here so they cannot be
mistaken for the cloak's digits or the ribbon's `r`. A legendary item's one animation is a palette
flicker (`flicker` in its palette), drawn as a second composite rather than repainted every frame.

Every other colour is **fixed** and drawn as baked: outline and eyes `#17120c`, belt `#5c4930`,
buckle `#d6a84c`, trousers `#2b3037`, boots `#3b2f20`, ribbon `#c23b2e` (`CHARACTER_FIXED_COLOURS`).
The bake fails on a palette colour that is neither. A test also checks that no key colour appears in
`dungeon.png`, since recolouring a character would otherwise recolour the floor under it. The key
colours are deliberately garish, so one the renderer forgot to swap is obvious on screen.

## The HUD frame

`hud-frame.png` (16 x 16) and `hud-stud.png` (8 x 8) dress every HUD panel. They are authored in
`source/hud.tiles.json` and baked by `npm run build:sprites`, one PNG per sprite, because CSS
`border-image` and `background-image` each load a whole file. `tests/client/hudSprites.test.ts`
fails if a PNG disagrees with its source.

```json
{
  "palette": { "0": "transparent", "o": "#120d09" },
  "sprites": { "hud-frame": { "width": 16, "height": 16, "rows": ["0oooooooooooooo0", "..."] } }
}
```

- The frame is a 9-slice with a 4 px border: `styles.css` slices it at 4 and draws it at
  `--hud-zoom` times that width. The middle is transparent and never drawn; the panel colour fills
  behind it. Corners may be transparent to chamfer the panel.
- The stud sits on each corner of the border box at `--hud-zoom` times its size.
- `--hud-zoom` is always a whole number (`hudFrameZoom` in `state/hudSettings.ts`: 2, or 3 at the
  largest UI scale), so the art stays on device pixels and `image-rendering: pixelated` keeps it crisp.
- Sizes are declared in `scripts/hudSprites.ts`; change them there and in the CSS together.

## Scale

Art is authored at 16 pixels per world tile and drawn at 2x, so a world tile is 32 screen pixels and
one authored `content/` tile - a `TILE_SCALE` block - is 128. Keep the renderer's
`pixelsPerWorldUnit` a multiple of 16 or the art stops landing on whole pixels.
