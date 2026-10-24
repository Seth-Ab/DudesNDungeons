# Game Content

The server loads and validates this directory once at startup. Content is JSON so a designer can
add or tune definitions without rebuilding TypeScript. Restart the server after an edit.

## Directories

- `items/`: live item definitions. Keys, consumables, and skill scrolls use the three-slot
  inventory. Torches equip separately and must be deliberately picked up in the hub or dungeon.
  A weapon has `kind: "weapon"` and a required, strict `weapon` block. A `melee` weapon needs every
  swing stat: `damage`, `range` (world units), `arcCos` (cosine of the half-angle covered),
  `cooldownMs`, and `staminaCost`. A `ranged` weapon (a bow) needs `drawMs` (a full draw),
  `minDrawMs` (a release sooner fires nothing and costs nothing), `minRange` and `maxRange` (world
  units; range grows linearly with the draw fraction and stops growing at `drawMs`), `damage`,
  `projectileSpeed`, `projectileRadius`, `staminaCost` and `ammoItemId`, which must name an `ammo`
  item. `hunting-bow` is the one that ships. The server reads the stats of the weapon in hand at each
  swing or draw, so an edit applies after a restart with no code change; an empty hand (or anything
  that is not a melee weapon) swings with the unarmed constants. `attackDamageBonus` skills add to either. A weapon is carried in the
  hand slot when that is empty, otherwise in an inventory slot. `rusted-sword` and `hunting-bow` lie on
  the hub's Weapons counter.
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
  training yard. It may also list `seats`, `{ entityId, x, y, facing }`, where a player can sit:
  `x`/`y` is where the sitter goes and the tile it rounds to is the one sat on, normally the `#`
  under a bench or the fountain. `facing` (`north`, `south`, `east` or `west`) is the side they
  look out over and stand up onto, and loading fails unless that neighbouring tile is floor. Put a
  seat about a sixteenth of a tile in from that edge, so a sitter's body reaches the floor and is
  seen from it. Ids are unique in the dungeon. The hub has two per bench and four on the fountain
  rim. It may also list `readyPlates`, `{ entityId, x, y }`: plates a player readies up by standing
  on. `x`/`y` is the plate's centre, and a half-tile position centres a row of them on a one-tile
  gate. A plate is `READY_PLATE_SIZE` world units across, a little under an authored tile, and
  loading fails unless every tile under it is floor. Ids are unique in the dungeon. The hub has
  four, in the strip in front of its gate.
- An authored dungeon may also set `ground`: a grid of strings the same size as `tiles`, saying what
  each floor tile is drawn as. `g` is grass, `c` cobble, `d` dirt, and `.` the theme's own floor,
  so a map without `ground` looks exactly as it did. It is render-only: collision always comes from
  `tiles`. Under a `#`, `.` leaves the wall drawn as the theme's wall (forest, in the hub), and any
  other character draws that ground instead, for the solid tile beneath a fountain, stall or bench. Loading fails on a grid of another size or a
  character outside `gcd.`. Grass draws a ragged fringe onto the cobble or dirt beside it, so
  boundaries need no art of their own; the hub is the example. Ground scales with the map, so each
  character covers a `TILE_SCALE` block, and reaches a client with the tiles it describes.
- `flows/` and `biomes/`: the two halves of a `delve` run (decision 0016). Nothing builds a `delve`
  run yet, so these are validated content only.
  A **flow** is the shape of a run: `weight` (relative odds), `minParty` (smallest party it may be
  drawn for), inclusive `{ min, max }` ranges for `path` (rooms on the critical path), `branches`,
  `branchLength` and `loops`, `branchFrom` (`any` path room, or `hub`, which also needs `hubIndex`),
  `bossLock`, `keySource` and `vaultChance` (0 to 1). `bossLock` is `key`, `seals` or `split-seal`,
  but only the locks in `GENERATOR_BOSS_LOCKS` (`schema.ts`) can be built, today `key` with a
  `keySource` of `puzzle`, `branch` or `arena`; any other lock, or a key source that lock cannot use,
  fails loading. `gauntlet`, `long-loop` and `three-roads` ship.
  A **biome** is what a run looks and fights like: `theme` and `lightTint`, `light` (a multiplier on
  light radii), a `roster` of `{ typeId, cost, weight }` (cost is spent against a room's threat
  budget; bosses are not allowed here), `traps` and `puzzles` pools, a `bosses` pool (each must be
  a `boss: true` monster), `roomWeights` by room kind, a `lootTableId`, and `names` by room kind.
  An unknown monster, trap, puzzle, boss, loot table or room kind fails startup naming the file and
  field. `cinder-depths` is the only biome and the only live one.
- A `delve` dungeon profile (`layout: "delve"`) sits in `dungeons/` beside `authored` and
  `generated`: `grid` (`cols`, `rows`, `cell` in authored tiles, `margin`), the `flows` and
  `biomes` a run draws from by id, `maxAttempts` layout retries, an optional `corridorLight` and an
  `exitDestination`. Every id must exist, and at least one listed flow must have `minParty` of 1 so
  a solo party has a run. `vault-run` stays `generated` until the integration issue switches it;
  asking `buildDungeon` for a `delve` profile throws until then.
- `skills/`: permanent skill definitions, with their stack limits and prerequisites, used by
  profiles and skill scrolls.

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

## Skills

Every skill contains one or more typed effects. Supported starting effect types are:

- `attackDamageBonus`
- `sightRadiusBonus`
- `resistanceBonus`
- `puzzlePowerBonus`

A profile holds a stack count per skill (decision 0014). `effects` is the first stack, and every
skill declares `maxStacks`: a positive integer, or `null` for a skill that keeps stacking. A
stacking skill adds exactly one of:

- `stackEffects`: the effects of stacks 2 to `maxStacks`, one list per stack, so it has
  `maxStacks - 1` entries. Only for a capped skill.
- `perStackEffects`: effects added again for every stack after the first. Required when
  `maxStacks` is `null`, allowed for a capped skill.

A skill with `maxStacks: 1` has neither, and loading refuses any other combination. Iron Will's
former tiered upgrades are its stacks 2 and 3. An optional `requires` list names skills the player
must hold at least one stack of first; unknown ids and prerequisite cycles are refused at load.
Every skill also declares `conversionCoin`, a positive integer: the coin one scroll of it converts to
once the skill is at `maxStacks` (decision 0014). It must stay below the scroll's shop price.

A skill scroll is an item with `kind: "skillScroll"` and a `skillId` naming one of these skill
definitions. It occupies an inventory slot and is consumed on use, adding one stack. In a dungeon,
the stack and its effect are provisional until that player extracts; in the hub, it is permanent
immediately. The limit and prerequisites count permanent and provisional stacks together. A scroll
whose skill is already at `maxStacks`, or whose prerequisites are missing, is refused without being
consumed, so it remains available to give away or store. A scroll at `maxStacks` can instead be
converted to coin after the player confirms (`convertSkillScroll`): into the run purse in a dungeon,
which is lost with the run, or straight to the profile in the hub. Every skill has a scroll (a content test
enforces it; a skill granted by a milestone is exempt). Scrolls come from the Ember Warden and
the vault chest and, rarely (about one kill in eighty), from ordinary monsters: the Ash Imp and
Cinder Spitter drop Torchbearer, the Cinder Slime Lever Sense, and the Slag Charger Iron Will. Lowering `maxStacks` never deletes stored
stacks; effects apply only up to the current limit. `puzzlePowerBonus` is consumed by `puzzles/`
(see above); Lever Sense is the skill that grants it. Clients must never submit trusted skill, item,
or profile state.

## Shops

`content/shops/` holds hub shops. `scroll-shop.json` is the skill shop at the hub's Scrolls stall (a
room of kind `shop`, which like `vault` only works in the hub). It lists `fixed` entries, always in
stock, a `rotating` pool, and a `rotatingCount` of pool entries in stock at a time; each entry is
`{ itemId, price }` with a positive coin price. Every `itemId` must be a skill scroll item, may
be listed only once across `fixed` and `rotating`, and must cost more than its skill's
`conversionCoin`, so buying a scroll to convert it never pays. `rotatingCount` cannot exceed the pool.

The rotating entries reroll after every run, by escape or wipe. The draw is a pure function of the
room code, the room's run count (saved with its party vault in `data/vaults.json`) and the pool, so
it is the same across calls and restarts and never changes during a run. A client buys with
`buySkillScroll { itemId }` and never names a price; the server reads it from here.

## Cosmetics

`content/cosmetics/` holds hats, cloaks, outfit dyes, weapon trails and torch flames (decision 0014,
#128, #138). They change how a
player looks and nothing else, and once owned they belong to the profile for good: never dropped,
never lost on death, kept across restarts. Each file is one item:

```json
{ "id": "ranger-hood", "slot": "hat", "rarity": "fine", "name": "Ranger's Hood",
  "lore": "Hides every hair and most of the worry.", "price": 30,
  "milestone": { "stat": "runsEscaped", "threshold": 5 } }
```

- `slot` is `hat`, `cloak`, `dye`, `trail` or `flame`; `rarity` is `common`, `fine`, `rare` or `legendary` and only
  colours the wardrobe card.
- How it is got is any of: `starter: true`, owned by every profile (the Leather Cap and Traveler's
  Cape; `STARTER_COSMETIC_IDS` in `src/server/profiles/profile.ts` must match, which a test checks); a
  `price` in coin at the hub's Wardrobe stall (a room of kind `wardrobe`); or a `milestone`, a stat
  from the list under Milestones and a threshold, granted when a run's stats are credited. An item
  with none of the three, or `rotating` without a price, fails validation.
- Priced items are in stock all the time unless `rotating: true`. Rotating ones form a pool from
  which `COSMETIC_ROTATING_COUNT` (2) are in stock at a time, rerolled after every run by the same
  draw as the skill shop's rotation. Keep the pool larger than that, or the rotation never rotates.
- What an item looks like is the client's: `src/client/rendering/characters.ts` lists the hats,
  cloaks and dyes it has art for, and `characterPalettes.ts` their colours, keyed by these ids, with
  each trail's colours and particle style and each flame's ramp. An id with no art is drawn as
  nothing: no trail, or the default hearth flame. A trail only ever draws inside the swing's
  server-resolved reach and arc, and a flame recolours the torch sprite and its halo, never the
  light it casts. Prices are tuning.

A client buys with `buyCosmetic { id }`, standing at the stall, and wears an owned item anywhere in
the hub with `equipCosmetic { slot, id }` (`id: null` takes the slot off). Neither names a price.

## Milestones

`content/milestones/` holds achievements that grant a skill outright (decision 0014). A milestone
names a `stat` from the profile's tracked stats, a positive `threshold`, and the `skillId` it grants:

- `runsEscaped`, `fullPartyEscapes` (every player in the party got out), `wins` (escaped a dungeon
  that had a boss, with every boss defeated), `emberWardenKills`, `flawlessEmberWardenKills` (nobody
  in the party was downed at any point in the run before the Warden fell), `teammatesCarriedOut`,
  `leverPuzzlesSolved`, `runsWithoutTorch`, `itemsBanked` and `mothRoomsFound`.

Stats are gathered per player during a run and credited when it ends, only to players who extract
(the same rule that saves provisional skills, so a downed player carried out counts). A Warden kill
or puzzle solve counts for every standing party member or plate holder. When a credited stat reaches
the threshold the profile gets one permanent stack of the skill and the milestone is recorded as
earned, so it never grants twice, even across restarts. If the skill is already at `maxStacks` the
milestone is still recorded and nothing more is granted. A milestone's skill may not have
`requires`, and an unknown skill or stat is refused at load. Existing profiles start every stat at
zero; nothing is backfilled. Emberhardened, granted by escaping five runs, is the shipped example.

Room-template loot rules accept an optional `chance` from 0 to 1 before their inclusive `min`/`max`
count is rolled. It defaults to 1 for existing loot; rare scrolls can therefore ask for one item at
a low chance without a successful roll ever producing an empty result.
