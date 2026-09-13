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

Movement is paced per player with a leaky bucket. Each accepted move books one `MOVE_INTERVAL_MS`
(one server tick), and a move may arrive up to `MOVE_BURST_TOLERANCE_MS` (one interval) ahead of
that schedule. Speed is a rate, so enforcing it per message would let a client move as fast as it can
send intents, and each accepted move would also trigger a party-wide broadcast. The tolerance exists
because network jitter bunches evenly sent intents, and a strict gap would drop legitimate moves and
desync the client's prediction. Early intents are refused with `actionRejected` / `onCooldown`.
Pacing uses a monotonic clock, and blocked moves book no time.

The step, collision, and pacing constants live in `src/shared/game/movement.ts`. The server resolves
moves with it and the client predicts with the same functions, so a prediction cannot disagree with
the server about step size or what blocks a move. The client sends one intent per `MOVE_INTERVAL_MS`
while movement keys are held, keeps its prediction while intents are in flight, and adopts the
snapshot position once they settle or the two drift more than one unit apart.

New players spawn on the first spawn point nobody is standing on, falling back to any free floor.
Spawning by party size put a new arrival on top of a player who stayed after someone else left.
Player collision only blocks moves that close the gap, so players who somehow overlap can still step
apart instead of both being stuck.

`stateSnapshot` now includes the dungeon payload, so `PROTOCOL_VERSION` is bumped to 2. Clients use
the snapshot dungeon when present and keep their placeholder only as pre-join fallback rendering.

## Consequences

Combat, pickup, door interaction, exits, and monster behavior can now resolve against server-owned
state instead of adding new client guesses.
