# Game Content

The server loads and validates this directory once at startup. Content is JSON so a designer can
add or tune definitions without rebuilding TypeScript. Restart the server after an edit.

## Directories

- `items/`: live item definitions. Keys, tonics, wards, and skill scrolls use the three-slot
  inventory. Torches equip separately and must be deliberately picked up in the hub or dungeon.
- `monsters/`: monster stats used by authored and generated dungeons.
- `dungeons/templates/`: reusable rooms for procedural generation.
- `dungeons/`: authored dungeons and generated-dungeon profiles.
- `skills/`: permanent skill definitions used by profiles and skill scrolls.
- `upgrades/`: ordered improvements associated with a skill.

Every definition needs a unique lowercase kebab-case `id`. A bad field or reference prevents server
startup and reports the offending file. The schemas are in `src/server/content/schema.ts`; catalog
loading and cross-file validation are in `src/server/content/loadContent.ts`.

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
give away or to support a later upgrade rule. Upgrade acquisition and puzzle effects remain future
work. Clients must never submit trusted skill, upgrade, item, or profile state.

Room-template loot rules accept an optional `chance` from 0 to 1 before their inclusive `min`/`max`
count is rolled. It defaults to 1 for existing loot; rare scrolls can therefore ask for one item at
a low chance without a successful roll ever producing an empty result.
