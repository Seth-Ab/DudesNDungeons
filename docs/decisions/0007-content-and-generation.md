# 0007 - Content Files and Procedural Generation

- Status: Accepted
- Date: 2026-09-15

## Context

`GAMEDESCRIPTION.md` asks for dungeons "generated from large room templates" that "can be large and
sparce, maze like, have traps or puzzles that encourage cooperative play, and have enemies to fight",
with bosses in some rooms and "one final room ... for the survivors to escape back to a hub world".

Before this change there was one hand-written 16x8 map, `FIXED_DUNGEON`, as a literal in
`src/server/game/dungeonState.ts`. `content/` existed but was empty. `MONSTER_STATS` was keyed by
display name, so two monsters sharing a name would have shared stats. Nothing in the model knew what
a room was, which visibility, boss gating, and template stitching all need.

## Decision

### Content is JSON on disk, validated at startup

`content/` holds monsters, items, room templates, and dungeon definitions as JSON. `AGENTS.md` calls
it "editable game data", so it is data a designer edits and restarts into, not a module that has to
be rebuilt. `src/server/content/schema.ts` is the contract and `loadContent.ts` reads and validates
the whole catalog once at startup.

Bad content fails loudly and names the file and field. Beyond per-file schemas, the loader checks
what a schema cannot see:

- a template spawning a monster or item that does not exist;
- a ragged map, which collision would read past the end of;
- a doorway outside its own template;
- a generated profile asking for a room kind no template provides;
- **a template whose doorways do not connect through its own floor**.

That last one is not hypothetical: the first `sunken-maze` written for this change had its east
doorway opening into a walled-off pocket. The generator happily built dungeons that could not be
finished, and it took a connectivity test to notice. It is invisible by eye on anything maze-shaped
and costs a whole playthrough to find, so the loader checks it now.

The content root is found by walking up to the package root and taking `content/` from there, not by
finding the first directory named `content` - this loader lives in `src/server/content/` and would
otherwise find itself. `CONTENT_DIR` overrides it.

### Two kinds of dungeon

`authored` dungeons place every entity by hand and may pin entity ids. The Ember Vault is one, moved
verbatim out of the old literal, which is what lets the existing tests keep asserting on known
positions and ids. `generated` dungeons name a world size and a list of slots.

Sessions get the generated `vault-run` by default. Tests that assert on a known world ask for
`ember-vault` explicitly.

### Generation is a pure function of its seed

`src/server/game/random.ts` is a seeded mulberry32 stream. Generation never calls `Math.random`:
a seed is drawn once per dungeon and everything downstream, entity ids included, comes from it. The
seed is stored on the session, so a run can be replayed exactly from a bug report. Entity ids are
drawn from the same stream rather than from `randomUUID`, or the same seed would build a
differently-identified dungeon each time; they are not credentials, and resume tokens and room codes
still come from `node:crypto`.

### Corridors route around rooms

A run is a chain: entrance, each slot in order, then the exit, with consecutive rooms joined by a
corridor. The chain is what makes the exit reachable by construction.

Corridors are routed by breadth-first search through the gaps between rooms, not as a straight L.
An L that crosses a room has to either breach its wall or be abandoned, and both are unacceptable: a
breach silently un-gates the locked door that makes the key worth finding, and abandoning the
corridor disconnects the run. Doorways whose outward tile is unusable are skipped, which is what the
`side` field on a doorway is for - a west doorway on a room against the world's edge opens onto
nothing, and picking it strands the corridor before it starts.

Three invariants are swept across 120 seeds in `tests/server/generation.test.ts`, because a
generator that only usually holds them is one that ships an unplayable dungeon to somebody:

- every spawn point is on open floor;
- the exit is unreachable while its door is locked, and reachable once it is open;
- a key is reachable without passing that door.

### Rooms are first-class, and monsters are keyed by type

`dungeonState` gains `rooms`, each with an id, name, kind, and tile bounds. A player only receives
rooms they have discovered part of: sending the full list would hand a client the shape of the
dungeon, including where the boss is, before they explore it.

`monsterState` gains `typeId`. Stats hang off the content id rather than the display name, so two
monsters may share a name.

## Protocol Version 6

Breaking, because `dungeonState` gained a required array and `monsterState` a required field.

- `dungeonState` gains `rooms`, filtered to what the viewer has discovered.
- `monsterState` gains `typeId`, a content id such as `ash-imp`.
- `roomKind` is `entrance`, `hall`, `maze`, `trap`, `puzzle`, `boss`, `exit`, or `corridor`.

## Two Consequences That Needed Fixing Here

Both are regressions this change would otherwise have introduced, caused by the map going from 128
tiles to 6144.

**Visibility was O(every tile x every light).** Fine on a 16x8 room, ruinous on a 96x64 one: it cost
about 4ms per player per tick and was computed twice per player, once for the snapshot and once for
voice. It now scans only the tiles inside each light's own radius, and the frame is computed once and
shared. Measured 4.1ms to 1.9ms per call, at half as many calls.

**Snapshots carried the whole map every tick.** At 96x64 that is about 115 kB/s per player, or 600
kB/s for a four-player party, which no home server will carry. WebSocket permessage-deflate is now
enabled: snapshots are mostly repetition, because nearly every tile is withheld as a blank until a
player explores, so they compress about seventy to one. Measured 114.9 kB/s to 1.6 kB/s on the wire.
Browsers negotiate it natively, so it needs nothing from the client.

Compression is a mitigation, not the fix. Sending the map once on join and then only newly
discovered tiles is still the right answer and is still open.

## Consequences

- Adding a monster, item, or room is a JSON file, not a code change.
- Trap, puzzle, and boss rooms exist as room kinds with templates and content, but traps, puzzle
  objects, and boss gating do nothing yet. That is Backend step 12; this step gives it rooms to
  put them in.
- The hub in Backend step 10 is another authored dungeon, which this already supports.
- The Ember Vault is now test scaffolding as much as content. Changing it changes test expectations.
