# Project Progress

Use this file as the project ledger. Update it whenever a step or substep from `STEPS.md` is completed, changed, blocked, or skipped. Keep entries short: the merged pull request and its commits are the detailed record, so the activity log names the change and points there.

## Current Status

- Overall phase: Backend steps 7-10, 12, and 13 complete; Backend 11 partly done (profiles,
  persistence, first skill scroll). Frontend steps 1, 2, 4, 5, 7, 8, 9, and 11 complete. Sessions
  start in a lit hub, a unanimously ready party generates a run, and escape or a wipe returns
  everyone to the hub under protocol v36.
- Last completed work: quiet HUD modules fading to 55% opacity after 4 s out of combat (issue #169, HUD Torch & Tally Phase 4, protocol unchanged); earlier, a redesigned hotbar with a 72px brass-edged hand slot, readable empty slots, violet skill-scroll glow with a SKILL badge, and a round torch slot that glows ember when lit (issue #168, HUD Torch & Tally Phase 3, protocol unchanged); earlier, a baked 9-slice HUD frame and brass corner studs on every panel (issue #166, HUD Torch & Tally Phase 2, protocol unchanged); earlier, a draw strength and aim indicator for the bow (issue #117, protocol unchanged); earlier, the Hunting Bow, drawn by holding a key, with range growing to a cap at
  two seconds and arrows that fly in the hub too (issue #116, protocol v36); earlier, minimap allies marked in their party colour with an initial, and arch and
  chest icons on discovered tiles (issue #171, HUD Torch & Tally Phase 5, protocol unchanged);
  earlier, speaking rings on party portraits from per-peer remote voice levels, with a
  hold and a proximity cutoff (issue #173, HUD Torch & Tally Phase 5, protocol unchanged); earlier,
  readying up by standing on four plates in front of the hub gate, lit in the
  holder's party colour, with a cue when the last one fills (issue #147, protocol v35); earlier, a
  hotbar slot pulse on a confirmed item use and an icon fly-in on pickup (issue #175, HUD Torch &
  Tally, protocol unchanged); earlier, toasts and the hub gate status merged into one top-centre
  notice stack, with a party-colour ready pip per member (issue #163, HUD Torch & Tally Phase 1,
  protocol unchanged);
  earlier, sitting on hub benches and the fountain rim (issue #148, protocol v34);
  earlier, the minimap given its own top-right frame with a room-name header (issue
  #162, HUD Torch & Tally Phase 1, protocol unchanged); earlier, the session and voice controls
  moved into an Esc camp menu (issue #161, HUD Torch & Tally Phase 1, protocol unchanged); earlier, HUD colour tokens and the self-hosted
  Silkscreen and Pixelify Sans fonts (issue #165, HUD Torch & Tally Phase 2, protocol unchanged); earlier, the Attack and Emote buttons
  shown only on touch devices (issue #164, HUD Torch & Tally Phase 1); earlier, the hub re-authored as a ring round a 3x3 fountain, with stalls on the
  diagonals, a gate road, a campfire clearing, a training yard, benches and a ragged forest edge
  (issue #145, Hub Revamp Phase 3, protocol v33); earlier, ambient hub lighting with varied,
  flickering lights and distance-based prop
  name plates kept clear of the HUD (issue #146, Hub Revamp Phase 4, protocol v32); earlier, party frames with character portraits and a "Designing…" state, and a hub
  banner that names who is still designing (issue #134, protocol unchanged at v31); earlier, players
  drawn as layered pixel-art characters in their own look and party colour (issue #132); earlier, hub training dummies with a server-kept
  damage-per-second readout (issue #150, protocol v31); earlier, an emote wheel with server-validated, rate-limited emotes (issue #149,
  protocol v30); earlier, animated weapon swings drawn from server-resolved reach and arc (issue #129,
  protocol v29); earlier, server-validated player appearance and party colours (issue #131, protocol
  v28); earlier, stamina draught, flare, and smelling salts consumables, with revive of a
  downed ally (issue #85, protocol v27); earlier, lootable chests placed by room templates (issue #88, protocol v26);
  earlier, stackable arrows that take one inventory slot (issue #115, protocol v25); earlier, server-lit tiles, so remembered and shared map stays dark (issue #120, protocol v24); earlier, the Rusted Sword and swinging in the hub (issue #114, protocol v23);
  earlier, a held-item slot and the `weapon` item kind (issue #113, protocol v22); earlier, ranged and charging monster behaviours (issue #91, protocol v21); earlier,
  a minimap that fills in as the party explores (issue #105); earlier,
  monsters route round walls on a shared flow field, aggro only on players
  they can see or hear, and leash home (issue #89); earlier, dropping and handing over inventory
  items (issue #87, protocol v19), owner-only banks and a once-per-tick roster (issue #81, protocol v17);
  earlier, monster loot tables and drops on death (issue #86), content-driven consumable effects
  (issue #84) and client WebRTC
  proximity voice (issue #27), closing Frontend step 5.
- Next recommended step: a wider item catalog, combat depth, and tick
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
- HUD Torch & Tally open questions, decided on 2026-10-21 for issue #160:
  - Unseen allies appear as a greyed "out of sight" frame with no position, health or resistance and
    a non-colour cue. This needs a server-sent party roster, built in #172.
  - The minimap stays free for everyone for now; revisit with the Skills UI (#25) and the progression
    economy (#23).
  - Health and resistance show their numbers (`82/100`) inside the bar, with an accessible text
    equivalent; stamina stays a bare bar. The Minimal density level (#170) may hide the numbers.
  - The run clock is a numberless torch that burns down toward the decay window, built in #174. The
    exact time stays in its accessible label.
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
- [x] Add a server-validated character look and party colour (issue #131, protocol v28). Shared id lists live in `src/shared/constants/appearance.ts`. `PlayerState` carries a public `appearance` (null while still designing) and a `partyColor`, the first colour free in the session, which is kept through reconnects and reused once the slot is released. `sessionJoined.needsAppearance` asks for a look, and `setAppearance` sets it once (`invalidAppearance`, `appearanceLocked`). A player still designing holds a slot but blocks nobody, cannot be given items, and has their move, attack, interact, item, carry and ready intents refused. `partyReadyForRun` waits on them, and the server spawns them on free ground once the look is set. The client skips players without a look when it draws, predicts, and fills the minimap. Run-save persistence (#122), the design screen and roster, and sprites remain out of scope.

### 3. Authoritative Dungeon State

- [x] Start with one fixed dungeon map. Each session clones the Ember Vault map from `src/server/game/dungeonState.ts`.
- [x] Validate player movement against walls, bounds, and occupied tiles. `movePlayer` handles zero intent, map collision, player occupancy, monsters, and closed doors.
- [x] Store monsters, loot, doors, exits, and room metadata server-side. The dungeon instance hangs off `Session.dungeon`.
- [x] Broadcast state changes after validated actions. Accepted actions mutate authoritative state and the 20Hz tick sends the `stateSnapshot` (issue #29); only the tick advances `session.tick`.

### 4. Combat and Game Rules

- [x] Implement attacks, damage, death, and simple monster behavior. Simple real-time melee in
  `src/server/game/combat.ts`; monsters chase and attack on the tick; downed players stay down until
  the run ends or future revive/carry mechanics resolve them. Monsters path round walls on a shared
  per-tick flow field, need line of sight or hearing to aggro, and leash home (issue #89).
- [x] Telegraph monster attacks with a wind-up players can step out of (issue #90, protocol v20).
  Monster content gains `windupMs`, `hitArcCos`, and optional `hitRange`; `combat.ts` holds a monster
  still while it winds up and resolves the hit against whoever is in its cone then. Snapshots carry
  `action`, `windupProgress`, `facing`, `hitRange`, `hitArcCos`. The optional dodge step is not
  implemented (left to an owner decision).
- [x] Add ranged and charging monster behaviours (issue #91, protocol v21). Monster content gains a
  `behavior` (`melee`, `ranged`, `charger`) with `projectile` / `preferredRange` / `charge` stats,
  validated at load. `monsterAttacks.ts` simulates server-owned projectiles (stopped by walls, closed
  doors, and the first player on the path; expire at range) and dashes (stopped by a wall or door,
  which stuns). Snapshots carry visible `projectiles` and each monster's `behavior`; the client draws
  placeholder bolts and tints by behavior. Content: Cinder Spitter and Slag Charger in `ashen-hall`.
  Boss phases and monster art (#63) remain out of scope.
- [x] Add item pickup and inventory basics. `src/server/game/items.ts` handles pickup, tonics, key-locked doors, and the exit.
- [x] Let players drop and hand over inventory items (issue #87, protocol v19). `dropItem` puts the item back on the floor as re-pickable loot with its own id (lost at run end, never banked); `giveItem` moves it to a standing, connected party member within `INTERACT_RANGE` with a free slot. Client keys: drop `Q`, give `T`, both acting on the last-used hotbar slot.
- [x] Add a held-item ("in hand") slot and a `weapon` item kind (issue #113, protocol v22). `held` on the player is separate from the three inventory slots and the torch; a weapon pickup fills the hand, then inventory, then is refused. `swapHeld` swaps the hand with an inventory item (null stows it). Drop, give, banking and resume treat it like carried items. Client: hand slot beside the hotbar, rebindable swap key `V`. No concrete weapon or attack change yet; the sword, ammo and bow issues build on this.
- [x] Animate player weapon swings (issue #129, protocol v29). `attackResolved` carries `swing` (attacker `origin`, `facing`, `range`, `arcCos`, taken from the held weapon or the unarmed constants, sent for misses too) and is `null` for monster attacks. The client's pure `swingArc` helper in `combatFeedback.ts` turns it into an arc and skips attackers outside the visible frame; the renderer sweeps a ~180 ms slash out to the exact reach, brighter with an impact flash on a hit. Held-weapon sprites and attack poses (#63), bow indicators (#117), and new weapons (#92) remain out of scope.
- [x] Add hub training dummies with a damage readout (issue #150, protocol v31). A dummy is its own entity (`DummyState` in `dungeon.dummies`), not a monster kind, so monster AI, loot, boss gating, run results and progression never see it. Authored dungeons list `dummies` (`entityId`, `x`, `y`); content validation refuses one on a wall, off the map, or reusing an id. `resolvePlayerAttack` treats dummies as targets with the same reach and arc as monsters and reports the full damage (with `attackDamageBonus`), `targetHealth: 0`, never a defeat. `src/server/game/dummies.ts` keeps a 5 s rolling hit log per dummy and sends each viewer per-attacker `recentDamage` and `dps` (averaged over at least 1 s). The hub has two, in the training yard since #145. Client: `rendering/trainingDummies.ts` draws a straw dummy that wobbles when hit and a DPS plate while it has hits; damage numbers and swing impacts find dummies. Dummies do not block movement, like monsters.
- [x] Let players sit on hub benches and the fountain rim (issue #148, protocol v34). Authored dungeons list `seats` (`entityId`, `x`, `y`, `facing` north/south/east/west); content validation refuses one off the map, facing no walkable floor, or reusing an id. The hub has two per bench and four on the rim, each placed just inside the solid tile's edge so a sitter is seen from the floor. Seats ride `map.seats` and arrive with map discovery once each. `playerInteract` on a seat (`src/server/game/seats.ts`) needs a designed, standing player who is not carrying, carried or already seated, within `INTERACT_RANGE`, and a free seat (`blocked` otherwise); it moves them onto it and sets the public `PlayerState.seatId`. Any move intent, an attack, a lift (either side), a disconnect and a world change stand them up onto free floor in front of the seat, so no step goes through the bench and a reconnect comes back standing. Client: a "Sit" prompt for a free seat in reach, no move prediction while seated, and the standing figure drawn slightly lower until #132 adds a seated frame.
- [x] Add the Rusted Sword and allow attacks in the hub (issue #114, protocol v23). A `melee` weapon block carries `damage`, `range`, `arcCos`, `cooldownMs` and `staminaCost`; `resolvePlayerAttack` reads them from the held weapon's content at each swing (weapon items now carry their content `itemId`) and falls back to the unarmed constants otherwise. `attackDamageBonus` stacks on top. `rusted-sword` (today's unarmed values) lies in the hub spawn area. Hub swings hit nothing but cost stamina and cooldown, and stamina regenerates in the hub. Own sprite `loot-rusted-sword`, generic `loot-weapon` fallback. Bow, projectiles and weapon traits remain out of scope.
- [x] Add stackable arrows (issue #115, protocol v25). New `ammo` item kind with a content `maxStack` (at most 99) and a `count` on loot and inventory entries; a stack takes one slot. Pickup tops up carried stacks of the same item, then takes a free slot, leaving any remainder on the floor. Drop and give move the whole stack, and give refuses unless it all fits. `consumeFromStack` spends from a stack and removes it at zero, ready for the bow. `arrow` (`maxStack` 8) lies as a stack of 5 beside the hub sword; authored placements take an optional `count`. Saved stacks without a `count` load as 1. HUD shows the count on the slot and in the pickup prompt; sprite `loot-arrow`. Splitting stacks and the bow remain out of scope.
- [x] Add the chargeable Hunting Bow (issue #116, protocol v36). A `ranged` weapon block carries `drawMs`, `minDrawMs`, `minRange`/`maxRange`, `damage`, `projectileSpeed`, `projectileRadius`, `staminaCost` and `ammoItemId` (checked to be an ammo item at load). `beginDraw`/`releaseDraw` carry only an aim direction: the server keeps the draw clock (`player.draw`), derives the fraction itself, and `bowMaxRange` is the one place a later `bowRangeBonus` can raise the cap. Beginning needs the bow in hand, an arrow and the stamina; the release spends one arrow and the stamina, then spawns a player-owned projectile (`ProjectileRun.ownerId` is a player) that stops at walls and closed doors, passes the party, and hits the first monster (through the shared `damageMonster`, with `attackDamageBonus`) or training dummy. A release before `minDrawMs` fires nothing; swapping the held item, going down, disconnecting or a world change cancels the draw at no cost. `playerState.drawFraction` carries the server fraction for the indicator issue; the client holds a rebindable key (`R`) and shows a plain bar. `hunting-bow` lies on the hub Weapons counter. The draw indicator followed in #117 (below). The range upgrade (#23), the sling (#92), arrow retrieval and monster ammo drops remain out of scope.
- [x] Show a draw strength and aim indicator while drawing the bow (issue #117, no protocol change). The pure `bowAims` in `src/client/state/bowIndicator.ts` turns `playerState.drawFraction` into an aim line from the player: the local player along the held keys' heading (or facing), a visible ally along their facing at half length. The line grows from `minRange` to `maxRange`, over a faint full-draw ghost line with an end tick; at full draw it thickens, turns green and ends in a ring. The HUD meter now has an end tick and a "FULL DRAW" label, so the cap never rests on colour alone, and prop labels avoid it. The snapshot carries no bow stats, so the client mirrors `minRange`/`maxRange` for `hunting-bow` in `BOW_RANGES`; a test checks them against `content/items/hunting-bow.json`, and a new bow must be added there (and any `bowRangeBonus` later needs the server to send the range). Walls are ignored visually; the server decides the hit. Bow audio, arrow art, aim assist and a sword crosshair remain out of scope.
- [x] Add lootable chests (issue #88, protocol v26). Named tables live in `content/loot-tables/` (the monster loot-table shape plus an `id`). A `ChestState` entity (`lootTableId`, `opened`, `locked`) is placed by a template `chests` rule or an authored `chests` list; the tile alphabet is unchanged. `playerInteract` on a chest in reach rolls its table once from the session drop stream and spills the items as loot at least 1.5 world units beside it; an opened chest refuses further tries, and a locked one spends a key like a locked door. Snapshots carry chests on tiles the viewer can see. `sunken-maze` always holds a `common-chest`, `ashen-hall` sometimes does, and `warden-crucible` holds a `vault-chest`; no shipped chest is locked. Client: "Open chest"/"Unlock chest" prompt and `chest-closed`/`chest-open` sprites. Mimics, trapped and two-player chests remain out of scope.
- [x] Add stamina, light, and revive consumables (issue #85, protocol v27). Content-only Stamina Draught (`restoreStamina`). New consumable effects `flare` (`radius`, `durationMs`: a dungeon-owned light of kind `flare` at the user's feet, lit fresh each tick rather than cached, removed when `session.flareExpiresAt` passes) and `revive` (`healthFraction`, `staminaCost`: Smelling Salts stand a downed, connected, uncarried ally in `INTERACT_RANGE` back up; it must be the item's only effect). `useItem` takes an optional `targetPlayerId`, required for a revive item and refused for anything else; consumables carry `useOn` (`self`/`downedAlly`, defaulting to `self` for banked items). All three roll from the chest tables, and the Ashen Hall and Sunken Maze templates place them at low odds. Client: a "Revive <name>" prompt on the salts' slot key near a downed ally, plus `loot-draught`, `loot-flare`, `loot-salts`, and `flare-lit` sprites. Hub shops, rarity UI, and throwing physics remain out of scope.
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
- [x] Send dungeon discovery deltas instead of rebuilding the map window every snapshot (issue #30,
  2026-10-09, protocol v18). `stateSnapshot.dungeon.map` is now `mapDiscovery`: world size plus runs
  of newly discovered `#`/`.` tiles, with `reset` marking a full baseline (first snapshot, reconnect,
  rebuilt world). The server queues tiles as `recordDiscovery` finds them (`pendingDiscovery`) and
  `takeMapDiscovery` drains them once per snapshot sent; the client accumulates them into a
  whole-world map (`src/client/state/discoveredMap.ts`). `SNAPSHOT_VIEW_RADIUS_TILES` and the window
  are gone. Lit versus remembered no longer travels in tiles (it travels as `lit` runs since #120). Doors
  stay in the per-snapshot `doors` list, so mutable geometry is unaffected. `bench:tick` (4 players,
  seed 1234), before to after: steady snapshot 9202 to 2392 bytes (885 to 734 deflated); serialize x4
  0.024 to 0.013 ms; visibility x4 at spawn 0.71 to 0.41 ms, explored 0.57 to 0.34 ms. A full
  baseline of a fully explored world is 107 kB (2.7 kB deflated), sent once per connection or world.
- [x] Share discovered map data between nearby players (issue #106, 2026-10-11). While two players are
  standing, connected, and within `PLAYER_MAP_SHARE_RANGE` (one torch radius, to be tuned in playtest) in
  a run, `shareDiscoveredMaps` (`src/server/game/mapSharing.ts`, called each tick before snapshots)
  merges their discovered tiles and rooms both ways, line of sight not required. Merges walk each
  player's append-only `discoveryLog` from a per-pair cursor, so a steady party costs ~0.001 ms.
  Geometry only: monsters, loot, players, and lit status still come from the viewer's own light. Doors
  on newly known tiles are listed like any door on a discovered tile. Merged tiles ride the ordinary
  discovery delta (no protocol change). Nothing is shared in the hub (fully lit); logs and grids reset
  with the world and are never persisted. Knowledge already received is kept after separating, and
  relays through a middle player.
- [x] Send each viewer what their light reaches now, and shade only that (issue #120, 2026-10-15,
  protocol v24). Since #30 every discovered tile drew as lit, so explored and map-shared geometry
  beyond every light glowed at half brightness and torches shaded remembered tiles through walls.
  `mapDiscovery.lit` carries the viewer's whole lit set each snapshot as `[x, y, length]` row runs;
  the client keeps it beside the accumulated map (`src/client/state/litTiles.ts`) and the shader
  reads every other discovered tile as remembered, fully dark. `UNATTRIBUTED_DARKNESS` and
  `RIM_SLACK_TILES` are gone: a lit tile no light in view reaches is dark too. `bench:tick` (seed
  1234): steady snapshot 2454 to 2665 bytes (754 to 841 deflated), explored 2566 to 2777 (807 to
  892); snapshot build x4 0.72 to 0.80 ms.

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
- [x] Ready plates (#147, v35): four authored `readyPlates` before the gate ready whoever stands on
  one through the same path as the button, and stepping off takes back only plate-set ready. Once
  the whole party is ready it is kept, so a player can walk to the gate; the button still backs out.

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
- [x] Send a window of the map rather than all of it. `dungeonMapState.originX/originY` and `SNAPSHOT_VIEW_RADIUS_TILES`. Superseded by discovery deltas (issue #30).

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
  Local prediction skips a step onto ground the client has never been shown (`stepsIntoUndiscovered`
  in `src/client/state/gameState.ts`) and follows the server's placement instead. Without a torch
  nothing ahead is discovered, and predicting against unknown tiles as walls froze the player and
  snapped them forward over and over in the dark.
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
- [x] Add a minimap in the top-right session cluster (issue #105). `src/client/state/minimap.ts` and
  `ui/hud/minimap.ts` draw the accumulated discovered map (black where undiscovered, so tiles shared
  by nearby players appear like self-discovered ones), the local player with facing, visible allies
  only (ring standing, cross downed), and exits once sent. It is windowed around the player on large
  worlds, repaints only on a change, toggles with a rebindable key (M), and starts shown in each new
  world. No protocol change.
  - [x] Give the minimap its own top-right frame (issue #162, HUD Torch & Tally Phase 1). `ui/hud.ts` puts a `hud__corner` column in the top-right with the minimap first, so its anchor never moves, and the session panel stacked under it; a hidden minimap takes no space and the panel rises into the corner. It keeps one size on short windows (no more 60% shrink). A header strip shows `minimapRoomName` ("Hub" in the hub, otherwise the authored room under the predicted position, or the dungeon's name between rooms) and an `N` mark.
  - [x] Show party colours, initials and icons on the minimap (issue #171, HUD Torch & Tally Phase 5). `minimapAllies` gives each visible ally their `PARTY_PALETTES` ring colour and `minimapInitial` (first letter or digit of the name); a standing ally is a ring holding the letter, a downed one a cross with the letter beside it. `rememberMarkers` keeps exits and chests seen in the current world (a chest keeps its last-seen opened state), and `minimapIcons` draws them only on discovered tiles: an arch for an exit, a box for a chest, hollow once opened. The canvas `title` carries the legend. No protocol change.
- [x] Add an emote wheel (issue #149, protocol v30). `EMOTES` in `src/shared/constants/emotes.ts`; the
  `emote { kind }` message is refused for a player with no look, anything but `help` while downed, and
  more than one a second (`rateLimited`). `playerEmoted` goes only to the sender and the party members
  whose visible frame holds the emoter (`src/server/game/emotes.ts`). The client opens the wheel on a
  rebindable key (B) or the HUD's Emote button, picks by mouse, touch, or keys 1-8, draws a ~2 s
  bubble (`rendering/emoteBubbles.ts`), and writes a line to the action feed (a toast since #161).
- [ ] Add minimal menus for start, pause, settings, and exit. A Controls menu now exists; start/pause/settings/exit menus remain.
  - [x] Move the session and voice controls into an Esc camp menu (issue #161, HUD Torch & Tally Phase 1). `ui/hud/campMenu.ts` holds Ready, Leave, Stash, Controls, and the voice readout, level meter, and Enable/Mute/Deafen buttons, with the disabled rules they had. Escape opens it once the player is in the world, unless the controls menu, the emote wheel, or the Stash takes the key first; Escape, Close, or a click outside shuts it. It does not pause the game; while open it owns the keyboard, traps Tab, and hands focus back on close. On screen stay a mic chip (`micChipView`: grey off/starting/muted/deafened, green live, amber blocked or missing, always with text) that opens the menu, a one-line key-hint strip whose Esc hint is also a button for touch, and a Ready button shown only in the hub (`hubReadyVisible`). The title, Place, and Action lines are gone: the latest server action and client refusals now show as an `action` toast, and the room name moves to the minimap header in #162.
  - [x] Merge the toasts and the hub status into one notice stack (issue #163, HUD Torch & Tally Phase 1). `ui/hud/toasts.ts` `createNoticeStack` puts the hub banner and the toast list in one `hud__notices` column at the top centre, so they flow instead of overlapping; the banner is drawn as a toast card, amber while waiting and green when ready. `hubStatusView` adds one `pips` entry per party member in their party ring colour, filled with ✓ when ready and hollow with ○ otherwise (dashed while designing, dimmed while disconnected, each with a spoken label), plus the gate key hint. Toast timing, order, and live regions are unchanged.

### 4. Combat and Dungeon Interaction

- [x] Add controls for attack, interact, pickup, and use item.
- [x] Display server-confirmed combat results.
- [x] Draw a growing, flashing cone telegraph for a winding-up monster (issue #90).
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
- [x] Add mute, deafened, input level, and permission-denied states. Camp menu buttons (#161), a
  level meter, and "microphone blocked" / "no microphone" readouts (`src/client/ui/hud/voice.ts`),
  plus an on-screen mic chip.
  - [x] Show speaking rings on party portraits (issue #173, HUD Torch & Tally Phase 5). Each peer
    link reads its remote stream through an analyser in the microphone's AudioContext, made on the
    track and disconnected on close. `voiceMesh.speakingPeers()` marks a connected peer speaking at
    or over `DEFAULT_SPEAKING_THRESHOLD` and holds it for `DEFAULT_SPEAKING_HOLD_MS` (400 ms); a peer
    at volume 0 (out of earshot, or this player deafened) never shows. The party frame gets a gold
    portrait ring and a ♪ "Speaking" badge; reduced motion keeps the ring steady. Client-only.

### 6. Polish and Playtesting

- [ ] Add sprites, sound effects, and visual feedback.
  - Player character sprites, the character design screen, and cosmetics are designed and owner-approved in `docs/design/character-sprite-bible.html` (decisions on #63 and #128). Open it in a browser; its `SPRITES` object is the pixel data to port. Monster sprites still need their own design pass.
  - [x] Give the hub a ground layer and a hue-shifted palette (issue #144). Rounded cobble with a plum gap, grass and dirt, ragged grass edges, the forest canopy overhanging the floor with a 25% shade, contact shadows under props, and one muted awning colour per stall. The ramps are documented in `assets/sprites/README.md`.
  - [x] Port the character bodies and hair to source art and bake a character sheet (issue #136). `assets/sprites/source/characters.tiles.json` holds `body-{guy,girl}` and six hair styles, each facing `down`, `up` and `side`, as whole 16 x 24 frames ported pixel for pixel from the reference. Skin, hair and tunic are baked in nine key colours (`CHARACTER_KEY_COLOURS`) for the renderer to swap; everything else is a fixed colour. `npm run build:sprites` also bakes `assets/sprites/characters.png`, deriving `walk1`/`walk2` frames by lifting one half's boots a row. `src/client/rendering/characters.ts` lists the layers and frame cells. Drawing characters in game, hats and cloaks, and attack and downed frames remain out of scope.
  - [x] Draw players as layered pixel-art characters with party colours (issue #132). `characters.ts` recolours the sheet's key colours by exact swap from the bible's ramps (`characterPalettes.ts`, keyed by the shared ids), closes the eyes for a blink, picks the facing (left mirrors `side`) and the 8 fps walk from whether the drawn position moved, and caches one composite per `body|skinTone|hairStyle|hairColor|partyColor`. `characterSprites.ts` stamps them at `pixelsPerWorldUnit / 16`, feet on `position.y + PLAYER_RADIUS`, over a 13 x 5 party-colour ring, in `y` order, with names tinted in the party colour. Downed and disconnected players draw at 45% alpha; a null appearance is not drawn. Every client still sends `DEFAULT_APPEARANCE` until the design screen exists. Hats, cloaks, dyes, attack and downed frames remain out of scope.
  - [x] Add the character design screen between the lobby and the hub (issue #133). When `sessionJoined.needsAppearance` is true and the player's own entry has no look, `ui/characterDesign.ts` shows a full-screen step: body, skin tone, hair style and hair colour as keyboard-navigable radio groups, a read-only party colour chip, a 10x preview (6x at phone width) with Turn and Walk and an idle blink, and an in-game-scale panel on flagstones with the party. The look opens as the last confirmed one from `localStorage` (`dnd.lastLook`) or a random one, and an id that is no longer offered falls back to random (`state/characterDesign.ts`). **Enter the hub** sends `setAppearance` and shows "Entering…" until the snapshot carries the look, or the server's refusal inline; **Back** leaves the session. The client no longer sends `DEFAULT_APPEARANCE`, and holds back its own move and action intents while designing. The name is shown, not editable: the protocol has no rename message, so editing it on this screen needs a protocol change and is left for a follow-up. The preview builds its own composites in `characterPreview.ts` from the shared helpers; folding it into `characterSprites.ts` waits on #156. The party roster's "Designing…" entry and cosmetics remain out of scope.
  - [x] Give the HUD a palette and pixel fonts (issue #165, HUD Torch & Tally Phase 2). `styles.css` defines `--hud-*` colour tokens on `:root` (panel, frame, brass, ember, text, and a light/dark pair per vital) and the HUD rules use them instead of literals; vital fills are two-tone. Silkscreen (numbers, key hints, labels) and Pixelify Sans (names, headings, sentences) are bundled as WOFF2 in `assets/ui/fonts/` with their OFL licences and load with `font-display: swap`; nothing is fetched from a font host. Vital glyph labels stay in the system face so ◆ and » keep their size. No layout change; the 9-slice frame is #166, below.
  - [x] Bake a 9-slice HUD frame and brass stud and restyle every panel (issue #166, HUD Torch & Tally Phase 2). `assets/sprites/source/hud.tiles.json` authors a 16x16 frame (4 px border) and an 8x8 stud as text; `scripts/hudSprites.ts` bakes them to `assets/sprites/hud-frame.png` and `hud-stud.png` through `npm run build:sprites`, and `tests/client/hudSprites.test.ts` fails if a PNG drifts. `styles.css` draws the frame with `border-image` and the studs as four corner backgrounds on the party, session, hints, stash and camp-menu panels, the minimap, party frames, prompt, toasts and hotbar slots, at `--hud-zoom`: `hudFrameZoom` gives 2 at every UI scale up to Large and 3 at Extra large, so the art stays on whole pixels. Party colour is an inset stripe, warning and error toasts a 1 px ring, and the held slot a brass ring; the notice stack narrowed by 2rem for the thicker border. `tests/e2e/browser/hudFrame.spec.ts` checks the frame, zoom and no clipping or overlap at the default and largest scale. The self frame and hotbar redesign stay Phase 3.
  - [x] Fade quiet HUD modules back to 55% opacity (issue #169, HUD Torch & Tally Phase 4). `state/hudFade.ts` holds the rule and its constants (`HUD_FADE_QUIET_MS` 4000, `HUD_FADE_COMBAT_HOLD_MS` 4000, `HUD_FADE_OPACITY` 0.55) and takes `now` from the caller. `ui/hud.ts` compares a per-module signature on each snapshot (vitals, party frames, hotbar, minimap room, session, run clock) and re-evaluates every 250 ms, setting `data-faded` on the module; `styles.css` dims it to `--hud-fade-opacity` with a 0.4 s transition, none under reduced motion. Damage taken or the Attack button restores everything and holds it for 4 s; any key press restores everything. Never faded: the vitals while health is low or resistance is decaying, the party frames while an ally is downed or carried, any module holding focus, and every module while the camp menu or Stash is open. `--hud-text-muted` was lightened so it holds 4.5:1 at 55% over an unlit scene. The Full/Calm/Minimal setting is #170. No protocol change.
  - [x] Add a HUD density setting next to UI scale (issue #170, HUD Torch & Tally Phase 4). `density` (`full` | `calm` | `minimal`, default `calm`) joins `HudSettings`, parsed per field so an unknown stored value falls back to `calm`; blocked storage degrades to `calm` too. `HUD_DENSITY_RULES` in `state/hudFade.ts` holds the rule: Full never fades, Calm is the #169 55% fade, Minimal fades to 35% and hides the key hints (the camp button stays). Warnings, vitals, party frames and focus pin modules at every level. The HUD settings select sets `data-hud-density` on the root and fires `hud-settings-changed` so the change applies at once. Minimal's 35% is an opt-in and sits below the 55% contrast floor the accessibility spec checks. No protocol change.
  - [x] Redesign the hotbar (issue #168, HUD Torch & Tally Phase 3). `hotbarView`/`heldView` carry a `SlotKind` (`empty`, `scroll`, `item`) and `torchView` gives the lit/out state; `ui/hud/hotbar.ts` toggles `hud__slot--empty`/`--scroll` from it and every slot holds a `SKILL` badge shown only for scrolls. The hand slot is 72px with a brass edge, the three item slots 60px, and empty slots are an opaque brown socket with an inset edge instead of 60% opacity. Scrolls glow violet; the torch is a round slot that glows ember while carried and is dimmed and desaturated otherwise, keeping its title and aria label. The prompt and key hints are unchanged. `tests/e2e/browser/hotbarLook.spec.ts` checks the sizes, opaque empty slots and the dim torch. No protocol change.
  - [x] Pulse a hotbar slot on a confirmed item use and fly a picked-up item into its slot (issue #175, HUD Torch & Tally). `state/itemFeedback.ts` diffs consecutive views: an inventory item that is gone and neither on the floor (dropped) nor carried by an ally (given) was used, a stack whose count fell was spent, and a new id or a grown stack was picked up or received, with its origin taken from the floor entry, the giving ally, or the pile of the same ammo that shrank; a swap or the shuffle after a slot empties is quiet, and nothing is reported across a hub/run transition. A refused use or a full-inventory pickup changes no slot, so it shows nothing. `ui/hud/itemFeedback.ts` plays a 360 ms pulse and a 420 ms fly-in from the item's screen position (the centre when off-screen) into the hand, a slot, or the torch pip; both ignore the pointer. Under reduced motion both are one instant highlight. Sound and world loot-drop animation stay out of scope.
- [ ] Test with 2-4 players in the same dungeon.
- [ ] Fix layout, browser permission, and reconnect edge cases.
  - [x] Show the HUD's Attack and Emote buttons only on a coarse pointer (issue #164, HUD Torch & Tally Phase 1). `state/touchControls.ts` follows `(pointer: coarse)`, including a hybrid device switching input at runtime; on a fine pointer the buttons are hidden and out of the tab order, and the bottom-right panel hides when the run clock is hidden too. The hotbar and prompt keep their key hints.
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
  lift the nearest downed party member in reach, or drop whoever is currently carried. The Attack
  and Emote buttons show only on touch devices (#164).
- [x] Render loot, doors, exits, monster health, downed players, and hub/run outcome state. The last
  two landed with Frontend step 9: the HUD names the place from room metadata and reports how the
  run ended.
- [x] Show combat results, refusals, and the resistance decay warning. The HUD warns from `stateSnapshot.run` a minute before decay starts, then while it is falling.

### 9. Hub World and Run Flow

Complete on `feature/hub-run-flow`.

- [x] Render the hub, entrance, torch supply, and storage. Areas are outlined and named from the
  room metadata in the snapshot, and the gate is captioned with what it is waiting for. Storage has
  no world entity to draw, so the bank is a HUD panel. Hub Revamp Phase 1 (#143) added a `forest`
  map theme and render-only props (fountain, stall, quest board, tree, bush, gate, sign) sent once
  with their first discovered tile. Phase 2 (#144) added an optional render-only `ground` grid
  (grass, cobble, dirt) sent with the discovery runs it describes, grass fringes onto cobble, the
  forest canopy's overhang and shade, prop contact shadows, stall awning tints, and hue-shifted
  ramps. Phase 3 (#145, v33) re-authored the hub as a 23x15 ring round a 3x3 fountain: a two-tile
  cobble ring road with four benches, the Torch Supply and Weapons stalls (pickups on their
  counters) north-west and north-east, the Bank and Wardrobe south-west and south-east facing
  north, the gate up a straight road with a clear strip before it, dirt paths to a campfire
  clearing with the quest board (south-west) and a training yard holding the dummies (north-east),
  and a ragged forest edge with single trees and bushes. Everything solid stands on `#`, and every
  light on open floor; a `#` with `ground` beneath it draws as that ground, not forest. New props
  `bench`, `log` and
  `campfire`, and `facing: "north"` for stalls and benches. The four spawns sit level with the
  fountain, two each side: at the renderer's zoom the gate is a few steps north of the first
  screen, an owner-approved change from the issue's first criterion. Phase 4 (#146) did lighting.
- [x] Add run start, escape, and death flows. The gate refuses locally with the names of whoever is
  not ready, the run start is announced, and the return to the hub reports what this player got out
  with or lost. Party frames show each teammate's head and shoulders cropped from their #132
  composite, edged in their party colour; one still designing shows a grey silhouette and
  "Designing…", and the hub banner names them as what the run waits on (#134).
- [x] Show what a player carries and what they banked. Three slots and the torch line, which is
  separate because a torch is not an inventory item, plus the session bank.

### 10. Skills and Progression UI

- [ ] Show unlocked skills and their effects.
- [ ] Show locked skills and their unlock cost.
- [ ] Drive unlocks from server-owned profile state.

### 11. Drawing at World Scale

- [x] Draw in world units at a zoom that keeps the player small against the room. 32 pixels per world unit, entities sized from `PLAYER_RADIUS`.
- [x] Clip drawing to the viewport and to the geometry the client has accumulated.
- [x] Rule the floor every `TILE_SCALE` units, so it reads as masonry rather than graph paper.
- [x] Draw a doorway across its whole opening, matching what the server collides against.


## Activity Log

One line per change; read the linked pull request for detail.

- 2026-10-21: Owner decisions on unseen allies, minimap access, bar numbers and the run clock (#160), unblocking #167, #172 and #174.
- 2026-10-20: HUD density setting (Full/Calm/Minimal) next to UI scale (#170, HUD Torch & Tally Phase 4).
- 2026-10-20: Quiet HUD modules fade to 55% opacity after 4 s out of combat (#169, HUD Torch & Tally Phase 4).
- 2026-10-20: Baked 9-slice HUD frame and brass studs on every HUD panel, drawn at a whole-number zoom per UI scale (#166, HUD Torch & Tally Phase 2).
- 2026-10-20: Minimap allies in party colour with an initial, plus exit and chest icons on discovered tiles (#171, HUD Torch & Tally).
- 2026-10-20: Speaking rings on party portraits from per-peer voice levels (#173, HUD Torch & Tally Phase 5).
- 2026-10-20: Ready plates in front of the hub gate, with a public `readyPlateId` and a party-ready cue (#147, v35).
- 2026-10-20: Hotbar slots pulse on a confirmed item use and a picked-up item flies into its slot, with a reduced-motion highlight (#175, HUD Torch & Tally).
- 2026-10-19: Sitting on hub benches and the fountain rim, with a public `seatId` (#148, v34).
- 2026-10-19: Minimap given its own top-right frame with a room-name header and an N mark (#162, HUD Torch & Tally Phase 1).
- 2026-10-19: Session and voice controls moved into an Esc camp menu, with a mic chip, key hints and a hub-only Ready button on screen (#161, HUD Torch & Tally Phase 1).
- 2026-10-19: HUD colour tokens and self-hosted Silkscreen and Pixelify Sans fonts (#165, HUD Torch & Tally Phase 2).
- 2026-10-19: Attack and Emote HUD buttons shown only on a coarse pointer (#164, HUD Torch & Tally Phase 1).
- 2026-10-19: Hub re-authored as a ring round a 3x3 fountain, with stalls on the diagonals, benches,
  a gate road, campfire clearing and training yard (#145, Hub Revamp Phase 3, v33).
- 2026-10-19: Ambient hub lighting, flickering lanterns and campfire, and distance-based prop name
  plates inside a HUD-safe area; the hub is fully visible to everyone (#146, Hub Revamp Phase 4, v32).
- 2026-10-19: Party-frame portraits, a "Designing…" state, and a hub banner naming designers (#134).
- 2026-10-19: Hub ground layer, canopy overhang, contact shadows, stall tints and hue-shifted
  palette (#144, Hub Revamp Phase 2, protocol unchanged at v31).
- 2026-10-19: Players drawn as recoloured, animated pixel-art characters with party rings (#132).
- 2026-10-19: Hub training dummies with a rolling damage-per-second readout (#150, v31).
- 2026-10-19: Emote wheel with server-validated, rate-limited, visibility-gated emotes (#149, v30).
- 2026-10-19: Map themes and render-only props; the hub draws forest walls and one of each prop
  (#143, Hub Revamp Phase 1, protocol unchanged at v29).
- 2026-10-20: Chargeable Hunting Bow, draw clock on the server, arrows in the hub (#116, v36).
- 2026-10-20: Bow draw strength and aim indicator in the world and on the HUD (#117, no protocol change).
- 2026-10-19: Animated weapon swings from server-resolved reach and arc (#129, v29).
- 2026-10-19: Server-validated player appearance and party colours, `setAppearance` (#131, v28).
- 2026-10-18: Stamina Draught, Flare, and Smelling Salts consumables; revive a downed ally (#85, v27).
- 2026-10-18: Lootable chests placed by room templates, rolling named loot tables (#88, v26).
- 2026-10-18: Stackable arrows and the `ammo` item kind (#115, v25).
- 2026-10-15: Snapshots carry the viewer's lit tiles; only those draw lit (#120, v24).
- 2026-10-13: Rusted Sword, content-driven melee stats, hub swings (#114, v23).
- 2026-10-13: Held-item slot and weapon item kind (#113, v22).
- 2026-10-12: Ranged and charging monster behaviours (#91, v21).
- 2026-10-12: Minimap HUD panel with rebindable toggle (#105).
- 2026-10-09: Monster flow-field pathing, line-of-sight aggro and leash (#89).
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
