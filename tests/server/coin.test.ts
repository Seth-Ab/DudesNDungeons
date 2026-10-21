import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { convertSkillScroll, useItem } from "../../src/server/game/items.js";
import { progressionUpdateFor } from "../../src/server/game/progression.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { persistedProfileSchema } from "../../src/server/profiles/profile.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { ESCAPE_REWARD_COIN } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { MINOR_TONIC_ID, testPlayer, testProfile, testSession, TONIC_FIELDS } from "./fixtures.js";

/** Iron Will ships with `maxStacks: 3` and converts to 3 coin; Torchbearer is a single stack worth 4. */
const IRON_WILL_MAX = 3;
const IRON_WILL_COIN = 3;
const TORCHBEARER_COIN = 4;

const SCROLL_ID = "e0000000-0000-4000-8000-000000000001";
const PROFILE_ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

const scroll = (id: string, skillId: string): InventoryItem => ({
  id,
  name: `Scroll of ${skillId}`,
  kind: "skillScroll",
  skillId,
});

function sessionWith(player: SessionPlayer, location: Session["location"] = "dungeon"): Session {
  const session = location === "hub" ? testSession([player], HUB_DUNGEON_ID) : testSession([player]);
  session.location = location;
  return session;
}

describe("profile coin", () => {
  it("loads an existing profile that has no coin as 0", () => {
    const { revision: _revision, coin: _coin, ...stored } = testProfile("legacy");

    expect(persistedProfileSchema.parse({ ...stored, id: PROFILE_ID }).coin).toBe(0);
  });

  it("rejects a negative or fractional balance", () => {
    const { revision: _revision, ...stored } = testProfile("bad");
    const base = { ...stored, id: PROFILE_ID };

    expect(persistedProfileSchema.safeParse({ ...base, coin: -1 }).success).toBe(false);
    expect(persistedProfileSchema.safeParse({ ...base, coin: 1.5 }).success).toBe(false);
  });
});

describe("the run purse", () => {
  function inRun(overrides: Partial<SessionPlayer> = {}) {
    const player = testPlayer("alpha", { runCoin: 6, ...overrides });
    const other = testPlayer("bravo");
    const session = testSession([player, other]);
    return { player, other, session };
  }

  it("is credited with the escape reward when the player extracts", () => {
    const { player, session } = inRun();
    const revision = player.profile.revision;

    returnToHub(session, true);

    expect(player.profile.coin).toBe(6 + ESCAPE_REWARD_COIN);
    expect(player.runCoin).toBe(0);
    expect(player.profile.revision).toBeGreaterThan(revision);
  });

  it("credits the escape reward even when the purse is empty", () => {
    const { player, session } = inRun({ runCoin: 0 });

    returnToHub(session, true);

    expect(player.profile.coin).toBe(ESCAPE_REWARD_COIN);
  });

  it("is lost in a wipe", () => {
    const { player, session } = inRun();

    returnToHub(session, false);

    expect(player.profile.coin).toBe(0);
    expect(player.runCoin).toBe(0);
  });

  it("is lost by a player left behind, while a survivor keeps theirs", () => {
    const { player, other, session } = inRun();
    other.runCoin = 2;
    player.health = 0;

    returnToHub(session, true);

    expect(player.profile.coin).toBe(0);
    expect(other.profile.coin).toBe(2 + ESCAPE_REWARD_COIN);
  });

  it("is kept by a downed player who is carried out", () => {
    const { player, other, session } = inRun();
    player.health = 0;
    player.carriedByPlayerId = other.id;

    returnToHub(session, true);

    expect(player.profile.coin).toBe(6 + ESCAPE_REWARD_COIN);
  });

  it("does not carry into the next run", () => {
    const { player, other, session } = inRun();
    session.location = "hub";
    player.ready = true;
    other.ready = true;
    player.runCoin = 9;

    expect(startRun(session, 0)).toEqual({ ok: true });
    expect(player.runCoin).toBe(0);
    expect(player.profile.coin).toBe(0);
  });

  it("is reported to its owner with the balance", () => {
    const { player } = inRun({ profile: testProfile("alpha", { coin: 11 }) });

    expect(progressionUpdateFor(player, loadContent())).toMatchObject({ coin: 11, runCoin: 6 });
  });
});

describe("convertSkillScroll", () => {
  const maxedIronWill = () => testProfile("alpha", { skillStacks: { "iron-will": IRON_WILL_MAX } });

  it("adds the conversion value to the run purse in a dungeon and consumes the scroll", () => {
    const player = testPlayer("alpha", {
      profile: maxedIronWill(),
      inventory: [scroll(SCROLL_ID, "iron-will")],
    });
    const session = sessionWith(player);
    const revision = player.profile.revision;

    expect(convertSkillScroll(session, "alpha", SCROLL_ID)).toEqual({ ok: true });

    expect(player.runCoin).toBe(IRON_WILL_COIN);
    expect(player.profile.coin).toBe(0);
    expect(player.profile.revision).toBe(revision);
    expect(player.inventory).toEqual([]);
  });

  it("credits the profile immediately in the hub", () => {
    const player = testPlayer("alpha", {
      profile: maxedIronWill(),
      inventory: [scroll(SCROLL_ID, "iron-will")],
    });
    const session = sessionWith(player, "hub");
    const revision = player.profile.revision;

    expect(convertSkillScroll(session, "alpha", SCROLL_ID)).toEqual({ ok: true });

    expect(player.profile.coin).toBe(IRON_WILL_COIN);
    expect(player.runCoin).toBe(0);
    expect(player.profile.revision).toBeGreaterThan(revision);
  });

  it("counts provisional stacks toward the limit", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { "iron-will": 1 } }),
      runSkillStacks: new Map([["iron-will", IRON_WILL_MAX - 1]]),
      inventory: [scroll(SCROLL_ID, "iron-will")],
    });

    expect(convertSkillScroll(sessionWith(player), "alpha", SCROLL_ID)).toEqual({ ok: true });
    expect(player.runCoin).toBe(IRON_WILL_COIN);
  });

  it("converts a maxed non-stacking skill at its own value", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { torchbearer: 1 } }),
      inventory: [scroll(SCROLL_ID, "torchbearer")],
    });

    expect(convertSkillScroll(sessionWith(player), "alpha", SCROLL_ID)).toEqual({ ok: true });
    expect(player.runCoin).toBe(TORCHBEARER_COIN);
  });

  it("is only offered after useItem refuses a maxed scroll, which keeps it", () => {
    const player = testPlayer("alpha", {
      profile: maxedIronWill(),
      inventory: [scroll(SCROLL_ID, "iron-will")],
    });

    expect(useItem(sessionWith(player), "alpha", SCROLL_ID)).toEqual({ ok: false, reason: "skillMaxed" });
    expect(player.inventory).toHaveLength(1);
    expect(player.runCoin).toBe(0);
  });

  describe("refusals change nothing", () => {
    function refused(
      player: SessionPlayer,
      itemId: string,
      reason: string,
      location: Session["location"] = "dungeon",
    ) {
      const session = sessionWith(player, location);
      const before = {
        coin: player.profile.coin,
        runCoin: player.runCoin,
        inventory: [...player.inventory],
        revision: player.profile.revision,
      };

      expect(convertSkillScroll(session, player.id, itemId)).toEqual({ ok: false, reason });

      expect(player.profile.coin).toBe(before.coin);
      expect(player.runCoin).toBe(before.runCoin);
      expect(player.inventory).toEqual(before.inventory);
      expect(player.profile.revision).toBe(before.revision);
    }

    it("for a scroll below its limit", () => {
      const player = testPlayer("alpha", {
        profile: testProfile("alpha", { skillStacks: { "iron-will": IRON_WILL_MAX - 1 } }),
        inventory: [scroll(SCROLL_ID, "iron-will")],
      });
      refused(player, SCROLL_ID, "notPermitted");
    });

    it("for a scroll of a skill the player has none of, even in the hub", () => {
      const player = testPlayer("alpha", { inventory: [scroll(SCROLL_ID, "iron-will")] });
      refused(player, SCROLL_ID, "notPermitted", "hub");
    });

    it("for a scroll missing its prerequisites", () => {
      const player = testPlayer("alpha", { inventory: [scroll(SCROLL_ID, "deep-will")] });
      const session = sessionWith(player);
      const content = loadContent();
      session.runDungeon.content = {
        ...content,
        skills: new Map([
          ...content.skills,
          [
            "deep-will",
            {
              id: "deep-will",
              name: "Deep Will",
              description: "Needs Iron Will first.",
              effects: [{ type: "resistanceBonus", amount: 1 }],
              maxStacks: 1,
              requires: ["iron-will"],
              conversionCoin: 2,
            },
          ],
        ]),
      };

      expect(convertSkillScroll(session, "alpha", SCROLL_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(player.runCoin).toBe(0);
      expect(player.inventory).toHaveLength(1);
    });

    it("for an item that is not a scroll", () => {
      const tonic: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", ...TONIC_FIELDS };
      const player = testPlayer("alpha", { profile: maxedIronWill(), inventory: [tonic] });
      refused(player, MINOR_TONIC_ID, "notPermitted");
    });

    it("for an unknown item", () => {
      const player = testPlayer("alpha", { profile: maxedIronWill() });
      refused(player, SCROLL_ID, "targetMissing");
    });

    it("for someone else's scroll", () => {
      const owner = testPlayer("owner", {
        profile: maxedIronWill(),
        inventory: [scroll(SCROLL_ID, "iron-will")],
      });
      const thief = testPlayer("thief", {
        profile: testProfile("thief", { skillStacks: { "iron-will": IRON_WILL_MAX } }),
      });
      const session = testSession([owner, thief]);

      expect(convertSkillScroll(session, "thief", SCROLL_ID)).toEqual({ ok: false, reason: "targetMissing" });
      expect(thief.runCoin).toBe(0);
      expect(owner.inventory).toHaveLength(1);
    });

    it("for a scroll in the hand rather than the inventory", () => {
      const player = testPlayer("alpha", { profile: maxedIronWill(), held: scroll(SCROLL_ID, "iron-will") });
      refused(player, SCROLL_ID, "notPermitted");
    });

    it("for a downed player", () => {
      const player = testPlayer("alpha", {
        health: 0,
        profile: maxedIronWill(),
        inventory: [scroll(SCROLL_ID, "iron-will")],
      });
      refused(player, SCROLL_ID, "notPermitted");
    });

    it("for a player still designing their character", () => {
      const player = testPlayer("alpha", {
        appearance: null,
        profile: maxedIronWill(),
        inventory: [scroll(SCROLL_ID, "iron-will")],
      });
      refused(player, SCROLL_ID, "notPermitted");
    });
  });
});
