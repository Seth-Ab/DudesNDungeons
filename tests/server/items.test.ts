import { describe, expect, it } from "vitest";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import { canOccupy } from "../../src/server/game/dungeonState.js";
import { interact, pickupItem, useItem } from "../../src/server/game/items.js";
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
  testSession,
  TONIC_FIELDS,
} from "./fixtures.js";

// Copper Key on tile (12, 1), locked door on (11, 6), exit on (14, 6) inside the vault.

const KEY: InventoryItem = { id: COPPER_KEY_ID, name: "Copper Key", kind: "key" };
const TONIC: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", ...TONIC_FIELDS };
const SKILL_SCROLL: InventoryItem = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "Scroll of Iron Will",
  kind: "skillScroll",
  skillId: "iron-will",
};

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
    expect(player.runSkillIds).toEqual(new Set(["iron-will"]));
    expect(player.profile.unlockedSkillIds).toEqual([]);
  });

  it("does not consume a scroll for a skill the player already knows", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      profile: testPlayer("known").profile,
    });
    player.profile.unlockedSkillIds.push("iron-will");
    const session = testSession([player]);

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(player.inventory).toEqual([SKILL_SCROLL]);
  });

  it("does not consume a duplicate after learning the same skill during this run", () => {
    const player = testPlayer("alpha", {
      inventory: [{ ...SKILL_SCROLL }],
      runSkillIds: new Set(["iron-will"]),
    });
    const session = testSession([player]);

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(player.inventory).toEqual([SKILL_SCROLL]);
  });

  it("makes a skill learned in the hub permanent immediately", () => {
    const player = testPlayer("alpha", { inventory: [{ ...SKILL_SCROLL }] });
    const session = testSession([player]);
    session.location = "hub";
    const before = player.profile.revision;

    expect(useItem(session, "alpha", SKILL_SCROLL.id)).toEqual({ ok: true });
    expect(player.profile.unlockedSkillIds).toEqual(["iron-will"]);
    expect(player.runSkillIds).toEqual(new Set());
    expect(player.profile.revision).toBe(before + 1);
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
    expect(door(session)).toMatchObject({ open: false, locked: true });
  });

  it("unlocks and opens a locked door with a key, spending the key", () => {
    const player = testPlayer("alpha", { position: BY_THE_DOOR, inventory: [{ ...KEY }] });
    const session = testSession([player]);

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: true });
    expect(door(session)).toMatchObject({ open: true, locked: false });
    expect(player.inventory).toEqual([]);
    // A point inside the doorway, far enough from the player that only the door could block it.
    expect(canOccupy(session, at(11, 6))).toBe(true);
    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
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
    expect(player.profile.bankedItems).toEqual([TONIC]);
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
