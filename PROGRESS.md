# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Frontend foundation.
- Last completed work: Added GitHub Actions CI for pull requests to `main`.
- Next recommended step: Require the CI check in GitHub branch protection, then coordinate backend message contracts.
- Current blocker: None.

## Opinion Checkpoints

- Visual style: Pixel art.
- Movement model: Slow free-roam.
- Combat model: Hybrid (real-time free-roam with a turn-based/tactical exchange when engaging enemies, inspired by Pokémon Legends: Z-A).
- Voice behavior: Always connected with distance-based volume.
- Target party size for v1: 4.

## Backend Dev Progress

### 1. Project Foundation

- [ ] Choose runtime and tooling.
- [ ] Add package scripts for development, testing, linting, and building.
- [x] Create `src/server/`, `src/shared/`, and `tests/` directories.
- [ ] Define shared protocol message types.

### 2. Session and Player Management

- [ ] Create dungeon instance records with invite codes or room IDs.
- [ ] Add player join, leave, reconnect, and disconnect handling.
- [ ] Track player identity, position, health, and ready state.
- [ ] Broadcast authoritative player state to all clients in a session.

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

- [x] Choose renderer.
- [x] Add `src/client/` structure for rendering, input, UI, state, networking, and audio.
- [ ] Connect to the backend WebSocket server.
- [x] Render the fixed dungeon map and local player.

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
- Created and pushed `feature/frontend-development`.
- Added Vite, TypeScript, and a vanilla Canvas frontend shell.
- Added keyboard movement preview, HUD status, microphone permission flow, and backend WebSocket connection scaffolding.
- Verified the frontend with `npm run build`.
- Added `.github/pull_request_template.md` and updated `AGENTS.md` to require it for pull requests.
- Added GitHub Actions CI to run `npm ci`, `npm test`, and `npm run build` on pull requests to `main`.
