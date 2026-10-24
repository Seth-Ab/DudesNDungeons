import { describe, expect, it } from "vitest";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import { canOccupy } from "../../src/server/game/dungeonState.js";
import { dropItem, giveItem, interact, pickupItem, useItem } from "../../src/server/game/items.js";
import {
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_HEALTH,
} from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import {
  COPPER_KEY_ID,
  MINOR_TONIC_ID,
  VAULT_DOOR_ID,
  VAULT_EXIT_ID,
  at,
  testPlayer,
  testProfile,
  testSession,
  TONIC_FIELDS,
} from "./fixtures.js";

// Copper Key on tile (12, 1), locked door on (11, 6), exit on (14, 6) inside the vault.

const KEY: InventoryItem = { id: COPPER_KEY_ID, name: "Copper Key", kind: "key", itemId: "copper-key" };
const TONIC: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", ...TONIC_FIELDS };
const SKILL_SCROLL: InventoryItem = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "Scroll of Iron Will",
  kind: "skillScroll",
  skillId: "iron-will",
};

const DEEP_WILL_SCROLL: InventoryItem = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Scroll of Deep Will",
  kind: "skillScroll",
  skillId: "deep-will",
};

/** Adds a test skill that requires Iron Will to the session's content. */
function withDeepWill<T extends ReturnType<typeof testSession>>(session: T): T {
  const shipped = loadContent();
  session.runDungeon.content = {
    ...shipped,
    skills: new Map([
      ...shipped.skills,
      [
        "deep-will",
        {
          id: "deep-will",
          name: "Deep Will",
          description: "Needs Iron Will first.",
          effects: [{ type: "resistanceBonus", amount: 1 }],
          maxStacks: 1,
          requires: ["iron-will"],
          conversionCoin: 1,
        },
      ],
    ]),
  };
  return session;
}

/** At the face of the doorway, on the tile before it: where a party walking up to it stops. */
const BY_THE_DOOR = at(10, 6, 1.9);

describe("pickup", () => {
  it("moves loot in reach from the floor into the inventory", () => {
    const player = testPlayer("alpha", { position: at(12, 1) });
    const session = testSession([player]);

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: true });
    expect(player.inventory).toEqual([KEY]);
    expect(session.dungeon.loot.find((loot) => loot.id === COPPER_KEY_ID)?.pickedUp).toBe(true);
  });

  it("refuses loot out of reach, and loot someone already took", () => {
    const far = testPlayer("alpha", { position: at(2, 2) });
    const near = testPlayer("beta", { position: at(12, 1) });
    const session = testSession([far, near]);

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: false, reason: "outOfRange" });
    expect(pickupItem(session, "beta", COPPER_KEY_ID).ok).toBe(true);
    expect(pickupItem(session, "beta", COPPER_KEY_ID)).toEqual({
      ok: false,
      reason: "targetMissing",
    });
  });

  it("refuses when the inventory is full", () => {
    const player = testPlayer("alpha", {
      position: at(12, 1),
      inventory: Array.from({ length: MAX_INVENTORY_SIZE }, () => ({ ...TONIC })),
    });
    const session = testSession([player]);

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });
});

describe("using items", () => {
  it("heals with a tonic and uses it up", () => {
    const player = testPlayer("alpha", { health: 50, inventory: [{ ...TONIC }] });
    const session = testSession([player]);

    expect(useItem(session, "alpha", MINOR_TONIC_ID)).toEqual({ ok: true });
    expect(player.health).toBe(50 + 35);
    expect(player.inventory).toEqual([]);
  });

  it("does not overheal, and refuses a tonic at full health", () => {
    const hurt = testPlayer("alpha", { health: PLAYER_MAX_HEALTH - 1, inventory: [{ ...TONIC }] });
    const healthy = testPlayer("beta", { inventory: [{ ...TONIC }] });
    const session = testSession([hurt, healthy]);

    expect(useItem(session, "alpha", MINOR_TONIC_ID).ok).toBe(true);
    expect(hurt.health).toBe(PLAYER_MAX_HEALTH);
    expect(useItem(session, "beta", MINOR_TONIC_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(healthy.inventory).toHaveLength(1);
  });

  it("does not use a key on its own, or an item the player does not carry", () => {
    const session = testSession([testPlayer("alpha", { inventory: [{ ...KEY }] })]);

    expect(useItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(useItem(session, "alpha", MINOR_TONIC_ID)).toEqual({
      ok: false,
      reason: "targetMissing",
    });
  });

  it("applies every effect of a consumable defined by a content file alone", () => {
    const player = testPlayer("alpha", { health: 20, stamina: 10, resistance: 5 });
    const session = testSession([player]);
    const shipped = loadContent();
    session.runDungeon.content = {
      ...shipped,
      items: new Map([
        ...shipped.items,
        [
          "grand-draught",
          itemDefinitionSchema.parse({
            id: "grand-draught",
            name: "Grand Draught",
            kind: "consumable",
            description: "Restores health, stamina, and resistance.",
            effects: [
              { type: "heal", amount: 30 },
              { type: "restoreStamina", amount: 50 },
              { type: "restoreResistance", amount: 10 },
            ],
          }),
        ],
      ]),
    };
    player.inventory.push({
      id: "88888888-8888-4888-8888-888888888888",
      name: "Grand Draught",
      kind: "consumable",
      itemId: "grand-draught",
      description: "Restores health, stamina, and resistance.",
      icon: "tonic",
      useOn: "self",
    });

    expect(useItem(session, "alpha", "88888888-8888-4888-8888-888888888888")).toEqual({ ok: true });
    expect(player.health).toBe(50);
    expect(player.stamina).toBe(60);
    expect(player.resistance).toBe(15);
    expect(player.inventory).toEqual([]);
  });

  it("applies the effects that matter and still consumes the item when only some are wasted", () => {
    const player = testPlayer("alpha", { health: PLAYER_MAX_HEALTH, stamina: 10 });
    const session = testSession([player]);
    const shipped = loadContent();
    session.runDungeon.content = {
      ...shipped,
      items: new Map([
        ...shipped.items,
        [
          "draught",
          itemDefinitionSchema.parse({
            id: "draught",
            name: "Draught",
            kind: "consumable",
            description: "Heals and refreshes.",
            effects: [
              { type: "heal", amount: 30 },
              { type: "restoreStamina", amount: 20 },
            ],
          }),
        ],
      ]),
    };
    player.inventory.push({ ...TONIC, id: "88888888-8888-4888-8888-888888888888", itemId: "draught" });

    expect(useItem(session, "alpha", "88888888-8888-4888-8888-888888888888").ok).toBe(true);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.stamina).toBe(30);
  });

  it("refuses a consumable whose definition no longer exists, and keeps it", () => {
    const player = testPlayer("alpha", {
      health: 10,
      inventory: [{ ...TONIC, itemId: "removed-from-content" }],
    });
    const session = testSession([player]);

    expect(useItem(session, "alpha", MINOR_TONIC_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toHaveLength(1);
    expect(player.health).toBe(10);
  });

  it("consumes a skill scroll and activates it provisionally during a run", () => {
    const player = testPlayer("alpha", { inventory: [{ ...SKILL_SCROLL }] });
    const session = testSession([player]);

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: true });
    expect(player.inventory).toEqual([]);
    expect(player.runSkillStacks).toEqual(new Map([["iron-will", 1]]));
    expect(player.profile.skillStacks).toEqual({});
  });

  it("adds a provisional stack for a duplicate scroll in a dungeon", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      profile: testProfile("alpha", { skillStacks: { "iron-will": 1 } }),
    });
    const session = testSession([player]);

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: true });
    expect(player.inventory).toEqual([]);
    expect(player.runSkillStacks).toEqual(new Map([["iron-will", 1]]));
    expect(player.profile.skillStacks).toEqual({ "iron-will": 1 });
  });

  it("adds a permanent stack for a duplicate scroll in the hub", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      profile: testProfile("alpha", { skillStacks: { "iron-will": 1 } }),
    });
    const session = testSession([player]);
    session.location = "hub";
    const before = player.profile.revision;

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: true });
    expect(player.profile.skillStacks).toEqual({ "iron-will": 2 });
    expect(player.runSkillStacks).toEqual(new Map());
    expect(player.profile.revision).toBe(before + 1);
  });

  it("refuses a scroll at max stacks, counting provisional ones, and keeps it", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      profile: testProfile("alpha", { skillStacks: { "iron-will": 2 } }),
      runSkillStacks: new Map([["iron-will", 1]]),
    });
    const session = testSession([player]);

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: false, reason: "skillMaxed" });
    expect(player.inventory).toEqual([SKILL_SCROLL]);
    expect(player.runSkillStacks).toEqual(new Map([["iron-will", 1]]));
    expect(player.profile.skillStacks).toEqual({ "iron-will": 2 });
  });

  it("treats a stored count above a lowered limit as maxed without trimming it", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      profile: testProfile("alpha", { skillStacks: { "iron-will": 5 } }),
    });
    const session = testSession([player]);
    session.location = "hub";

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: false, reason: "skillMaxed" });
    expect(player.profile.skillStacks).toEqual({ "iron-will": 5 });
  });

  it("refuses a scroll whose prerequisites are missing, and keeps it", () => {
    const player = testPlayer("alpha", { inventory: [{ ...DEEP_WILL_SCROLL }] });
    const session = withDeepWill(testSession([player]));

    expect(useItem(session, "alpha", DEEP_WILL_SCROLL.id)).toEqual({
      ok: false,
      reason: "missingPrerequisites",
    });
    expect(player.inventory).toEqual([DEEP_WILL_SCROLL]);
    expect(player.runSkillStacks).toEqual(new Map());
  });

  it("accepts a prerequisite learned earlier in the same run", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }, { ...DEEP_WILL_SCROLL }],
    });
    const session = withDeepWill(testSession([player]));

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: true });
    expect(useItem(session, "alpha", DEEP_WILL_SCROLL.id)).toEqual({ ok: true });
    expect(player.inventory).toEqual([]);
    expect(player.runSkillStacks).toEqual(
      new Map([
        ["iron-will", 1],
        ["deep-will", 1],
      ]),
    );
  });

  it("refuses a scroll for a skill content no longer has, and keeps it", () => {
    const scroll: InventoryItem = { ...SKILL_SCROLL, skillId: "removed-skill" };
    const player = testPlayer("alpha", { inventory: [scroll] });
    const session = testSession([player]);

    expect(useItem(session, "alpha", scroll.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toEqual([scroll]);
  });
});

describe("doors and exits", () => {
  const door = (session: ReturnType<typeof testSession>) => {
    const found = session.dungeon.doors.find((candidate) => candidate.id === VAULT_DOOR_ID);
    if (!found) throw new Error("Ember Vault has a vault door");
    return found;
  };

  it("keeps a locked door shut for a player without a key", () => {
    const session = testSession([testPlayer("alpha", { position: BY_THE_DOOR })]);

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(door(session)).toMatchObject({ open: false, lock: { type: "key", keyItemId: "copper-key" } });
  });

  it("unlocks and opens a locked door with a key, spending the key", () => {
    const player = testPlayer("alpha", { position: BY_THE_DOOR, inventory: [{ ...KEY }] });
    const session = testSession([player]);

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: true });
    expect(door(session)).toMatchObject({ open: true, lock: null });
    expect(player.inventory).toEqual([]);
    // A point inside the doorway, far enough from the player that only the door could block it.
    expect(canOccupy(session, at(11, 6))).toBe(true);
    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
  });

  describe("typed key locks", () => {
    const BOSS_KEY: InventoryItem = { id: "b0000000-0000-4000-8000-000000000001", name: "Boss Key", kind: "key", itemId: "boss-key" };
    const VAULT_KEY: InventoryItem = { id: "b0000000-0000-4000-8000-000000000002", name: "Vault Key", kind: "key", itemId: "vault-key" };

    /** The vault door, relocked so it wants `keyItemId`. */
    function lockedWith(keyItemId: string, inventory: InventoryItem[], extra: Parameters<typeof testPlayer>[1] = {}) {
      const player = testPlayer("alpha", { position: BY_THE_DOOR, inventory, ...extra });
      const session = testSession([player]);
      door(session).lock = { type: "key", keyItemId };
      return { player, session };
    }

    it("opens a boss door with the boss key and refuses the vault key, keeping it", () => {
      const refused = lockedWith("boss-key", [{ ...VAULT_KEY }]);
      expect(interact(refused.session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(door(refused.session)).toMatchObject({ open: false, lock: { type: "key", keyItemId: "boss-key" } });
      expect(refused.player.inventory).toEqual([VAULT_KEY]);

      const opened = lockedWith("boss-key", [{ ...VAULT_KEY }, { ...BOSS_KEY }]);
      expect(interact(opened.session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: true });
      expect(door(opened.session)).toMatchObject({ open: true, lock: null });
      expect(opened.player.inventory).toEqual([VAULT_KEY]);
    });

    it("opens a vault door with the vault key and refuses the boss key, keeping it", () => {
      const refused = lockedWith("vault-key", [{ ...BOSS_KEY }]);
      expect(interact(refused.session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(refused.player.inventory).toEqual([BOSS_KEY]);

      const opened = lockedWith("vault-key", [{ ...VAULT_KEY }]);
      expect(interact(opened.session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: true });
      expect(opened.player.inventory).toEqual([]);
    });

    it("refuses the generic key on a typed door", () => {
      const { player, session } = lockedWith("boss-key", [{ ...KEY }]);

      expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(player.inventory).toEqual([KEY]);
    });

    it("refuses from out of range, keeping the key and the lock", () => {
      const { player, session } = lockedWith("boss-key", [{ ...BOSS_KEY }], { position: at(1, 1) });

      expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "outOfRange" });
      expect(player.inventory).toEqual([BOSS_KEY]);
      expect(door(session).lock).not.toBeNull();
    });

    it("refuses a disconnected player, keeping the key and the lock", () => {
      const { player, session } = lockedWith("boss-key", [{ ...BOSS_KEY }], { connected: false });

      expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(player.inventory).toEqual([BOSS_KEY]);
      expect(door(session)).toMatchObject({ open: false });
      expect(door(session).lock).not.toBeNull();
    });

    it("spends one key once when two players interact together", () => {
      const first = testPlayer("alpha", { position: BY_THE_DOOR, inventory: [{ ...BOSS_KEY }] });
      const second = testPlayer("bravo", { position: BY_THE_DOOR, inventory: [{ ...BOSS_KEY, id: "b0000000-0000-4000-8000-000000000003" }] });
      const session = testSession([first, second]);
      door(session).lock = { type: "key", keyItemId: "boss-key" };

      expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: true });
      expect(interact(session, "bravo", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(first.inventory).toEqual([]);
      expect(second.inventory).toHaveLength(1);
    });

    it("does not open a seal or hidden lock by interacting", () => {
      for (const lock of [{ type: "seal", groupId: "arena" }, { type: "hidden" }] as const) {
        const { player, session } = lockedWith("boss-key", [{ ...BOSS_KEY }]);
        door(session).lock = lock;

        expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
        expect(player.inventory).toEqual([BOSS_KEY]);
        expect(door(session)).toMatchObject({ open: false, lock });
      }
    });
  });

  it("refuses a door out of reach", () => {
    const session = testSession([testPlayer("alpha", { inventory: [{ ...KEY }] })]);

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "outOfRange" });
  });

  it("returns the party to the hub from the exit", () => {
    const player = testPlayer("alpha", { position: at(14, 6), inventory: [{ ...TONIC }] });
    const session = testSession([player]);

    expect(interact(session, "alpha", VAULT_EXIT_ID)).toEqual({ ok: true });
    expect(session.location).toBe("hub");
    expect(session.dungeon.map.id).toBe("hub");
    expect(player.inventory).toEqual([]);
    expect(session.vault.items).toEqual([TONIC]);
  });

  it("refuses an unknown target", () => {
    const session = testSession([testPlayer("alpha")]);

    expect(interact(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: false, reason: "targetMissing" });
  });
});

describe("downed players", () => {
  it("cannot pick up, use, or interact", () => {
    const session = testSession([
      testPlayer("alpha", {
        position: at(12, 1),
        health: 0,
        inventory: [{ ...TONIC }],
      }),
    ]);
    const refused = { ok: false, reason: "notPermitted" };

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual(refused);
    expect(useItem(session, "alpha", MINOR_TONIC_ID)).toEqual(refused);
    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual(refused);
  });
});

describe("dropping", () => {
  it("round-trips the same item id through the floor", () => {
    const player = testPlayer("alpha", { position: at(12, 1) });
    const session = testSession([player]);

    expect(pickupItem(session, "alpha", COPPER_KEY_ID).ok).toBe(true);
    player.position = at(3, 3);
    expect(dropItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: true });
    expect(player.inventory).toEqual([]);

    const matches = session.dungeon.loot.filter((loot) => loot.id === COPPER_KEY_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ pickedUp: false, position: at(3, 3), kind: "key", itemId: "copper-key" });

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: true });
    expect(player.inventory).toEqual([KEY]);
  });

  it("keeps a consumable's and a scroll's details so they can be picked up whole", () => {
    const player = testPlayer("alpha", { inventory: [{ ...TONIC }, { ...SKILL_SCROLL }] });
    const session = testSession([player]);

    expect(dropItem(session, "alpha", MINOR_TONIC_ID).ok).toBe(true);
    expect(dropItem(session, "alpha", SKILL_SCROLL.id).ok).toBe(true);
    expect(pickupItem(session, "alpha", MINOR_TONIC_ID).ok).toBe(true);
    expect(pickupItem(session, "alpha", SKILL_SCROLL.id).ok).toBe(true);
    expect(player.inventory).toEqual([TONIC, SKILL_SCROLL]);
  });

  it("refuses an item the player does not hold, and malformed ids", () => {
    const player = testPlayer("alpha", { inventory: [{ ...TONIC }] });
    const session = testSession([player]);
    const lootBefore = session.dungeon.loot.length;

    for (const id of [COPPER_KEY_ID, "not-an-id", ""]) {
      expect(dropItem(session, "alpha", id)).toEqual({ ok: false, reason: "targetMissing" });
    }
    expect(player.inventory).toEqual([TONIC]);
    expect(session.dungeon.loot).toHaveLength(lootBefore);
  });

  it("refuses a downed player", () => {
    const player = testPlayer("alpha", { health: 0, inventory: [{ ...TONIC }] });
    const session = testSession([player]);

    expect(dropItem(session, "alpha", MINOR_TONIC_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toEqual([TONIC]);
  });

  it("loses a dropped item at run end instead of banking it", () => {
    const player = testPlayer("alpha", { position: at(14, 6), inventory: [{ ...TONIC }] });
    const session = testSession([player]);

    expect(dropItem(session, "alpha", MINOR_TONIC_ID).ok).toBe(true);
    expect(interact(session, "alpha", VAULT_EXIT_ID)).toEqual({ ok: true });
    expect(session.location).toBe("hub");
    expect(player.profile.bankedItems).toEqual([]);
    expect(session.dungeon.loot.some((loot) => loot.id === MINOR_TONIC_ID)).toBe(false);
  });
});

describe("giving", () => {
  function pair(beta: Parameters<typeof testPlayer>[1] = {}, alpha: Parameters<typeof testPlayer>[1] = {}) {
    const giver = testPlayer("alpha", { position: at(5, 5), inventory: [{ ...TONIC }], ...alpha });
    const receiver = testPlayer("beta", { position: at(5, 5), ...beta });
    return { giver, receiver, session: testSession([giver, receiver]) };
  }

  it("moves the item to a standing, connected player in reach", () => {
    const { giver, receiver, session } = pair();

    expect(giveItem(session, "alpha", MINOR_TONIC_ID, "beta")).toEqual({ ok: true });
    expect(giver.inventory).toEqual([]);
    expect(receiver.inventory).toEqual([TONIC]);
  });

  it.each([
    ["full", { inventory: Array.from({ length: MAX_INVENTORY_SIZE }, () => ({ ...KEY })) }, "notPermitted"],
    ["downed", { health: 0 }, "notPermitted"],
    ["disconnected", { connected: false }, "notPermitted"],
    ["still designing", { appearance: null }, "notPermitted"],
    ["out of range", { position: at(12, 12) }, "outOfRange"],
  ] as const)("refuses a %s target and changes nothing", (_label, overrides, reason) => {
    const { giver, receiver, session } = pair(overrides);
    const receiverBefore = [...receiver.inventory];

    expect(giveItem(session, "alpha", MINOR_TONIC_ID, "beta")).toEqual({ ok: false, reason });
    expect(giver.inventory).toEqual([TONIC]);
    expect(receiver.inventory).toEqual(receiverBefore);
  });

  it("refuses a player from another session, an unknown target, and oneself", () => {
    const { giver, session } = pair();
    const outsider = testPlayer("gamma", { position: at(5, 5) });
    testSession([outsider]);

    expect(giveItem(session, "alpha", MINOR_TONIC_ID, "gamma")).toEqual({
      ok: false,
      reason: "targetMissing",
    });
    expect(giveItem(session, "alpha", MINOR_TONIC_ID, "alpha")).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(outsider.inventory).toEqual([]);
    expect(giver.inventory).toEqual([TONIC]);
  });

  it("refuses an item the giver does not hold and a downed giver", () => {
    const { giver, receiver, session } = pair();

    expect(giveItem(session, "alpha", COPPER_KEY_ID, "beta")).toEqual({
      ok: false,
      reason: "targetMissing",
    });
    expect(giveItem(session, "alpha", "bad", "beta").ok).toBe(false);
    giver.health = 0;
    expect(giveItem(session, "alpha", MINOR_TONIC_ID, "beta")).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(giver.inventory).toEqual([TONIC]);
    expect(receiver.inventory).toEqual([]);
  });
});
