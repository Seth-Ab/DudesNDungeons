# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Backend Dev step 2 (Session and Player Management) complete and verified.
- Last completed work: Implemented dungeon sessions end to end. `POST /sessions` creates a room, `joinSession` admits players, and the server tracks identity, position, health, ready, and connection state, broadcasting each change plus a 20Hz `stateSnapshot`. A dropped socket holds the player's slot for 60 seconds and can be reclaimed with a resume token. See `docs/decisions/0002-session-lifecycle.md`. Work is on the `backend-development` branch.
- Next recommended step: Backend Dev step 3 (Authoritative Dungeon State), which fills the tick loop with real movement.
- Current blocker: None.

## Opinion Checkpoints

- Visual style: Pixel art.
- Movement model: Slow free-roam.
- Combat model: Hybrid (real-time free-roam with a turn-based/tactical exchange when engaging enemies, inspired by Pokémon Legends: Z-A).
- Voice behavior: Always connected with distance-based volume.
- Target party size for v1: 4.

## Backend Dev Progress

### 1. Project Foundation

- [x] Choose runtime and tooling. Node.js 20.11+ with TypeScript, `ws`, `zod`, `vitest`, and ESLint. See `docs/decisions/0001-runtime-and-tooling.md`.
- [x] Add package scripts for development, testing, linting, and building. See `README.md` for the command list.
- [x] Create `src/server/`, `src/shared/`, and `tests/` directories.
- [x] Define shared protocol message types. See `src/shared/protocol/`.

### 2. Session and Player Management

- [x] Create dungeon instance records with invite codes or room IDs. `POST /sessions` mints a room code; see `SessionStore.createSession`.
- [x] Add player join, leave, reconnect, and disconnect handling. A drop holds the slot for `RECONNECT_GRACE_MS`; reconnect uses the resume token from `sessionJoined`.
- [x] Track player identity, position, health, and ready state. See `SessionPlayer` in `src/server/sessions/sessionStore.ts`.
- [x] Broadcast authoritative player state to all clients in a session. Lifecycle events plus a `stateSnapshot` each tick.

### 3. Authoritative Dungeon State

- [ ] Start with one fixed dungeon map.
- [ ] Validate player movement against walls, bounds, and occupied tiles.
- [ ] Store monsters, loot, doors, exits, and room metadata server-side.
- [ ] Broadcast state changes after validated actions.

### 4. Combat and Game Rules

- [ ] Implement attacks, damage, death, and simple monster behavior.
- [ ] Add item pickup and inventory basics.
- [ ] Resolve all combat outcomes on the server.
- [ ] Add tests for movement, combat, session joins, and invalid messages.

### 5. Voice Signaling and Proximity Data

- [ ] Use the WebSocket server for WebRTC signaling.
- [ ] Track pairwise player distances inside each dungeon instance.
- [ ] Send proximity updates to clients for audio volume attenuation.
- [ ] Add limits and validation for signaling messages.

### 6. Deployment Readiness

- [ ] Add environment configuration documentation.
- [ ] Add production build and start commands.
- [ ] Add basic logging for sessions, disconnects, and server errors.
- [ ] Verify one deployed server can host multiple dungeon instances.

## Frontend Dev Progress

### 1. Project Foundation

- [x] Choose renderer. Phaser 3, recorded in `docs/decisions/0001-runtime-and-tooling.md`. Not installed yet; it lands with the rest of Frontend Dev step 1.
- [x] Add `src/client/` structure for rendering, input, UI, state, networking, and audio.
- [ ] Connect to the backend WebSocket server.
- [ ] Render the fixed dungeon map and local player.

### 2. Multiplayer Movement

- [ ] Send movement intent messages instead of direct position changes.
- [ ] Render remote players from server broadcasts.
- [ ] Add simple interpolation or step animation.
- [ ] Show connection, join, leave, and disconnect states.

### 3. Core Game UI

- [ ] Add party join flow with invite code or room ID.
- [ ] Show health, inventory, combat feedback, and player names.
- [ ] Add monster and loot rendering.
- [ ] Add minimal menus for start, pause, settings, and exit.

### 4. Combat and Dungeon Interaction

- [ ] Add controls for attack, interact, pickup, and use item.
- [ ] Display server-confirmed combat results.
- [ ] Add feedback for invalid moves or blocked actions.
- [ ] Show win, loss, and dungeon exit states.

### 5. Proximity Voice Chat

- [ ] Request microphone access only after player intent.
- [ ] Establish WebRTC mesh connections within each dungeon party.
- [ ] Apply volume falloff based on server-provided distance data.
- [ ] Add mute, deafened, input level, and permission-denied states.

### 6. Polish and Playtesting

- [ ] Add sprites, sound effects, and visual feedback.
- [ ] Test with 2-4 players in the same dungeon.
- [ ] Fix layout, browser permission, and reconnect edge cases.
- [ ] Capture screenshots or short recordings for pull requests.

## Activity Log

### 2026-09-11

- Created `STEPS.md` with backend and frontend development tracks.
- Created `PROGRESS.md` to track completed steps, blockers, and the next starting point.

### 2026-09-12

- Updated `AGENTS.md` with the documentation sources of truth.
- Created `CLAUDE.md` pointing to `AGENTS.md`.
- Created initial tracked folders for source, assets, content, tests, docs, scripts, and config.
- Updated `AGENTS.md`, `STEPS.md`, `PROGRESS.md`, and `README.md` to reflect the project skeleton.
- Resolved opinion checkpoint: visual style set to pixel art.
- Resolved opinion checkpoint: movement model set to slow free-roam.
- Resolved opinion checkpoints: combat model set to hybrid (Pokémon Legends: Z-A style), voice behavior set to always-connected with distance-based volume, target party size for v1 set to 4. All five opinion checkpoints are now resolved.
- Created the `backend-development` branch for Backend Dev work.
- Completed Backend Dev step 1 (Project Foundation):
  - Recorded runtime, module, validation, and renderer choices in `docs/decisions/0001-runtime-and-tooling.md`.
  - Added `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, and `.gitignore`.
  - Added shared constants in `src/shared/constants/game.ts` and core types in `src/shared/types/core.ts`.
  - Defined the protocol in `src/shared/protocol/` covering session lifecycle, movement intent, attacks, interaction, item use, voice signaling, proximity updates, and errors.
  - Added a minimal HTTP + WebSocket server entry point at `src/server/index.ts` that validates inbound messages and answers with `notImplemented` until session handling lands.
  - Added protocol tests in `tests/shared/protocol.test.ts` covering valid messages, malformed JSON, unknown types, missing fields, out-of-range values, and oversized payloads.
  - Documented commands in `README.md` and environment variables in `config/.env.example`.
- Blocked on verification: Node.js is not installed on the development machine, so `npm install`, `npm run lint`, `npm run typecheck`, and `npm test` have not been run.
- Unblocked and verified Backend Dev step 1 after installing Node.js 24.21.0 (npm 11.19.0):
  - `npm install` succeeded; committed `package-lock.json` so the dependency set is reproducible.
  - `npm run typecheck`, `npm run lint`, and `npm test` (15/15 passing) are all clean.
  - `npm run build` emits `dist/` and the built server starts under plain `node`, confirming the ESM/NodeNext choice in `docs/decisions/0001-runtime-and-tooling.md` works without a loader.
  - Smoke-tested the running server: `/health` returns 200 with the protocol version, unknown routes return 404, and the WebSocket layer rejects malformed JSON and unknown message types while answering a valid `joinSession` with `notImplemented`.
  - Known issue: `npm audit` reports 5 advisories, all in the `vitest`/`vite`/`esbuild` dev dependency chain. None ship in the server build. Clearing them means upgrading Vitest 2.x to 3.x, deferred so it does not ride along with step 2.
- Completed Backend Dev step 2 (Session and Player Management):
  - Added `SessionStore` in `src/server/sessions/sessionStore.ts`, holding dungeon instances, room codes, and per-player identity, position, health, ready, and connection state. It takes no transport types and receives its clock and id generators by injection, so the lifecycle is testable without opening a port.
  - Added `POST /sessions` to create a dungeon and return a shareable room code. `joinSession` now only joins an existing room and answers `sessionNotFound` otherwise.
  - Made a dropped socket hold the player's slot for 60 seconds instead of removing them, releasing it as `playerLeft`/`timedOut` if nobody returns.
  - Added resume tokens so a refreshed or briefly disconnected client reclaims its slot with position, health, and ready state intact. The token is sent only to its owner and never broadcast.
  - Protocol changes: `joinSession` gained an optional `resumeToken`; `sessionJoined` gained `resumeToken` and `resumed`; added `playerConnectionChanged`; removed `disconnected` from `playerLeftReason`, which a grace window makes unreachable. Recorded in `docs/decisions/0002-session-lifecycle.md`.
  - Split the transport into `src/server/gameServer.ts` as a `createGameServer()` factory, leaving `src/server/index.ts` as the entry point. This is what lets the e2e tests boot a real server on an ephemeral port with a compressed grace window.
  - Added a 20Hz `stateSnapshot` broadcast. Nothing moves between ticks yet; the loop exists so step 3 has somewhere to put movement and clients read from snapshots from the start.
  - Tests grew from 15 to 63: `tests/server/sessions.test.ts` covers the store's lifecycle and `tests/e2e/session.test.ts` drives real sockets through joins, duplicate joins, party limits, disconnect, reconnect, timeout, leave, and session isolation, including assertions that resume tokens never reach another player.
  - Verified: typecheck, lint, 63/63 tests (stable across repeated runs), `npm run build`, and the compiled entry point serving a live join.
