# 0016 - Dungeon Generator v2

- Status: Accepted
- Supersedes: the layout section of [0007](0007-content-and-generation.md)
- Date: 2026-10-23

## Context

Today's generator chains rooms in reading order with one template per landmark, so every run starts
in the same room, solves the same puzzle, and fights the same boss. The Dungeon Design Bible
(`docs/design/dungeon-design-bible.html`, which also holds the reference generator `GEN`) is the
design for replacing it. Every ticket in the generator v2 series builds on a handful of choices, so
they are recorded first. The owner accepted every recommendation in issue #243 on 2026-10-23.

## Decision

1. **Grid layout.** Rooms sit on a 6x4 grid of 16-tile cells with sockets at the side midpoints,
   instead of free placement. Corridors stay inside the gap between two rooms, so they cannot cross
   rooms or bypass locks.
2. **One floor.** A run is one floor through Phase 4. A Descent option at the exit is a later
   decision, because it changes how runs save (#122, #231, decision 0015).
3. **Map alphabet.** Keep `#` and `.` only through Phases 1 to 3. Locks, switches and traps are
   entities. Water, chasms and pit rooms would be a coordinated content, collision, protocol and
   renderer change, so they must earn their place later.
4. **Omen visibility.** A run's flow-independent omens show on the hub quest board before the party
   readies up. Biome and flow stay hidden until the party is inside.
5. **Small parties.** Generation never asks for more plates than there are players, spawns Ballast
   Stones for the missing hands, and filters group-only content (Split Seal, Pale Twins) below two
   players.
6. **Biome scope.** One biome per run, with Cinder Depths only in Phase 1. Revisit per-depth biomes
   only if Descent ships.
7. **Proposed content.** The biomes, bosses, puzzles, traps and omens listed in the design bible are
   approved as a menu, not a commitment. The owner pulls items into the series one issue at a time,
   since each needs art and new monsters.

## Consequences

- The series is listed as Backend 14 in `STEPS.md`; Phase 1 is backend only and changes no protocol.
- No linked ticket changes scope, because every decision went the recommended way.
- `GAMEDESCRIPTION.md` is untouched.

## Shipped pipeline

Design source: the [Dungeon Design Bible](https://claude.ai/artifact/NPMxae19nMZRk6VStMphXf)
(`docs/design/dungeon-design-bible.html`, Porting guide). This section records what Phase 1 built
(#244 to #253); where it differs from the bible, this record is the behaviour. `vault-run` is a
`delve` profile (`layout: "delve"`), and `generation/delve.ts` runs seven stages:

1. **Recipe.** Reads the run seed directly. Draws a flow (weighted, among the profile's flows whose
   `minParty` the party meets) and a biome, so a retry never changes the run's flow or biome.
2. **Layout** (`layout.ts`). Walks a self-avoiding critical path over the 6x4 grid, grows the flow's
   branches, then adds loops between rooms at least three hops apart. The boss and exit get none.
3. **Roles** (`roles.ts`). Fixes entrance, boss and exit, puts the boss lock on the edge in front of
   the boss, puts the key on the farthest free dead end beyond the lock (a puzzle reward, a branch's
   loot or a guarded room, by `keySource`), and fills other rooms from the biome's `roomWeights`
   with no kind twice in a row on the critical path and no trap straight after the entrance.
4. **Room shapes** (`roomShapes.ts`, `delve.ts`). Each room is, half the time when one fits its
   cell, a Cinder Depths template rotated and mirrored (`transform: true`), otherwise a procedural
   shape (plain, pillars, block, cross, ring, octagon, partition, alcoves, braided maze, cavern).
   Every room has midpoint sockets and an odd size.
5. **Carve** (`carve.ts`). Stamps each room into its cell with jitter inside the margin and joins
   every graph edge socket to socket with a corridor that jogs once inside the gap. It never writes
   the outer ring, and fails (for a retry) when no jog keeps a corridor clear of the others.
6. **Populate** (`populate.ts`). Places the boss door, lights, four entrance spawn points, the
   exit, monsters from a threat budget, the boss and its vault chest, the key, role-based loot,
   chests, traps, and puzzle plates plus Ballast Stones for the missing hands.
7. **Validate** (`validate.ts`). Flood-fills the real tiles; any error discards the attempt.

Stages 2 to 7 read `mixSeed(seed, attempt)`. A failed stage or failed validation retries from the
next attempt, up to the profile's `maxAttempts`, then generation throws naming the seed, party
size and flow. Generation is a pure function of seed and party size.

### Invariants as shipped

Checked by `validateDungeon` on every attempt and swept in `tests/server/generationSweep.test.ts`
(1,000 seeds for each party size 1 to 4, plus every flow; mutation tests confirm a key in the boss
room or locks never placed are rejected):

- every spawn, entity, plate, door and exit is on open floor, and no two share a tile;
- with every lock closed, the boss room cannot be entered;
- collecting keys and solving puzzles in any reachable order opens a route to the exit, and every
  room is reachable by the end;
- the first spawn point stands inside a light;
- no puzzle needs more plates held than the party has players plus Ballast Stones.

### Differences from the design

- `maxAttempts` is 200, not the bible's 40. Layout and roles alone succeed about 31% of the time
  for `gauntlet` and about 11% for `long-loop`; no seed in 8,000 needed more than 200 attempts, and
  a run still builds in about 1.3 ms. Raising those rates is a possible follow-up.
- Only the `key` boss lock (key sources `puzzle`, `branch`, `arena`) can be built
  (`GENERATOR_BOSS_LOCKS`). `seals` and `split-seal` load as content but fail startup if used, so
  Split Seal gating from decision 5 waits for its own issue.
- A puzzle's plate count is fixed (a paired-levers puzzle has two); a smaller party is covered by
  Ballast Stones, not by changing the plate count. Threat scales with party size.
- Vaults (#257): the run seed's own stream (`mixSeed(seed, 1000003)`, so omens and attempts never
  move it) decides from the flow's `vaultChance` whether the run has one. A run that does adds one
  branch to the layout, takes the farthest dead end left after the boss key's for a `vault` room
  behind a `vault-key` door in its own wall (no lights, one or two `vault-chest` chests, no
  guards), and puts an elite in a hall, cavern, maze or arena that holds neither key. The elite is
  a roster monster of cost 2 or less with 3x health and 1.5x damage that always drops the key (it
  is never placed on the floor); validation reads its tile as the place the key is picked up, so a
  key carried inside or behind the vault door fails. If no layout in the first 120 attempts holds
  a vault the run builds without one rather than fail.
- Only today's room kinds, plus vaults, are generated. Shrines, camps, secrets and arenas (the rest
  of Phase 2) and omens (Phase 3) are not part of this record.
- `ember-vault` stays an authored map that tests build on. The old `generated` chain layout
  remains in code but no shipped content uses it.
