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
  opaque `#rrggbb`.
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
- Props: `torch-pillar`, `torch-flame`, `glow-mote`, `door-closed-h`/`-v`, `door-jamb-h`/`-v`,
  `door-lock`, `loot-key`, `loot-tonic`, `loot-ward`, `loot-draught`, `loot-flare`, `loot-salts`,
  `flare-lit` (a burning flare's light), `loot-skill-scroll`, `loot-weapon` (any weapon
  without its own art), `loot-rusted-sword`, `loot-arrow` (any ammo), `loot-torch`,
  `chest-closed`, `chest-open` (a locked chest adds `door-lock` over its face), `exit-stairs`.

Players and monsters are still drawn as flat figures in game. The character sheet below is baked
but not drawn yet; monster sprites are still to be designed. Both are Frontend step 6.

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
  headroom for hair and, later, hats. Every layer is a whole frame, so its rows must expand to
  exactly 24 rows of 16 pixels or the bake fails and names the layer. Rows, `N*` and `0` work as in
  the tile source.
- Layers stack in one frame, body first and hair over it. `body-guy` and `body-girl`, and
  `hair-crop`, `-spiky`, `-long`, `-ponytail`, `-bun` and `-shaved`, each come in `down`, `up` and
  `side`. Facing left is `side` mirrored.
- Bodies are baked in three poses, `stand`, `walk1` and `walk2`, so the renderer only picks a frame.
  The walk frames are **derived, not authored**: `walk1` moves the boot pixels in the right half of
  the frame up one row onto the trousers, and `walk2` does the same for the left half. The cycle is
  stand, walk1, stand, walk2.
- `src/client/rendering/characters.ts` is the one list of layers and frame cells, the way `tiles.ts`
  is for the tilesheet. A layer in one and not the other fails the bake.

### Key colours

Skin, hair and tunic are not baked in real colours. Each is baked in a three-step **key colour**
ramp (light, mid, shadow) that the renderer swaps for a player's skin tone, hair colour and party
colour, so one sheet covers every combination.

| Ramp  | Characters | Key colours                     |
| ----- | ---------- | ------------------------------- |
| skin  | `s S T`    | `#ffb0ff` `#ff60ff` `#c000c0`   |
| hair  | `h H G`    | `#b0ffff` `#00ffff` `#00a0a0`   |
| tunic | `C c d`    | `#ffffa0` `#ffff00` `#a0a000`   |

Every other colour is **fixed** and drawn as baked: outline and eyes `#17120c`, belt `#5c4930`,
buckle `#d6a84c`, trousers `#2b3037`, boots `#3b2f20`, ribbon `#c23b2e` (`CHARACTER_FIXED_COLOURS`).
The bake fails on a palette colour that is neither. A test also checks that no key colour appears in
`dungeon.png`, since recolouring a character would otherwise recolour the floor under it. The key
colours are deliberately garish, so one the renderer forgot to swap is obvious on screen.

## Scale

Art is authored at 16 pixels per world tile and drawn at 2x, so a world tile is 32 screen pixels and
one authored `content/` tile - a `TILE_SCALE` block - is 128. Keep the renderer's
`pixelsPerWorldUnit` a multiple of 16 or the art stops landing on whole pixels.
