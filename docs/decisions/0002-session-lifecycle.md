# 0002 - Session Lifecycle and Reconnection

- Status: Accepted
- Date: 2026-09-12

## Context

Backend Dev step 2 asks for dungeon instance records, player join/leave/reconnect/disconnect
handling, tracked player identity and state, and authoritative broadcasts.

The step 1 protocol could not express reconnection. `joinSession` carried only a protocol version,
a room code, and a player name, so a returning client was indistinguishable from a stranger. Two
other details written in step 1 pointed at a design that had not been finished: `playerState`
carries a `connected` flag, and `playerLeftReason` included both `disconnected` and `timedOut`.
Those only make sense if a dropped player can linger in the roster.

## Decision

### A disconnect is not a departure

A dropped socket marks the player `connected: false` and starts a grace window
(`RECONNECT_GRACE_MS`, 60s). The player keeps their slot, position, health, and ready state. If the
window expires, the slot is released and the party is told `playerLeft` with reason `timedOut`.

60 seconds is long enough to survive a browser refresh or a brief network drop, and short enough
that a four-slot party is not held hostage by someone who closed the tab.

Because a disconnect is now transient, two protocol changes followed:

- Added `playerConnectionChanged { playerId, connected }`, so clients can grey a player out rather
  than removing them.
- Removed `disconnected` from `playerLeftReason`. With a grace window, no disconnect removes a
  player directly, so emitting that reason was impossible. The terminal reasons are `left` and
  `timedOut`.

### Reconnection uses a bearer token

`sessionJoined` now returns a `resumeToken` (16 random bytes, hex) and a `resumed` flag.
`joinSession` accepts an optional `resumeToken`. Presenting a token for a disconnected slot in the
same room reclaims it with its game state intact.

A token was chosen over trusting a client-supplied player id because a player id is broadcast to
the whole party in `playerJoined` and every `stateSnapshot`. Anything every client already knows
cannot also be the thing that proves who you are. The token is therefore sent **only** in its
owner's own `sessionJoined` and is never broadcast; `toPlayerState()` is the single conversion into
the public shape and drops it.

Two edge cases:

- A token for a slot that is **still connected** is refused with `alreadyInSession`. Otherwise a
  leaked token would let a party member kick and impersonate another.
- A token that matches **nothing** falls through to a fresh join rather than erroring, so a client
  returning from a long outage still lands in the dungeon instead of having to retry without it.

On resume, game state (position, health, ready) is preserved but the display name is taken from the
new `joinSession`, since the name is presentation the player may have changed.

### Rooms are created over HTTP, joined over WebSocket

`POST /sessions` creates a dungeon and returns `{ sessionId, roomCode }`. `joinSession` only ever
joins an existing room and answers `sessionNotFound` otherwise.

The lobby needs a shareable code *before* anyone connects, which is an HTTP-shaped request. Letting
`joinSession` auto-create a room instead would mean a typo'd room code silently strands a player
alone in a new dungeon rather than telling them the code was wrong.

Room creation is unauthenticated, so an empty session is dropped after `EMPTY_SESSION_TTL_MS`
(10 minutes). Without that, repeated calls to `POST /sessions` would grow the session map without
bound.

### Session rules are kept out of the transport

`SessionStore` holds no socket types. It takes plain requests, returns plain results, and receives
its clock and id generators through the constructor. `src/server/index.ts` owns sockets and
translates store results into protocol messages.

This is what lets `tests/server/sessions.test.ts` drive the whole lifecycle — including a 60-second
grace window — deterministically and without opening a port.

### State is broadcast on a tick

Each session carries a monotonic `tick`. Every `SERVER_TICK_MS` the server sends `stateSnapshot` to
sessions with at least one connected player. Right now nothing moves between ticks, so snapshots
are redundant with the join and leave events; the loop exists because step 3 adds movement to it and
clients should be reading from snapshots from the start rather than switching sources later.

## Consequences

- Clients must store the `resumeToken` from `sessionJoined` (session storage, not local storage:
  it is a credential, and the slot it unlocks expires in a minute anyway) and send it back when
  reconnecting.
- Clients must handle `playerConnectionChanged` and must not treat it as a removal.
- A party can look full while a slot is held by someone who has disconnected but not yet timed out.
  This is intentional: their position and loot are still reserved.
- Sessions live in process memory, so a server restart drops every dungeon. Acceptable for a
  prototype; a second server instance would need shared storage, which deployment (step 6) revisits.
