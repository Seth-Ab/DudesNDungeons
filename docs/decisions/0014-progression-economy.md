# 0014 - Progression Economy and Skill Stacking

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the "already-known scroll" and "duplicate scrolls may become an upgrade path later"
  rules of decision 0011, and the "Progression currency: none" checkpoint in `PROGRESS.md`.

## Context

Decision 0011 made skills rare, transferable scroll loot and left three things open: whether there
is a currency, how a duplicate scroll of a known skill is used, and how a hub shop sells skills.
`src/server/content/schema.ts` left unlock costs out of upgrade definitions until that was settled,
and the Skills UI (#25) could not show what unlocking a skill takes.

The owner settled every open point on issue #23 on 2026-10-19, and the cosmetics shop decisions on
#128 the same day share the same coin and stock rules. This record writes those decisions down and
fills in the mechanics the follow-up tickets need so none of them has to invent product behavior.
Numbers (coin amounts, prices, stack limits and per-stack values) are tuning for those tickets.

## Decision

### Coin

- There is one progression currency, **coin**. It is a non-negative integer on the player's profile
  (`profile.coin`), personal, never shared with the party and never stored in the party vault.
- The same coin buys skills and, per #128, cosmetics.
- Coin is earned from runs. During a run it accrues to a per-player **run purse** that sits outside
  the three inventory slots, like the torch. The run purse is credited to the profile when that
  player extracts (by the same predicate that keeps provisional skills: escaping, including being
  revived first or carried out), and lost when the player is left behind or the party wipes,
  following the death-and-loss rule.
- Run coin comes from an escape reward credited on extraction and from converting a scroll (below).
  Loot tables may also roll coin into the purse; which tables do, and every amount, is tuning.
- Coin earned in the hub (converting a scroll there) is credited to the profile immediately, since
  the hub is the save boundary.
- The server alone changes coin. A client never sends a balance, a price or an amount.

### Where skills come from

A permanent skill, or another stack of one, comes from one of three sources:

1. **The hub skill shop**, for coin. The shop sells skill scrolls, not unlocks: a bought scroll goes
   into the buyer's inventory and follows every scroll rule below, so it can be used at once, given
   to a teammate, or stored in the party vault (#126). Used in the hub, it is permanent immediately,
   as decision 0011 already says.
2. **Rare monster drops** (and, as today, boss and chest loot): skill scrolls in loot tables. Which
   monsters drop which scrolls, and how rarely, is tuning.
3. **Milestone achievements**, for special unlocks. A milestone grants one stack of its skill
   straight to the profile, with no scroll, when the profile's tracked stat reaches the milestone's
   threshold. A milestone skill may not have prerequisites (content validation refuses it), so a
   grant never has to wait.

### Stacking

This replaces duplicate-scroll upgrades and the separate tiered-upgrade content.

- Every skill declares `maxStacks`: a positive integer, or `null` for unlimited. `1` means the skill
  does not stack (for example "revive once per run"); a small number caps it (night vision at 2-3);
  `null` keeps stacking (+5% move speed). The skill names here are illustrations, not content.
- A skill's existing `effects` are its first stack. A stacking skill adds exactly one of:
  - `stackEffects`: an explicit list for stacks 2 to `maxStacks`, so its length is `maxStacks - 1`.
    Only for a capped skill.
  - `perStackEffects`: effects added again for every stack beyond the first. Required for an
    unlimited skill, allowed for a capped one.
  A skill with `maxStacks: 1` has neither. Content loading refuses any other combination.
- Using a scroll of a skill the player already has, below its limit, consumes the scroll and adds
  one stack. In a dungeon that stack is provisional and is saved or lost on extraction exactly like a
  first unlock (decision 0011). The limit counts permanent and provisional stacks together.
- Profiles store a stack count per skill. Existing `unlockedSkillIds` become one stack each.
  `content/upgrades/` is folded into the skills: Iron Will's two tiers become its stacks 2 and 3
  (`maxStacks: 3`), the upgrade content kind and `unlockedUpgradeIds` are retired, and a profile
  holding upgrade ids keeps them as extra stacks (one plus its highest tier) so nothing is lost.

### Prerequisites and build paths

- A skill may list `requires`: skill ids the player must already have at least one stack of.
  Content loading refuses unknown ids and cycles.
- Prerequisites count permanent and provisional stacks, so a skill learned earlier in the same run
  qualifies; if the run is lost, both are lost together.
- A scroll whose prerequisites the player lacks **cannot be used**. The server refuses the use and
  the scroll stays in the slot, so the player can carry it out and store it until they qualify, or
  give it to a teammate who already does. Different players end up on different build paths.

### Scrolls at max stacks

- Using a scroll of a skill already at its `maxStacks` does not consume it. The server refuses the
  plain use with a reason saying the skill is maxed, and the client shows a prompt instead:
  converting the scroll turns it into coin, and the prompt reminds the player they can **give it to
  a teammate** (`giveItem`/`dropItem`) or **keep it** and store it in the vault.
- Conversion is its own explicit intent, sent only after the player confirms. The server checks
  again that the scroll is in the player's inventory and its skill is still at max; anything else
  is refused and nothing changes.
- Converted coin goes to the run purse in a dungeon (carried, lost on death) and to the profile in
  the hub. The coin a scroll converts to is tuning, but it is always less than the scroll's shop
  price, so buying to convert never pays.
- Only maxed scrolls convert. A scroll that is merely missing prerequisites does not.

### The hub skill shop

- The shop is a hub room of a new kind `shop` around a stall labelled Scrolls. Placing it in the
  hub ring is layout work for the follow-up ticket. Like the vault, a purchase requires a standing,
  non-designing player inside that room, in the hub.
- A purchase names a stock entry, never a price. The server refuses it when the item is not in
  stock right now, the player cannot afford it, their inventory has no free slot, or the scroll's
  skill is already at max stacks for them. Buying a scroll whose prerequisites they lack is
  allowed, since it can wait or go to a teammate.
- A skill's price is per scroll and flat unless a later tuning ticket adds a per-stack rule.
- **Stock** (shared with the cosmetics shop, #128 and #137): mostly fixed, plus a small rotating
  slot of 2-3 items that rerolls **after every run** (owner decision, 2026-10-21, replacing the
  weekly rotation). Stock belongs to the room: a run ending by escape or wipe advances that room's
  run count, and the rotation is derived deterministically from the room code, that count and the
  rotating pool in content. Only the count needs saving, alongside the room's vault, so a restart
  does not reshuffle it and the stock never changes during a run.

### Milestones

- Profiles track the stats milestones need, shared with the cosmetic milestones listed on #128:
  runs escaped, full-party escapes, wins, Ember Warden kills, flawless Ember Warden kills, teammates
  carried out, lever puzzles solved, runs without a torch, items banked, and finding the hidden moth
  room.
- A run's stats are credited when it ends, to each player who extracted, by the same rule that saves
  provisional skills. A player left behind or caught in a wipe earns no run stats.
- A milestone is content: the stat, the threshold, and the skill (or, in #137, the cosmetic) it
  grants. Crossing it grants once, permanently.

### Locked-skill display

A locked skill shows its coin price and any prerequisite skills. When a skill is not in the shop's
fixed stock, it shows its other source instead (its milestone and threshold, or that it is found in
the dungeon), and a rotating skill shows whether it is in stock right now. A held scroll the player
cannot use yet shows the missing prerequisites; a held maxed scroll shows that it can be converted.
Stacking skills show their stack count against the limit; unlimited ones show only the count, and
non-stacking ones show none. All of this comes from the owner-only progression messages, never from
client state.

### Existing profiles and content changes

- Unlocks and stacks are kept when content changes, and new content shows up locked.
- A skill removed from content stays on the profile but has no effect and is not shown, as the
  effect resolver already does for unknown ids. If it returns, so does the stack.
- Lowering a skill's `maxStacks` never deletes stacks. The stored count stays, effects apply only up
  to the current limit, and the excess counts as maxed for scroll use and conversion.
- Existing profiles start with 0 coin and zero for every tracked stat; nothing is backfilled from
  `runsEscaped` or `runsLost`. The legacy `bankedItems` list is untouched.

### Unchanged

- Decision 0011's extraction rule: dungeon-earned skills and stacks are provisional until
  extraction; hub-earned ones are permanent immediately.
- The minimap stays free for everyone (#160); no skill gates it.

## Follow-up Work

Filed on 2026-10-21, in dependency order:

- #213: skill stacking and prerequisites, folding tiered upgrades into stacks.
- #214: profile coin, the run purse, and converting max-stack scrolls with a confirmation.
- #215: milestone stat tracking and milestone skill grants.
- #216: the hub skill shop with stock that rotates after every run.
- #217: a scroll for every skill and rare skill-scroll monster drops.

The Skills UI (#25) and the cosmetics shop (#137) build on them.

## Consequences

- Skills, upgrades and duplicates collapse into one rule, stacks, and the separate upgrade content
  kind goes away.
- Coin adds a second thing a failed run can lose, carried the same way as items, so the
  death-and-loss rule stays one rule.
- The shop sells items rather than unlocks, so buying, finding and trading scrolls all go through
  the same `useItem` path and the same server checks.
- The protocol grows coin, stacks, prerequisites, prices and stock in the owner-only progression
  messages, plus purchase and conversion intents; each follow-up bumps `PROTOCOL_VERSION`.
