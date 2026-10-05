import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import {
  effectiveResistance,
  progressionEffectTotal,
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
    const player = testPlayer("alpha", { runSkillIds: new Set(["iron-will"]) });
    const session = testSession([player]);

    expect(effectiveResistance(player)).toBe(PLAYER_BASE_RESISTANCE + 10);
    expect(toPlayerState(player, session).resistance).toBe(PLAYER_BASE_RESISTANCE + 10);
    expect(player.profile.unlockedSkillIds).toEqual([]);
  });

  it("applies valid permanent upgrade tiers and ignores a tier missing its prerequisite", () => {
    const complete = testPlayer("complete", {
      profile: testProfile("complete", {
        unlockedSkillIds: ["iron-will"],
        unlockedUpgradeIds: ["iron-will-steeled", "iron-will-unbroken"],
      }),
    });
    const skipped = testPlayer("skipped", {
      profile: testProfile("skipped", {
        unlockedSkillIds: ["iron-will"],
        unlockedUpgradeIds: ["iron-will-unbroken"],
      }),
    });

    expect(progressionEffectTotal(complete, "resistanceBonus")).toBe(20);
    expect(progressionEffectTotal(skipped, "resistanceBonus")).toBe(10);
  });

  it("extends the owner's server-authoritative torch radius", () => {
    const viewer = testPlayer("viewer", {
      profile: testProfile("viewer", { unlockedSkillIds: ["torchbearer"] }),
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
      profile: testProfile("alpha", { unlockedSkillIds: ["battle-focus"] }),
    });
    const session = testSession([player]);
    const shipped = loadContent();
    const skills = new Map(shipped.skills);
    skills.set("battle-focus", {
      id: "battle-focus",
      name: "Battle Focus",
      description: "Hit harder.",
      effects: [{ type: "attackDamageBonus", amount: 2 }],
    });
    session.runDungeon.content = { ...shipped, skills };

    const result = resolvePlayerAttack(session, player.id, { x: 1, y: 0 }, ASH_IMP_ID, 0);

    expect(result.ok && result.event.damage).toBe(PLAYER_ATTACK_DAMAGE + 2);
  });
});
