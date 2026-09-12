# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Planning and project setup.
- Last completed work: Updated `AGENTS.md` to reference `STEPS.md` and `PROGRESS.md`; created `CLAUDE.md`.
- Next recommended step: Resolve the opinion checkpoints in `STEPS.md`, then begin Backend Dev step 1 and Frontend Dev step 1.
- Current blocker: Core design choices need owner input before implementation starts.

## Opinion Checkpoints

- Visual style: Pending.
- Movement model: Pending.
- Combat model: Pending.
- Voice behavior: Pending.
- Target party size for v1: Pending.

## Backend Dev Progress

### 1. Project Foundation

- [ ] Choose runtime and tooling.
- [ ] Add package scripts for development, testing, linting, and building.
- [ ] Create `src/server/`, `src/shared/`, and `tests/` directories.
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

- [ ] Choose renderer.
- [ ] Add `src/client/` structure for rendering, input, UI, and audio.
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
