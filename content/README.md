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
  Ammo has `kind: "ammo"` and a positive integer `maxStack` (at most 99). A stack of any count up
  to `maxStack` takes one inventory slot; a pickup tops up carried stacks of the same item, then
  takes a free slot, and leaves whatever does not fit on the floor. An authored dungeon's loot
  placement may give ammo a `count` (default 1, never above `maxStack`); a `count` on anything
  else fails validation. `arrow` lies as a stack of 5 beside the hub's sword.
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
- `loot-tables/`: named loot tables with the same shape as a monster's `loot` (`rolls`, weighted
  `entries`, `nothingWeight`) plus an `id`. Chests refer to one by `lootTableId`; an unknown id or
  an unknown entry `itemId` fails validation.
- `dungeons/templates/`: reusable rooms for procedural generation. A `chests` rule list
  (`lootTableId`, inclusive `min`/`max`, optional `chance`, optional `locked`) places chests on the
  room's floor like loot. A chest's contents are rolled from its table only when a player opens it,
  and spill beside it as ordinary loot. A `locked` chest spends a key, like a locked door. Authored
  dungeons place chests with a `chests` list of `x`, `y`, `lootTableId`, and optional `locked`.
- `dungeons/`: authored dungeons and generated-dungeon profiles. An authored dungeon may set
  `theme` (`stone`, the default, or `forest`, which draws walls as woodland, with its canopy
  overhanging the floor beside it) and a `props` list of
  scenery: `{ kind, x, y, label?, tint?, facing? }`, with `kind` one of `fountain`, `stall`,
  `quest-board`, `tree`, `bush`, `dungeon-gate`, `sign`, `hanging-lantern`, `bench`, `log` or
  `campfire` (the stone pit round a `fixture: "campfire"` light, flat on open floor: a light on a
  `#` tile shines on nothing and is never sent). A prop's `x`/`y` is the authored tile at its
  top-left (fractions allowed) and its size is fixed per kind in
  `src/shared/constants/scenery.ts` (the fountain is three authored tiles square, a stall two wide);
  the whole of it must be on the map. Props never collide, so put `#` under anything a player
  should not walk through, and give that `#` a `ground` character so it draws as the ground the
  prop stands on rather than as the theme's wall. A stall or a bench may set `facing: "north"`
  when it stands south of what it serves; it is drawn from behind. `label` (32 characters at most) is drawn in the hub as a name plate when the player is within four authored tiles (a small icon marks a stall from farther off); `hanging-lantern` is a scenery lantern for an awning, paired with a `fixture: "none"` light. A stall,
  and only a stall, may set `tint` for its awning: `ember` (the default), `moss`, `azure` or
  `plum`. A light may add `tint` (`warm`, the default, or `red`, a red glow), `fixture` (`pillar`,
  the default torch stand, `campfire`, or `none` for a light whose source is a prop already drawn) and
  `flicker` (0 to 1, how much its reach wavers; every client shows the same waver).
  An authored dungeon may also list training `dummies`, `{ entityId, x, y }`, each on a floor tile
  with an id unique in the dungeon. A dummy is struck like a monster but never takes damage, dies,
  moves, or attacks, and shows a rolling five-second damage readout; the hub has two, in its
  training yard.
- An authored dungeon may also set `ground`: a grid of strings the same size as `tiles`, saying what
  each floor tile is drawn as. `g` is grass, `c` cobble, `d` dirt, and `.` the theme's own floor,
  so a map without `ground` looks exactly as it did. It is render-only: collision always comes from
  `tiles`. Under a `#`, `.` leaves the wall drawn as the theme's wall (forest, in the hub), and any
  other character draws that ground instead, for the solid tile beneath a fountain, stall or bench. Loading fails on a grid of another size or a
  character outside `gcd.`. Grass draws a ragged fringe onto the cobble or dirt beside it, so
  boundaries need no art of their own; the hub is the example. Ground scales with the map, so each
  character covers a `TILE_SCALE` block, and reaches a client with the tiles it describes.
- `skills/`: permanent skill definitions used by profiles and skill scrolls.
- `upgrades/`: ordered improvements associated with a skill.

Every definition needs a unique lowercase kebab-case `id`. A bad field or reference prevents server
startup and reports the offending file. The schemas are in `src/server/content/schema.ts`; catalog
loading and cross-file validation are in `src/server/content/loadContent.ts`.

## Consumables

A consumable item has `kind: "consumable"`, a short `description` shown in the HUD (80 characters
at most), an optional `icon` (`tonic`, `ward`, `draught`, `flare`, or `salts`, defaulting to
`tonic`), and a non-empty `effects` list. Supported effect types are:

- `heal`, `restoreResistance`, and `restoreStamina`, each with a positive integer `amount`.
- `flare`, with `radius` (world units) and `durationMs`: puts a light at the user's feet that the
  dungeon owns and removes when its time is up. It is never wasted.
- `revive`, with `healthFraction` (above 0, at most 1) and `staminaCost`: stands a downed ally in
  `INTERACT_RANGE` back up at that fraction of max health, charging the user the stamina. The
  client names the ally; the server refuses a standing, carried, or disconnected target, a downed
  user, and a user who cannot pay, keeping the item. A revive must be the item's only effect.

An unknown type fails startup, naming the file and field.

Effects apply in order. Use is refused, and the item kept, only when every effect would be wasted
(full health, resistance at its cap, a full stamina bar). Clients receive the description, the
icon, and whether the item is used on a downed ally (`useOn`), never the amounts. Adding a
consumable needs no code or protocol change, only the JSON file and a placement in a room template
or loot rule; a new icon also needs art. `stamina-draught`, `flare`, and `smelling-salts` are rolled
by the chest tables and placed at low odds by the Ashen Hall and Sunken Maze templates.

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
