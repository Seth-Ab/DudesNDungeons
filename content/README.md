# Game Content

The server loads and validates this directory once at startup. Content is JSON so a designer can
add or tune definitions without rebuilding TypeScript. Restart the server after an edit.

## Directories

- `items/`: live item definitions. Keys, consumables, and skill scrolls use the three-slot
  inventory. Torches equip separately and must be deliberately picked up in the hub or dungeon.
  A weapon has `kind: "weapon"` and a required, strict `weapon` block. A `melee` weapon needs every
  swing stat: `damage`, `range` (world units), `arcCos` (cosine of the half-angle covered),
  `cooldownMs`, and `staminaCost`; a `ranged` block is `{ "kind": "ranged" }` until the bow issue
  adds its stats. The server reads the stats of the weapon in hand at each swing, so an edit applies
  after a restart with no code change; an empty hand (or anything that is not a melee weapon) swings
  with the unarmed constants. `attackDamageBonus` skills add to either. A weapon is carried in the
  hand slot when that is empty, otherwise in an inventory slot. `rusted-sword` lies in the hub's
  spawn area.
- `monsters/`: monster stats used by authored and generated dungeons. A monster with `boss: true`
  seals every exit in its dungeon until it is defeated. It may only spawn in a `boss` room
  template (or inside an authored room of kind `boss`), and every `boss` template must have a boss
  rule with `min` of at least 1. An optional `loot` table (`rolls`, weighted `entries` of
  `itemId`, and `nothingWeight`) is rolled when a player kills the monster; drops land on open
  floor at or near the corpse and are ordinary loot. A single entry with no `nothingWeight` is a
  guaranteed drop, and an unknown `itemId` fails validation naming the file's monster and field.
  `behavior` is `melee` (default), `ranged` (needs `projectile`: `speed`, `radius`, `damage`,
  `range`; optional `preferredRange` no greater than `attackRange`), or `charger` (needs `charge`:
  `speed`, `distance`, `stunMs`). A ranged monster fires from within `attackRange` with a clear line
  and backs off inside `preferredRange`; its bolt uses `projectile.damage`. A charger winds up from
  within `attackRange`, dashes straight for `charge.distance` dealing `damage` to the first player it
  touches, and is stunned for `stunMs` if it hits a wall or closed door.
- `traps/`: trap types (trigger radius, damage, resistance loss, stamina drain, optional rearm
  delay). Templates spawn them with a `traps` rule list and authored dungeons place them.
- `puzzles/`: cooperative puzzle types: pressure plates that must all be held at once, each by a
  different player, for `holdMs`. `plateRadius` is in world units. Each point of `puzzlePowerBonus`
  among the players holding a plate shortens the hold by `holdReductionMsPerPower`, never below
  `minHoldMs`. Solving drops `rewardItemId` on the first plate. Templates spawn puzzles with a
  `puzzles` rule list (`typeId` plus two or more local `plates`) and authored dungeons place them.
- `dungeons/templates/`: reusable rooms for procedural generation.
- `dungeons/`: authored dungeons and generated-dungeon profiles.
- `skills/`: permanent skill definitions used by profiles and skill scrolls.
- `upgrades/`: ordered improvements associated with a skill.

Every definition needs a unique lowercase kebab-case `id`. A bad field or reference prevents server
startup and reports the offending file. The schemas are in `src/server/content/schema.ts`; catalog
loading and cross-file validation are in `src/server/content/loadContent.ts`.

## Consumables

A consumable item has `kind: "consumable"`, a short `description` shown in the HUD (80 characters
at most), an optional `icon` (`tonic` or `ward`, defaulting to `tonic`), and a non-empty `effects`
list. Supported effect types, each with a positive integer `amount`, are `heal`,
`restoreResistance`, and `restoreStamina`. An unknown type fails startup, naming the file and field.

Effects apply in order. Use is refused, and the item kept, only when every effect would be wasted
(full health, resistance at its cap, a full stamina bar). Clients receive the description and icon,
never the amounts. Adding a consumable needs no code or protocol change, only the JSON file and a
placement in a room template or loot rule.

## Skills and upgrades

Skills and upgrades each contain one or more typed effects. Supported starting effect types are:

- `attackDamageBonus`
- `sightRadiusBonus`
- `resistanceBonus`
- `puzzlePowerBonus`

An upgrade names its owning `skillId` and positive `tier`. Its optional `requires` list may contain
only lower-tier upgrades belonging to the same skill. There can be only one upgrade at each tier for
a skill.

A skill scroll is an item with `kind: "skillScroll"` and a `skillId` naming one of these skill
definitions. It occupies an inventory slot and is consumed on use. In a dungeon, the unlock and its
effect are provisional until that player extracts; in the hub, it is permanent immediately. A
scroll for an already-known skill is refused without being consumed, so it remains available to
give away or to support a later upgrade rule. Upgrade acquisition remains future work. `puzzlePowerBonus` is consumed by `puzzles/`
(see above); Lever Sense is the skill that grants it. Clients must never submit trusted skill, upgrade, item, or profile state.

Room-template loot rules accept an optional `chance` from 0 to 1 before their inclusive `min`/`max`
count is rolled. It defaults to 1 for existing loot; rare scrolls can therefore ask for one item at
a low chance without a successful roll ever producing an empty result.
