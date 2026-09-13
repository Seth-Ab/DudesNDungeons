import { describe, expect, it } from "vitest";
import { canOccupy } from "../../src/server/game/dungeonState.js";
import { interact, pickupItem, useItem } from "../../src/server/game/items.js";
import {
  MAX_INVENTORY_SIZE,
  PLAYER_MAX_HEALTH,
  TONIC_HEAL_AMOUNT,
} from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import {
  COPPER_KEY_ID,
  MINOR_TONIC_ID,
  VAULT_DOOR_ID,
  VAULT_EXIT_ID,
  testPlayer,
  testSession,
} from "./fixtures.js";

// Copper Key at (12, 1), locked door at (11, 6), exit at (14, 6) inside the vault.

const KEY: InventoryItem = { id: COPPER_KEY_ID, name: "Copper Key", kind: "key" };
const TONIC: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", kind: "tonic" };
const BY_THE_DOOR = { x: 10.4, y: 6 };

describe("pickup", () => {
  it("moves loot in reach from the floor into the inventory", () => {
    const player = testPlayer("alpha", { position: { x: 12, y: 1 } });
    const session = testSession([player]);

    expect(pickupItem(session, "alpha", COPPER_KEY_ID)).toEqual({ ok: true });
    expect(player.inventory).toEqual([KEY]);
    expect(session.dungeon.loot.find((loot) => loot.id === COPPER_KEY_ID)?.pickedUp).toBe(true);
  });

  it("refuses loot out of reach, and loot someone already took", () => {
    const far = testPlayer("alpha", { position: { x: 2, y: 2 } });
    const near = testPlayer("beta", { position: { x: 12, y: 1 } });
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
      position: { x: 12, y: 1 },
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
    expect(player.health).toBe(50 + TONIC_HEAL_AMOUNT);
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
    // A point inside the door's tile, far enough from the player that only the door could block it.
    expect(canOccupy(session, { x: 11.4, y: 6 })).toBe(true);
    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
  });

  it("refuses a door out of reach", () => {
    const session = testSession([testPlayer("alpha", { inventory: [{ ...KEY }] })]);

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "outOfRange" });
  });

  it("clears the dungeon from the exit", () => {
    const session = testSession([testPlayer("alpha", { position: { x: 14, y: 6 } })]);

    expect(interact(session, "alpha", VAULT_EXIT_ID)).toEqual({ ok: true });
    expect(session.dungeon.cleared).toBe(true);
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
        position: { x: 12, y: 1 },
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
