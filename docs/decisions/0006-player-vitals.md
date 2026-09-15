# 0006 - Player Vitals: Resistance, Stamina, and the Run Timer

- Status: Accepted
- Date: 2026-09-15

## Context

`GAMEDESCRIPTION.md` gives players three bars, not one: "players have heath, resistance, and stamina
bars aswell as 3 inventory slots". It also ties two rules to them. Resistance is "a general defensive
stat ... The higher this number is, the less damage your character can take", raised only by
consuming items or unlocking skills. Staying in the dungeon too long makes resistance "start falling
causing you to be progressivly more suceptable to damage". Stamina "regenrates over time and is used
when the player picks up objects or other players and durring combat".

Before this change a player was a bare `health` number. Combat had a cooldown but no cost, so the
resolved "stamina-gated real-time combat" checkpoint was not actually true of the code, and there
was nothing to punish a slow run.

## Decision

### One place for damage

`src/server/game/vitals.ts` owns health, resistance, and stamina. `damagePlayer` is the only function
that lowers a player's health, and it applies resistance itself. A new damage source - a trap, a
boss, a hazard - cannot forget the reduction, because there is no other way to deal damage.

Damage is scaled by `RESISTANCE_DAMAGE_SCALE / (scale + resistance)`, with the scale equal to
`PLAYER_MAX_RESISTANCE`. That gives diminishing returns rather than a linear percentage: 100
resistance halves a hit, 300 would quarter it, and no amount reaches immunity. A hit scaled below one
point still costs one, so a heavily warded player is slower to kill rather than invulnerable.
`attackResolved` reports what actually landed, not what was swung.

### Resistance only ever goes down on its own

Resistance starts at `PLAYER_BASE_RESISTANCE` and never regenerates. Consumables raise it - a new
`ward` item kind, with a `Warding Salve` in the Ember Vault - and unlocked skills will in Backend
step 11. Nothing else does, including respawning: a downed player returns with full health and full
stamina but the resistance they had, so dying is not a way to undo the run clock.

### The run clock is per player

Decay starts after `RESISTANCE_DECAY_GRACE_MS` (10 minutes) and then removes
`RESISTANCE_DECAY_PER_SECOND` (0.1) until resistance reaches zero, which takes another ~6.7 minutes
from the base value. Against the resolved 15-20 minute target run length, a party moving at pace
escapes before decay ever bites, and a party that dawdles feels it.

The clock is per player rather than per session. `GAMEDESCRIPTION.md` says "if you stay in the
duengon too long", and a player who joined late has not. `SessionPlayer.enteredDungeonAt` is stamped
by the first simulation step that sees the player, because the session store runs on wall time while
the simulation runs on a monotonic clock. Backend step 10 will reset it when a party leaves the hub.

A decay step only decays the part of itself that falls after the grace period, so decay starts at the
right moment rather than at the first tick afterwards.

### Stamina prices actions

Stamina regenerates at `STAMINA_REGEN_PER_SECOND` (12) and is not regenerated for a downed player.
A swing costs `ATTACK_STAMINA_COST` (15). Against the 500ms attack cooldown that is a net 9 per
swing, so a full bar buys about eleven back-to-back swings before combat is paced by stamina rather
than by the cooldown. A swing refused for any other reason costs nothing: stamina is charged only
once the swing is going to happen.

`LIFT_STAMINA_COST` and `CARRY_STAMINA_DRAIN_PER_SECOND` are defined here, with `spendStamina` and
`drainStamina` to pay them, but nothing spends them yet. Lifting and carrying are Backend step 12 and
have no representation in the model at all - no protocol message, no carried-object state - so
building them here would have duplicated that step rather than completing this one.

## Protocol Version 5

Breaking, because `playerState` gained required fields and `rejectionReason` gained a value old
clients cannot parse.

- `playerState` gains `resistance` and `stamina`, both integers, alongside `health`. They are stored
  unrounded on the server, because decay moves resistance by fractions of a point per tick, and
  rounded in `toPlayerState` for broadcast.
- `stateSnapshot` gains `run`: `elapsedMs`, `decayStartsInMs`, `decaying`, and `decayPerSecond`. Like
  the rest of the snapshot since v4 it is per viewer. It exists so a client can warn before decay
  starts instead of only after a bar has already dropped; `RESISTANCE_DECAY_WARNING_MS` is shared so
  both sides agree on when that warning is due.
- `rejectionReason` gains `exhausted`, distinct from `onCooldown` because the wait is longer and the
  fix is different.
- `itemKind` gains `ward`.

## Consequences

- Every future damage source routes through `damagePlayer` or silently ignores resistance.
- Monsters hit for less than their stat line now. The Ash Imp's 8 becomes 6 against base resistance,
  which is why `tests/server/combat.test.ts` pins resistance to 0 where it is measuring cooldowns.
- Torches, sight range, and puzzle interaction are the remaining places skills will need to reach
  once Backend step 11 adds them; resistance and combat already have a seam.
- The respawn behavior this builds on still contradicts the resolved downed/revive/carry direction.
  That conflict is Backend step 10's to resolve, and vitals are now in place for it.
