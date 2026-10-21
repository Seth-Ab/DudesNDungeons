import { describe, expect, it } from "vitest";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import { lootInstance } from "../../src/server/game/dungeonBuilder.js";
import { dropItem, giveItem, pickupItem, swapHeld, useItem } from "../../src/server/game/items.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import { MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, MINOR_TONIC_ID, testPlayer, testSession, TONIC_FIELDS } from "./fixtures.js";

const SWORD: InventoryItem = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Test Sword",
  kind: "weapon",
  itemId: "test-sword",
  weaponKind: "melee",
};
const BOW: InventoryItem = {
  id: "a0000000-0000-4000-8000-000000000002",
  name: "Test Bow",
  kind: "weapon",
  itemId: "test-bow",
  weaponKind: "ranged",
};
const TONIC: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", ...TONIC_FIELDS };

function tonics(count: number): InventoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...TONIC,
    id: `b0000000-0000-4000-8000-00000000000${index}`,
  }));
}

/** A session with `weapons` lying on the floor at the player's feet. */
function withWeaponsOnFloor(player: ReturnType<typeof testPlayer>, weapons: InventoryItem[]) {
  const session = testSession([player]);
  for (const weapon of weapons) {
    if (weapon.kind !== "weapon") continue;
    session.dungeon.loot.push({
      id: weapon.id,
      name: weapon.name,
      kind: "weapon",
      itemId: weapon.itemId,
      weaponKind: weapon.weaponKind,
      position: { ...player.position },
      pickedUp: false,
    });
  }
  return session;
}

describe("weapon content", () => {
  const sword = {
    id: "test-sword",
    name: "Test Sword",
    kind: "weapon",
    weapon: { kind: "melee", damage: 6, range: 1.2, arcCos: 0.5, cooldownMs: 500, staminaCost: 15 },
  };

  it("accepts a weapon with a weapon block and turns it into loot carrying its weapon kind", () => {
    const parsed = itemDefinitionSchema.parse(sword);
    expect(lootInstance(parsed, { x: 1, y: 1 }, SWORD.id)).toMatchObject({
      kind: "weapon",
      itemId: "test-sword",
      weaponKind: "melee",
    });
  });

  it("rejects a weapon with no weapon block, an unknown kind, missing stats, or unknown stats", () => {
    expect(itemDefinitionSchema.safeParse({ ...sword, weapon: undefined }).success).toBe(false);
    expect(itemDefinitionSchema.safeParse({ ...sword, weapon: { kind: "magic" } }).success).toBe(false);
    expect(
      itemDefinitionSchema.safeParse({ ...sword, weapon: { kind: "melee", damage: 5 } }).success,
    ).toBe(false);
    expect(
      itemDefinitionSchema.safeParse({ ...sword, weapon: { ...sword.weapon, knockback: 2 } }).success,
    ).toBe(false);
  });

  it("still loads the shipped content", () => {
    expect(() => loadContent()).not.toThrow();
  });
});

describe("picking up a weapon", () => {
  it("fills the hand first, then inventory, then is refused", () => {
    const player = testPlayer("alpha", { position: at(5, 5), inventory: tonics(MAX_INVENTORY_SIZE - 1) });
    const second = { ...BOW };
    const third = { ...BOW, id: "a0000000-0000-4000-8000-000000000003" };
    const session = withWeaponsOnFloor(player, [SWORD, second, third]);

    expect(pickupItem(session, "alpha", SWORD.id)).toEqual({ ok: true });
    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toHaveLength(MAX_INVENTORY_SIZE - 1);

    expect(pickupItem(session, "alpha", second.id)).toEqual({ ok: true });
    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toHaveLength(MAX_INVENTORY_SIZE);

    expect(pickupItem(session, "alpha", third.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(session.dungeon.loot.find((loot) => loot.id === third.id)?.pickedUp).toBe(false);
  });

  it("takes a weapon into the hand even when the inventory is full", () => {
    const player = testPlayer("alpha", { position: at(5, 5), inventory: tonics(MAX_INVENTORY_SIZE) });
    const session = withWeaponsOnFloor(player, [SWORD]);

    expect(pickupItem(session, "alpha", SWORD.id)).toEqual({ ok: true });
    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toHaveLength(MAX_INVENTORY_SIZE);
  });

  it("never puts a torch in either place", () => {
    const player = testPlayer("alpha", { position: at(5, 5), carryingTorch: false });
    const session = testSession([player]);
    session.dungeon.loot.push({
      id: "c0000000-0000-4000-8000-000000000001",
      name: "Torch",
      kind: "torch",
      position: { ...player.position },
      pickedUp: false,
    });

    expect(pickupItem(session, "alpha", "c0000000-0000-4000-8000-000000000001").ok).toBe(true);
    expect(player.carryingTorch).toBe(true);
    expect(player.held).toBeNull();
    expect(player.inventory).toEqual([]);
  });

  it("keeps non-weapons out of the hand", () => {
    const player = testPlayer("alpha", { position: at(5, 5) });
    const session = testSession([player]);
    // A fresh id: the vault already places a Minor Tonic under `MINOR_TONIC_ID`.
    const lootId = "c0000000-0000-4000-8000-000000000002";
    session.dungeon.loot.push({
      id: lootId,
      name: TONIC.name,
      position: { ...player.position },
      pickedUp: false,
      ...TONIC_FIELDS,
    });

    expect(pickupItem(session, "alpha", lootId).ok).toBe(true);
    expect(player.held).toBeNull();
    expect(player.inventory).toHaveLength(1);
  });
});

describe("swapping the held item", () => {
  it("swaps the hand with an inventory item, in both directions", () => {
    const player = testPlayer("alpha", { held: SWORD, inventory: [TONIC, BOW] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: true });
    expect(player.held).toEqual(BOW);
    expect(player.inventory).toEqual([TONIC, SWORD]);

    expect(swapHeld(session, "alpha", SWORD.id)).toEqual({ ok: true });
    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toEqual([TONIC, BOW]);
  });

  it("swaps with a full inventory without losing or duplicating anything", () => {
    const stowed = tonics(MAX_INVENTORY_SIZE - 1);
    const player = testPlayer("alpha", { held: SWORD, inventory: [...stowed, BOW] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: true });
    expect(player.held).toEqual(BOW);
    expect(player.inventory).toEqual([...stowed, SWORD]);
  });

  it("moves an inventory item into an empty hand", () => {
    const player = testPlayer("alpha", { inventory: [TONIC, BOW] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: true });
    expect(player.held).toEqual(BOW);
    expect(player.inventory).toEqual([TONIC]);
  });

  it("stows the hand item into a free slot, and refuses when none is free", () => {
    const player = testPlayer("alpha", { held: SWORD, inventory: [TONIC] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", null)).toEqual({ ok: true });
    expect(player.held).toBeNull();
    expect(player.inventory).toEqual([TONIC, SWORD]);

    const full = testPlayer("beta", { held: SWORD, inventory: tonics(MAX_INVENTORY_SIZE) });
    const fullSession = testSession([full]);
    expect(swapHeld(fullSession, "beta", null)).toEqual({ ok: false, reason: "notPermitted" });
    expect(full.held).toEqual(SWORD);
    expect(full.inventory).toHaveLength(MAX_INVENTORY_SIZE);
  });

  it("refuses to stow an empty hand", () => {
    const player = testPlayer("alpha");
    expect(swapHeld(testSession([player]), "alpha", null)).toEqual({
      ok: false,
      reason: "targetMissing",
    });
  });

  it("refuses an unknown id, an item the player does not carry, and the item already in hand", () => {
    const player = testPlayer("alpha", { held: SWORD, inventory: [TONIC] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", "d0000000-0000-4000-8000-000000000009")).toEqual({
      ok: false,
      reason: "targetMissing",
    });
    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: false, reason: "targetMissing" });
    expect(swapHeld(session, "alpha", SWORD.id)).toEqual({ ok: false, reason: "targetMissing" });
    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toEqual([TONIC]);
  });

  it("refuses an item a teammate carries", () => {
    const alpha = testPlayer("alpha", { held: SWORD });
    const beta = testPlayer("beta", { inventory: [BOW] });
    const session = testSession([alpha, beta]);

    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: false, reason: "targetMissing" });
    expect(beta.inventory).toEqual([BOW]);
  });

  it("refuses a downed player, and an unknown one", () => {
    const player = testPlayer("alpha", { health: 0, held: SWORD, inventory: [BOW] });
    const session = testSession([player]);

    expect(swapHeld(session, "alpha", BOW.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(swapHeld(session, "alpha", null)).toEqual({ ok: false, reason: "notPermitted" });
    expect(swapHeld(session, "nobody", null)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.held).toEqual(SWORD);
  });
});

describe("the held item alongside the rest of the kit", () => {
  it("is independent of a full inventory and the torch", () => {
    const player = testPlayer("alpha", {
      carryingTorch: true,
      held: SWORD,
      inventory: tonics(MAX_INVENTORY_SIZE),
    });
    const state = toPlayerState(player);

    expect(state.held).toEqual(SWORD);
    expect(state.inventory).toHaveLength(MAX_INVENTORY_SIZE);
    expect(state.carryingTorch).toBe(true);
  });

  it("is copied into the snapshot rather than shared", () => {
    const player = testPlayer("alpha", { held: SWORD });
    const state = toPlayerState(player);
    expect(state.held).not.toBe(player.held);
    expect(toPlayerState(testPlayer("beta")).held).toBeNull();
  });

  it("cannot be used like a consumable", () => {
    const player = testPlayer("alpha", { held: SWORD });
    expect(useItem(testSession([player]), "alpha", SWORD.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(player.held).toEqual(SWORD);
  });

  it("drops to the floor as loot anyone can pick up again", () => {
    const player = testPlayer("alpha", { position: at(5, 5), held: SWORD });
    const session = testSession([player]);

    expect(dropItem(session, "alpha", SWORD.id)).toEqual({ ok: true });
    expect(player.held).toBeNull();
    expect(session.dungeon.loot.find((loot) => loot.id === SWORD.id)).toMatchObject({
      kind: "weapon",
      weaponKind: "melee",
      pickedUp: false,
    });

    expect(pickupItem(session, "alpha", SWORD.id).ok).toBe(true);
    expect(player.held).toEqual(SWORD);
  });

  it("is given to a teammate's empty hand, or their inventory when it is taken", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), held: SWORD });
    const receiver = testPlayer("beta", { position: at(5, 5) });
    const session = testSession([giver, receiver]);

    expect(giveItem(session, "alpha", SWORD.id, "beta")).toEqual({ ok: true });
    expect(giver.held).toBeNull();
    expect(receiver.held).toEqual(SWORD);

    const again = testPlayer("gamma", { position: at(5, 5), held: BOW });
    const busy = testPlayer("delta", { position: at(5, 5), held: SWORD });
    const second = testSession([again, busy]);
    expect(giveItem(second, "gamma", BOW.id, "delta")).toEqual({ ok: true });
    expect(busy.held).toEqual(SWORD);
    expect(busy.inventory).toEqual([BOW]);
  });

  it("is not given to a teammate with nowhere to put it", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), held: BOW });
    const receiver = testPlayer("beta", {
      position: at(5, 5),
      held: SWORD,
      inventory: tonics(MAX_INVENTORY_SIZE),
    });
    const session = testSession([giver, receiver]);

    expect(giveItem(session, "alpha", BOW.id, "beta")).toEqual({ ok: false, reason: "notPermitted" });
    expect(giver.held).toEqual(BOW);
  });

  it("is deposited on escape and lost with everything else on a wipe", () => {
    const survivor = testPlayer("alpha", { held: SWORD, inventory: [TONIC] });
    const fallen = testPlayer("beta", { health: 0, held: BOW });
    const session = testSession([survivor, fallen]);

    returnToHub(session, true);

    expect(session.vault.items).toEqual([TONIC, SWORD]);
    expect(survivor.held).toBeNull();
    expect(fallen.held).toBeNull();
  });
});
