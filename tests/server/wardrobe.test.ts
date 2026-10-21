import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { cosmeticDefinitionSchema } from "../../src/server/content/schema.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { beginRunStats } from "../../src/server/game/milestones.js";
import { progressionUpdateFor } from "../../src/server/game/progression.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import {
  buyCosmetic,
  COSMETIC_ROTATING_COUNT,
  cosmeticStock,
  equipCosmetic,
  grantCosmeticMilestones,
  wardrobeCatalogMessage,
} from "../../src/server/game/wardrobe.js";
import {
  createMilestoneStats,
  persistedProfileSchema,
  STARTER_COSMETIC_IDS,
  toProfileState,
} from "../../src/server/profiles/profile.js";
import { createMemoryProfileStorage, ProfileStore } from "../../src/server/profiles/profileStore.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import { at, testPlayer, testProfile, testSession } from "./fixtures.js";

const content = loadContent();
const cosmetics = [...content.cosmetics.values()];
const PROFILE_ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

/** In front of the Wardrobe stall, which faces north, and out in the plaza. */
const AT_STALL = at(16, 8);
const IN_HEARTH = at(11, 7);

const ROTATING_IDS = cosmetics.filter((cosmetic) => cosmetic.rotating).map((cosmetic) => cosmetic.id);
const FIXED = cosmetics.find((cosmetic) => cosmetic.price !== undefined && !cosmetic.rotating)!;
const MILESTONE_ONLY = cosmetics.find((cosmetic) => cosmetic.milestone && cosmetic.price === undefined)!;

function hubWith(player: SessionPlayer): Session {
  const session = testSession([player], HUB_DUNGEON_ID);
  session.location = "hub";
  return session;
}

function shopper(overrides: Partial<SessionPlayer> = {}, coin = 200): SessionPlayer {
  return testPlayer("alpha", { position: AT_STALL, profile: testProfile("alpha", { coin }), ...overrides });
}

/** A room's stock with the given rotating item out of it, found by advancing the run count. */
function sessionWithout(cosmeticId: string): Session {
  const session = hubWith(shopper());
  while (cosmeticStock(content, session.roomCode, session.vault.runCount).has(cosmeticId)) {
    session.vault.runCount += 1;
  }
  return session;
}

/** Everything a refused purchase or equip must leave alone. */
const snapshotOf = (player: SessionPlayer) => ({
  coin: player.profile.coin,
  owned: [...player.profile.ownedCosmeticIds],
  equipped: { ...player.profile.equippedCosmetics },
  revision: player.profile.revision,
});

describe("the shipped catalogue", () => {
  it("has hats, cloaks and dyes, each obtainable some way", () => {
    expect(new Set(cosmetics.map((cosmetic) => cosmetic.slot))).toEqual(new Set(["hat", "cloak", "dye"]));
    for (const cosmetic of cosmetics) {
      expect(cosmetic.starter || cosmetic.price !== undefined || cosmetic.milestone !== undefined, cosmetic.id).toBe(true);
    }
  });

  it("marks exactly the profile's starter items as starters", () => {
    const starters = cosmetics.filter((cosmetic) => cosmetic.starter).map((cosmetic) => cosmetic.id);

    expect(starters.sort()).toEqual([...STARTER_COSMETIC_IDS].sort());
  });

  it("has a rotating pool larger than what is stocked, so something is always out of rotation", () => {
    expect(ROTATING_IDS.length).toBeGreaterThan(COSMETIC_ROTATING_COUNT);
  });

  it("puts a wardrobe room labelled Wardrobe in the hub", () => {
    const session = hubWith(shopper());
    expect(session.dungeon.rooms.find((room) => room.name === "Wardrobe")?.kind).toBe("wardrobe");
  });

  it("refuses a cosmetic nobody could own, or a rotating one without a price", () => {
    const base = { id: "plain-hat", slot: "hat", rarity: "common", name: "Plain Hat", lore: "Plain." };

    expect(cosmeticDefinitionSchema.safeParse(base).success).toBe(false);
    expect(cosmeticDefinitionSchema.safeParse({ ...base, starter: true, rotating: true }).success).toBe(false);
    expect(cosmeticDefinitionSchema.safeParse({ ...base, price: 10, rotating: true }).success).toBe(true);
    expect(cosmeticDefinitionSchema.safeParse({ ...base, price: 10, slot: "trail" }).success).toBe(false);
  });
});

describe("stock", () => {
  it("is every fixed priced item plus the rotating count from the pool, the same on every call", () => {
    for (let runCount = 0; runCount < 12; runCount += 1) {
      const stock = cosmeticStock(content, "ROOM01", runCount);
      const rotating = [...stock].filter((id) => ROTATING_IDS.includes(id));

      expect(rotating).toHaveLength(COSMETIC_ROTATING_COUNT);
      expect(stock.has(FIXED.id)).toBe(true);
      expect(stock.has(MILESTONE_ONLY.id)).toBe(false);
      expect(cosmeticStock(content, "ROOM01", runCount)).toEqual(stock);
    }
  });

  it("rerolls when a run ends", () => {
    const seen = new Set<string>();
    for (let runCount = 0; runCount < 20; runCount += 1) {
      seen.add([...cosmeticStock(content, "ROOM01", runCount)].sort().join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is listed in the catalogue message with every item, its unlock and whether it is in stock", () => {
    const session = hubWith(shopper());
    const message = wardrobeCatalogMessage(session);
    const stock = cosmeticStock(content, session.roomCode, session.vault.runCount);

    expect(message.type).toBe("wardrobeCatalog");
    if (message.type !== "wardrobeCatalog") return;
    expect(message.entries).toHaveLength(cosmetics.length);
    for (const entry of message.entries) expect(entry.inStock, entry.id).toBe(stock.has(entry.id));
    expect(message.entries.find((entry) => entry.id === "leather-cap")).toMatchObject({
      starter: true,
      price: null,
      milestone: null,
    });
    expect(message.entries.find((entry) => entry.id === "ranger-hood")).toMatchObject({
      price: 30,
      milestone: { stat: "runsEscaped", threshold: 5 },
    });
  });
});

describe("buying a cosmetic", () => {
  it("takes the price in coin and owns the item without wearing it", () => {
    const player = shopper();
    const session = hubWith(player);
    const revision = player.profile.revision;

    expect(buyCosmetic(session, "alpha", FIXED.id)).toEqual({ ok: true });

    expect(player.profile.coin).toBe(200 - FIXED.price!);
    expect(player.profile.ownedCosmeticIds).toContain(FIXED.id);
    expect(player.profile.equippedCosmetics).toEqual({ hat: null, cloak: null, dye: null });
    expect(player.profile.revision).toBeGreaterThan(revision);
  });

  it("buys a rotating item while it is in stock", () => {
    const player = shopper();
    const session = hubWith(player);
    const inStock = ROTATING_IDS.find((id) => cosmeticStock(content, session.roomCode, 0).has(id))!;

    expect(buyCosmetic(session, "alpha", inStock)).toEqual({ ok: true });
  });

  const refusals: [string, () => { session: Session; player: SessionPlayer; id: string }, string][] = [
    ["the player cannot afford it", () => {
      const player = shopper({}, FIXED.price! - 1);
      return { session: hubWith(player), player, id: FIXED.id };
    }, "insufficientCoin"],
    ["the player already owns it", () => {
      const player = shopper();
      player.profile.ownedCosmeticIds.push(FIXED.id);
      return { session: hubWith(player), player, id: FIXED.id };
    }, "alreadyOwned"],
    ["it is a starter, which every profile owns", () => {
      const player = shopper();
      return { session: hubWith(player), player, id: "leather-cap" };
    }, "alreadyOwned"],
    ["the id is unknown", () => {
      const player = shopper();
      return { session: hubWith(player), player, id: "golden-toque" };
    }, "unknownCosmetic"],
    ["the item is out of rotation", () => {
      const session = sessionWithout(ROTATING_IDS[0]!);
      return { session, player: session.players.get("alpha")!, id: ROTATING_IDS[0]! };
    }, "outOfStock"],
    ["the item is only earned by a milestone", () => {
      const player = shopper();
      return { session: hubWith(player), player, id: MILESTONE_ONLY.id };
    }, "outOfStock"],
    ["the player is outside the hub", () => {
      const player = shopper();
      const session = hubWith(player);
      session.location = "dungeon";
      return { session, player, id: FIXED.id };
    }, "notPermitted"],
    ["the player is downed", () => {
      const player = shopper({ health: 0 });
      return { session: hubWith(player), player, id: FIXED.id };
    }, "notPermitted"],
    ["the player is not at the stall", () => {
      const player = shopper({ position: IN_HEARTH });
      return { session: hubWith(player), player, id: FIXED.id };
    }, "outOfRange"],
  ];

  for (const [when, setup, reason] of refusals) {
    it(`is refused, changing nothing, when ${when}`, () => {
      const { session, player, id } = setup();
      const before = snapshotOf(player);

      expect(buyCosmetic(session, "alpha", id)).toEqual({ ok: false, reason });
      expect(snapshotOf(player)).toEqual(before);
    });
  }
});

describe("equipping a cosmetic", () => {
  it("wears an owned item in its slot, anywhere in the hub, and shows it to the party", () => {
    const player = shopper({ position: IN_HEARTH });
    player.profile.ownedCosmeticIds.push("night-cloak");
    const session = hubWith(player);

    expect(equipCosmetic(session, "alpha", "hat", "leather-cap")).toEqual({ ok: true });
    expect(equipCosmetic(session, "alpha", "cloak", "night-cloak")).toEqual({ ok: true });

    expect(player.profile.equippedCosmetics).toEqual({ hat: "leather-cap", cloak: "night-cloak", dye: null });
    expect(toPlayerState(player, session).cosmetics).toEqual({ hat: "leather-cap", cloak: "night-cloak", dye: null });
  });

  it("swaps one item in a slot for another, and takes a slot off with null", () => {
    const player = shopper();
    player.profile.ownedCosmeticIds.push("wizard-hat");
    const session = hubWith(player);

    equipCosmetic(session, "alpha", "hat", "leather-cap");
    expect(equipCosmetic(session, "alpha", "hat", "wizard-hat")).toEqual({ ok: true });
    expect(player.profile.equippedCosmetics.hat).toBe("wizard-hat");

    expect(equipCosmetic(session, "alpha", "hat", null)).toEqual({ ok: true });
    expect(player.profile.equippedCosmetics.hat).toBeNull();
  });

  type Equip = Parameters<typeof equipCosmetic>;
  const refusals: [string, Equip[2], Equip[3], string, ((player: SessionPlayer, session: Session) => void)?][] = [
    ["an item the player does not own", "hat", "wizard-hat", "notOwned"],
    ["an item in the wrong slot", "cloak", "leather-cap", "unknownCosmetic"],
    ["an unknown item", "hat", "golden-toque", "unknownCosmetic"],
    ["anything outside the hub", "hat", "leather-cap", "notPermitted", (_player, session) => {
      session.location = "dungeon";
    }],
    ["taking a slot off outside the hub", "hat", null, "notPermitted", (player, session) => {
      player.profile.equippedCosmetics.hat = "leather-cap";
      session.location = "dungeon";
    }],
  ];

  for (const [what, slot, id, reason, arrange] of refusals) {
    it(`refuses ${what}, changing nothing`, () => {
      const player = shopper();
      const session = hubWith(player);
      arrange?.(player, session);
      const before = snapshotOf(player);

      expect(equipCosmetic(session, "alpha", slot, id)).toEqual({ ok: false, reason });
      expect(snapshotOf(player)).toEqual(before);
    });
  }
});

describe("keeping cosmetics", () => {
  it("leaves what is owned and worn alone through a death, a wipe and an escape", () => {
    const player = shopper();
    player.profile.ownedCosmeticIds.push("night-cloak");
    player.profile.equippedCosmetics = { hat: "leather-cap", cloak: "night-cloak", dye: null };
    const owned = [...player.profile.ownedCosmeticIds];

    const wiped = testSession([player], "vault-run");
    player.health = 0;
    returnToHub(wiped, false);
    expect(player.profile.equippedCosmetics).toEqual({ hat: "leather-cap", cloak: "night-cloak", dye: null });
    expect(player.profile.ownedCosmeticIds).toEqual(owned);

    player.health = 100;
    const escaped = testSession([player], "vault-run");
    beginRunStats(player);
    returnToHub(escaped, true);
    expect(player.profile.equippedCosmetics).toEqual({ hat: "leather-cap", cloak: "night-cloak", dye: null });
  });

  it("survives a server restart", () => {
    const storage = createMemoryProfileStorage();
    const before = new ProfileStore({ storage, createProfileId: () => PROFILE_ID });
    const { profile, secret } = before.create("Grix");
    profile.ownedCosmeticIds.push("night-cloak");
    profile.equippedCosmetics = { hat: "leather-cap", cloak: "night-cloak", dye: null };
    profile.revision += 1;
    before.flush();

    const after = new ProfileStore({ storage }).find(secret)!;

    expect(after.ownedCosmeticIds).toEqual(["leather-cap", "traveler-cape", "night-cloak"]);
    expect(after.equippedCosmetics).toEqual({ hat: "leather-cap", cloak: "night-cloak", dye: null });
  });

  it("gives a new profile the starter items, wearing nothing", () => {
    const { profile } = new ProfileStore().create("Grix");

    expect(profile.ownedCosmeticIds).toEqual([...STARTER_COSMETIC_IDS]);
    expect(profile.equippedCosmetics).toEqual({ hat: null, cloak: null, dye: null });
  });

  it("loads a profile written before cosmetics with the starter items owned and nothing worn", () => {
    const {
      revision: _revision,
      ownedCosmeticIds: _owned,
      equippedCosmetics: _equipped,
      ...stored
    } = testProfile("legacy");

    const parsed = persistedProfileSchema.parse({ ...stored, id: PROFILE_ID });

    expect(parsed.ownedCosmeticIds).toEqual([...STARTER_COSMETIC_IDS]);
    expect(parsed.equippedCosmetics).toEqual({ hat: null, cloak: null, dye: null });
  });

  it("adds the starters to a stored profile that somehow lacks them, keeping what it had", () => {
    const { revision: _revision, ...stored } = testProfile("partial");

    const parsed = persistedProfileSchema.parse({ ...stored, id: PROFILE_ID, ownedCosmeticIds: ["night-cloak"] });

    expect(parsed.ownedCosmeticIds).toEqual(["leather-cap", "traveler-cape", "night-cloak"]);
  });

  it("tells the owner what they own, and nobody else", () => {
    const player = shopper();
    player.profile.ownedCosmeticIds.push("night-cloak");

    expect(toProfileState(player.profile).ownedCosmeticIds).toContain("night-cloak");
    expect(progressionUpdateFor(player, content).ownedCosmeticIds).toContain("night-cloak");
    expect(toPlayerState(player)).not.toHaveProperty("ownedCosmeticIds");
  });
});

describe("cosmetic milestones", () => {
  const hood = content.cosmetics.get("ranger-hood")!;

  it("grants an item once its stat reaches the threshold, once", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { stats: { ...createMilestoneStats(), runsEscaped: hood.milestone!.threshold } }),
    });

    expect(grantCosmeticMilestones(player, content)).toContain("ranger-hood");
    expect(player.profile.ownedCosmeticIds).toContain("ranger-hood");
    expect(grantCosmeticMilestones(player, content)).not.toContain("ranger-hood");
    expect(player.profile.ownedCosmeticIds.filter((id) => id === "ranger-hood")).toHaveLength(1);
  });

  it("grants nothing below the threshold, and skips an item already bought", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { stats: { ...createMilestoneStats(), runsEscaped: hood.milestone!.threshold - 1 } }),
    });
    expect(grantCosmeticMilestones(player, content)).toEqual([]);

    player.profile.stats.runsEscaped += 1;
    player.profile.ownedCosmeticIds.push("ranger-hood");
    expect(grantCosmeticMilestones(player, content)).not.toContain("ranger-hood");
  });

  it("is granted by the escape that crosses the threshold, not by a wipe", () => {
    const stats = { ...createMilestoneStats(), runsEscaped: hood.milestone!.threshold - 1 };
    const wiper = testPlayer("alpha", { profile: testProfile("alpha", { stats: { ...stats } }) });
    const wiped = testSession([wiper], "vault-run");
    beginRunStats(wiper);
    wiper.health = 0;
    returnToHub(wiped, false);
    expect(wiper.profile.ownedCosmeticIds).not.toContain("ranger-hood");

    const escaper = testPlayer("bravo", { profile: testProfile("bravo", { stats: { ...stats } }) });
    const escaped = testSession([escaper], "vault-run");
    beginRunStats(escaper);
    returnToHub(escaped, true);
    expect(escaper.profile.ownedCosmeticIds).toContain("ranger-hood");
  });
});
