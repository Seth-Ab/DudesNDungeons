# 0003: Authoritative Dungeon State

## Status

Accepted.

## Context

Backend Dev step 3 moves the game from session-only snapshots to server-owned dungeon state. The
client already sends movement intent, but previous server builds answered `notImplemented` and
spawned every player at the `{0, 0}` placeholder.

## Decision

Each session owns a cloned fixed dungeon instance, currently the Ember Vault. The instance stores
map metadata, tile rows, monsters, loot, doors, and exits server-side.

`playerMoveIntent` is resolved on the server. The server normalizes direction, applies its own
movement step, rejects zero-length intent, and blocks positions that hit map bounds, walls, other
players, living monsters, or closed doors. Valid movement increments the session tick and
broadcasts a `stateSnapshot`.

`stateSnapshot` now includes the dungeon payload, so `PROTOCOL_VERSION` is bumped to 2. Clients use
the snapshot dungeon when present and keep their placeholder only as pre-join fallback rendering.

## Consequences

Combat, pickup, door interaction, exits, and monster behavior can now resolve against server-owned
state instead of adding new client guesses.
