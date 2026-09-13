---
name: protocol-contract-change
description: Use when changing DudesNDungeons shared protocol messages, schemas, payload shapes, WebSocket events, or frontend/backend contract assumptions.
---

# Protocol Contract Change

Use this skill for changes that affect how the DudesNDungeons client and server talk to each other.

## Contract Sources

Inspect the current contract before editing:

- `src/shared/protocol/` for zod schemas, inferred TypeScript types, serialization, and parsing.
- `src/shared/types/` and `src/shared/constants/` for branded IDs, vectors, protocol version, limits, and gameplay constants.
- `src/server/gameServer.ts` for server handling and broadcasts.
- `src/client/network/` and frontend state/rendering code for client assumptions.
- `tests/shared/`, `tests/server/`, and `tests/e2e/` for expected behavior.

## Change Rules

Keep zod schemas as the runtime source of truth. Do not add a TypeScript-only message shape without validation. If a field is client-sent, assume it is untrusted and validate size, range, enum values, and required session state.

When a message changes, update every relevant surface:

- shared schema and exported type;
- server handler, broadcast, or error behavior;
- frontend sender/consumer;
- tests for valid messages, malformed messages, and edge cases;
- docs or PR contract notes when another contributor must adapt.

Bump `PROTOCOL_VERSION` in `src/shared/constants/game.ts` only for breaking changes that make old clients incompatible.

## Review Checklist

Before finishing, run the relevant checks:

- `npm run typecheck`
- `npm test`
- `npm run build` when frontend or shared browser code is affected

Call out contract changes explicitly in the PR template under `Backend / Frontend Contract Notes`.
