import { describe, expect, it } from "vitest";
import { depositVaultItem, withdrawVaultItem } from "../../src/server/game/items.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { inVaultArea, storeInVault } from "../../src/server/game/vault.js";
import type { SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, testPlayer, testSession, TONIC_FIELDS } from "./fixtures.js";

/** `content/items/arrow.json` ships a `maxStack` of 8. */
const ARROW_MAX = 8;

/** Inside the hub's Bank room, which `content/dungeons/hub.json` marks as the vault area. */
const AT_VAULT = at(5, 8);
/** The Strategy Hearth, well outside it. */
const AT_HEARTH = at(11, 7);

function tonic(id: string): InventoryItem {
  return { id, name: "Minor Tonic", ...TONIC_FIELDS };
}

const TONIC_A = tonic("c0000000-0000-4000-8000-000000000001");
const TONIC_B = tonic("c0000000-0000-4000-8000-000000000002");
const KEY: InventoryItem = { id: "c0000000-0000-4000-8000-000000000003", name: "Copper Key", kind: "key" };
const SCROLL: InventoryItem = {
  id: "c0000000-0000-4000-8000-000000000004",
  name: "Scroll of Iron Will",
  kind: "skillScroll",
  skillId: "iron-will",
};
const SWORD: InventoryItem = {
  id: "c0000000-0000-4000-8000-000000000005",
  name: "Rusted Sword",
  kind: "weapon",
  itemId: "rusted-sword",
  weaponKind: "melee",
};

function arrows(id: string, count: number): InventoryItem {
  return { id, name: "Arrows", kind: "ammo", itemId: "arrow", count };
}

/** A party back in the hub, standing at the vault unless told otherwise. */
function hubParty(...players: SessionPlayer[]) {
  const session = testSession(players, "hub");
  session.location = "hub";
  for (const player of players) player.position = { ...AT_VAULT };
  return session;
}

describe("what an escape deposits", () => {
  it("puts two survivors' carries in one shared vault and leaves a downed player's out", () => {
    const alpha = testPlayer("alpha", { inventory: [{ ...TONIC_A }], held: { ...SWORD } });
    const beta = testPlayer("beta", { inventory: [{ ...KEY }] });
    const fallen = testPlayer("fallen", { health: 0, inventory: [{ ...TONIC_B }] });
    const session = testSession([alpha, beta, fallen]);

    returnToHub(session, true);

    expect(session.vault.items).toEqual([TONIC_A, SWORD, KEY]);
    expect(session.vault.revision).toBeGreaterThan(0);
    expect(fallen.inventory).toEqual([]);
  });

  it("deposits a downed player's carry when they are carried out", () => {
    const carrier = testPlayer("carrier", { carryingPlayerId: "carried" });
    const carried = testPlayer("carried", {
      health: 0,
      carriedByPlayerId: "carrier",
      inventory: [{ ...SCROLL }],
    });
    const session = testSession([carrier, carried]);

    returnToHub(session, true);

    expect(session.vault.items).toEqual([SCROLL]);
  });

  it("deposits nothing on a wipe", () => {
    const first = testPlayer("first", { health: 0, inventory: [{ ...TONIC_A }] });
    const session = testSession([first]);

    returnToHub(session, false);

    expect(session.vault.items).toEqual([]);
    // Nothing was deposited, but the run ended, which rerolls the shop's rotation.
    expect(session.vault.runCount).toBe(1);
  });

  it("merges stacks of arrows into the vault's stacks until they are full", () => {
    const alpha = testPlayer("alpha", { inventory: [arrows("d0000000-0000-4000-8000-000000000001", 5)] });
    const beta = testPlayer("beta", { inventory: [arrows("d0000000-0000-4000-8000-000000000002", 6)] });
    const session = testSession([alpha, beta]);

    returnToHub(session, true);

    const counts = session.vault.items.map((item) => (item.kind === "ammo" ? item.count : 0));
    expect(counts).toEqual([ARROW_MAX, 11 - ARROW_MAX]);
    // The first stack keeps the id it was deposited with; the overflow is a new entry.
    expect(session.vault.items[0]?.id).toBe("d0000000-0000-4000-8000-000000000001");
    expect(new Set(session.vault.items.map((item) => item.id)).size).toBe(2);
  });
});

describe("taking from the vault", () => {
  it("lets any party member take any item into a free slot", () => {
    const depositor = testPlayer("depositor");
    const teammate = testPlayer("teammate");
    const session = hubParty(depositor, teammate);
    storeInVault(session, { ...TONIC_A });

    expect(withdrawVaultItem(session, "teammate", TONIC_A.id)).toEqual({ ok: true });

    expect(teammate.inventory).toEqual([TONIC_A]);
    expect(session.vault.items).toEqual([]);
  });

  it("puts a weapon in an empty hand first", () => {
    const player = testPlayer("alpha");
    const session = hubParty(player);
    storeInVault(session, { ...SWORD });

    expect(withdrawVaultItem(session, "alpha", SWORD.id)).toEqual({ ok: true });

    expect(player.held).toEqual(SWORD);
    expect(player.inventory).toEqual([]);
  });

  it("refuses outside the hub", () => {
    const player = testPlayer("alpha");
    const session = hubParty(player);
    storeInVault(session, { ...TONIC_A });
    session.location = "dungeon";

    expect(withdrawVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(session.vault.items).toEqual([TONIC_A]);
  });

  it("refuses out of range of the vault area", () => {
    const player = testPlayer("alpha");
    const session = hubParty(player);
    storeInVault(session, { ...TONIC_A });
    player.position = { ...AT_HEARTH };

    expect(inVaultArea(session, player)).toBe(false);
    expect(withdrawVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "outOfRange" });
    expect(session.vault.items).toEqual([TONIC_A]);
  });

  it("refuses with a full inventory", () => {
    const full = Array.from({ length: MAX_INVENTORY_SIZE }, (_, index) =>
      tonic(`e0000000-0000-4000-8000-00000000000${index}`),
    );
    const player = testPlayer("alpha", { inventory: full });
    const session = hubParty(player);
    storeInVault(session, { ...KEY });

    expect(withdrawVaultItem(session, "alpha", KEY.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toHaveLength(MAX_INVENTORY_SIZE);
    expect(session.vault.items).toEqual([KEY]);
  });

  it("refuses an unknown id and one already taken", () => {
    const player = testPlayer("alpha");
    const session = hubParty(player);
    storeInVault(session, { ...TONIC_A });

    expect(withdrawVaultItem(session, "alpha", TONIC_B.id)).toEqual({ ok: false, reason: "targetMissing" });
    expect(withdrawVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: true });
    expect(withdrawVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "targetMissing" });
  });

  it("refuses a downed player", () => {
    const player = testPlayer("alpha", { health: 0 });
    const session = hubParty(player);
    storeInVault(session, { ...TONIC_A });

    expect(withdrawVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "notPermitted" });
  });

  it("gives the same item to exactly one of two players asking in one tick", () => {
    const alpha = testPlayer("alpha");
    const beta = testPlayer("beta");
    const session = hubParty(alpha, beta);
    storeInVault(session, { ...SCROLL });

    const results = [
      withdrawVaultItem(session, "alpha", SCROLL.id),
      withdrawVaultItem(session, "beta", SCROLL.id),
    ];

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results[1]).toEqual({ ok: false, reason: "targetMissing" });
    expect([...alpha.inventory, ...beta.inventory]).toEqual([SCROLL]);
    expect(session.vault.items).toEqual([]);
  });

  it("tops up carried arrows and leaves what does not fit in the vault", () => {
    const full = [
      arrows("f0000000-0000-4000-8000-000000000001", ARROW_MAX - 2),
      tonic("f0000000-0000-4000-8000-000000000002"),
      tonic("f0000000-0000-4000-8000-000000000003"),
    ];
    const player = testPlayer("alpha", { inventory: full });
    const session = hubParty(player);
    storeInVault(session, arrows("f0000000-0000-4000-8000-000000000004", 5));

    expect(withdrawVaultItem(session, "alpha", "f0000000-0000-4000-8000-000000000004")).toEqual({ ok: true });

    expect(player.inventory[0]).toMatchObject({ kind: "ammo", count: ARROW_MAX });
    expect(session.vault.items).toEqual([arrows("f0000000-0000-4000-8000-000000000004", 3)]);
  });
});

describe("storing in the vault", () => {
  it("stores a carried item, hand or inventory, for anyone to take later", () => {
    const player = testPlayer("alpha", { inventory: [{ ...SCROLL }], held: { ...SWORD } });
    const session = hubParty(player);

    expect(depositVaultItem(session, "alpha", SCROLL.id)).toEqual({ ok: true });
    expect(depositVaultItem(session, "alpha", SWORD.id)).toEqual({ ok: true });

    expect(player.inventory).toEqual([]);
    expect(player.held).toBeNull();
    expect(session.vault.items).toEqual([SCROLL, SWORD]);
  });

  it("refuses outside the hub, out of range, and for an item not carried", () => {
    const player = testPlayer("alpha", { inventory: [{ ...TONIC_A }] });
    const session = hubParty(player);

    expect(depositVaultItem(session, "alpha", TONIC_B.id)).toEqual({ ok: false, reason: "targetMissing" });
    player.position = { ...AT_HEARTH };
    expect(depositVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "outOfRange" });
    player.position = { ...AT_VAULT };
    session.location = "dungeon";
    expect(depositVaultItem(session, "alpha", TONIC_A.id)).toEqual({ ok: false, reason: "notPermitted" });

    expect(player.inventory).toEqual([TONIC_A]);
    expect(session.vault.items).toEqual([]);
  });
});
