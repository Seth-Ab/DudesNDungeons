# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped.

## Current Status

- Overall phase: Backend Dev steps 7-10 and 13 complete, with Frontend steps 7, 9, and 11, plus
  identity, persistence, and the first skill-scroll slice of Backend step 11. Sessions begin in a
  lit authored hub, unanimously ready parties generate a run, and escape or a total wipe returns
  the party to the hub
  under protocol v11. What a player banks now belongs to a device-local profile that survives a
  server restart. The dungeon is drawn as pixel art, and the hub reads as a place with named areas.
- Last completed work: server-authoritative cooperative puzzles, the puzzle item of Backend step 12
  (issue #32), under protocol v13. Puzzle types live in `content/puzzles/` (`plateRadius`,
  `holdMs`, `minHoldMs`, `holdReductionMsPerPower`, `rewardItemId`); room templates spawn them with
  `puzzles` rules and authored dungeons place them. `src/server/game/puzzles.ts` assigns each
  plate its nearest standing, connected player (one plate per player), and a puzzle completes when
  every plate is held at once for the required time. Stepping off, going down, or disconnecting
  resets the hold to zero. `puzzlePowerBonus` is consumed here: the summed bonus of the current
  holders shortens the hold per point, floored at `minHoldMs` (new Lever Sense skill grants it).
  Solving drops the reward item on the first plate and leaves the puzzle `solved` for the run.
  Snapshots carry `dungeon.puzzles` with held plates and progress, only plates on visible tiles.
  Paired Levers now uses it instead of a static key; the client draws placeholder plates.
- Before that: server-authoritative traps, the traps item of Backend step 12 (issue #33),
  under protocol v12. Trap types live in `content/traps/` (radius, `damage`, `resistanceLoss`,
  `staminaDrain`, optional `rearmMs`) and are validated at startup; room templates spawn them with
  `traps` rules and authored dungeons place them. `src/server/game/traps.ts` fires an armed trap
  when a standing, connected player is within reach, evaluated on the simulation tick and straight
  after each accepted move. Damage goes through `damagePlayer` (resistance-aware); resistance loss
  and stamina drain use new `reduceResistance`/`loseStamina` vitals helpers. A rearming trap waits
  for its footprint to clear (one hit per entry); a single-use trap ends `disabled`. Snapshots carry
  `dungeon.traps` with a `phase` (armed/triggered/disabled) only for visible tiles. The Collapsing
  Span trap room now uses spike plates, ember vents, and snare wires. The client draws flat
  placeholder footprints; final trap art/audio is out of scope.
- Before that: the carrying slice of Backend/Frontend step 12 (issue #34). A standing
  player can lift a downed party member within `INTERACT_RANGE`, spending `LIFT_STAMINA_COST` and
  then `CARRY_STAMINA_DRAIN_PER_SECOND` continuously in place of stamina regen; carrying halves
  movement speed (`CARRY_MOVE_SPEED_MULTIPLIER`) and drags the target's position along the
  carrier's. Exhaustion, an explicit drop, a carrier's disconnect, or either player leaving the
  session all release the target safely; a downed player still being carried when the party
  escapes counts as a survivor for banking, distinct from a full revive. Object carrying (as
  opposed to downed players) has no content to carry yet, so only the player-carrying half of the
  issue is wired end to end; see the scope note below. Protocol v11 adds `carryingPlayerId` /
  `carriedByPlayerId` to `PlayerState` and the `liftPlayer` / `dropCarry` client messages. New
  `src/server/game/carrying.ts`; a "C" key and HUD button toggle lift/drop client-side.
- Before that: Frontend step 2's remaining item, remote player interpolation. Remote players
  now slide between authoritative snapshots instead of snapping, drawn from a new
  `src/client/state/remoteInterpolation.ts` module and a continuous render loop; teleports, run
  transitions, reconnects, and large corrections still snap. Before that: the first playable
  skill-scroll slice of Backend step 11. A rare Scroll of Iron Will uses one inventory slot,
  activates immediately, and becomes a permanent profile unlock only for a player who extracts.
  Resistance, attack, upgrade, and torch-sight effects resolve on the server; protocol v10 carries
  the new item kind and its skill id.
- Next recommended step: expose the progression catalog plus active and permanent unlock state to
  the owning client, then build Frontend step 10. Upgrade-scroll acquisition, duplicate-to-upgrade
  behavior, transfer/drop, monster drops, chests, and hub shops remain follow-ups. Backend step 5
  (voice signaling, half done) also remains open, as does verifying Backend step 6 on a real
  deployment.
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
- Light reach at that scale: Light and voice grow by three rather than four, so a torch covers less of a room than it used to and a party that splits up loses each other sooner.
- Hub/run lifecycle: The whole reserved party must be connected and ready before a standing player
  can use the entrance. Fresh joins wait during a run; reconnects reclaim their slot.
- Torch supply: Torches are deliberate, separate-from-inventory pickups in the hub and rare dungeon
  loot. Forgetting one means entering the run without personal light.

## Direction Alignment

How the code stands against `GAMEDESCRIPTION.md` as of 2026-09-14. Owner-authored direction is the target; this is the gap, not a complaint about the code, which was written before the description existed.

Already aligned:

- Four-player parties, proximity voice as the social core, and slow free-roam movement in any direction with walls, monsters, and other players all blocking.
- Server-authoritative everything: positions, combat, loot, and doors are decided on the server and clients send intent.
- Real-time melee with stamina-shaped pacing (cooldowns today, stamina later) matches the description better than the recorded hybrid checkpoint does.
- Levels large enough to lose each other in, since Backend step 13. A generated run is 384x256 world tiles, a corridor holds four abreast, and a torch reaches 12.6 of the roughly 48 units across a room.

Missing entirely, and now covered by new steps:

- ~~Darkness, light sources, and limited sight.~~ Closed by Backend step 8 and Frontend step 7. Reach was retuned against the map by Backend step 13 on 2026-09-17.
- ~~Procedural generation.~~ Closed by Backend step 9 on 2026-09-15. Validated skill and upgrade
  definitions now exist; Backend step 11 still needs profiles, unlocking, and effect application.
- ~~Rooms.~~ Closed by Backend step 9 on 2026-09-15.
- ~~The hub world, run lifecycle, torch supply, and session-local storage.~~ Closed by Backend step
  10 on 2026-09-17. Persistent storage and its frontend remain open.
- Roguelite progression. Partially closed by Backend step 11 on 2026-09-20: banked items and a
  profile outlive both the session and the server, and the first rare scroll activates Iron Will
  provisionally before extraction saves it. General acquisition, upgrades, transfer, and UI remain.
- ~~Resistance and stamina, and the decay that punishes a slow run.~~ Closed by Backend step 7 on 2026-09-14.
- Traps, cooperative puzzle mechanics, bosses, and the rest of the skill progression surface.
- Carrying objects and downed players.
- ~~A camera.~~ Closed by Frontend step 7. The renderer draws through a camera centred on the local player.

Conflicts resolved by Backend step 10:

- ~~Downed players auto-respawned at full health.~~ They now stay down until future revive/carry
  mechanics or until the run ends; a total party down wipes to the hub.
- ~~The exit only set `cleared` and pointed at "deeper vault".~~ Exits now resolve the run, bank only
  standing survivors' carry, and rebuild the hub.

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

- [x] Implement attacks, damage, death, and simple monster behavior. Simple real-time melee in
  `src/server/game/combat.ts`; monsters chase and attack on the tick; downed players stay down until
  the run ends or future revive/carry mechanics resolve them.
- [x] Add item pickup and inventory basics. `src/server/game/items.ts` handles pickup, tonics, key-locked doors, and the exit.
- [x] Resolve all combat outcomes on the server. Clients send intent only; `attackResolved` and snapshots carry results.
- [x] Add tests for movement, combat, session joins, and invalid messages. `tests/server/combat.test.ts`, `tests/server/items.test.ts`, plus protocol and e2e coverage.

### 5. Voice Signaling and Proximity Data

Half done: the proximity half landed with Backend step 8, the signaling relay has not been built.

- [ ] Use the WebSocket server for WebRTC signaling. `voiceSignal` is still answered with `notImplemented`.
- [x] Track pairwise player distances inside each dungeon instance. `voiceRangeForPlayer` in `src/server/game/visibility.ts`.
- [x] Send proximity updates to clients for audio volume attenuation. `voiceRangeUpdated`, gated on visibility, sent with each snapshot.
- [ ] Add limits and validation for signaling messages. The schema and `MAX_VOICE_SIGNAL_LENGTH` exist; no rate limiting yet.

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
  a Warding Salve; returning to the hub does not restore resistance.

### 8. Server-Authoritative Visibility and Lighting

- [x] Model carried torches, fixed map lights, and lit monsters.
- [x] Compute per-player visibility each tick from light radius and line of sight.
- [x] Replace the party-wide snapshot with a per-player one.
- [x] Track discovered tiles per player and keep sending them as unlit geometry.
- [x] Gate proximity voice distances on the same visibility rules.
- [x] Test that an unseen player is absent from the frame, not merely dimmed.

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
  expose progression state/catalog, add upgrade acquisition, and connect puzzle effects.
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
- [ ] Add boss monsters and rooms that gate on them.
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
- [x] Add simple interpolation or step animation. `src/client/state/remoteInterpolation.ts` slides
  each remote player between the last two authoritative positions over the server's tick interval,
  fed by a `requestAnimationFrame` loop in `main.ts`; local prediction/reconciliation is untouched.
  A hub/run transition, a fresh join or resume, or a correction beyond `SNAP_DISTANCE` snaps instead
  of sliding. Monsters still draw at raw snapshot position; interpolation was scoped to players only.
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

### 2026-10-03

- Upgraded Vitest from 2.1.9 to 5.0.3 for issue #22, removing the critical/high/moderate advisory
  chain through Vitest, vite-node, its bundled Vite, and esbuild. No test or config changes were
  needed; all 390 tests pass. Vitest 5 requires Node `^22.12.0 || >=24.0.0`, so the `engines`
  floor and README requirement rose from 20.19 (CI already runs Node 24). `npm audit` still reports
  one high `brace-expansion` advisory through the ESLint tree, which is outside this issue.

### 2026-09-22

- Reconciled stale status for issue #36. Backend step 6 environment documentation, production
  build/start, and basic logging are checked after verifying the code and running `npm start` from
  a fresh build with two concurrent sessions; the deployed multi-instance check stays open. Frontend
  step 4 outcome states are checked to match Frontend steps 8 and 9, and the Frontend step 2
  interpolation note now reflects server-owned movement.
- Added the `ticket` skill for completing one approved GitHub issue through a review-ready pull
  request. It validates owner decisions and dependencies before editing, creates the issue branch
  before implementation, runs the full repository checks, updates progress, commits and pushes only
  scoped work, links the issue with `Closes`, and never merges the PR. When `HERDR_ENV=1`, it now
  delegates the workflow to Claude in a new Herdr tab and uses a child marker to prevent recursive
  delegation; outside Herdr the invoking agent runs it directly.
- Migrated the four repo-local shared skills from `agent-skills/` to the standard
  `.agents/skills/` discovery path and updated repository documentation to use the new location.
- Added the `backlog-audit` skill for evidence-backed backlog reviews. Audit-only runs produce
  proposals without editing code or creating issues; publishing GitHub issues requires explicit
  owner authorization and a duplicate check.
- Added `.claude/skills/` symlinks for all five skills, keeping `.agents/skills/` canonical while
  exposing the same workflows as direct slash commands in Claude Code without duplicated files.

### 2026-09-17

- Completed Backend step 10, Hub World and Run Lifecycle, on protocol v8:
  - Added the lit, monster-free Ember Hearth hub with quest/planning areas, a dungeon gate, and four
    deliberate torch pickups, while retaining the `#`/`.` tile alphabet for parallel art work.
  - Made runs party-wide: every reserved player must be connected and ready, fresh joins wait while
    a run is active, and reconnects still reclaim their existing slot.
  - Added rare dungeon torch loot. Torches equip outside the three inventory slots and are never
    automatically issued, so forgetting one means a dark run.
  - Replaced `dungeon.cleared` with real escape and wipe transitions. Standing survivors bank their
    carry in session-local storage; downed players lose theirs; an all-downed party wipes.
  - Removed timed respawn. Downed players now remain available for Backend step 12's revive/carry
    mechanics instead of standing up automatically.
  - Added `stateSnapshot.location`, `playerState.carryingTorch`, and `playerState.bankedItems`; added
    the `runInProgress` join error. Recorded in `docs/decisions/0009-hub-and-run-lifecycle.md`.
  - Verified `npm run typecheck`, `npm run lint`, `npm test` (221/221 passing), and `npm run build`.
- Added `content/skills/` and `content/upgrades/` with example progression definitions.
- Extended startup content validation with typed progression effects and skill/upgrade reference,
  tier, and prerequisite checks.
- Documented what is already live for items and what remains before skills/upgrades affect gameplay.

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
- Added repo-local shared skills, now under `.agents/skills/`: `project-progress-sync`, `protocol-contract-change`, `frontend-gameplay-slice`, and `backend-authoritative-state`.
- Moved shared skills out of the user-local `.codex/skills/`; they now use the repository-standard `.agents/skills/` path so Codex can discover the same checked-in guidance contributors can read.
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
  - `STEPS.md` gained Backend steps 7-12 (vitals and the run timer, server-authoritative visibility and lighting, procedural generation from room templates, hub world and run lifecycle, roguelite persistence, and traps/puzzles/bosses/carrying) and Frontend steps 7-10 (camera and darkness, vitals and gameplay controls, hub flow, skills UI). Steps 1-6 keep their numbers because `PROGRESS.md`, the decision records, and `.agents/skills/` reference them.
  - Added five open opinion checkpoints the description raises: what death costs, whether the hybrid tactical exchange survives, three inventory slots against the current eight, how identity outlives a session, and target run length.
  - Added the Direction Alignment section above, recording what already matches, what is missing, and the three places the code and the description now contradict each other.
- Recommended code changes, none applied yet, ordered by how much more expensive they get if deferred:
  1. Per-player snapshots. `snapshotOf(session)` in `src/server/gameServer.ts` builds one frame for the whole party, so every client holds the full map, roster, and monster list. Darkness cannot be a client-side effect on top of that: anyone can read the unlit world straight out of the socket, which defeats the pillar. Needed before anything else is built on the current shared-snapshot assumption.
  2. Stop sending the map in every snapshot. Still open, and now measured rather than predicted: a generated 96x64 map is about 115 kB/s per player of uncompressed JSON, or 600 kB/s for a four-player party. Backend step 9 mitigated it by enabling WebSocket permessage-deflate, which takes it to 1.6 kB/s on the wire because the withheld tiles are nearly all blanks, but the real fix is unchanged: send the map once on join, then only newly discovered tiles.
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
- Completed Backend step 9, Procedural Dungeon Generation from Room Templates, on `feature/procedural-generation`:
  - Moved game data out of code into `content/`: monsters, items, room templates, and dungeon definitions as JSON, validated at startup by `src/server/content/`. `FIXED_DUNGEON` and `MONSTER_STATS` are gone.
  - Kept the Ember Vault verbatim as an authored dungeon with its entity ids pinned, which is what lets the existing tests keep asserting on known positions. Sessions get the generated `vault-run` by default; tests that need a known world ask for `ember-vault`.
  - Added `src/server/game/random.ts`, a seeded mulberry32 stream. Generation never calls `Math.random`: entity ids are drawn from the seed too, so the same seed builds an identical dungeon, and the seed is stored on the session so a run can be replayed from a bug report.
  - Added `rooms` to `dungeonState`, filtered per player to rooms they have discovered part of. Sending the full list would hand a client the shape of the dungeon, including where the boss is, before they explore it.
  - Keyed monsters by `typeId` rather than display name, so two monsters may share a name.
  - Wrote seven room templates covering every kind the description names: entrance, hall, maze, trap, puzzle, boss, and exit.
  - Chained rooms entrance to exit, joining them with corridors routed by BFS through the gaps between rooms. A straight L was tried first and abandoned: an L that crosses a room has to either breach its wall, which silently un-gates the locked door that makes the key worth finding, or be dropped, which disconnects the run.
  - Used the `side` field on doorways to skip doorways whose outward tile is unusable. A west doorway on a room against the world's edge opens onto nothing, and picking it stranded the corridor before it started, which is what drove the breaching fallback.
  - Swept three invariants across 120 seeds: every spawn point is on open floor, the exit is sealed while its door is locked and reachable once open, and a key is reachable without passing that door. A generator that only usually holds these ships an unplayable dungeon to somebody.
  - Added a content check that every template's doorways connect through its own floor. Not hypothetical: the first `sunken-maze` had its east doorway opening into a walled-off pocket, and the generator happily built dungeons that could not be finished.
  - Protocol v6, breaking: `dungeonState` gained `rooms`, `monsterState` gained `typeId`. Recorded in `docs/decisions/0007-content-and-generation.md`.
  - Fixed two regressions the bigger map would otherwise have introduced, both measured rather than guessed:
    - Visibility scanned every tile against every light, which cost about 4ms per player per tick on a 96x64 map and ran twice per player, once for the snapshot and once for voice. It now scans only the tiles inside each light's radius, and the frame is computed once and shared: 4.1ms to 1.9ms per call, at half the calls.
    - Snapshots carried the whole map every tick, about 115 kB/s per player or 600 kB/s for a four-player party. Enabled WebSocket permessage-deflate, which takes it to 1.6 kB/s on the wire because withheld tiles are nearly all blanks. This is a mitigation; sending the map once on join and then only new tiles is still the right fix and is still open.
  - Fixed the e2e movement flake carried over from Backend step 7. It was a real test bug: `next("stateSnapshot")` took the first snapshot after the intent, which can be a tick snapshot from before the move was applied. Added `nextWhere`, which waits on content rather than arrival.
  - Corrected two Backend step 5 checkboxes that were done by step 8 but never ticked: pairwise distances and proximity updates. The signaling relay is still `notImplemented`.
  - Tests grew from 175 to 201, including `tests/server/generation.test.ts`, `tests/server/content.test.ts`, and `tests/server/random.test.ts`.
  - Smoke-tested a generated run against a live server built from `dist/`: a 96x64 map with 99.2% of tiles withheld from a player at the entrance, one room known, and the map opening up as they walked.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (201/201 passing, stable across three consecutive runs), and `npm run build`. Not yet exercised in a browser.
  - Known gap: trap, puzzle, and boss rooms exist as kinds with templates and content, but traps, puzzle objects, and boss gating do nothing yet. That is Backend step 12; this step gives it rooms to put them in.

### 2026-09-17

- Completed Backend step 13, World Tile Scale, with Frontend step 11, on `feature/procedural-generation`:
  - Acted on the first demo: the maps looked small and the corridors and rooms were cramped for four players. One authored tile was one world unit, so a corridor authored one tile wide fitted exactly one body with 0.15 units of clearance either side, and a torch reaching 4.2 units lit most of a twelve-unit room. The dungeon read as cramped rather than dark.
  - Separated the scale content is authored at from the scale it is played at. `TILE_SCALE` is 4, so one authored tile becomes a 4x4 block and a generated run is 384x256 world tiles instead of 96x64. A corridor is now four units across, about five player widths, and a party of four walks it abreast.
  - Put the whole transform in `src/server/game/scale.ts`, applied once to a built dungeon. Generation still lays rooms out, routes corridors, and scatters loot in authored tiles, where the BFS through the padding between rooms is small; nothing downstream of `buildDungeon` sees an authored coordinate.
  - Left `content/` the size it was. A template is still a dozen characters a person can read in a diff. The rule, now in the schema's own docs, is that coordinates scale and world-unit distances do not.
  - Chose the three feel numbers with the owner rather than deriving them: 4x per axis for tiles, speed 2.5 to 6 rather than to 10, and light and voice by 3 rather than 4. The last is what makes the dungeon darker rather than merely larger; scaling light by the full four would have lit the same fraction of the map as before.
  - Rewrote the content numbers that are in world units: light radii by three, monster speeds by 2.4 to match the player, monster perception by three so it still notices you at about the edge of your light. Attack reach is a body's length and did not change.
  - Fixed two things the scale change would otherwise have broken silently, both about the only gate in the game. A closed door plugged one world tile of the sixteen it used to fill, so a party could walk around it; and its centre sat two units inside a doorway that `INTERACT_RANGE` reaches 1.2 into, so a party standing at a locked door could not open it. `doorState.size` carries the opening's width, and reach is measured to the nearest point of it.
  - Sent each player a window of the map rather than all of it. Sixteen times the tiles took a snapshot from 6,144 characters to 98,304, built and deflated per player per tick. `dungeonMapState` gained `originX`/`originY`; the window is 129 tiles across, over 4000px at the renderer's zoom and ten times the torch radius, so nobody can reach its edge between snapshots. This also closes the follow-up left open by step 9, which noted that permessage-deflate was a mitigation rather than the fix.
  - Rewrote line of sight to walk the grid one tile boundary at a time instead of sampling every 0.2 units, which was five samples per tile crossed. At this scale a torch reaches thirteen tiles and every light covers sixteen times the area, so the old sampler would have been the tick's dominant cost again.
  - Moved room discovery to the moment a tile is first lit. Rescanning every room's tiles each tick was fine when a room was a hundred tiles and is not now that it is two thousand; `SessionPlayer` gained `discoveredRoomIds`.
  - Measured rather than assumed: a four-player tick on a generated run costs 9.4 ms against the 50 ms budget, and a snapshot is 9.6 kB before deflate.
  - Redrew the client in world units at 32 pixels per unit, down from 48 per tile. An authored tile still draws at 128px while the player is a fifth of the width of the corridor they stand in. Tiles are clipped to the viewport, which a 384x256 map makes mandatory, and the floor is ruled every `TILE_SCALE` units so it reads as masonry rather than graph paper.
  - Protocol v7, breaking: `dungeonMapState` gained `originX` and `originY`, `doorState` gained `size`. Recorded in `docs/decisions/0008-world-tile-scale.md`.
  - Gave tests an `at(x, y)` helper that names the authored tile they mean, so another change of scale does not rewrite every assertion. Tests grew from 201 to 209 with `tests/server/scale.test.ts`, which covers the expansion itself, a party of four abreast in a corridor, a closed door across its whole width, and the snapshot window's anchoring.
  - Struck through two Direction Alignment entries that Backend step 8 and Frontend step 7 had already closed but that were never updated: darkness and limited sight, and the camera.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (209/209 passing), and `npm run build`. Not yet exercised in a browser.
  - Known gap, and the thing most likely to want tuning after the next playtest: reach is now small relative to a tile. Loot sits at the centre of a 4x4 block, so a player walks to it rather than near it.

### 2026-09-18

- Completed the last open item of Frontend step 7, pixel-art dungeon tiles and props, on `feature/pixel-art-tiles`:
  - Authored the art as text under `assets/sprites/source/dungeon.tiles.json` and baked it to `assets/sprites/dungeon.png` with `npm run build:sprites`. A pull request that moves a flagstone now shows which pixels moved, the same way `content/` shows which monster got faster, and an artist can still overwrite the PNG directly because nothing in the client reads the source.
  - Put the sheet's contents and layout in `src/client/rendering/tiles.ts`, which is free of the DOM so the baker, the renderer, and the node test environment all read one declaration. `tests/client/spriteSheet.test.ts` re-bakes and compares bytes, so the PNG cannot drift from the art it came from.
  - Composed the sixteen wall cells from one fill and four edge strips rather than authoring them. Hand-drawn, the corner cells would have drifted a pixel from the straight cells beside them, and it would only have shown up on a stretch of wall nobody had walked yet. The south face is painted over the side lips, which is why there are no corner sprites at all.
  - Autotiled walls against their neighbours, counting unknown and off-window tiles as wall. Treating undiscovered space as floor would cut a lit lip into the wall wherever the viewer's knowledge stops, which both looks wrong and draws the shape of what they have not explored onto their screen.
  - Weighted floor variants 24:3:3:2 toward plain after the first look in a browser. An even split put a crack or a chip on every other world tile, because a world tile is a quarter of an authored one, and the floor read as rubble under a hailstorm. Variants are picked from a hash of the coordinates, so a cracked flagstone stays put across frames, clients, and reconnects.
  - Kept a flat-colour fallback for the frames before the sheet decodes and for a sheet that never arrives, so a failed load is a plain dungeon rather than a black screen.
  - Read door orientation off the map, since `doorState` carries a span but no orientation. Closed doors tile their leaf over the whole opening; open ones are two jambs so the floor shows through.
  - Left players and monsters as flat figures. `STEPS.md` Frontend step 6 already owns sprites, and directional character art is a larger job than this step's wording covers.
  - Fixed two bugs found by looking at the result in a browser, both fallout from Backend step 13 making single-tile things into 4x4 blocks:
    - A closed door made every tile it covered opaque, including its own, so line of sight to the door's centre tile was blocked by the door itself. `discoveredTiles` never gained that tile and **no closed door was ever sent to any client**. The exemption in `hasLineOfSight` covered one tile, which was right while a door was one tile. It now covers the whole door being looked at, and still does not let anyone see past it.
    - The client picked its interact target by distance to a door's **centre** while the server judged reach to the nearest point of its span, which Backend step 13 had already fixed server-side. Standing at the face of a locked door, the client refused to send the interact the server would have accepted, so **no locked door could be opened from the UI**. The geometry is now `distanceToDoor` in `src/shared/game/movement.ts`, used by both sides, which is what `AGENTS.md` asks for and what would have prevented the drift.
  - Added 39 tests: `tests/client/tiles.test.ts` (22), `tests/client/spriteSheet.test.ts` (10), `tests/shared/doorReach.test.ts` (5), and two visibility cases pinning that a closed door is visible and still opaque. The closed-door case was checked to fail without the fix rather than assumed to cover it. The suite is 260 after merging Backend step 10.
  - Verified every sprite in a browser against a live server: flagstones with sparse damage, autotiled wall lips and south faces, the torch pillar with its glow, a carried flame above the head, the copper key and the minor tonic, the sealed vault door drawn across its whole opening with the lock plate at its centre, the same door open as two jambs with floor showing between them, and the exit stairs filling their authored tile.
  - Recorded the choices in `docs/decisions/0010-pixel-art-tiles.md`.
  - No protocol change. The sheet is 1.4 kB and lands under Vite's inline limit, so it ships as a data URI in the bundle rather than a second request.
  - Merged Backend step 10 (hub and run lifecycle, PR #15) in after it landed mid-task. The tile alphabet seam held with nothing to coordinate: `content/dungeons/hub.json` uses the same `#` and `.` as every other authored map. The new `torch` item kind did exactly what the exhaustive `Record<ItemKind, SpriteName>` was there for and failed the client build until `loot-torch` was authored, rather than spawning on the floor wearing a key.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (260/260), and `npm run build`.

### 2026-09-20

- Added the first playable skill-scroll slice of Backend step 11 on
  `feature/skill-scroll-progression`:
  - Recorded the owner-defined save boundary in `docs/decisions/0011-skill-scroll-progression.md`:
    scrolls occupy inventory, activate on use, become permanent only on extraction, and remain
    unconsumed when the skill is already known. Hub acquisition saves immediately; revive then
    escape counts, and carried extraction will count when Backend step 12 adds it.
  - Added the rare Scroll of Iron Will to boss-room generation and protocol v10's discriminated
    loot/inventory shapes, including its own pixel-art sprite.
  - Added run-local skill state that survives reconnect, activates effects immediately, promotes to
    the profile for standing survivors, and is discarded for a wipe or player left behind.
  - Centralized skill and upgrade effect totals. Resistance affects damage and the HUD, attack
    bonuses affect server-resolved swings, and sight bonuses change server-authoritative torch
    visibility. Puzzle power has no consumer until Backend step 12.
  - Added coverage for content references, scroll use and duplicate refusal, hub permanence,
    extraction/loss, upgrade prerequisites, effect consumers, protocol validation, deterministic
    rarity, and sprite-sheet drift.
  - Verified `npm run lint`, `npm run typecheck`, `npm test` (320/320), and `npm run build`.

- Completed Frontend step 9, Hub World and Run Flow, on `feature/hub-run-flow`. Backend step 10 gave
  the party a hub and a run lifecycle without a single renderer change, by design; this is the half
  a player can see.
  - Drew the hub's named areas from the room metadata the snapshot already carries.
    `content/dungeons/hub.json` is one open 21x13 rectangle: its Quest Gallery, Strategy Hearth,
    Torch Supply and Dungeon Gate exist only as room records, because `AGENTS.md` freezes the
    authored alphabet at `#` and `.` so backend and renderer work stay independent. Outlining and
    naming those records is what turns the data into a place without spending the coordinated
    content, collision, protocol, and renderer change a new tile character costs.
  - Kept the outlines to the hub. A room is discovered the moment any part of it is lit, so drawing
    one in a dungeon would trace its full extent from the first corner a player sees, which is the
    shape of the room they have not explored yet. The same metadata is safe in the hub because the
    hub is lit and monster-free by construction.
  - Drew the signage after the darkness mask, unlike every other label. The mask is a client-side
    vignette around the player rather than the server's lighting, so leaving the signs under it
    faded out the one pointing at the torches exactly when a player was far enough away to need it.
  - Named the place in the HUD from `map.name` plus the room the player stands in, which was
    already on the wire and unused: "The Ember Hearth · Torch Supply". Corrected the connection
    label while there, which said "in dungeon" for every player in the hub since Backend step 10.
  - Refused the gate on the client when the party is not unanimously ready, and named who is
    missing. The server answers a premature gate with `notPermitted`, which is also its answer to a
    locked door without a key and a tonic at full health, so a client relaying it has nothing to say
    beyond "no". `entranceStatus` mirrors `partyReadyForRun` the way `predictMove` mirrors the
    movement rules; the server still decides, and a drift costs a round trip rather than a wrong
    answer. The check is by target rather than by location, so a dungeon exit is never held back.
  - Put every refusal in words. `Action refused: onCooldown` is a protocol token, not a sentence.
  - Derived how a run ended from the two snapshots either side of the return to the hub, since
    protocol v8 announces neither the start nor the end. That bounds what can honestly be said: a
    wipe and an escape that left this player behind are the same pair of snapshots from the client,
    because `returnToHub` heals everyone on the way back. So the banner speaks only about the
    player reading it - what they banked, or that they went down and lost their carry - and never
    about the party. Party-level wording needs a `runEnded` message and a protocol bump.
  - Showed the torch separately from the three slots, and warned in the hub while it can still be
    fixed. A torch is not an inventory item, so nothing else in the HUD would show its absence, and
    the gate does not check: forgetting one is a decision the run will not let you revisit.
  - Made the bank a HUD panel rather than a world object. Storage has no entity in `content/`; the
    bank is `player.bankedItems`, so drawing a vault would mean inventing one.
  - Fixed three bugs, all found by looking at the result in a browser rather than by reasoning:
    - A snapshot overwrote every client-side action message 50ms after it appeared. `view.lastAction`
      keeps its value until the next action, and the HUD re-applied it on every frame, so "No loot
      nearby", "Nothing nearby", "Empty slot" and the gate's own refusal were all wiped before
      anyone could read them. Pre-existing, and it made the new gate message look like it had never
      fired at all. The HUD now applies a server action only when it is a new one.
    - An area name centred on its room sat off screen for most of the walk across it, because an
      area here is wider than the viewport. The first look drew a lone "Y" of "QUEST GALLERY"
      against the left edge while the gallery filled half the screen. Names now centre on the part
      of the area that is actually visible.
    - The gate caption was drawn straight through the player's own name, because below the stairs is
      exactly where a player stands to use them. It sits above them now, and the area label is
      suppressed for a room a fixture already names.
  - No protocol change, no server change, and nothing outside `src/client/` and `tests/client/`.
  - Tests grew from 260 to 281: `tests/client/runFlow.test.ts` (15) covers the gate rule, the
    outcome derivation, area lookup at world scale, and the refusal wording; six more in
    `tests/client/sessionState.test.ts` pin the location transitions, including that the first
    snapshot is nobody's run ending.
  - Verified in a browser against a live dev server, walking the whole flow: the hub named as The
    Ember Hearth with the Quest Gallery, Strategy Hearth and Torch Supply outlined and labelled; the
    place label following the player from Strategy Hearth to Dungeon Gate; the gate captioned
    "Waiting on 1 of 1" above its stairs; "Something is in the way." on walking into the north wall;
    the torch warning and the empty bank; pressing interact at the gate answering "Waiting on Maya
    to ready up." without a round trip; readying up flipping the sign to "The party is ready" and
    the notice to "Use the Dungeon Gate to start the run."; and the interact then landing the party
    in The Vault Run · Cinder Gate, reported as "in a run" with "The run has begun.", the hub's
    outlines and notices gone and the dungeon dark around its wall torches.
  - Not yet seen in a browser: the return to the hub and its outcome banner, which would mean
    walking a generated run to its exit or dying in it. The transition either way is covered by the
    six reducer cases added to `tests/client/sessionState.test.ts`.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (281/281), and `npm run build`.
  - Two known flakes, both pre-existing, both in server tests this branch does not touch. Neither
    can come from this work: the diff is `src/client/` and `tests/client/` only, and nothing under
    `tests/server/` or `tests/e2e/` imports client code. Left alone rather than fixed here, because
    both fixes belong in server tests and would hide in a client PR.
    - `tests/server/scale.test.ts > anchors the window so a world coordinate reads back the tile it
      names`, about 1 run in 20, measured over twenty runs of that file alone. `testSession` builds
      `vault-run` without a seed, so `buildDungeon` draws a random one, and some layouts leave no
      floor tile `SNAPSHOT_VIEW_RADIUS_TILES` clear of every edge for `deepFloorTile` to stand on.
      Pinning the seed fixes it.
    - `tests/e2e/session.test.ts > hub and run lifecycle > starts only when the whole connected
      party is ready`, which times out waiting for `actionRejected`. It failed only on runs that
      took 9-12s against the usual 6.6s, and passed 10 times out of 10 run on its own, so it is a
      timeout that a loaded machine outruns rather than a race in the lifecycle.

- Completed the identity and persistence half of Backend step 11 on `feature/profile-persistence`.
  Nothing a run earned outlived the process before this: `SessionStore` is in memory, so restarting
  the server emptied every bank.
  - Added a profile as its own thing in `src/server/profiles/`, rather than widening the session.
    `SessionPlayer.bankedItems` became `SessionPlayer.profile`, a reference to an object the
    `ProfileStore` owns, so banking at the end of a run needs no write-back step and `toPlayerState`
    reads the bank straight off the profile.
  - Issued identity from the server rather than accepting it from the client. `joinSession` carries
    at most a profile secret; everything about what that profile holds comes back in `sessionJoined`
    and is never parsed from a client frame. Protocol v8 to v9.
  - Stored only a SHA-256 hash of the secret. That is also why `sessionJoined.profileSecret` is
    non-null exactly once, on the join that minted it: the server cannot repeat a secret it did not
    just generate. A client that loses its copy starts a new profile, which is the honest outcome
    and the one the checkpoint's "device-local first" already implies.
  - Put the secret in local storage while the resume token stays in session storage. Opposite
    lifetimes for opposite reasons: a resume token unlocks one slot for sixty seconds, this names
    everything a player has ever banked.
  - Refused a second join by a profile that is already playing, with a new `profileInUse` error.
    One bank spent by two parties would let a run's loot be banked twice or lost twice. The check
    sits after the resume branch, not before it: a reconnecting player's own slot already holds
    their profile, and checking first would lock them out of their own party on a refresh. A slot
    held open for a disconnected player still counts, so a dropped player who opens a new room waits
    out the grace window. Covered by a test, and called out in the README as a thing players hit.
  - Made `markProfileChanged` clockless. Game code is paced by `performance.now()`, and stamping
    that monotonic number onto `lastSeenAt` would have written something meaningless across a
    restart; `lastSeenAt` is set on join instead, where the store's own wall clock is at hand.
  - Persisted with a revision counter rather than a dirty flag on the store, so `returnToHub` can
    bank an item without holding a reference to whatever is writing files. `flush()` compares each
    profile's revision against what was last written and does nothing when nothing changed, which
    is what lets the server call it on escape, on wipe, on join, every sweep, and on close.
  - Wrote to a temp file and renamed over the target, and refused a `profiles.json` that does not
    parse instead of starting empty. Starting empty is the worse failure: the first save would then
    overwrite whatever the file still held.
  - Added no progression currency. `GAMEDESCRIPTION.md` names only items and skills kept between
    runs, and `content/schema.ts` already leaves unlock costs out for the same reason. Recorded as
    a checkpoint rather than decided silently.
  - Two things the tests caught rather than review: the in-memory storage accepted a profile the
    file-backed one rejected, because only the file parsed the schema - the memory double now
    validates on write, so a store bug fails in a test rather than on a deployment. And the first
    end-to-end attempt used `disconnect()` where a player leaving for another room would press
    leave, which surfaced the held-slot refusal above as real behaviour worth its own test.
  - Fixed the `tests/server/scale.test.ts` flake logged on 2026-09-18, since this is a server
    change and that is where it belonged. `testSession` now pins a seed, so a test about snapshot
    windowing is no longer also a test about which map the generator drew.
  - The other flake logged that day is still open: `tests/e2e/session.test.ts > starts only when the
    whole connected party is ready` timed out once on the first full run here and passed on every
    run since, matching the diagnosis that it is a tight timeout rather than a race. Left alone
    because nothing here touches it and a guess at the right timeout is not worth a blind change.
  - Tests grew from 281 to 308: `tests/server/profiles.test.ts` (12) covers hashing, lookup, dirty
    tracking, reload, and every way the file can be untrustworthy; five in `sessions.test.ts` cover
    profile reuse, the in-use refusal, reconnect, and that a failed join mints nothing; four in
    `runLifecycle.test.ts` cover what a run leaves on a profile; five in
    `tests/client/sessionClient.test.ts` drive the real client against the real server, including a
    banked item surviving a restart and arriving back in the roster the HUD draws from.
  - Verified: `npm run typecheck`, `npm run lint`, `npm test` (308/308), and `npm run build`. Also
    smoke-tested the real file path against a live server: `data/profiles.json` is written, holds a
    64-hex hash and not the secret, and a restarted server hands the same device the same profile
    without issuing a second one.
  - Not done here, and the rest of Backend step 11: unlocking skills and applying their effects.
    `unlockedSkillIds` and `unlockedUpgradeIds` persist but stay empty. Frontend step 10 is their
    visible half and should follow that, not this.
