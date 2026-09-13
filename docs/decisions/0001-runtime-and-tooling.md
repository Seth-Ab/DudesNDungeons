# 0001 - Runtime, Tooling, and Renderer

- Status: Accepted
- Date: 2026-09-12

## Context

All five opinion checkpoints in `STEPS.md` are resolved: pixel art visuals, slow free-roam
movement, hybrid combat (real-time positioning with a turn-like action exchange), always-connected
proximity voice, and a target party size of 4. Backend Dev step 1 requires choosing a runtime and
tooling before any implementation work can start.

## Decision

### Runtime and language

Node.js (>= 20.11) with TypeScript for server, shared, and client code.

A single language across `src/server/`, `src/shared/`, and `src/client/` lets the protocol
definitions in `src/shared/` be imported directly by both sides, which is the drift protection
`AGENTS.md` asks for.

### Module system

ESM with `module`/`moduleResolution` set to `NodeNext`, and explicit `.js` extensions on relative
imports. This runs under plain `node` after a `tsc` build with no loader, resolver hook, or path
alias tooling. The cost is the unfamiliar `.js` suffix on imports that resolve to `.ts` files.

Path aliases (`@shared/*`) were rejected: they need extra runtime resolution on the server for no
benefit a relative import does not already provide at this project size.

### Message validation

`zod` schemas are the single source of truth for protocol messages. TypeScript types are inferred
from the schemas rather than declared separately, so a message's compile-time shape and its runtime
validation cannot drift.

This matters because the server is authoritative and `AGENTS.md` requires explicit validation of
untrusted client input. Hand-written type guards would duplicate every field and rot.

### Renderer

Vanilla Canvas with Vite for the first client slice.

The initial frontend branch already provides a lightweight Canvas dungeon preview, keyboard input,
HUD state, and WebSocket scaffolding. Staying on Canvas keeps the first playable loop small while
the backend protocol is still settling. Phaser remains a possible upgrade if sprite sheets,
tilemaps, animation states, or collision tooling start to dominate the client code.

### Supporting tools

- `ws` for the WebSocket server.
- `tsx` for running the server in watch mode during development.
- `vitest` for tests, matching the `*.test.ts` naming in `AGENTS.md`.
- `eslint` with `typescript-eslint` (flat config) for linting.

## Consequences

- Relative imports in `src/` must carry `.js` extensions.
- Protocol changes are made by editing a zod schema; the TypeScript type follows automatically.
- The client build uses Vite and its own `tsconfig.client.json` because it targets the DOM rather
  than Node.
