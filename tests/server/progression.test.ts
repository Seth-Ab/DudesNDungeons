import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import {
  activeSkillStacks,
  effectiveResistance,
  progressionCatalogFor,
  progressionEffectTotal,
  progressionUpdateFor,
} from "../../src/server/game/progression.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import {
  PLAYER_ATTACK_DAMAGE,
  PLAYER_BASE_RESISTANCE,
  PLAYER_TORCH_LIGHT_RADIUS,
} from "../../src/shared/constants/game.js";
import { ASH_IMP_ID, at, testPlayer, testProfile, testSession } from "./fixtures.js";

describe("active skill effects", () => {
  it("applies a provisional resistance skill immediately without changing the profile", () => {
    const player = testPlayer("alpha", { runSkillStacks: new Map([["iron-will", 1]]) });
    const session = testSession([player]);

    expect(effectiveResistance(player)).toBe(PLAYER_BASE_RESISTANCE + 10);
    expect(toPlayerState(player, session).resistance).toBe(PLAYER_BASE_RESISTANCE + 10);
    expect(player.profile.skillStacks).toEqual({});
  });

  it("resolves Iron Will at 3 stacks to what Iron Will and both old upgrades granted", () => {
    // Iron Will (10) + Steeled (5) + Unbroken (5), before decision 0014 folded them into stacks.
    const resistanceWithBothUpgrades = 20;
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { "iron-will": 3 } }),
    });

    expect(progressionEffectTotal(player, "resistanceBonus")).toBe(resistanceWithBothUpgrades);
  });

  it("scales effects with permanent and provisional stacks together", () => {
    const stacksOf = (permanent: number, run: number) =>
      progressionEffectTotal(
        testPlayer("alpha", {
          profile: testProfile("alpha", permanent ? { skillStacks: { "iron-will": permanent } } : {}),
          runSkillStacks: run ? new Map([["iron-will", run]]) : new Map(),
        }),
        "resistanceBonus",
      );

    expect(stacksOf(0, 0)).toBe(0);
    expect(stacksOf(1, 0)).toBe(10);
    expect(stacksOf(0, 2)).toBe(15);
    expect(stacksOf(1, 1)).toBe(15);
    expect(stacksOf(2, 1)).toBe(20);
  });

  it("caps effects at a lowered limit while keeping the stored count", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { "iron-will": 5 } }),
      runSkillStacks: new Map([["iron-will", 1]]),
    });

    expect(progressionEffectTotal(player, "resistanceBonus")).toBe(20);
    expect(activeSkillStacks(player)).toEqual(new Map([["iron-will", 3]]));
    expect(player.profile.skillStacks).toEqual({ "iron-will": 5 });
  });

  it("repeats perStackEffects for every stack of an unlimited skill", () => {
    const shipped = loadContent();
    const content = {
      ...shipped,
      skills: new Map([
        [
          "quick-step",
          {
            id: "quick-step",
            name: "Quick Step",
            description: "Keeps stacking.",
            effects: [{ type: "attackDamageBonus" as const, amount: 2 }],
            maxStacks: null,
            requires: [],
            conversionCoin: 1,
            perStackEffects: [{ type: "attackDamageBonus" as const, amount: 1 }],
          },
        ],
      ]),
    };
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { "quick-step": 40 } }),
    });

    expect(progressionEffectTotal(player, "attackDamageBonus", content)).toBe(2 + 39);
  });

  it("ignores stacks of a skill content no longer has, but reports them as held", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { skillStacks: { "removed-skill": 2, "iron-will": 1 } }),
    });

    expect(progressionEffectTotal(player, "resistanceBonus")).toBe(10);
    expect(progressionUpdateFor(player, loadContent())).toEqual({
      type: "progressionUpdated",
      skillStacks: { "removed-skill": 2, "iron-will": 1 },
      runSkillStacks: {},
      activeSkillStacks: { "iron-will": 1 },
      coin: 0,
      runCoin: 0,
    });
  });

  it("describes stack limits, per-stack effects and prerequisites in the catalog", () => {
    const catalog = progressionCatalogFor(loadContent());

    expect(catalog.type === "progressionCatalog" && catalog.skills).toContainEqual({
      id: "iron-will",
      name: "Iron Will",
      description: expect.any(String),
      effects: [{ type: "resistanceBonus", amount: 10 }],
      maxStacks: 3,
      requires: [],
      conversionCoin: 3,
      stackEffects: [
        [{ type: "resistanceBonus", amount: 5 }],
        [{ type: "resistanceBonus", amount: 5 }],
      ],
      perStackEffects: [],
    });
  });

  it("extends the owner's server-authoritative torch radius", () => {
    const viewer = testPlayer("viewer", {
      profile: testProfile("viewer", { skillStacks: { torchbearer: 1 } }),
    });
    const session = testSession([viewer]);

    const ownTorch = visibilityFrameForPlayer(session, viewer).dungeon.lightSources.find(
      (light) => light.kind === "carriedTorch" && light.id === viewer.id,
    );

    expect(ownTorch?.radius).toBe(PLAYER_TORCH_LIGHT_RADIUS + 1.5);
  });

  it("routes attack bonuses through the same effect resolver", () => {
    const player = testPlayer("alpha", {
      position: at(11, 2, -0.9),
      profile: testProfile("alpha", { skillStacks: { "battle-focus": 1 } }),
    });
    const session = testSession([player]);
    const shipped = loadContent();
    const skills = new Map(shipped.skills);
    skills.set("battle-focus", {
      id: "battle-focus",
      name: "Battle Focus",
      description: "Hit harder.",
      effects: [{ type: "attackDamageBonus", amount: 2 }],
      maxStacks: 1,
      requires: [],
      conversionCoin: 1,
    });
    session.runDungeon.content = { ...shipped, skills };

    const result = resolvePlayerAttack(session, player.id, { x: 1, y: 0 }, ASH_IMP_ID, 0);

    expect(result.ok && result.event.damage).toBe(PLAYER_ATTACK_DAMAGE + 2);
  });
});
