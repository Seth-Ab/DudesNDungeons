# 0004 - Combat, Monsters, and Items

- Status: Accepted
- Date: 2026-09-12

## Context

Backend Dev step 4 asks for attacks, damage, death, simple monster behavior, item pickup, and
inventory basics, all resolved on the server. The combat checkpoint is resolved as "hybrid": real-time
positioning with a turn-like tactical exchange when engaging enemies. That exchange is the least
specified part of the design, and a playable demo needs combat before it needs the exchange.

The step 1 protocol already defined `playerAttack`, `pickupItem`, `useItem`, `playerInteract`, and
`attackResolved`; the server answered all of them with `notImplemented`.

## Decision

### Simple real-time melee first

The first combat slice is plain melee, not the tactical exchange. A `playerAttack` swings along its
direction. With a `targetId`, that monster must be alive and in reach; without one, the swing hits the
nearest living monster within `PLAYER_ATTACK_RANGE` and 60 degrees of the direction. A swing that hits
nothing still resolves as `attackResolved` with a null target and still costs
`PLAYER_ATTACK_COOLDOWN_MS`, so swinging in every direction gains nothing.

The tactical exchange can later be layered on top: the reach, arc, damage, and cooldown rules stay
server-side, and only what triggers and sequences an exchange is new.

### Monsters run on the tick

Each server tick calls `simulate(session, now)`. A living monster chases the nearest connected,
standing player within its aggro range, sliding along one axis when the direct path is blocked, and
attacks when in reach on its own cooldown. Monster attacks are broadcast as `attackResolved` with the
monster as attacker. Monster stats (speed, aggro range, reach, damage, cooldown) live only on the
server; clients see position, health, and max health.

Disconnected players are not hunted, so a dropped connection does not come back to a wipe. Elapsed
time per step is capped, so a stalled timer cannot teleport monsters.

### Downed, then respawn

A player at zero health is downed: they cannot move, attack, or use items, they block nobody, and
monsters ignore them. After `PLAYER_RESPAWN_MS` they return at a free spawn point with full health,
keeping their inventory. There is no loss state yet; a party wipe simply respawns.

### Items, doors, and the exit

Loot has a `kind` (`key` or `tonic`). `pickupItem` moves loot within `INTERACT_RANGE` into the
player's inventory, capped at `MAX_INVENTORY_SIZE`. `useItem` drinks a tonic, refused at full health
so a misclick cannot waste it; keys are not used directly. `playerInteract` on a door opens it,
spending a key if it is locked; on an exit it sets the dungeon's `cleared` flag.

The Ember Vault was reshaped so this matters: the exit now sits in a walled vault whose only entrance
is the locked door, and the Copper Key sits by the Ash Imp. Previously players could walk around the
door to the exit.

### Tile centers

Collision now treats an integer position as the center of its tile (tile `x` covers `x - 0.5` to
`x + 0.5`), matching how the renderer draws and where spawn points and entities are placed. It
previously treated integers as tile corners, so collision and rendering disagreed by half a tile. A
closed door now blocks its whole tile, like a wall, rather than a circle that could be slipped past
at its corners.

### Protocol version 3

- `lootState` gains `kind`; `monsterState` gains `maxHealth`; `dungeonState` gains `cleared`.
- `playerState` gains `inventory`, and `health: 0` now means downed.
- Refusals use the existing `actionRejected` reasons: `notPermitted` (downed, full inventory, locked
  door without a key, tonic at full health), `outOfRange`, `targetMissing`, and `onCooldown`.
  `pickupItem`, `useItem`, and `playerInteract` carry no sequence, so their rejections send `null`.

These are breaking shape changes, so `PROTOCOL_VERSION` is 3.

## Consequences

- The client must render loot, doors, exits, monster health, downed players, and the cleared state,
  and must send attack, pickup, use, and interact messages. That is Frontend steps 3 and 4.
- Balance numbers are first guesses and will need playtesting.
- Only the tactical exchange from the hybrid combat checkpoint remains undesigned.
