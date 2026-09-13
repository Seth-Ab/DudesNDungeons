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

Phaser 3 for the client, chosen over raw Canvas.

The locked-in checkpoints need sprite sheet and tilemap support (pixel art), continuous collision
against dungeon geometry (slow free-roam), and animation state handling for positioning and dodging
(hybrid combat). Phaser provides these; raw Canvas would mean hand-rolling them. The tradeoff is an
added framework with its own conventions.

Phaser and its build tooling are **not** installed yet. They land in Frontend Dev step 1 so the
backend branch does not carry unused dependencies.

### Supporting tools

- `ws` for the WebSocket server.
- `tsx` for running the server in watch mode during development.
- `vitest` for tests, matching the `*.test.ts` naming in `AGENTS.md`.
- `eslint` with `typescript-eslint` (flat config) for linting.

## Consequences

- Relative imports in `src/` must carry `.js` extensions.
- Protocol changes are made by editing a zod schema; the TypeScript type follows automatically.
- The client build (Vite + Phaser) is deferred to Frontend Dev step 1 and will need its own
  `tsconfig` because it targets the DOM rather than Node.
