# 0015 - Room Saves and Continuing a Run

- Status: Accepted
- Date: 2026-10-21

## Context

Only profiles and party vaults survive a restart. A run lives in the in-memory `Session`, so
quitting, a crash or a server restart throws away a 15-20 minute run, and a player who leaves
mid-run is abandoned and loses their carry. A character's look and party colour live only on the
`SessionPlayer`, so once an empty room is swept (or the server restarts) the party designs new
characters on its next visit.

The owner asked for runs that can be saved and continued, and settled the questions in issue #122
on 2026-10-19, with the character rules recorded there from the #63 design. Three points #122 left
open were settled on 2026-10-21: what an absent member keeps, whether a party in the hub has a save,
and map memory.

## Decision

### A save belongs to the room code

The party is the room code, as it already is for the party vault (decision 0013). Each room code has
at most one save, on the server under `data/`, versioned, validated on read and written atomically
like profiles and vaults. The client holds only the room code, never save contents.

The save outlives runs. It has two parts:

- **Members**: each member's profile id, name, appearance and party colour. These last for the life
  of the room, so characters survive the hub, an empty room being swept, and a restart. A returning
  member skips the design screen, and an appearance is locked for the life of the save.
- **Run**: present only while a run is in progress. It holds the dungeon and every member's run
  state.

Members are identified by profile id, because profiles survive restarts and resume tokens do not.
A player who joins in the hub and sets a look becomes a member.

### Who can continue

- Any subset of the original party can continue a saved run.
- Absent members' characters and carry stay in the save, and they can rejoin later in that run.
- No new players can join a run that is continued mid-run. Joining a room in the hub is unchanged:
  new players may join and become members.

### When it saves

- An autosave every 30-60 s during a run.
- A deliberate "Save and quit", which removes that player from the run but keeps their carry and
  position in the save. It is refused during combat.
- When the party empties.
- At server shutdown.
- Member changes in the hub (a new member, a look being set).

There are no other manual saves.

### Exit versus death

- A save can't undo a death or a wipe. Only the latest save exists.
- An escape or a wipe deletes the run part of the save. The members stay.
- A player who saves and quits keeps their carry and position, unlike a player who simply leaves.
- If the rest of the party escapes or wipes before an absent member returns, that member's saved
  items, run coin and provisional run skills are lost, the same as a downed player left behind.
  They return to the room in the hub with their character.

### What is restored

- Kept: positions, health and stamina, inventories (held item and torch included), provisional run
  skills and run coin, monsters, and trap and puzzle timers.
- Kept: each member's map memory (discovered tiles and rooms) for that dungeon. Map memory belongs to
  the dungeon: every run generates a new one, so it never carries from one run to the next.
- Reset on load: projectiles in flight and attack wind-ups.
- The run clock, and the resistance decay it drives, pauses while saved. Timers are stored as time
  remaining, not as wall-clock times.

### Continuing

The entry point is the lobby. Joining a room code that has a saved run continues it. Starting fresh
in such a room asks the player to confirm first, then discards the whole save: the run and every
member's character, so the party designs new characters for the new save. The party vault is not
part of the save and is kept.

### Lifetime and invalidation

- A save expires 7 days after the room was last played.
- A content version change discards the run part. Members are kept, and an appearance id later
  removed from content loads as the first entry of its list instead of rejecting the save (#135).

## Follow-up Work

Filed on 2026-10-21, in dependency order:

- #233: the versioned room save format and store, with timers stored as time remaining and a content
  version.
- #234: save triggers (autosave, members, an emptied party, shutdown), clearing the run on escape or
  wipe, and the `saveAndQuit` intent.
- #235: continuing from a room code after a restart, membership checks, and discarding a save.
- #232: Save and quit in the camp menu and the lobby's saved-room prompt.

#135 then restores appearance from the members and adds the lobby Continue list.

## Implementation Notes

Continuing (#235, protocol v46) resolves two details the decision left open. A join into a room with a saved run needs an entry in the run, not only membership in the room, because a member who was never in the run would otherwise be a new player in it. A returning member of any room with a save arrives with their saved look, in the hub as well as the dungeon, since a continued player who had to redesign would lose their position.

Save and quit and the lobby prompt (#232, protocol v47) add one message the decision did not list: `savedAndQuit { roomCode }`, sent to the quitter when `saveAndQuit` is accepted. Without it the client could not tell success from silence, because the server stops sending to a player it has taken out of the room.

## Consequences

- The room code becomes the single party identity for the vault, characters and the current run.
- Leaving mid-run gains a safe path (Save and quit) beside the existing abandonment rule, without
  giving a way out of death: a downed player can't save and quit, and a wipe deletes the run.
- Every session timestamp has to be checked when the save format lands, because an absolute time
  restored hours later would fire at once.
- The protocol grows a `saveAndQuit` intent and continue and discard options on `joinSession`; those
  follow-ups bump `PROTOCOL_VERSION`. This record changes no code.
