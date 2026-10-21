# 0013 - Party Vault

- Status: Accepted
- Date: 2026-10-21

## Context

Each survivor's carry used to go into their own profile bank (`profile.bankedItems`). Nothing could
take an item back out, so banked loot was never used again, and the bank was owner-only data that
teammates could not see. The owner asked for a vault the whole party shares, and recorded the open
questions as decisions on issue #126 on 2026-10-19.

## Decision

### The vault belongs to the room code

A `PartyVault` (`src/server/vaults/`) is keyed by room code and shared by reference with the
`Session` playing that code, like a profile with its player. A new room starts with an empty vault.
`VaultStore` writes every vault that has ever changed to `data/vaults.json` (relocated by
`DATA_DIR` with the profiles), atomically and validated on read. A room code with a saved vault is
never handed to a new room, and joining that code when no session holds it (after the empty session
was swept, or after a restart) reopens the room in the hub with its vault. A room nobody stored in
leaves nothing on disk and so cannot be reopened. This is the party identity #122's per-room saves
will share.

### Who deposits

`returnToHub` deposits every escaping survivor's inventory and hand into the vault, including a
downed player being carried out. A wipe, or a downed player left behind, loses their carry. Skill
unlocks and run counts stay on each profile.

### Taking and storing

`withdrawVaultItem` and `depositVaultItem` name a vault entry or a carried item by id. Both are hub
only, refused for a downed player or one still designing, and require the player to stand inside a
room of kind `vault`: the hub's Bank room, around the Bank stall. The client prompts by the same
shared `roomAt` rule, and interacting there opens the vault panel; each Take or Store is what the
server checks. There are no locks: any standing party member may take any item. Messages are
handled one at a time against the current vault, so two requests for one item resolve to one taker
and the other gets `targetMissing`.

A withdrawal follows pickup rules: a weapon fills an empty hand first, ammo tops up carried stacks
before taking a free slot, and whatever ammo does not fit stays in the vault. Capacity is unlimited,
and a deposited stack merges into the vault's stacks of the same item up to its `maxStack`.

Skill scrolls are ordinary vault items, so a scroll a player cannot use yet can wait for later or
for a teammate.

### Legacy banks

`profile.bankedItems` stays on the profile and in the owner's `PlayerState` as a read-only legacy
list, shown in the camp menu's Stash. There is no migration and nothing adds to it any more.

## Protocol Version 38

- `withdrawVaultItem { itemId }` and `depositVaultItem { itemId }` client messages;
- `partyVault { items }`, sent to every member once after joining and whenever the vault changes;
- room kind `vault`.

## Consequences

- Shared loot can now be used again, and a party coming back to its room code finds what it left.
- A room code is long-lived once anything was stored in it. Nothing expires saved vaults yet.
