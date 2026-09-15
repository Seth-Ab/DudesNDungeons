# 0005 - Visibility, Lighting, and Voice Range

- Status: Accepted
- Date: 2026-09-15

## Context

`GAMEDESCRIPTION.md` makes darkness and proximity communication core pillars. The earlier
`stateSnapshot` sent one party-wide dungeon frame, which meant every client received the full map,
monsters, loot, exits, and roster even if the renderer drew darkness over it.

## Decision

The server now builds one visible frame per connected player. Visibility is computed from server-owned
light sources and line of sight through walls and closed doors.

Light sources are:

- the player's carried hub torch, currently enabled for every joined player;
- fixed dungeon lights such as torch pillars and braziers;
- optional monster glow from server-side monster stats.

Each player also tracks discovered tiles server-side. Current visible tiles are sent normally,
discovered-but-unlit floor and wall tiles are sent as dim tile markers, and unknown space is sent as
blank tiles. Unseen monsters, loot, exits, and other players are omitted from that player's snapshot.

Voice attenuation uses the same visible-player rule. The server sends `voiceRangeUpdated` only for
peers present in the viewer's visible frame, then applies distance falloff to those peers.

## Protocol Version 4

`dungeonState` gains `lightSources`, an array of server-authored light source states:

- `id`
- `name`
- `kind`: `fixed`, `carriedTorch`, or `monsterGlow`
- `position`
- `radius`

The `stateSnapshot` message shape otherwise remains the same, but its semantics are now per-player:
it is the visible frame for the receiving player, not a complete party-wide world state.

## Consequences

- Clients must merge snapshot player data into their roster rather than treating each snapshot as the
  complete party list.
- Clients may render `lightSources`, but the server owns where light comes from.
- Future room generation should author fixed lights in content rather than code literals.
- Torch inventory, torch depletion, and hub supply behavior remain future work.
