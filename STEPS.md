# Project Steps

This plan tracks the work needed to build a browser-based co-op dungeon crawler with proximity chat. Complete backend and frontend work in small vertical slices so the game is playable early and improves steadily.

## Opinion Checkpoints

Ask before moving past these points:

- Visual style: pixel art, clean vector-like 2D, or dark fantasy illustrated.
- Movement model: grid-based, slow free-roam, or turn-based room movement.
- Combat model: turn-based, cooldown-based real time, or hybrid.
- Voice behavior: always connected with distance-based volume, or connect only when nearby.
- Target party size for v1: 2, 4, or more.

## Backend Dev

### 1. Project Foundation

- Choose runtime and tooling, likely Node.js with TypeScript.
- Add package scripts for development, testing, linting, and building.
- Maintain the server/shared/test folder skeleton under `src/server/`, `src/shared/`, and `tests/`.
- Define shared protocol message types.

### 2. Session and Player Management

- Create dungeon instance records with invite codes or room IDs.
- Add player join, leave, reconnect, and disconnect handling.
- Track player identity, position, health, and ready state.
- Broadcast authoritative player state to all clients in a session.

### 3. Authoritative Dungeon State

- Start with one fixed dungeon map.
- Validate player movement against walls, bounds, and occupied tiles.
- Store monsters, loot, doors, exits, and room metadata server-side.
- Broadcast state changes after validated actions.

### 4. Combat and Game Rules

- Implement attacks, damage, death, and simple monster behavior.
- Add item pickup and inventory basics.
- Resolve all combat outcomes on the server.
- Add tests for movement, combat, session joins, and invalid messages.

### 5. Voice Signaling and Proximity Data

- Use the WebSocket server for WebRTC signaling.
- Track pairwise player distances inside each dungeon instance.
- Send proximity updates to clients for audio volume attenuation.
- Add limits and validation for signaling messages.

### 6. Deployment Readiness

- Add environment configuration documentation.
- Add production build and start commands.
- Add basic logging for sessions, disconnects, and server errors.
- Verify one deployed server can host multiple dungeon instances.

## Frontend Dev

### 1. Project Foundation

- Choose renderer, likely Canvas or Phaser for a fast 2D prototype.
- Maintain the `src/client/` structure for rendering, input, UI, state, networking, and audio.
- Connect to the backend WebSocket server.
- Render the fixed dungeon map and local player.

### 2. Multiplayer Movement

- Send movement intent messages instead of direct position changes.
- Render remote players from server broadcasts.
- Add simple interpolation or step animation.
- Show connection, join, leave, and disconnect states.

#### 2a. Client Networking (detailed breakdown)

Completes the last bullet of Frontend step 1 and most of step 2. Broken out because the frontend
prototype shell currently invents its own message shapes and cannot talk to the backend at all.

Starting condition: `src/client/network/gameClient.ts` opens a socket, never joins a session, never
reads a server message, hand-rolls a `playerMove` frame the protocol does not define, and defaults
to port 8787 while the server listens on 8080.

1. **Adopt the shared protocol.** Import message types and parsers from `src/shared/protocol/`
   rather than hand-writing frames. `AGENTS.md` requires one definition so client and server cannot
   drift; the client build already bundles it (verified, ~16 kB gzipped including zod).
2. **Fix the endpoint.** Default to the port the server actually listens on, and derive both the
   HTTP and WebSocket origins from one place so they cannot disagree.
3. **Model the connection lifecycle.** Track offline, connecting, connected, joining, in session,
   disconnected, and reconnecting as distinct states, so the UI can tell "no socket" apart from
   "socket open but not in a dungeon".
4. **Implement the join flow.** `POST /sessions` to create a dungeon, then `joinSession` with the
   room code, player name, and protocol version. Handle every `sessionError` code with a message a
   player can act on.
5. **Persist the resume token.** Store the token from `sessionJoined` in `sessionStorage`, send it
   on reconnect, and clear it on an explicit leave. It is a credential: never log it, never put it
   in a URL, and prefer session storage so it dies with the tab.
6. **Reconnect automatically.** Retry with backoff while the server's 60s grace window is open, so
   a refresh or a brief drop returns the player to the same slot.
7. **Make server state authoritative.** Build the roster from `sessionJoined` and `stateSnapshot`
   rather than local guesses, and apply `playerJoined`, `playerLeft`, `playerConnectionChanged`,
   and `playerReadyChanged`. Treat `playerConnectionChanged` as "grey them out", never as removal.
8. **Send real movement intent.** Replace the invented `playerMove` with `playerMoveIntent`
   carrying a sequence number and an `{x, y}` direction. The server answers `notImplemented` until
   Backend step 3, so the client keeps predicting locally until snapshots carry real positions.
9. **Surface it in the UI.** A lobby to create or join a room, the room code, connection state, the
   party roster with health and ready state, a ready toggle, and a leave control.
10. **Test without a browser.** Keep the networking layer free of DOM references so the existing
    node test environment can drive it against a real `createGameServer()`, covering join, rejoin,
    duplicate join, party limit, disconnect, and malformed frames.

Out of scope here: real movement and collision (Backend step 3), combat (step 4), and voice
(step 5). This step only makes the client and server speak to each other correctly.

### 3. Core Game UI

- Add party join flow with invite code or room ID.
- Show health, inventory, combat feedback, and player names.
- Add monster and loot rendering.
- Add minimal menus for start, pause, settings, and exit.

### 4. Combat and Dungeon Interaction

- Add controls for attack, interact, pickup, and use item.
- Display server-confirmed combat results.
- Add feedback for invalid moves or blocked actions.
- Show win, loss, and dungeon exit states.

### 5. Proximity Voice Chat

- Request microphone access only after player intent.
- Establish WebRTC mesh connections within each dungeon party.
- Apply volume falloff based on server-provided distance data.
- Add mute, deafened, input level, and permission-denied states.

### 6. Polish and Playtesting

- Add sprites, sound effects, and visual feedback.
- Test with 2-4 players in the same dungeon.
- Fix layout, browser permission, and reconnect edge cases.
- Capture screenshots or short recordings for pull requests.
