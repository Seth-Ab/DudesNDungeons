# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Backend Dev steps 7 and 8 complete. Players now carry health, resistance, and stamina; resistance reduces every hit in one place, stamina prices swings, and a per-player run clock wears resistance down once the grace period passes. The server still sends each connected player a tailored snapshot based on server-owned light sources and line of sight. On the frontend, the Controls menu has landed alongside the new vitals bars.
- Last completed work: Player vitals, resistance decay, and the run timer on protocol v5. See `docs/decisions/0006-player-vitals.md`.
- Next recommended step: Backend step 9 (Procedural Dungeon Generation from Room Templates), because `content/` is still empty, `MONSTER_STATS` is still keyed by display name, and nothing in the model knows what a room is - which visibility, boss gating, and the hub all need. Backend step 5 (voice signaling) and step 6 (deployment readiness) remain open and are independent of it. Frontend polish that stays off shared protocol - exit/cleared feedback and pixel-art renderer work - can continue in parallel.
- Current blocker: GitHub branch protection cannot be enabled for this private repository on the current GitHub plan; make the repo public or upgrade to GitHub Pro to require CI before merge.

## Opinion Checkpoints

Resolved:

- Visual style: Pixel art.
- Movement model: Slow free-roam.
- Combat model: Stamina-gated real-time combat. The earlier hybrid tactical exchange is dropped for now so combat matches `GAMEDESCRIPTION.md`.
- Voice behavior: Always connected with distance-based volume.
- Target party size for v1: 4.
- Death and loss: Downed players stay down until revived or carried out. If the party escapes without them, they lose carried items and return to the hub.
- Carry capacity: Three inventory slots. Keys and normal items use slots; torches are carried/equipped separately and do not spend inventory slots.
- Identity for progression: Device-local profile first, backed by a local profile secret. Real accounts are deferred.
- Target run length: 15-20 minutes for a full dungeon run.

## Direction Alignment

How the code stands against `GAMEDESCRIPTION.md` as of 2026-09-14. Owner-authored direction is the target; this is the gap, not a complaint about the code, which was written before the description existed.

Already aligned:

- Four-player parties, proximity voice as the social core, and slow free-roam movement in any direction with walls, monsters, and other players all blocking.
- Server-authoritative everything: positions, combat, loot, and doors are decided on the server and clients send intent.
- Real-time melee with stamina-shaped pacing (cooldowns today, stamina later) matches the description better than the recorded hybrid checkpoint does.

Missing entirely, and now covered by new steps:

- Darkness, light sources, and limited sight. Nothing in the code models light; the client draws the whole map fully lit.
- Procedural generation. One hardcoded 16x8 map, `Ember Vault`, lives as a literal in `src/server/game/dungeonState.ts`. `content/dungeons/`, `content/monsters/`, `content/items/`, and `content/skills/` are all empty.
- Rooms. The map is a flat tile grid with no notion of a room, which visibility, boss gating, and template stitching all need.
- The hub world, and with it the run lifecycle, the torch supply, and storage.
- Roguelite progression. Nothing outlives a session; `SessionStore` is in-memory and keyed by room code.
- ~~Resistance and stamina, and the decay that punishes a slow run.~~ Closed by Backend step 7 on 2026-09-14.
- Skills, traps, cooperative puzzles, and bosses.
- Carrying objects and downed players.
- A camera. The renderer draws from the world origin, so the player does not hold the center of the screen.

Conflicts to resolve before building further:

- Downed players stand back up at full health after `PLAYER_RESPAWN_MS`, which contradicts the resolved downed/revive/carry direction and makes carrying a friend pointless.
- The exit sets `cleared` and names a `destination` of "deeper vault"; the description ends a run by escaping to the hub.

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

### 7. Player Vitals: Resistance, Stamina, and the Run Timer

- [x] Add resistance and stamina to the server player record and to `playerState`. Stored unrounded on `SessionPlayer`, rounded in `toPlayerState`.
- [x] Apply resistance as damage reduction in one place when a hit resolves. `damagePlayer` in `src/server/game/vitals.ts` is the only thing that lowers a player's health.
- [x] Regenerate stamina over time; spend it on attacking, lifting, and carrying. Regen and the attack cost are live. Lifting and carrying have their prices and their spend/drain API here but nothing to spend them on until Backend step 12, which has no carried-object state yet.
- [x] Decay resistance over time spent in the dungeon and warn the client. Per-player clock, 10 minute grace, then 0.1/s; `stateSnapshot.run` carries the countdown.
- [x] Keep consumables and skills the only ways to raise resistance. Added the `ward` item kind and a Warding Salve; nothing else raises it, including respawning.

### 8. Server-Authoritative Visibility and Lighting

- [x] Model carried torches, fixed map lights, and lit monsters.
- [x] Compute per-player visibility each tick from light radius and line of sight.
- [x] Replace the party-wide snapshot with a per-player one.
- [x] Track discovered tiles per player and keep sending them as unlit geometry.
- [x] Gate proximity voice distances on the same visibility rules.
- [x] Test that an unseen player is absent from the frame, not merely dimmed.

### 9. Procedural Dungeon Generation from Room Templates

- [ ] Move room templates, monster stats, and item definitions into `content/`.
- [ ] Make rooms first-class: id, bounds, template, lighting, contents.
- [ ] Key monsters by type id instead of display name.
- [ ] Stitch templates into a dungeon: halls, mazes, traps, puzzles, bosses, exit.
- [ ] Place loot, monsters, and lights from a seeded random source.

### 10. Hub World and Run Lifecycle

- [ ] Add the hub as a lit, monster-free place with a dungeon entrance.
- [ ] Start players in the hub and generate the dungeon on entry.
- [ ] Add the torch supply and between-run storage.
- [ ] Make the exit room end the run and return survivors to the hub.
- [ ] Handle a player who dies mid-run and a party that escapes without them.

### 11. Roguelite Progression and Persistence

- [ ] Add a player profile holding banked items and unlocked skills.
- [ ] Persist profiles across server restarts.
- [ ] Bank a survivor's carry; take a dead player's.
- [ ] Add skills with server-resolved effects.
- [ ] Reject client-sent profile, inventory, or unlock state.

### 12. Traps, Puzzles, Bosses, and Carrying

- [ ] Add traps as server-resolved triggers.
- [ ] Add puzzle objects that need two or more players at once.
- [ ] Add boss monsters and rooms that gate on them.
- [ ] Add lifting and carrying for objects and downed players.

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

- [x] Add party join flow with invite code or room ID.
- [x] Show health, inventory, combat feedback, and player names.
- [x] Add monster and loot rendering.
- [ ] Add minimal menus for start, pause, settings, and exit. A Controls menu now exists; start/pause/settings/exit menus remain.

### 4. Combat and Dungeon Interaction

- [x] Add controls for attack, interact, pickup, and use item.
- [x] Display server-confirmed combat results.
- [x] Add feedback for invalid moves or blocked actions.
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

### 7. Camera and Darkness

- [x] Draw through a camera centered on the local player.
- [x] Draw only what the server sent; leave undiscovered space black.
- [x] Add a local light mask for the player. Torches, map lights, and lit monsters still need explicit server light-source data.
- [x] Draw discovered-but-unlit geometry dim rather than absent.
- [ ] Replace flat rectangles with pixel-art dungeon tiles and props.

### 8. Vitals, Inventory, and Gameplay Controls

- [x] Show health, resistance, and stamina bars and three inventory slots. All three bars render from server `playerState`; three inventory slots were already visible.
- [ ] Add attack, interact, pickup, use, drop, and carry controls. Attack, interact, pickup, and use are done; drop and carry wait on Backend step 12.
- [ ] Render loot, doors, exits, monster health, downed players, and cleared state. Loot, doors, exits, monster health, and downed players are done; cleared/run outcome UI remains.
- [x] Show combat results, refusals, and the resistance decay warning. The HUD warns from `stateSnapshot.run` a minute before decay starts, then while it is falling.

### 9. Hub World and Run Flow

- [ ] Render the hub, entrance, torch supply, and storage.
- [ ] Add run start, escape, and death flows.
- [ ] Show what a player carries and what they banked.

### 10. Skills and Progression UI

- [ ] Show unlocked skills and their effects.
- [ ] Show locked skills and their unlock cost.
- [ ] Drive unlocks from server-owned profile state.

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

### 2026-09-14

- Added `GAMEDESCRIPTION.md` as the owner-authored source of truth for game direction, referenced from `AGENTS.md` and `README.md`. Agents read it and never write to it.
- Merged `main` into `feature/client-networking`.
- Rewrote the roadmap against that direction:
  - `STEPS.md` gained Backend steps 7-12 (vitals and the run timer, server-authoritative visibility and lighting, procedural generation from room templates, hub world and run lifecycle, roguelite persistence, and traps/puzzles/bosses/carrying) and Frontend steps 7-10 (camera and darkness, vitals and gameplay controls, hub flow, skills UI). Steps 1-6 keep their numbers because `PROGRESS.md`, the decision records, and `agent-skills/` reference them.
  - Added five open opinion checkpoints the description raises: what death costs, whether the hybrid tactical exchange survives, three inventory slots against the current eight, how identity outlives a session, and target run length.
  - Added the Direction Alignment section above, recording what already matches, what is missing, and the three places the code and the description now contradict each other.
- Recommended code changes, none applied yet, ordered by how much more expensive they get if deferred:
  1. Per-player snapshots. `snapshotOf(session)` in `src/server/gameServer.ts` builds one frame for the whole party, so every client holds the full map, roster, and monster list. Darkness cannot be a client-side effect on top of that: anyone can read the unlit world straight out of the socket, which defeats the pillar. Needed before anything else is built on the current shared-snapshot assumption.
  2. Stop sending the map in every snapshot. `cloneDungeonState` copies `map.tiles` into each frame, broadcast on every tick and again on every accepted move. Invisible on a 16x8 map; ruinous on the large generated maps the description calls for. Send the map once on join, then only mutable state, and later only newly discovered tiles.
  3. Decouple broadcast rate from action rate. `publish()` fans out a full snapshot on every accepted move, so four players moving at 20Hz produce roughly a hundred snapshots a second per session on top of the tick's twenty. Mark the session dirty and let the tick flush it. Visibility work then computes once per tick instead of once per action.
  4. Make dungeon content data-driven before it grows. `FIXED_DUNGEON` is a literal with hand-written UUIDs, and `MONSTER_STATS` is keyed by display name, which breaks as soon as two monsters share one. Move both into `content/` and key monsters by type id.
  5. Introduce rooms into the data model. Everything the description wants from level design (unseen players in other rooms, per-room templates, boss gating) needs a room to exist; today there is only a tile grid.
  6. Widen player vitals once. Health is a bare number on `SessionPlayer` and `playerStateSchema`; adding resistance, stamina, and decay across three separate changes will cost more than one vitals module and one protocol bump.
  7. Collide with the player's body, not their center point. `isFloor` tests only `tileOf(position)` while `PLAYER_RADIUS` is 0.35, so a player's body overlaps walls and clips corners, even though player-versus-player and player-versus-monster collision do respect the radius. The inconsistency will be felt most in dark corridors.
  8. Add the camera before more rendering lands. Everything drawn from here on is drawn through it.

### 2026-09-15

- Resolved the five open owner opinion checkpoints raised by `GAMEDESCRIPTION.md`:
  - Death is downed/revivable or carryable; a player left behind on escape loses carried items and returns to the hub.
  - The hybrid tactical exchange is dropped for now in favor of stamina-gated real-time combat.
  - Inventory capacity is three slots; keys/items spend slots, torches do not.
  - Progression identity starts as a device-local profile secret, with real accounts deferred.
  - Target run length is 15-20 minutes.
- Continued the frontend gameplay slice:
  - Set `MAX_INVENTORY_SIZE` to 3 to match the resolved carry-capacity checkpoint.
  - Switched the Canvas renderer to draw from server `DungeonState` through a camera centered on the local player.
  - Added rendering for loot, doors, exits, monster health, downed players, inventory slots, and a local player light mask.
  - Added HUD buttons and keyboard handling for attack, pickup, interact, and item-slot use; the client sends the existing server protocol messages instead of inventing local results.
  - Added combat/refusal feedback to the client session view and HUD.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (147/147 passing; required local server permission outside the sandbox), and `npm run build`.
- Continued Backend step 8, Server-Authoritative Visibility and Lighting:
  - Added `src/server/game/visibility.ts` to compute per-player visible tiles from light radius and line of sight through walls and closed doors.
  - Added per-player discovered tile memory and filtered dungeon frames that send unknown space as black, discovered-but-unlit geometry as dim tiles, and visible geometry at full brightness.
  - Changed server snapshot fanout from one party-wide `stateSnapshot` to one tailored snapshot per connected player. Unseen monsters, loot, exits, and player positions are filtered out of that player's frame.
  - Updated the client session reducer so snapshots merge visible player state into the roster while rendering only players present in the latest visible frame.
  - Added renderer support for unknown and discovered tile markers.
  - Added visibility tests and updated the e2e token-privacy assertion now that snapshots no longer include far-away loot by default.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (150/150 passing; required local server permission outside the sandbox), and `npm run build`.
- Finished Backend step 8:
  - Added protocol v4 light source state to `dungeonState`.
  - Modeled server-owned carried torches, fixed dungeon lights, and monster glow for visibility.
  - Sent visible light sources to the client and rendered them as small light markers.
  - Sent `voiceRangeUpdated` from the same visible-player frame, so unseen peers are omitted and visible peers get distance falloff.
  - Recorded the contract in `docs/decisions/0005-visibility-lighting-and-voice.md`.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (152/152 passing; required local server permission outside the sandbox), and `npm run build`.
- Updated `feature/frontend-development` to current `main` and added a low-conflict frontend Controls menu:
  - Added `src/client/ui/controlsMenu.ts` with grouped movement, dungeon action, inventory, party, and voice controls.
  - Added a HUD `Controls` button and overlay styling.
  - Kept Backend step 7 surfaces untouched while that work happens separately.
  - Verified: `npm run typecheck:client`, `npm run build:client`, and `npm run lint`.
- Completed Backend step 7, Player Vitals: Resistance, Stamina, and the Run Timer, on `feature/player-vitals`:
  - Added `src/server/game/vitals.ts`, which owns health, resistance, and stamina. `damagePlayer` is now the only function that lowers a player's health, and it applies resistance itself, so a trap or a boss added later cannot forget the reduction.
  - Chose `scale / (scale + resistance)` for the reduction rather than a linear percentage: diminishing returns, 100 resistance halves a hit, and no value reaches immunity. A hit scaled below one point still costs one.
  - Added resistance and stamina to `SessionPlayer` and `playerState`. They are stored unrounded, because decay moves resistance by fractions of a point per tick, and rounded in `toPlayerState` for broadcast.
  - Made resistance decay a per-player clock rather than a party-wide one, since `GAMEDESCRIPTION.md` says "if you stay in the duengon too long" and a player who joined late has not. `enteredDungeonAt` is stamped by the first simulation step, because the session store runs on wall time while the simulation runs on a monotonic clock. Backend step 10 resets it on leaving the hub.
  - Tuned decay against the 15-20 minute target run length: 10 minutes of grace, then 0.1 resistance per second, so base resistance is gone around minute 17. A step straddling the boundary decays only the part of itself past it.
  - Priced a swing at 15 stamina against 12/s regen and the 500ms cooldown, which is about eleven back-to-back swings before stamina paces combat instead of the cooldown. A swing refused for any other reason is charged nothing.
  - Kept consumables the only way resistance goes up: added the `ward` item kind and a Warding Salve to the Ember Vault. Respawning restores health and stamina but not resistance, so dying is not a way to undo the run clock.
  - Protocol v5, breaking: `playerState` gained `resistance` and `stamina`, `stateSnapshot` gained a per-viewer `run` clock, `rejectionReason` gained `exhausted`, and `itemKind` gained `ward`. Recorded in `docs/decisions/0006-player-vitals.md`.
  - Partial by design: stamina costs for lifting and carrying are defined here with `spendStamina`/`drainStamina` to pay them, but nothing spends them. Carried objects and downed-player carrying have no model or protocol yet; that is Backend step 12, and building it here would have duplicated that step. `STEPS.md` now says so on both steps.
  - Closed two Frontend step 8 items along the way: the HUD draws health, resistance, and stamina bars from server state, and warns from `stateSnapshot.run` a minute before decay starts and again while it is falling.
  - Tests grew from 152 to 175, including a new `tests/server/vitals.test.ts` (20 cases) and an e2e assertion that vitals and the run clock reach a real socket. `tests/server/combat.test.ts` now pins resistance to 0 where it is measuring monster cooldowns, and gained a case asserting the reduction itself.
  - Smoke-tested against a live server built from `dist/`: joined with resistance 40 and stamina 100, had the 11th consecutive swing refused as `exhausted`, and landed a swing again after the bar recovered.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (175/175 passing, stable across nine consecutive runs), and `npm run build`. Not yet exercised in a browser.
  - Known flake, pre-existing and unrelated: one full-suite run failed `tests/e2e/session.test.ts > accepts movement intent and broadcasts the authoritative position`, which races a tick snapshot against the move-driven one. It did not recur in nine further runs.
  - Merged the Controls menu from `main` (PR #10). The only overlap was the HUD and its stylesheet; the controls overlay and the vitals bars are independent.
