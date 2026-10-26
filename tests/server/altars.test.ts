import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import { altarInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon, DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { generateDelve } from "../../src/server/game/generation/delve.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";
import { interact } from "../../src/server/game/items.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { distance, isFloor } from "../../src/shared/game/movement.js";
import type { AltarState } from "../../src/shared/types/core.js";
import { TEST_SEED, at, testPlayer, testSession } from "./fixtures.js";

const ALTAR_ID = "a0000000-0000-4000-8000-000000000000";
const OFFER = ["iron-will-scroll", "lever-sense-scroll"];
const [FIRST, SECOND] = OFFER as [string, string];

/** The Ember Vault with an altar on open floor at authored tile (4, 4) and alpha standing beside it. */
function vaultWithAltar(): { session: Session; altar: AltarState } {
  const request = { dungeonId: "ember-vault", seed: TEST_SEED };
  const built = buildDungeon(request);
  const session = testSession([
    testPlayer("alpha", { position: at(4, 4, -0.9) }),
    testPlayer("bravo", { position: at(4, 4, 0.9) }),
  ]);
  session.dungeon = built.dungeon;
  session.runDungeon = request;
  session.lootRng = lootRngFor(built.seed, "ember-vault");

  const altar = altarInstance(OFFER, at(4, 4), ALTAR_ID);
  session.dungeon.altars.push(altar);
  return { session, altar };
}

describe("taking a scroll from an altar", () => {
  it("drops the chosen scroll as ordinary loot beside the altar and cages the other", () => {
    const { session, altar } = vaultWithAltar();
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", ALTAR_ID, 0, SECOND)).toEqual({ ok: true });

    expect(altar.taken).toBe(SECOND);
    expect(altar.offer).toEqual(OFFER);
    const dropped = session.dungeon.loot.slice(before);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ kind: "skillScroll", skillId: "lever-sense", pickedUp: false });
    expect(isFloor(session.dungeon, dropped[0]!.position)).toBe(true);
    expect(distance(dropped[0]!.position, altar.position)).toBeGreaterThanOrEqual(1.5);
  });

  it("refuses a second take, of the other scroll or the same one, and drops nothing more", () => {
    const { session, altar } = vaultWithAltar();
    interact(session, "alpha", ALTAR_ID, 0, FIRST);
    const after = session.dungeon.loot.length;

    expect(interact(session, "alpha", ALTAR_ID, 0, SECOND)).toEqual({ ok: false, reason: "notPermitted" });
    expect(interact(session, "bravo", ALTAR_ID, 0, FIRST)).toEqual({ ok: false, reason: "notPermitted" });

    expect(altar.taken).toBe(FIRST);
    expect(session.dungeon.loot).toHaveLength(after);
  });

  it("lets only one of two players taking at once win, whatever each chose", () => {
    const { session, altar } = vaultWithAltar();
    const before = session.dungeon.loot.length;

    const results = [
      interact(session, "alpha", ALTAR_ID, 0, FIRST),
      interact(session, "bravo", ALTAR_ID, 0, SECOND),
    ];

    expect(results).toEqual([{ ok: true }, { ok: false, reason: "notPermitted" }]);
    expect(altar.taken).toBe(FIRST);
    expect(session.dungeon.loot.length - before).toBe(1);
  });

  it("refuses a player out of reach, leaving the altar untaken", () => {
    const { session, altar } = vaultWithAltar();
    session.players.get("alpha")!.position = at(2, 2);
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", ALTAR_ID, 0, FIRST)).toEqual({ ok: false, reason: "outOfRange" });

    expect(altar.taken).toBeNull();
    expect(session.dungeon.loot).toHaveLength(before);
  });

  it("changes nothing when the taker disconnects first, and the party can still choose", () => {
    const { session, altar } = vaultWithAltar();
    session.players.get("alpha")!.connected = false;
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", ALTAR_ID, 0, FIRST)).toEqual({ ok: false, reason: "notPermitted" });
    expect(altar.taken).toBeNull();
    expect(session.dungeon.loot).toHaveLength(before);

    expect(interact(session, "bravo", ALTAR_ID, 0, SECOND)).toEqual({ ok: true });
    expect(altar.taken).toBe(SECOND);
  });

  it("refuses a downed player", () => {
    const { session, altar } = vaultWithAltar();
    session.players.get("alpha")!.health = 0;

    expect(interact(session, "alpha", ALTAR_ID, 0, FIRST)).toEqual({ ok: false, reason: "notPermitted" });
    expect(altar.taken).toBeNull();
  });

  it("refuses a take with no choice, or a scroll the altar does not offer", () => {
    const { session, altar } = vaultWithAltar();

    expect(interact(session, "alpha", ALTAR_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(interact(session, "alpha", ALTAR_ID, 0, "torchbearer-scroll")).toEqual({ ok: false, reason: "notPermitted" });
    expect(interact(session, "alpha", ALTAR_ID, 0, "minor-tonic")).toEqual({ ok: false, reason: "notPermitted" });

    expect(altar.taken).toBeNull();
  });

  it("refuses a choice aimed at anything that is not an altar", () => {
    const { session } = vaultWithAltar();
    const door = session.dungeon.doors[0]!;

    expect(interact(session, "alpha", door.id, 0, FIRST)).toEqual({ ok: false, reason: "notPermitted" });
  });

  it("is shown only to players who can see its tile, with what was taken", () => {
    const { session } = vaultWithAltar();
    const far = testPlayer("far", { position: at(13, 6), carryingTorch: false });
    session.players.set("far", far);

    const near = visibilityFrameForPlayer(session, session.players.get("alpha")!);
    expect(near.dungeon.altars).toEqual([{ id: ALTAR_ID, position: at(4, 4), offer: OFFER, taken: null }]);
    expect(JSON.stringify(visibilityFrameForPlayer(session, far))).not.toContain(ALTAR_ID);

    interact(session, "alpha", ALTAR_ID, 0, FIRST);
    expect(visibilityFrameForPlayer(session, session.players.get("alpha")!).dungeon.altars[0]!.taken).toBe(FIRST);
  });
});

describe("generating shrine altars", () => {
  const content = loadContent();
  const profile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
  const SEEDS = Array.from({ length: 60 }, (_, index) => index * 31 + 7);
  const scrollItems = [...content.items.values()].filter((item) => item.kind === "skillScroll");

  it("puts an altar in every shrine room and in no other", () => {
    for (const seed of SEEDS) {
      const { dungeon } = generateDelve(profile, content, seed, 3);
      const shrines = dungeon.rooms.filter((room) => room.kind === "shrine");
      expect(shrines.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(dungeon.altars.length, `seed ${seed}`).toBe(shrines.length);
      for (const altar of dungeon.altars) {
        const room = shrines[0]!;
        expect(altar.position.x).toBeGreaterThan(room.x);
        expect(altar.position.x).toBeLessThan(room.x + room.width);
        expect(altar.position.y).toBeGreaterThan(room.y);
        expect(altar.position.y).toBeLessThan(room.y + room.height);
        expect(altar.taken).toBeNull();
      }
    }
  });

  it("rolls a shrine some of the time without an omen (a layout may have no free dead end), and every time under Scroll Cache", () => {
    const plain = SEEDS.filter((seed) => generateDelve(profile, content, seed, 3, { omens: [] }).dungeon.altars.length > 0);
    expect(plain.length).toBeGreaterThan(SEEDS.length * 0.1);
    expect(plain.length).toBeLessThan(SEEDS.length * 0.75);
    for (const seed of SEEDS) {
      const built = generateDelve(profile, content, seed, 3, { omens: ["scroll-cache"] });
      expect(built.dungeon.altars, `seed ${seed}`).toHaveLength(1);
      expect(validateDungeon(built, content, 3), `seed ${seed}`).toEqual([]);
    }
  });

  it("offers two distinct existing scrolls, the same two for the same seed", () => {
    const known = new Set(scrollItems.map((item) => item.id));
    const offers = new Set<string>();
    for (const seed of SEEDS) {
      const built = generateDelve(profile, content, seed, 3, { omens: ["scroll-cache"] });
      const offer = built.dungeon.altars[0]!.offer;
      expect(offer).toHaveLength(2);
      expect(new Set(offer).size).toBe(2);
      for (const id of offer) expect(known.has(id)).toBe(true);
      expect(generateDelve(profile, content, seed, 3, { omens: ["scroll-cache"] }).dungeon.altars).toEqual(
        built.dungeon.altars,
      );
      offers.add([...offer].sort().join("+"));
    }
    expect(offers.size).toBeGreaterThan(1);
  });

  it("never offers a scroll the party already carries, and goes bare when fewer than two remain", () => {
    const skillOf = (itemId: string): string => {
      const item = content.items.get(itemId)!;
      if (item.kind !== "skillScroll") throw new Error(`${itemId} is not a scroll`);
      return item.skillId;
    };
    for (const carried of scrollItems) {
      for (const seed of SEEDS.slice(0, 20)) {
        const { dungeon } = generateDelve(profile, content, seed, 3, {
          omens: ["scroll-cache"],
          carriedSkillIds: [skillOf(carried.id)],
        });
        for (const altar of dungeon.altars) expect(altar.offer).not.toContain(carried.id);
        expect(dungeon.altars).toHaveLength(scrollItems.length - 1 >= 2 ? 1 : 0);
      }
    }
    const all = scrollItems.map((item) => skillOf(item.id));
    const bare = generateDelve(profile, content, SEEDS[0]!, 3, { omens: ["scroll-cache"], carriedSkillIds: all });
    expect(bare.dungeon.rooms.some((room) => room.kind === "shrine")).toBe(true);
    expect(bare.dungeon.altars).toEqual([]);
  });

  it("builds the altar through buildDungeon, scaled onto the floor", () => {
    const built = buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed: SEEDS[0]!, partySize: 3 });
    for (const altar of built.dungeon.altars) expect(isFloor(built.dungeon, altar.position)).toBe(true);
  });

  it("passes the party's carried scrolls from a run request down to the altar", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const plain = buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed, partySize: 3 });
      const offered = plain.dungeon.altars[0]?.offer[0];
      const item = offered ? content.items.get(offered) : undefined;
      if (item?.kind !== "skillScroll") continue;

      const rebuilt = buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed, partySize: 3, carriedSkillIds: [item.skillId] });
      for (const altar of rebuilt.dungeon.altars) expect(altar.offer).not.toContain(offered);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
