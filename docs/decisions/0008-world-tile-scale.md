# 0008 - World Tile Scale

- Status: Accepted
- Date: 2026-09-17

## Context

`GAMEDESCRIPTION.md` asks for levels that "are large in scale to allow players to lose eachother",
rooms that "can be large and sparce", and a map so dark that a player "can only see a small area
arround themselves".

Watching the first playable demo, none of that held. Every authored tile was one world unit and a
player's body is 0.7 units across, so a corridor authored one tile wide fitted exactly one person
with 0.15 units of clearance on each side. A party of four filed down it single file and could not
pass each other. Rooms were a dozen units across, which a torch reaching 4.2 units lit most of. The
dungeon read as cramped rather than dark, and four people in it were never apart long enough for
proximity voice to mean anything.

The room templates themselves were not the problem. They are the right shape and the right thing for
a designer to edit: a dozen characters wide, readable in a diff, with doorways a person can place by
counting. What was wrong was the assumption that one authored character is one world unit.

## Decision

### An authored tile is `TILE_SCALE` world tiles on each side

`TILE_SCALE` is 4, so one authored tile becomes a 4x4 block and a dungeon covers sixteen times the
area it reads as. `content/` is untouched by this: templates stay the size they were, and a generated
world grows from 96x64 to 384x256.

Consequences that are the point of the change:

- A corridor authored one tile wide is four world units across, about five player widths. Four
  people walk it abreast and can slip past each other.
- A room interior of 12x6 authored tiles is 48x24 world units. A party that splits up inside one is
  genuinely separated.
- The player's body does not change. Neither does reach, which is a body's length rather than a
  distance across the map, so `PLAYER_ATTACK_RANGE` and `INTERACT_RANGE` are as they were.

### Only coordinates scale

`src/server/game/scale.ts` is the single place that knows the world is bigger than the page. It takes
a built dungeon and multiplies tile coordinates, room bounds, and door spans; it does not touch
anything already measured in world units.

That split is the rule for `content/`: `x`, `y`, `width`, `height`, and tile rows are authored tiles;
a light's radius, a monster's speed, and its reach are world units, written as they will be used. The
alternative - scaling every number by the same factor - would have made it impossible to light the
dungeon differently from how it was lit before, which is the second half of this decision.

Scaling at the end rather than inside the generator keeps generation cheap and unchanged. It lays
rooms out, routes corridors, and scatters loot entirely in authored tiles, where a corridor is one
tile wide and the breadth-first search through the padding between rooms is small.

### Movement and light grow by less than the map

Two numbers were chosen deliberately against the tile scale rather than with it.

`PLAYER_MOVE_SPEED` goes from 2.5 to 6 world units per second, not to 10. Crossing the dungeon takes
about 1.7 times as long as it did rather than four times, which reads as expansive without a run
overrunning the recorded 15-20 minute target.

Light grows by `LIGHT_SCALE`, which is 3: a carried torch goes from 4.2 to 12.6 units, fixed lights
from 3.2 to 9.6, monster glow from 2.4 to 7.2, and the content files' own radii are rewritten to
match. Scaling light by the full four would have lit the same fraction of the map as before and left
the dungeon feeling no darker; at three, a torch covers rather less of a room than it used to. Voice
falloff follows light rather than tiles for the same reason: it is already gated on visibility, so
someone lit at the edge of a torch should still be audible.

These light and voice values were later cut further after a playtest (issue #60, 2026-10-04): a
torch now reaches 8 units. `PROGRESS.md` records the current values and the reasoning.

### A door carries the width of its opening

`DoorState` gained `size`, the number of world tiles the doorway spans. A closed door is tested as a
square around its centre by collision and by line of sight, and reach to it is measured to the
nearest point of that square rather than to its centre.

Without this the scale change would have quietly broken the only gate in the game twice over: a
closed door would have plugged one world tile of the sixteen it used to fill, so a party could walk
around it; and its centre would have been two units inside the doorway while `INTERACT_RANGE` is 1.2,
so a party standing at the face of a locked door could not open it.

### Snapshots carry a window, not the whole map

`DungeonMapState` gained `originX` and `originY`. `width` and `height` are still the whole world, so
a client knows the bounds it is moving inside; `tiles` is now only the window around the viewer,
`SNAPSHOT_VIEW_RADIUS_TILES` (64) in each direction.

Sixteen times the tiles meant a snapshot went from 6,144 characters to 98,304, built and deflated per
player per tick. The window is 129 tiles across: over 4000px at the renderer's zoom and ten times the
torch radius, so no player can see or walk to its edge before the next snapshot replaces it.

Measured on a generated run with four players: 9.4 ms per tick against the 50 ms budget, and 9.6 kB
per snapshot before deflate.

Line of sight was rewritten at the same time. It sampled each ray every 0.2 units, which was five
samples per tile crossed; at this scale a torch reaches thirteen tiles and every light covers sixteen
times the area, so it now walks the grid one tile boundary at a time and visits each tile the ray
passes through exactly once. Room discovery was moved to the moment a tile is first lit, because
rescanning every room's tiles each tick was affordable when a room was a hundred tiles and is not now
that it is two thousand.

### The renderer draws in world units

Pixels per world unit drops from 48 to 32, so an authored tile still draws at 128px while the player
is a fifth of the width of the corridor they stand in. Entities are sized in world units rather than
fixed pixels, so they keep their proportions if the zoom changes again; names stay a fixed size,
because a label is read rather than inhabited. Tiles are clipped to the viewport, which a 384x256 map
makes mandatory, and the grid is ruled every `TILE_SCALE` units so it reads as masonry rather than as
graph paper.

## Consequences

- Protocol v7, breaking. `dungeonMapState` gained `originX` and `originY`; `doorState` gained `size`.
- `content/` is unchanged in shape. A designer keeps authoring templates at a readable size, and the
  only content edits this change made were to the numbers that are in world units: light radii, and
  monster speeds and perception.
- Tests name the authored tile they mean and convert through `at()` in `tests/server/fixtures.ts`,
  so another change of scale does not rewrite every assertion.
- Reach is now small relative to a tile. Loot sits at the centre of a 4x4 block and a player has to
  walk to it rather than near it. That is intended, but it is the thing most likely to want tuning
  once there is a second playtest.
- The step-12 work on traps and cooperative puzzles now has room to use: a pressure plate two people
  must hold is a different object in a 48x24 room than in a 12x6 one.
