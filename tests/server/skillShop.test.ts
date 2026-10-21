import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import {
  buySkillScroll,
  currentStock,
  rotatingStock,
  SKILL_SHOP_ID,
  skillShopStockMessage,
  stockFor,
} from "../../src/server/game/shop.js";
import { depositVaultItem, giveItem, useItem } from "../../src/server/game/items.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import { createFileVaultStorage } from "../../src/server/vaults/fileVaultStorage.js";
import { createMemoryVaultStorage, VaultStore } from "../../src/server/vaults/vaultStore.js";
import { MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, joinRequest, testPlayer, testProfile, testSession } from "./fixtures.js";

const content = loadContent();
const shop = content.shops.get(SKILL_SHOP_ID)!;
const FIXED = shop.fixed[0]!;
const FIXED_PRICE = FIXED.price;
const ROTATING_IDS = shop.rotating.map((entry) => entry.itemId);

/** The Scrolls stall's room, in authored tiles: a spot a player can stand in front of it. */
const IN_SHOP = at(6, 3);
const IN_HEARTH = at(11, 7);

function hubWith(player: SessionPlayer): Session {
  const session = testSession([player], HUB_DUNGEON_ID);
  session.location = "hub";
  return session;
}

function shopper(overrides: Partial<SessionPlayer> = {}, coin = 100): SessionPlayer {
  return testPlayer("alpha", { position: IN_SHOP, profile: testProfile("alpha", { coin }), ...overrides });
}

const stockIds = (session: Session): string[] => currentStock(session).map((entry) => entry.itemId);

describe("the shipped skill shop", () => {
  it("is content: fixed stock, a rotating pool, and a rotating count that fits it", () => {
    expect(shop.fixed.length).toBeGreaterThan(0);
    expect(shop.rotatingCount).toBeGreaterThan(0);
    expect(shop.rotatingCount).toBeLessThanOrEqual(shop.rotating.length);
  });

  it("sells only skill scrolls, each above what it converts to", () => {
    for (const entry of [...shop.fixed, ...shop.rotating]) {
      const item = content.items.get(entry.itemId);
      expect(item?.kind, entry.itemId).toBe("skillScroll");
      if (item?.kind !== "skillScroll") continue;
      expect(entry.price, entry.itemId).toBeGreaterThan(content.skills.get(item.skillId)!.conversionCoin);
    }
  });

  it("puts a shop room labelled Scrolls in the hub", () => {
    const session = hubWith(shopper());
    expect(session.dungeon.rooms.find((room) => room.name === "Scrolls")?.kind).toBe("shop");
  });
});

describe("rotation", () => {
  it("gives the same stock for the same room and run count, across calls", () => {
    const first = stockFor(shop, "ROOM01", 4);
    const second = stockFor(shop, "ROOM01", 4);

    expect(second).toEqual(first);
  });

  it("matches the rotating count in content, with the fixed entries always present", () => {
    for (let runCount = 0; runCount < 12; runCount += 1) {
      const stock = stockFor(shop, "ROOM01", runCount);
      expect(stock.filter((entry) => entry.rotating)).toHaveLength(shop.rotatingCount);
      expect(stock.filter((entry) => !entry.rotating).map((entry) => entry.itemId)).toEqual(
        shop.fixed.map((entry) => entry.itemId),
      );
      for (const entry of stock.filter((candidate) => candidate.rotating)) {
        expect(ROTATING_IDS).toContain(entry.itemId);
      }
    }
  });

  it("can differ from one run to the next, and between rooms", () => {
    const byRun = new Set<string>();
    const byRoom = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      byRun.add(stockFor(shop, "ROOM01", index).map((entry) => entry.itemId).join());
      byRoom.add(stockFor(shop, `ROOM${index}`, 0).map((entry) => entry.itemId).join());
    }

    expect(byRun.size).toBeGreaterThan(1);
    expect(byRoom.size).toBeGreaterThan(1);
  });

  it("does not depend on the order the pool is listed in", () => {
    const pool = [{ itemId: "a" }, { itemId: "b" }, { itemId: "c" }, { itemId: "d" }];

    for (let runCount = 0; runCount < 10; runCount += 1) {
      expect(rotatingStock([...pool].reverse(), 2, "ROOM01", runCount)).toEqual(
        rotatingStock(pool, 2, "ROOM01", runCount),
      );
    }
  });

  it("stays the same during a run and moves when the run ends, by escape or by wipe", () => {
    const player = shopper();
    const session = hubWith(player);
    const before = stockIds(session);

    // Nothing in a run changes the room's run count, so a stock read mid-run is the same stock.
    session.location = "dungeon";
    expect(stockIds(session)).toEqual(before);
    expect(session.vault.runCount).toBe(0);

    returnToHub(session, true);
    expect(session.vault.runCount).toBe(1);
    returnToHub(session, false);
    expect(session.vault.runCount).toBe(2);
    expect(stockIds(session)).toEqual(stockFor(shop, session.roomCode, 2).map((entry) => entry.itemId));
  });

  it("is the same after a restart, because the run count is saved with the vault", () => {
    const storage = createMemoryVaultStorage();
    const before = new SessionStore({ vaults: new VaultStore(storage), createRoomCode: () => "BCDFGH" });
    const session = before.createSession();
    session.vault.runCount = 0;
    returnToHub(session, false);
    returnToHub(session, false);
    returnToHub(session, false);
    const stock = stockIds(session);
    before.vaults.flush();

    const after = new SessionStore({ vaults: new VaultStore(storage), createRoomCode: () => "JKLMNP" });
    const joined = after.join(joinRequest({ roomCode: "BCDFGH", playerName: "Grix" }));
    expect(joined.ok).toBe(true);
    const reopened = after.getSession("BCDFGH")!;

    expect(reopened.vault.runCount).toBe(3);
    expect(stockIds(reopened)).toEqual(stock);
  });

  it("keeps a room with no items but a run count worth saving", () => {
    const storage = createMemoryVaultStorage();
    const store = new SessionStore({ vaults: new VaultStore(storage), createRoomCode: () => "BCDFGH" });
    const session = store.createSession();
    returnToHub(session, true);
    store.vaults.flush();

    expect(storage.read()?.vaults).toEqual([{ roomCode: "BCDFGH", items: [], runCount: 1 }]);
    expect(new VaultStore(storage).has("BCDFGH")).toBe(true);
  });

  it("loads a vault file written before the shop existed with a run count of 0", () => {
    const root = mkdtempSync(join(tmpdir(), "dnd-vault-legacy-"));
    const path = join(root, "vaults.json");
    try {
      writeFileSync(path, JSON.stringify({ version: 1, vaults: [{ roomCode: "BCDFGH", items: [] }] }));

      expect(new VaultStore(createFileVaultStorage(path)).open("BCDFGH").runCount).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the stock message", () => {
  it("lists the current stock with names, skills, prices and which entries rotate", () => {
    const session = hubWith(shopper());
    const message = skillShopStockMessage(session);

    expect(message.type).toBe("skillShopStock");
    if (message.type !== "skillShopStock") return;
    expect(message.entries.map((entry) => entry.itemId)).toEqual(stockIds(session));
    expect(message.entries[0]).toMatchObject({
      itemId: FIXED.itemId,
      price: FIXED_PRICE,
      rotating: false,
      skillId: "iron-will",
    });
    expect(message.entries.filter((entry) => entry.rotating)).toHaveLength(shop.rotatingCount);
  });
});

describe("buying a scroll", () => {
  it("takes the price in coin and puts the scroll in the inventory", () => {
    const player = shopper();
    const session = hubWith(player);
    const revision = player.profile.revision;

    expect(buySkillScroll(session, "alpha", FIXED.itemId)).toEqual({ ok: true });

    expect(player.profile.coin).toBe(100 - FIXED_PRICE);
    expect(player.profile.revision).toBeGreaterThan(revision);
    expect(player.inventory).toHaveLength(1);
    expect(player.inventory[0]).toMatchObject({ kind: "skillScroll", skillId: "iron-will", name: "Scroll of Iron Will" });
  });

  it("buys whatever the rotation put in stock", () => {
    const player = shopper();
    const session = hubWith(player);
    const rotating = currentStock(session).find((entry) => entry.rotating)!;

    expect(buySkillScroll(session, "alpha", rotating.itemId)).toEqual({ ok: true });
    expect(player.profile.coin).toBe(100 - rotating.price);
  });

  it("refuses a rotating entry that is not in stock this run", () => {
    const player = shopper();
    const session = hubWith(player);
    const stocked = new Set(stockIds(session));
    const absent = ROTATING_IDS.find((id) => !stocked.has(id));
    // With the shipped pool of two and a rotation of one, exactly one rotating entry is absent.
    expect(absent).toBeDefined();

    expect(buySkillScroll(session, "alpha", absent!)).toEqual({ ok: false, reason: "outOfStock" });
    expect(player.profile.coin).toBe(100);
    expect(player.inventory).toHaveLength(0);
  });

  describe("refusals change neither coin nor inventory", () => {
    const refused = (
      player: SessionPlayer,
      session: Session,
      reason: string,
      itemId: string = FIXED.itemId,
    ) => {
      const coin = player.profile.coin;
      const revision = player.profile.revision;
      const inventory = player.inventory.map((item) => ({ ...item }));

      expect(buySkillScroll(session, player.id, itemId)).toEqual({ ok: false, reason });

      expect(player.profile.coin).toBe(coin);
      expect(player.profile.revision).toBe(revision);
      expect(player.inventory).toEqual(inventory);
    };

    it("outside the hub", () => {
      const player = shopper();
      const session = hubWith(player);
      session.location = "dungeon";

      refused(player, session, "notPermitted");
    });

    it("outside the shop room", () => {
      const player = shopper({ position: IN_HEARTH });

      refused(player, hubWith(player), "outOfRange");
    });

    it("while downed", () => {
      const player = shopper({ health: 0 });

      refused(player, hubWith(player), "notPermitted");
    });

    it("for a player who has not finished designing a character", () => {
      const player = shopper({ appearance: null });

      refused(player, hubWith(player), "notPermitted");
    });

    it("for an unknown entry", () => {
      const player = shopper();

      refused(player, hubWith(player), "outOfStock", "no-such-scroll");
    });

    it("for an item that exists but is not for sale", () => {
      const player = shopper();

      refused(player, hubWith(player), "outOfStock", "minor-tonic");
    });

    it("when unaffordable", () => {
      const player = shopper({}, FIXED_PRICE - 1);

      refused(player, hubWith(player), "insufficientCoin");
    });

    it("with a full inventory", () => {
      const filler: InventoryItem[] = Array.from({ length: MAX_INVENTORY_SIZE }, (_, index) => ({
        id: `f0000000-0000-4000-8000-00000000000${index}`,
        name: "Copper Key",
        kind: "key",
      }));
      const player = shopper({ inventory: filler });

      refused(player, hubWith(player), "inventoryFull");
    });

    it("for a skill already at max stacks", () => {
      const player = shopper({ profile: testProfile("alpha", { coin: 100, skillStacks: { "iron-will": 3 } }) });

      refused(player, hubWith(player), "skillMaxed");
    });

    it("counting provisional stacks toward the limit", () => {
      const player = shopper({ runSkillStacks: new Map([["iron-will", 3]]) });

      refused(player, hubWith(player), "skillMaxed");
    });

    it("for a player who is not in the session", () => {
      const player = shopper();

      expect(buySkillScroll(hubWith(player), "ghost", FIXED.itemId)).toEqual({ ok: false, reason: "notPermitted" });
    });
  });

  it("is allowed when the buyer lacks the skill's prerequisites", () => {
    const gated = loadContent();
    const skill = gated.skills.get("iron-will")!;
    const patched = new Map(gated.skills);
    patched.set("iron-will", { ...skill, requires: ["lever-sense"] });
    const player = shopper();
    const session = hubWith(player);
    session.runDungeon.content = { ...gated, skills: patched };

    expect(buySkillScroll(session, "alpha", FIXED.itemId)).toEqual({ ok: true });
    expect(player.inventory).toHaveLength(1);
  });

  it("never reads a price from the client: the same intent costs the content price", () => {
    const player = shopper();
    const session = hubWith(player);

    // The intent has no price field; a cheaper-looking entry id is simply not in stock.
    buySkillScroll(session, "alpha", FIXED.itemId);

    expect(player.profile.coin).toBe(100 - FIXED_PRICE);
  });
});

describe("what a bought scroll can do", () => {
  it("is usable in the hub and permanent at once", () => {
    const player = shopper();
    const session = hubWith(player);
    buySkillScroll(session, "alpha", FIXED.itemId);
    const scroll = player.inventory[0]!;

    expect(useItem(session, "alpha", scroll.id, 0)).toEqual({ ok: true });

    expect(player.profile.skillStacks["iron-will"]).toBe(1);
    expect(player.runSkillStacks.size).toBe(0);
    expect(player.inventory).toHaveLength(0);
  });

  it("can be given to a teammate", () => {
    const buyer = shopper();
    const teammate = testPlayer("bravo", { position: { ...IN_SHOP } });
    const session = testSession([buyer, teammate], HUB_DUNGEON_ID);
    session.location = "hub";
    buySkillScroll(session, "alpha", FIXED.itemId);
    const scroll = buyer.inventory[0]!;

    expect(giveItem(session, "alpha", scroll.id, "bravo")).toEqual({ ok: true });

    expect(buyer.inventory).toHaveLength(0);
    expect(teammate.inventory.map((item) => item.id)).toEqual([scroll.id]);
  });

  it("can be stored in the vault", () => {
    const player = shopper();
    const session = hubWith(player);
    buySkillScroll(session, "alpha", FIXED.itemId);
    const scroll = player.inventory[0]!;
    // The vault is the Bank stall's room, so the buyer walks over to it.
    player.position = at(6, 9);

    expect(depositVaultItem(session, "alpha", scroll.id)).toEqual({ ok: true });

    expect(player.inventory).toHaveLength(0);
    expect(session.vault.items.map((item) => item.id)).toEqual([scroll.id]);
  });
});

describe("shop content validation", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const IRON_WILL = {
    id: "iron-will",
    name: "Iron Will",
    description: "More resistance.",
    effects: [{ type: "resistanceBonus", amount: 10 }],
    conversionCoin: 3,
    maxStacks: 1,
  };

  /** A minimal content tree with one skill, its scroll, a tonic, and the shop file under test. */
  function contentWith(shopFile: unknown): string {
    const root = mkdtempSync(join(tmpdir(), "dnd-shop-"));
    roots.push(root);
    const files: Record<string, unknown> = {
      "skills/iron-will.json": IRON_WILL,
      "items/iron-will-scroll.json": { id: "iron-will-scroll", name: "Scroll of Iron Will", kind: "skillScroll", skillId: "iron-will" },
      "items/minor-tonic.json": {
        id: "minor-tonic",
        name: "Minor Tonic",
        kind: "consumable",
        description: "Restores health.",
        icon: "tonic",
        effects: [{ type: "heal", amount: 35 }],
      },
      "shops/scroll-shop.json": shopFile,
    };
    for (const [path, body] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
    }
    return root;
  }

  const SHOP = {
    id: "scroll-shop",
    name: "Scrolls",
    fixed: [{ itemId: "iron-will-scroll", price: 20 }],
    rotating: [],
    rotatingCount: 0,
  };

  it("accepts a well-formed shop", () => {
    expect(loadContent(contentWith(SHOP)).shops.get("scroll-shop")?.fixed).toHaveLength(1);
  });

  it("refuses an entry naming an unknown item", () => {
    const root = contentWith({ ...SHOP, fixed: [{ itemId: "ghost-scroll", price: 20 }] });

    expect(() => loadContent(root)).toThrow(/sells "ghost-scroll", which is not a skill scroll/);
  });

  it("refuses an entry that is not a skill scroll", () => {
    const root = contentWith({ ...SHOP, fixed: [{ itemId: "minor-tonic", price: 20 }] });

    expect(() => loadContent(root)).toThrow(/"minor-tonic", which is not a skill scroll/);
  });

  it("refuses a price that does not exceed the scroll's conversion value", () => {
    const root = contentWith({ ...SHOP, fixed: [{ itemId: "iron-will-scroll", price: 3 }] });

    expect(() => loadContent(root)).toThrow(/not above its 3 coin conversion/);
  });

  it("refuses a rotating count larger than its pool", () => {
    const root = contentWith({ ...SHOP, rotatingCount: 1 });

    expect(() => loadContent(root)).toThrow(/rotatingCount/);
  });

  it("refuses a scroll listed twice", () => {
    const root = contentWith({
      ...SHOP,
      rotating: [{ itemId: "iron-will-scroll", price: 20 }],
      rotatingCount: 1,
    });

    expect(() => loadContent(root)).toThrow(/listed twice/);
  });
});
