# Game Content

The server loads and validates this directory once at startup. Content is JSON so a designer can
add or tune definitions without rebuilding TypeScript. Restart the server after an edit.

## Directories

- `items/`: live item definitions. Keys, tonics, and wards use the three-slot inventory. Torches
  equip separately and must be deliberately picked up in the hub or dungeon.
- `monsters/`: monster stats used by authored and generated dungeons.
- `dungeons/templates/`: reusable rooms for procedural generation.
- `dungeons/`: authored dungeons and generated-dungeon profiles.
- `skills/`: permanent skill definitions for the upcoming profile system.
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

These definitions are authoring infrastructure, not unlock state. Backend Step 11 still needs a
server-owned persistent profile, an unlock economy, and gameplay code that applies the effects.
Clients must never submit trusted skill, upgrade, item, or profile state.
