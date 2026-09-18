# 0009 - Hub World and Run Lifecycle

- Status: Accepted
- Date: 2026-09-17

## Context

`GAMEDESCRIPTION.md` says players begin in a hub where they can prepare and store items, then enter
a dark generated dungeon and escape back to the hub. The code instead created every session inside
an active dungeon, automatically equipped every player with a torch, respawned downed players after
five seconds, and made an exit set a `cleared` boolean without changing worlds.

The owner clarified that the hub is a shared social, quest, and strategy area; the whole group must
be ready before entering. Torches are deliberate pickups in the hub or sparse dungeon loot. A player
who forgets one must complete that run without personal torchlight.

## Decision

### One party, one place

A `Session` has a server-owned `location` of `hub` or `dungeon`. All reserved members share it. A
standing player may use the hub gate only when every member is connected and ready. Starting builds
a fresh run and resets readiness. Fresh joins receive `runInProgress` during a run; a known resume
token still reconnects to its reserved slot.

`content/dungeons/hub.json` is a lit, monster-free authored map with named quest, strategy, supply,
and gate areas. It uses only `#` and `.`, preserving the content/rendering boundary while pixel-art
tiles are developed independently.

### Torches are a preparation choice

`torch` is a content item kind, but pickup equips `carryingTorch` directly rather than using one of
the three inventory slots. The hub contains four one-use pickups and generated halls may rarely
spawn another. Starting a run does not grant a torch. Returning to the hub removes the old torch so
the next run again requires a deliberate pickup.

### Escape, loss, and storage

Using the dungeon exit immediately replaces the run with a rebuilt hub. Each standing player banks
their carried inventory; each downed player loses theirs. The bank is server-owned and session-local.
Backend step 11 will move it into the persistent device profile and provide the lasting progression
contract.

Timed respawn is removed. Downed players remain down for Backend step 12's revive and carry
mechanics. If every reserved player is down, the server wipes the party to the hub and nobody banks
their current carry. Health and stamina recover for the hub; resistance does not, preserving the
rule that only consumables and skills raise it.

## Protocol Version 8

Breaking changes:

- `stateSnapshot.location` is `hub` or `dungeon`;
- `playerState.carryingTorch` reports the separate equipped torch;
- `playerState.bankedItems` reports the session-local bank;
- `runInProgress` is a join error;
- `torch` is an item kind;
- `dungeonState.cleared` is removed because exiting now changes worlds.

## Consequences

- The backend lifecycle does not touch `src/client/rendering/` or `assets/`; Task 2 can replace flat
  tiles independently.
- The current client can move, ready, pick up visible torches, and use the already-rendered exit. A
  dedicated hub/storage/run-outcome UI remains Frontend step 9.
- Quest behavior is not implemented here. The hub supplies a named space for it without inventing a
  quest contract before that system is designed.
