# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Backend Dev step 4 complete; the server resolves melee combat, monster behavior, downed/respawn, item pickup and use, doors, and the exit.
- Last completed work: Combat and Game Rules on `backend-development` (protocol v3). See `docs/decisions/0004-combat-and-items.md`.
- Next recommended step: Frontend Dev steps 3-4 (Core Game UI, Combat and Dungeon Interaction). The server accepts every gameplay action, but the client does not yet send attack, pickup, use, or interact, and does not draw loot, doors, exits, monster health, downed players, or the cleared state. That is the remaining gap to a playable demo.
- Current blocker: GitHub branch protection cannot be enabled for this private repository on the current GitHub plan; make the repo public or upgrade to GitHub Pro to require CI before merge.

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

- [x] Start with one fixed dungeon map. Each session clones the Ember Vault map from `src/server/game/dungeonState.ts`.
- [x] Validate player movement against walls, bounds, and occupied tiles. `movePlayer` handles zero intent, map collision, player occupancy, monsters, and closed doors.
- [x] Store monsters, loot, doors, exits, and room metadata server-side. The dungeon instance hangs off `Session.dungeon`.
- [x] Broadcast state changes after validated actions. Valid `playerMoveIntent` messages increment the session tick and fan out a `stateSnapshot`.

### 4. Combat and Game Rules

- [x] Implement attacks, damage, death, and simple monster behavior. Simple real-time melee in `src/server/game/combat.ts`; monsters chase and attack on the tick; downed players respawn after `PLAYER_RESPAWN_MS`. The hybrid tactical exchange is deferred.
- [x] Add item pickup and inventory basics. `src/server/game/items.ts` handles pickup, tonics, key-locked doors, and the exit.
- [x] Resolve all combat outcomes on the server. Clients send intent only; `attackResolved` and snapshots carry results.
- [x] Add tests for movement, combat, session joins, and invalid messages. `tests/server/combat.test.ts`, `tests/server/items.test.ts`, plus protocol and e2e coverage.

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

- [x] Choose renderer. Vanilla Canvas with Vite, recorded in `docs/decisions/0001-runtime-and-tooling.md`.
- [x] Add `src/client/` structure for rendering, input, UI, state, networking, and audio.
- [x] Connect to the backend WebSocket server. See `src/client/network/`.
- [x] Render the fixed dungeon map and local player.

### 2. Multiplayer Movement

- [x] Send movement intent messages instead of direct position changes. Backend step 3 now resolves them authoritatively.
- [x] Render remote players from server broadcasts.
- [ ] Add simple interpolation or step animation. Deferred: there is nothing to interpolate until the server moves players.
- [x] Show connection, join, leave, and disconnect states.

#### 2a. Client Networking

Breakdown in `STEPS.md`. Complete on `feature/client-networking`.

- [x] Adopt the shared protocol in the client instead of hand-rolled frames.
- [x] Point the client at the port the server actually listens on.
- [x] Model the connection lifecycle as explicit states. See `ConnectionPhase`.
- [x] Implement the join flow (`POST /sessions`, then `joinSession`).
- [x] Persist and replay the resume token from `sessionJoined`.
- [x] Reconnect automatically inside the server's grace window.
- [x] Build the roster from server messages rather than local guesses.
- [x] Send `playerMoveIntent` with a sequence and an `{x, y}` direction.
- [x] Surface lobby, room code, roster, ready, and leave in the UI.
- [x] Cover the networking layer with browser-free tests against a real server.

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
- Completed Client Networking (Frontend steps 1-2; breakdown in `STEPS.md`) on `feature/client-networking`:
  - Replaced the prototype `gameClient.ts`, which invented a `playerMove` frame the protocol does not define, never joined a session, and pointed at port 8787 while the server listens on 8080.
  - Added `src/client/network/sessionState.ts`, a pure reducer folding server messages into a session view, and `sessionClient.ts`, which owns the socket, the join flow, resume tokens, and reconnect backoff. Both import the shared protocol, so client and server can no longer drift.
  - Kept the networking layer free of DOM references, which lets the node test environment drive the real client against a real `createGameServer()`.
  - Added lobby, room code, party roster, ready toggle, and leave controls; disconnected players render greyed rather than disappearing.
  - Verified the client bundles the shared protocol through Vite (~18 kB gzipped including zod).
  - Three bugs found only by running it in Chrome, none of which the node tests could catch:
    - `POST /sessions` was blocked by CORS, because Vite serves the client from :5173 and the API answers on :8080. Added an `Access-Control-Allow-Origin` header, configurable via `CORS_ORIGIN`, with a regression test.
    - The lobby stayed visible after joining: the `.lobby` class sets `display: grid`, which outranks the user agent's `[hidden]` rule.
    - The renderer ran once during construction, before the first subscription callback had assigned the session view, throwing on load and leaving a blank page.
  - Browser-verified with two tabs: create and join by room code, roster and ready propagating both ways, collision-checked local movement, a drop greying the player out while holding the slot, and a page reload reclaiming the same slot with ready state intact.
  - Known gap: the server spawns every player at {0, 0}, which is inside a wall on the client's placeholder map, so remote players sit in the corner until Backend step 3 owns the dungeon.
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
- Created and pushed `feature/frontend-development`.
- Added Vite, TypeScript, and a vanilla Canvas frontend shell.
- Added keyboard movement preview, HUD status, microphone permission flow, and backend WebSocket connection scaffolding.
- Verified the frontend with `npm run build`.
- Added `.github/pull_request_template.md` and updated `AGENTS.md` to require it for pull requests.
- Added GitHub Actions CI to run `npm ci`, `npm test`, and `npm run build` on pull requests to `main`.
- Verified PR #1 CI passed. Attempted to require CI before merge, but GitHub returned a branch protection plan limit for this private repository.
- Resolved PR #2 conflicts by keeping backend session code, frontend Canvas code, the PR template, and CI together.
- Added repo-local shared skills under `agent-skills/`: `project-progress-sync`, `protocol-contract-change`, `frontend-gameplay-slice`, and `backend-authoritative-state`.
- Moved shared skills from `.codex/skills/` to tool-neutral `agent-skills/` so Codex, Claude, and contributors can use the same guidance.
- Fast-forwarded `backend-development` to current `main` before starting Backend Dev step 3.
- Completed Backend Dev step 3 (Authoritative Dungeon State):
  - Added `src/server/game/dungeonState.ts` with the fixed Ember Vault map, per-session dungeon cloning, spawn points, movement stepping, and collision checks against walls, bounds, other players, living monsters, and closed doors.
  - Added server-owned dungeon state to `Session`, including map metadata, monsters, loot, doors, and exits.
  - Changed `stateSnapshot` to include the dungeon payload, bumped `PROTOCOL_VERSION` to 2, and updated the client session reducer/render bridge to use server map and monster positions once snapshots arrive.
  - Implemented `playerMoveIntent` handling in `src/server/gameServer.ts`; invalid moves send `actionRejected`, valid moves immediately broadcast the authoritative snapshot.
  - Recorded the contract and state ownership decision in `docs/decisions/0003-authoritative-dungeon-state.md`.
  - Fixed `GameServer.listen()` so local bind failures reject instead of hanging test hooks.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (94/94 passing), and `npm run build`.
- Fast-forwarded `backend-development` to `main` after PR #4 merged.
- Fixed two Backend step 3 movement bugs found in review:
  - Players could be permanently stuck together. Spawns were chosen by party size, so after a player left, the next arrival landed on a player who stayed, and every step either took was blocked. `findSpawnPoint` now picks the first unoccupied spawn point (falling back to free floor), and player collision only blocks moves that close the gap.
  - Speed hack: every `playerMoveIntent` applied a full step, so sending intents faster moved a player faster and triggered a party broadcast each time. Moves are now paced per player with a leaky bucket on a monotonic clock: one move per `MOVE_INTERVAL_MS`, with one interval of burst tolerance so network jitter does not drop legitimate moves. Early intents get `actionRejected` / `onCooldown`. Recorded in `docs/decisions/0003-authoritative-dungeon-state.md`.
  - Client prediction disagreed with the server: the client stepped whole tiles and looked up tiles by fractional positions, so prediction froze once the server moved a player off a tile boundary. Step, collision, and pacing rules now live in `src/shared/game/movement.ts`, used by both the server and the client's `predictMove`. The client sends one intent per `MOVE_INTERVAL_MS` while keys are held instead of on key repeat, and `reconcile` keeps the prediction while intents are in flight, adopting the snapshot once they settle or drift more than one unit.
  - Movement keys no longer fire while typing in the lobby's name and room code fields, and the HUD shows positions to two decimals.
  - No protocol change: `onCooldown` already existed in `rejectionReasonSchema`.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (115/115 passing, stable across repeated runs), and `npm run build`. Not yet exercised in a browser.
- Fast-forwarded `backend-development` to `main` after PR #5 merged.
- Smoke-tested PR #5 movement against the live dev server with a two-player script (no browser available): 39 intents sent at the client's 50ms cadence drew no `onCooldown` refusals, and the mover stopped correctly against the other player.
- Completed Backend Dev step 4 (Combat and Game Rules):
  - Chose simple real-time melee as the first combat slice, deferring the hybrid tactical exchange. Recorded in `docs/decisions/0004-combat-and-items.md`.
  - Added `src/server/game/combat.ts`: directional swings with reach, arc, and cooldown; monsters that chase the nearest connected standing player and attack on their own cooldown; downed players who respawn with full health.
  - Added `src/server/game/items.ts`: loot pickup into a capped inventory, tonics that heal, locked doors opened by spending a key, and an exit that clears the dungeon.
  - Wired `playerAttack`, `pickupItem`, `useItem`, and `playerInteract` into `src/server/gameServer.ts`, and ran the monster simulation on the server tick. Refusals use `actionRejected`.
  - Reshaped the Ember Vault so the exit sits in a walled vault behind the locked door, with the key guarded by the Ash Imp, and moved spawn points out of monster aggro range.
  - Fixed collision to treat integer positions as tile centers, matching the renderer; it was off by half a tile. Closed doors now block their whole tile.
  - Protocol v3: loot `kind`, monster `maxHealth`, dungeon `cleared`, and player `inventory`.
  - Client kept compatible: downed players do not move, do not block prediction, and show as "down" in the roster. No new gameplay controls or rendering yet.
  - Tests grew from 115 to 146. A scripted fight against the live dev server walked to the Ash Imp, took its hit and one from the Cinder Slime, killed the imp in two swings, and picked up the Copper Key.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (146/146 passing, stable across repeated runs), and `npm run build`.
