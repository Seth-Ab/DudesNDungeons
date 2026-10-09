# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped. Keep entries short: the merged pull request and its commits are the detailed record, so the activity log names the change and points there.

## Current Status

- Overall phase: Backend steps 7-10, 12, and 13 complete; Backend 11 partly done (profiles,
  persistence, first skill scroll). Frontend steps 1, 2, 4, 5, 7, 8, 9, and 11 complete. Sessions
  start in a lit hub, a unanimously ready party generates a run, and escape or a wipe returns
  everyone to the hub under protocol v16.
- Last completed work: content-driven consumable effects (issue #84); earlier, client WebRTC
  proximity voice (issue #27), closing Frontend step 5.
- Next recommended step: monster loot drops and a wider item catalog, combat depth, and tick
  performance (see the open issues), then build Frontend
  step 10 on the owner-only progression messages (#24, v15). Verifying Backend step 6 on a real
  deployment remains open.
- Current blocker: GitHub branch protection cannot be enabled for this private repository on the
  current GitHub plan; make the repo public or upgrade to GitHub Pro to require CI before merge.

## Opinion Checkpoints

Resolved:

- Visual style: Pixel art.
- Movement model: Slow free-roam.
- Combat model: Stamina-gated real-time combat. The earlier hybrid tactical exchange is dropped for now so combat matches `GAMEDESCRIPTION.md`.
- Voice behavior: Always connected with distance-based volume.
- Target party size for v1: 4.
- Death and loss: Downed players stay down until revived or carried out. If the party escapes without them, they lose carried items and return to the hub.
- Carry capacity: Three inventory slots. Keys and normal items use slots; torches are carried/equipped separately and do not spend inventory slots.
- Identity for progression: Device-local profile first, backed by a local profile secret. Real
  accounts are deferred. Implemented on 2026-09-20: the server issues the secret and keeps only its
  hash, and the browser holds it in local storage.
- Progression currency: none. `GAMEDESCRIPTION.md` names only items and skills kept between runs,
  so no currency was invented to go with them, and upgrade definitions keep leaving unlock costs
  out. Decided on 2026-09-20 while building the profile; revisit only if the owner asks for one.
- Skill acquisition and saving: skills are rare, transferable scroll loot occupying a normal
  inventory slot. Using one activates it immediately, but dungeon-earned skills become permanent
  only on extraction; a hub purchase is permanent immediately. Revive then escape counts, as will
  carrying a downed player through the exit once carrying exists. An already-known scroll is not
  consumed; duplicates may become upgrades later. Recorded in decision 0011.
- Target run length: 15-20 minutes for a full dungeon run.
- World tile scale: One authored tile is 4 world tiles on each side, so a dungeon is sixteen times the area its templates read as. Chosen on 2026-09-17 after the first demo: a one-tile corridor fitted exactly one of four players.
- Traversal pacing at that scale: Movement speed rises from 2.5 to 6 world units per second, well under the full four, so crossing the dungeon takes about 1.7 times as long rather than four times and a run still fits the 15-20 minute target.
- Light reach at that scale: Light and voice grow by three rather than four, so a torch covers less of a room than it used to and a party that splits up loses each other sooner. Retuned darker on 2026-10-04 (issue #60) after a playtest: a torch now reaches 6 world units, one and a half authored tiles.
- Hub/run lifecycle: The whole reserved party must be connected and ready before a standing player
  can use the entrance. Fresh joins wait during a run; reconnects reclaim their slot.
- Torch supply: Torches are deliberate, separate-from-inventory pickups in the hub and rare dungeon
  loot. Forgetting one means entering the run without personal light. The hub does not require a
  torch to enter; it only warns (re-confirmed by issue #61 on 2026-10-05).
- Player-to-player sight, decided for issue #61 on 2026-10-05 and implemented in
  `src/server/game/visibility.ts`:
  - Another player's carried torch is seen from any distance with a clear line between your body
    and theirs, and a player is seen when light falls on any open tile of their body. Line of sight
    between bodies counts a clear ray from either end, so it is the same answer both ways.
  - Two torch carriers therefore see each other or neither. Light from fixed lights, monsters, or a
    third player can still reveal one to the other alone; that is not the torch case.
  - Torchless players: a deliberate asymmetry. They see a distant carrier by that carrier's torch,
    and are seen only where someone's light reaches them, so a carrier sees a torchless ally only
    inside their own light. Two torchless players see each other only by other light.
  - Downed players: their torch keeps burning where they fell, so the party can find them and they
    light the same ground for others as they already did for themselves. A disconnected player's
    torch goes out.
  - Hysteresis: once seen, a player stays seen while sight or light reaches within one tile
    (`PLAYER_SIGHT_LINGER`) of their body, so walking the rim of a light or past a corner does not
    flicker. Only see-through tiles count, so a closing door still hides them at once.
  - Voice is gated on the same visible set, per listener.


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
- [x] Broadcast state changes after validated actions. Accepted actions mutate authoritative state and the 20Hz tick sends the `stateSnapshot` (issue #29); only the tick advances `session.tick`.

### 4. Combat and Game Rules

- [x] Implement attacks, damage, death, and simple monster behavior. Simple real-time melee in
  `src/server/game/combat.ts`; monsters chase and attack on the tick; downed players stay down until
  the run ends or future revive/carry mechanics resolve them.
- [x] Add item pickup and inventory basics. `src/server/game/items.ts` handles pickup, tonics, key-locked doors, and the exit.
- [x] Resolve all combat outcomes on the server. Clients send intent only; `attackResolved` and snapshots carry results.
- [x] Add tests for movement, combat, session joins, and invalid messages. `tests/server/combat.test.ts`, `tests/server/items.test.ts`, plus protocol and e2e coverage.

### 5. Voice Signaling and Proximity Data

Done: the proximity half landed with Backend step 8, the signaling relay with issue #26 on 2026-10-04.

- [x] Use the WebSocket server for WebRTC signaling. `voiceSignal` is relayed as `voiceSignalRelay` to a connected member of the sender's dungeon; `src/server/voice/signalRelay.ts`.
- [x] Track pairwise player distances inside each dungeon instance. `voiceRangeForPlayer` in `src/server/game/visibility.ts`.
- [x] Send proximity updates to clients for audio volume attenuation. `voiceRangeUpdated`, gated on visibility, sent with each snapshot.
- [x] Add limits and validation for signaling messages. Schema and `MAX_VOICE_SIGNAL_LENGTH`, plus a per-player token bucket (`VOICE_SIGNAL_BURST` 48, refilling `VOICE_SIGNAL_REFILL_PER_SECOND` 8) answered with `rateLimited`.

### 6. Deployment Readiness

Reconciled on 2026-09-22 against the code and a local production smoke test; only the deployed
check remains.

- [x] Add environment configuration documentation. `config/.env.example` documents `PORT`, `HOST`,
  `CORS_ORIGIN`, `VITE_WS_URL`, `CONTENT_DIR`, and `DATA_DIR`; `README.md` points to it.
- [x] Add production build and start commands. `npm run build` then `npm start`, listed in
  `README.md`; verified by building and serving `GET /health` and `POST /sessions` from `dist/`.
- [x] Add basic logging for sessions, disconnects, and server errors. `src/server/index.ts` logs
  startup and `SIGINT`/`SIGTERM` shutdown; `src/server/gameServer.ts` logs session creation, join,
  leave, disconnect, slot timeout, rejected messages, and socket errors. Plain `console` output,
  no structured logger.
- [ ] Verify one deployed server can host multiple dungeon instances. A local `npm start` process
  hosted two joined sessions at once over HTTP and WebSocket, but there is no deployment target yet,
  and the only automated multi-session check is store-level (`tests/server/sessions.test.ts`).

### 7. Player Vitals: Resistance, Stamina, and the Run Timer

- [x] Add resistance and stamina to the server player record and to `playerState`. Stored unrounded on `SessionPlayer`, rounded in `toPlayerState`.
- [x] Apply resistance as damage reduction in one place when a hit resolves. `damagePlayer` in `src/server/game/vitals.ts` is the only thing that lowers a player's health.
- [x] Regenerate stamina over time; spend it on attacking, lifting, and carrying. Regen and the attack cost are live. Lifting and carrying have their prices and their spend/drain API here but nothing to spend them on until Backend step 12, which has no carried-object state yet.
- [x] Decay resistance over time spent in the dungeon and warn the client. Per-player clock, 10 minute grace, then 0.1/s; `stateSnapshot.run` carries the countdown.
- [x] Keep consumables and skills the only ways to raise resistance. Added the `ward` item kind and
  a Warding Salve; returning to the hub does not restore resistance. Issue #84 replaced the
  `tonic` and `ward` kinds with one `consumable` kind whose content declares `effects` (`heal`,
  `restoreResistance`, `restoreStamina`); a new consumable is now one JSON file. Wire items carry
  `itemId`, `description`, and `icon` but no magnitudes, protocol v16. Profiles banked under the old
  kinds are migrated on read.

### 8. Server-Authoritative Visibility and Lighting

- [x] Model carried torches, fixed map lights, and lit monsters.
- [x] Compute per-player visibility each tick from light radius and line of sight.
- [x] Replace the party-wide snapshot with a per-player one.
- [x] Track discovered tiles per player and keep sending them as unlit geometry.
- [x] Gate proximity voice distances on the same visibility rules.
- [x] Test that an unseen player is absent from the frame, not merely dimmed.
- [x] Make player-to-player sight consistent and symmetric (issue #61, 2026-10-05). Rules are under
  Opinion Checkpoints.
- [x] Store discovered and lit tiles as typed-array grids instead of `"x,y"` string sets (issue #79,
  2026-10-09). `discoveredTiles` is a `Uint8Array` sized per installed world, the per-frame lit set is
  a reusable generation-marked grid per viewer, and rooms are found through a per-dungeon tile-to-room
  grid (`src/server/game/tileGrid.ts`). Wire format unchanged. `bench:tick` visibility for 4 players:
  explored 3.6-3.8 ms to 0.55-0.64 ms; fresh spawn 2.0 ms to 0.64-0.72 ms.

### 9. Procedural Dungeon Generation from Room Templates

- [x] Move room templates, monster stats, and item definitions into `content/`. JSON validated at startup by `src/server/content/`; the Ember Vault moved across verbatim as an authored dungeon.
- [x] Make rooms first-class: id, bounds, template, lighting, contents. `dungeonState.rooms`, filtered per player to what they have discovered.
- [x] Key monsters by type id instead of display name. `monsterState.typeId`; `MONSTER_STATS` is gone.
- [x] Stitch templates into a dungeon: halls, mazes, traps, puzzles, bosses, exit. Seven templates covering every kind; rooms chained entrance to exit with BFS-routed corridors.
- [x] Place loot, monsters, and lights from a seeded random source. `src/server/game/random.ts`; the seed is stored on the session so a run replays exactly.

### 10. Hub World and Run Lifecycle

Note: dungeon sizes here are now authored tiles, which the world builds at four times on each axis. See step 13.

- [x] Add the hub as a lit, monster-free place with a dungeon entrance. `content/dungeons/hub.json`
  uses only `#`/`.` and includes named quest, strategy, supply, and gate areas.
- [x] Start players in the hub and generate the dungeon on entry. Every reserved player must be
  connected and ready; fresh joins are refused mid-run while reconnects remain available.
- [x] Add the torch supply and between-run storage. Four hub torches are deliberate pickups, rare
  torches can spawn in the dungeon, and `bankedItems` is session-local until step 11.
- [x] Make the exit room end the run and return survivors to the hub. Standing players bank their
  inventory; downed players lose it.
- [x] Handle a player who dies mid-run and a party that escapes without them. Timed respawn is gone;
  downed players remain until escape/revival, and an all-downed party wipes to the hub.

### 11. Roguelite Progression and Persistence

Identity and persistence landed on 2026-09-20 under protocol v9. The first skill-scroll slice landed
under protocol v10; the full catalog, upgrade acquisition, and UI remain.

- [x] Add a player profile holding banked items and unlocked skills. `src/server/profiles/`.
  `SessionPlayer.profile` replaces `SessionPlayer.bankedItems`, so one profile is shared by
  reference and may play only one slot at a time.
- [x] Persist profiles across server restarts. `data/profiles.json`, written atomically, validated
  on read, relocatable with `DATA_DIR`. In-memory everywhere except `src/server/index.ts`.
- [x] Persist survivor banking and dead-player loss across server restarts. `returnToHub` writes to
  the profile and marks it changed; the server flushes on escape, on wipe, on join, every sweep,
  and on close.
- [ ] Add skills with server-resolved effects. The first slice is live: Iron Will can spawn as rare
  boss-room loot, provisional skills survive reconnect but not a failed extraction, and the shared
  effect resolver drives resistance, attack damage, upgrade tiers, and torch sight. Remaining:
  add upgrade acquisition and connect puzzle effects. The owner now receives the catalog
  (`progressionCatalog`) and live state (`progressionUpdated`), protocol v15 (#24).
- [x] Add validated JSON definitions for skills and tiered upgrades. This is content scaffolding;
  skill definitions now feed the effect resolver, while upgrade acquisition remains future work.
- [x] Reject client-sent profile, inventory, or unlock state. The client sends one credential and
  nothing else; `profileState` is output-only and never parsed from a client frame.

### 12. Traps, Puzzles, Bosses, and Carrying

- [x] Add traps as server-resolved triggers. `content/traps/`, `src/server/game/traps.ts`; the
  Collapsing Span room uses them. Trigger kind is movement/proximity only; interaction-based
  disarming is future work.
- [x] Add puzzle objects that need two or more players at once. `content/puzzles/`,
  `src/server/game/puzzles.ts`; held pressure plates, the Paired Levers room uses them. Paired
  levers and puzzle gates beyond a loot reward (e.g. unlocking a door) are future work.
- [x] Add boss monsters and rooms that gate on them. `src/server/game/bosses.ts`; a living boss
  seals every exit in its dungeon. One boss encounter (Ember Warden in the Warden Crucible) ships;
  boss-specific attacks, art, and further bosses are future work.
- [x] Add lifting and carrying for downed players, spending step 7's stamina costs and paying a
  movement penalty. `src/server/game/carrying.ts`. Carryable objects have no content yet (nothing
  in `content/` is marked liftable), so this covers the downed-player half of the item only; a
  liftable prop would need its own content schema and is left for whenever one is authored.

### 13. World Tile Scale

Taken before steps 10-12, on the demo's evidence that the map was too cramped for four players.

- [x] Separate authored scale from world scale. `TILE_SCALE` is 4 and `src/server/game/scale.ts` is the only place that applies it; `content/` keeps the size a designer can read.
- [x] Scale only coordinates. Light radii, monster speeds, and reach stay in world units and are authored as they are used; the schema says which is which.
- [x] Grow speed and light by less than the map. Speed 2.5 to 6, light and voice by `LIGHT_SCALE` of 3, so the dungeon is larger and darker rather than merely further away.
- [x] Give a doorway the width of its opening. `doorState.size`, honoured by collision, line of sight, and reach.
  - Two bugs in that width surfaced on 2026-09-18 while drawing the door art, both from the one-tile assumptions the block replaced. Line of sight exempted only a door's centre tile, so a closed door hid behind itself and was never sent to any client; and the client still measured interact reach to the centre while the server measured to the face, so no locked door could be opened from the UI. Fixed with `distanceToDoor` in `src/shared/game/movement.ts`, now shared by both sides.
- [x] Send a window of the map rather than all of it. `dungeonMapState.originX/originY` and `SNAPSHOT_VIEW_RADIUS_TILES`.

## Frontend Dev Progress

### 1. Project Foundation

- [x] Choose renderer. Vanilla Canvas with Vite, recorded in `docs/decisions/0001-runtime-and-tooling.md`.
- [x] Add `src/client/` structure for rendering, input, UI, state, networking, and audio.
- [x] Connect to the backend WebSocket server. See `src/client/network/`.
- [x] Render the fixed dungeon map and local player.

### 2. Multiplayer Movement

- [x] Send movement intent messages instead of direct position changes. Backend step 3 now resolves them authoritatively.
- [x] Render remote players from server broadcasts.
- [x] Add simple interpolation or step animation. `src/client/state/remoteInterpolation.ts` buffers
  each remote player's authoritative positions and draws them `REMOTE_RENDER_DELAY_MS` in the past,
  with steps spaced one move interval apart and brief capped extrapolation when the buffer runs dry
  (issue #62), fed by a `requestAnimationFrame` loop in `main.ts`; local prediction/reconciliation is
  untouched. A hub/run transition, a fresh join or resume, or a correction beyond `SNAP_DISTANCE`
  snaps instead of sliding. Monsters still draw at raw snapshot position; interpolation was scoped to players only.
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
- [x] Show win, loss, and dungeon exit states. Landed with Frontend step 9: on the return to the
  hub the HUD reports an escape with what was banked, or a loss for a downed player
  (`runOutcome`/`outcomeMessage` in `src/client/state/runFlow.ts`).

### 5. Proximity Voice Chat

- [x] Request microphone access only after player intent. Only Enable Voice captures it
  (`src/client/audio/browserVoice.ts`), and it is held until voice is disabled or the party is left.
- [x] Establish WebRTC mesh connections within each dungeon party. One link per party member,
  negotiated over `voiceSignal` with polite/impolite glare handling (`src/client/audio/voiceMesh.ts`).
- [x] Apply volume falloff based on server-provided distance data. Each remote stream plays at its
  `voiceRangeUpdated` volume; an omitted peer plays at 0 and keeps its link.
- [x] Add mute, deafened, input level, and permission-denied states. Session cluster buttons, a
  level meter, and "microphone blocked" / "no microphone" readouts (`src/client/ui/hud/voice.ts`).

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
- [x] Replace flat rectangles with pixel-art dungeon tiles and props. Done on `feature/pixel-art-tiles`; players and monsters stay flat figures for Frontend step 6.

### 8. Vitals, Inventory, and Gameplay Controls

- [x] Show health, resistance, and stamina bars and three inventory slots. All three bars render from server `playerState`; three inventory slots were already visible.
- [x] Add attack, interact, pickup, use, drop, and carry controls. The "C" key and a HUD button
  lift the nearest downed party member in reach, or drop whoever is currently carried.
- [x] Render loot, doors, exits, monster health, downed players, and hub/run outcome state. The last
  two landed with Frontend step 9: the HUD names the place from room metadata and reports how the
  run ended.
- [x] Show combat results, refusals, and the resistance decay warning. The HUD warns from `stateSnapshot.run` a minute before decay starts, then while it is falling.

### 9. Hub World and Run Flow

Complete on `feature/hub-run-flow`.

- [x] Render the hub, entrance, torch supply, and storage. Areas are outlined and named from the
  room metadata in the snapshot, and the gate is captioned with what it is waiting for. Storage has
  no world entity to draw, so the bank is a HUD panel.
- [x] Add run start, escape, and death flows. The gate refuses locally with the names of whoever is
  not ready, the run start is announced, and the return to the hub reports what this player got out
  with or lost.
- [x] Show what a player carries and what they banked. Three slots and the torch line, which is
  separate because a torch is not an inventory item, plus the session bank.

### 10. Skills and Progression UI

- [ ] Show unlocked skills and their effects.
- [ ] Show locked skills and their unlock cost.
- [ ] Drive unlocks from server-owned profile state.

### 11. Drawing at World Scale

- [x] Draw in world units at a zoom that keeps the player small against the room. 32 pixels per world unit, entities sized from `PLAYER_RADIUS`.
- [x] Clip drawing to the viewport and to the window the snapshot carried.
- [x] Rule the floor every `TILE_SCALE` units, so it reads as masonry rather than graph paper.
- [x] Draw a doorway across its whole opening, matching what the server collides against.


## Activity Log

One line per change; read the linked pull request for detail.

- 2026-10-07: Owner-only progression catalog and live state (#24, v15).
- 2026-10-06: Trimmed repository bloat: redundant tests, an always-skipped paid-API browser spec
  and its dependency, PR screenshot media, dead constants, and this ledger's long-form history.
- 2026-10-04: Client proximity voice (#27, decision 0012); symmetric player-to-player sight (#61);
  snapshots coalesced into the 20 Hz tick (#29); buffered remote interpolation (#62); WebRTC
  signaling relay (#26); rebindable controls (#69); darker lighting (#60); HUD accessibility
  (#51); party frames (#49); run clock and combat feedback (#50).
- 2026-10-03: Bosses and sealed exits (#31, v14); cooperative puzzles (#32, v13); traps (#33,
  v12); HUD overlay, vitals cluster, hotbar and action prompt (#46-#48); WebSocket payload limit
  (#28).
- 2026-09-23: Carrying downed players (#34, v11).
- 2026-09-22: Deployment readiness reconciled; first remote interpolation (#35); Playwright e2e.
- 2026-09-20: Roguelite profiles persisted to `data/profiles.json` (v9); first skill scroll, Iron
  Will (v10, decision 0011).
- 2026-09-18: Pixel-art tiles (decision 0010); door-width line-of-sight and reach fixes.
- 2026-09-17: World tile scale (decision 0008); hub and run lifecycle (decision 0009).
- 2026-09-15: Content moved to `content/` and procedural generation from room templates
  (decision 0007).
- 2026-09-14: Player vitals: resistance, stamina, run timer (decision 0006); server-authoritative
  visibility and lighting (decision 0005).
- 2026-09-11 to 09-12: Project foundation, sessions, authoritative dungeon state, combat and items,
  client networking (decisions 0001-0004).
