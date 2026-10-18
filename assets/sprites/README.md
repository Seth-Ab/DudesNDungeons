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
  `door-lock`, `loot-key`, `loot-tonic`, `loot-ward`, `loot-skill-scroll`, `loot-weapon` (any weapon
  without its own art), `loot-rusted-sword`, `loot-arrow` (any ammo), `loot-torch`,
  `chest-closed`, `chest-open` (a locked chest adds `door-lock` over its face), `exit-stairs`.

Players and monsters are still drawn as flat figures. They are Frontend step 6.

## Scale

Art is authored at 16 pixels per world tile and drawn at 2x, so a world tile is 32 screen pixels and
one authored `content/` tile - a `TILE_SCALE` block - is 128. Keep the renderer's
`pixelsPerWorldUnit` a multiple of 16 or the art stops landing on whole pixels.
