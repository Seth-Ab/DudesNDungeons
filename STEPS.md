# Project Steps

This plan tracks the work needed to build a browser-based co-op dungeon crawler with proximity chat. Complete backend and frontend work in small vertical slices so the game is playable early and improves steadily.

`GAMEDESCRIPTION.md` is the owner-authored source of truth for what the game is: a dark, randomly generated dungeon crawl for up to four friends, built on lighting, looting and fighting, proximity voice, and roguelite progression between runs. This file turns that direction into ordered work. Where the two disagree, `GAMEDESCRIPTION.md` wins and this file is what gets corrected.

Steps 1-6 in each track predate `GAMEDESCRIPTION.md` and are kept at their original numbers, because `PROGRESS.md`, the decision records, and `agent-skills/` all reference them. Steps 7 and up carry the work the game description added.

## Opinion Checkpoints

Ask before moving past these points.

Resolved, with answers recorded in `PROGRESS.md`: visual style, movement model, combat model,
voice behavior, party size, death and loss, hybrid combat direction, carry capacity, identity for
progression, target run length, and world tile scale.

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

### 7. Player Vitals: Resistance, Stamina, and the Run Timer

- Add resistance and stamina to the server's player record and to the broadcast `playerState`, next to health.
- Apply resistance as damage reduction in one place, when a hit resolves, so no caller can forget it.
- Regenerate stamina over time and spend it on attacking, lifting objects, and carrying another player. Lifting and carrying have no representation in the model yet, so step 7 sets their prices and step 12 spends them.
- Decay resistance the longer the party stays in the dungeon, so a slow run gets progressively more dangerous, and send the client enough to warn the player before it bites.
- Keep consumables and unlocked skills the only ways to raise resistance.

### 8. Server-Authoritative Visibility and Lighting

Lighting is a core pillar, so it belongs on the server. A client that receives the whole dungeon can draw the whole dungeon no matter what the renderer intends.

- Model light sources: torches a player carries, fixed map lights such as wall torches and fireplaces, and monsters that glow.
- Compute what each player can see once per tick, from light radius and line of sight through walls and closed doors.
- Send each player a snapshot of only what they can see, replacing the single party-wide snapshot.
- Remember tiles a player has already discovered, and keep sending those to that player as known-but-unlit geometry.
- Gate the proximity distances from Backend step 5 on the same rules, so a player you cannot see in the next room is also one you cannot hear.
- Test that a player in another room is absent from the frame entirely, not merely dimmed by the client.

### 9. Procedural Dungeon Generation from Room Templates

- Move room templates, monster stats, and item definitions out of `src/server/game/` literals and into `content/`, which exists for exactly this and is still empty.
- Make a room a first-class thing with an id, bounds, a template, lighting, and contents. Nothing in the model currently knows what a room is, and visibility, boss gating, and generation all need one.
- Key monsters by a type id rather than by display name, which is what `MONSTER_STATS` uses today.
- Generate a dungeon by stitching large templates together: sparse halls, mazes, trap rooms, cooperative puzzle rooms, boss rooms, and one exit room that returns the party to the hub.
- Scatter loot, monsters, and light sources by per-template rules from a seeded random source, so a generated run can be replayed exactly in a test.
- Keep generation server-side. The client learns the map by exploring it.

### 10. Hub World and Run Lifecycle

- Add the hub as its own place: lit, monster-free, with an entrance to the dungeon.
- Start players in the hub instead of in the dungeon, and generate a fresh dungeon when the party enters.
- Give the hub a torch supply and storage that holds items between runs.
- Make the exit room end the run and return survivors to the hub.
- Decide and implement what happens to a player who dies mid-run, and to a party that escapes without them.

### 11. Roguelite Progression and Persistence

- Add a player profile that outlives a session: banked items, unlocked skills, and whatever currency the description's progression needs.
- Persist profiles across server restarts. File-backed is enough at this size.
- Bank what a survivor carries out; take what a dead player was carrying, per the death checkpoint.
- Add skills with server-resolved effects across combat, sight range, resistance, and puzzle interaction.
- Never trust a client-sent profile, inventory, or unlock. The client asks; the server decides.

### 12. Traps, Puzzles, Bosses, and Carrying

- Add traps as server-resolved triggers with effects on health, resistance, or stamina.
- Add puzzle objects that need two or more players at once, such as paired levers and held pressure plates. These are what make a dark room worth talking through on voice.
- Add boss monsters with their own stats and rooms that gate on defeating them.
- Add lifting and carrying for objects and for downed players, spending the stamina costs step 7 defined and paying a movement penalty.

### 13. World Tile Scale

Taken out of order, before steps 10-12, because the first playable demo showed the dungeon was cramped rather than expansive: a corridor authored one tile wide fitted exactly one of the four players it was meant to hold. `GAMEDESCRIPTION.md` asks for levels "large in scale to allow players to lose eachother", and nothing built on top of a cramped map would have fixed that.

- Separate the scale a designer authors at from the scale the game is played at, so one authored tile becomes a block of world tiles and `content/` keeps the size a person can read in a diff.
- Scale only coordinates. Light radii, monster speeds, and reach are already world units and must stay tunable against the map rather than with it.
- Grow traversal speed and light reach by less than the map, so the dungeon reads as large and dark rather than merely drawn further away.
- Give a doorway the width of its opening. A door authored as one tile has to keep filling the whole of it, for collision, for line of sight, and for how close a player must stand to open it.
- Send each player a window of the map rather than all of it, now that the whole map is far more than anyone can see or walk to between snapshots.
- Make the renderer draw in world units and clip to the viewport, so the player holds a small part of a large room instead of most of a small one.

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

### 7. Camera and Darkness

- Draw through a camera centered on the local player, so the player holds the middle of the screen and the map moves around them. The renderer currently draws the map from the world origin and has no camera at all.
- Draw only what the server sent, and leave undiscovered space black.
- Add a light mask: a small radius around the local player, plus carried torches, map lights, and lit monsters.
- Draw discovered-but-unlit geometry dim rather than absent, so a player can navigate back through a room they have already crossed.
- Replace the flat colored rectangles with pixel-art dungeon tiles and props, matching the resolved visual style. Tiles and static props only; player and monster sprites are Frontend step 6.

### 8. Vitals, Inventory, and Gameplay Controls

- Show health, resistance, and stamina bars, and three inventory slots.
- Add controls for attack, interact, pickup, use, drop, and carry. None of these exist yet, which is why the party cannot finish a dungeon the server is fully able to run.
- Render loot, doors, exits, monster health, downed players, and the cleared state.
- Show server-confirmed combat results, refusals, and a warning as resistance decays.

### 9. Hub World and Run Flow

- Render the hub, the dungeon entrance, the torch supply, and storage.
- Add the flow for starting a run, escaping, and dying.
- Show what a player is carrying and what they banked on the way out.

### 10. Skills and Progression UI

- Show unlocked skills and what each one does.
- Show what is still locked and what unlocking it takes.
- Drive the unlock flow from server-owned profile state, never from local state.

### 11. Drawing at World Scale

The client half of Backend step 13, done with it.

- Draw in world units at a zoom that keeps the player small against the room, rather than at a fixed size per tile.
- Clip drawing to the viewport and to the window the snapshot carried. A generated world is far too large to draw whole every frame.
- Rule the floor at the scale the level was authored at, not at every world tile.
- Draw a doorway across its whole opening, so what a player sees is what the server collides against.
