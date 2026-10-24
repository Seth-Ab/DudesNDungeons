# 0016 - Dungeon Generator v2

- Status: Accepted
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
