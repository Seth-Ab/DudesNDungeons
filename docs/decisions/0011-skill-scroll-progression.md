# 0011: Skill Scroll Progression

## Status

Accepted on 2026-09-20.

## Context

Skills are long-term roguelite progression, but the game has no progression currency and should
reward dungeon exploration. They also need to be social loot: one player may find a skill and give
it to the party member who needs it.

The hub is already the point where run inventory becomes permanent. Skill progression should obey
the same extraction rule instead of becoming a special case that survives a failed run.

## Decision

- A skill may exist as a rare `skillScroll` loot item, whether found loose, dropped by a monster,
  found in a chest, or later bought from a hub shop.
- A scroll occupies one of the three normal inventory slots until used.
- Using it consumes the scroll and activates the skill immediately for that player.
- In a dungeon, that unlock is provisional. It moves to the persistent profile only if the player
  extracts. Being downed and revived, or eventually carried through the exit, still counts as
  extracting. A player left behind or caught in a wipe loses the provisional unlock.
- A skill acquired in the hub is permanent immediately because the hub is the save boundary.
- A scroll cannot be consumed by somebody who already knows its skill. It remains transferable;
  duplicate scrolls may become an upgrade path later, but this decision does not define that rule.
- The server owns scroll contents, use, active effects, extraction, and profile mutation. Clients
  send item-use intent and render the result.

The first implementation puts a rare Scroll of Iron Will in generated boss-room loot. Monster
drops, chests, player-to-player transfer, shops, and duplicate-to-upgrade behavior are follow-up
systems.

## Consequences

Run-local skill ids must live on the session player separately from permanent profile ids. Effect
resolution reads both sets, while extraction promotes only the survivor's run-local ids. This also
makes a disconnect/reconnect safe: the reserved session slot retains provisional progression.

Until revive and carrying exist, the current exit rule treats a standing player as extracted. The
future carrying work must extend that predicate so a downed player physically carried out also
keeps provisional skills.
