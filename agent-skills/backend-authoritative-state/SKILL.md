---
name: backend-authoritative-state
description: Use when implementing DudesNDungeons server-owned dungeon state, movement validation, sessions, combat rules, snapshots, monsters, loot, or authoritative gameplay behavior.
---

# Backend Authoritative State

Use this skill for backend gameplay work in `src/server/` and shared game rules in `src/shared/`.

## Core Rule

The server is authoritative. Clients send intent; the server validates, mutates state, and broadcasts the result. Do not trust client-sent position, health, loot, combat outcome, ready/session ownership, or voice proximity data.

## Current Backend Shape

- `src/server/gameServer.ts` owns HTTP/WebSocket transport, session joins, ready changes, lifecycle broadcasts, and the 20Hz snapshot loop.
- `src/server/sessions/sessionStore.ts` owns session/player lifecycle and reconnect grace behavior.
- `src/shared/protocol/` validates inbound/outbound message contracts.
- `tests/server/` covers store logic; `tests/e2e/` covers real HTTP/WebSocket behavior.

## Implementation Guidance

For Backend Dev step 3, keep dungeon state deterministic and testable:

- Put transport-free rules in small modules that can be unit tested without sockets.
- Validate movement against map bounds, walls, occupied spaces, and session membership.
- Apply movement/combat/item state on the server, then send snapshots or specific events.
- Keep resume tokens private; never broadcast them in roster or snapshot messages.
- Keep timers injectable or configurable in tests when adding time-dependent behavior.

If a backend change affects client payloads or shared messages, use the protocol contract workflow and update `src/shared/protocol/` plus tests.

## Verification

Run:

- `npm run typecheck:server`
- `npm run lint`
- `npm test`
- `npm run build:server`

E2E tests bind a localhost server; if sandboxing blocks them, rerun with permission rather than weakening the tests.
