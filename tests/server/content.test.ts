import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameContent, loadContent, resolveContentRoot } from "../../src/server/content/loadContent.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes a throwaway content tree, so a test can assert on content that must not be committed. */
function contentRoot(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-content-"));
  roots.push(root);

  for (const [path, body] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  }

  return root;
}

const ASH_IMP = {
  id: "ash-imp",
  name: "Ash Imp",
  maxHealth: 12,
  speed: 1.8,
  aggroRange: 5,
  attackRange: 1,
  damage: 8,
  attackCooldownMs: 1000,
};

describe("the shipped content", () => {
  it("loads and validates", () => {
    const content = loadContent();

    expect(content.monsters.size).toBeGreaterThan(0);
    expect(content.items.size).toBeGreaterThan(0);
    expect(content.skills.has("iron-will")).toBe(true);
    expect(content.items.get("iron-will-scroll")).toMatchObject({
      kind: "skillScroll",
      skillId: "iron-will",
    });
    expect(content.upgrades.has("iron-will-steeled")).toBe(true);
    expect(content.templates.size).toBeGreaterThan(0);
    expect(content.traps.has("spike-plate")).toBe(true);
    expect(content.templates.get("collapsing-span")?.traps.length).toBeGreaterThan(0);
    expect(content.items.get("travelers-torch")?.kind).toBe("torch");
    expect(content.dungeons.has("hub")).toBe(true);
    expect(content.dungeons.has("ember-vault")).toBe(true);
    expect(content.dungeons.has("vault-run")).toBe(true);
  });

  it("resolves the repository content directory, not the source folder of the same name", () => {
    // basename rather than a regex, so the assertion reads the same on Windows and POSIX paths.
    expect(basename(resolveContentRoot())).toBe("content");
    expect(resolveContentRoot()).not.toContain(join("src", "server"));
  });

  it("gives every room template at least one way in", () => {
    const content = loadContent();

    for (const template of content.templates.values()) {
      expect(template.doorways.length).toBeGreaterThan(0);
    }
  });
});

describe("rejecting bad content", () => {
  it("names the file when JSON will not parse", () => {
    const root = contentRoot({ "monsters/broken.json": "{ not json" });

    expect(() => loadContent(root)).toThrow(/broken\.json is not valid JSON/);
  });

  it("names the file and the field when a value is wrong", () => {
    const root = contentRoot({ "monsters/ash-imp.json": { ...ASH_IMP, maxHealth: -3 } });

    expect(() => loadContent(root)).toThrow(/ash-imp\.json is not valid content.*maxHealth/s);
  });

  it("refuses two files claiming the same id", () => {
    const root = contentRoot({
      "monsters/a.json": ASH_IMP,
      "monsters/b.json": ASH_IMP,
    });

    expect(() => loadContent(root)).toThrow(/reuses the content id "ash-imp"/);
  });

  it("refuses an upgrade for a skill that does not exist", () => {
    const root = contentRoot({
      "upgrades/ghost-training.json": {
        id: "ghost-training",
        skillId: "missing-skill",
        name: "Ghost Training",
        description: "This should never load.",
        tier: 1,
        effects: [{ type: "attackDamageBonus", amount: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/belongs to unknown skill "missing-skill"/);
  });

  it("refuses a skill scroll that teaches a skill that does not exist", () => {
    const root = contentRoot({
      "items/ghost-scroll.json": {
        id: "ghost-scroll",
        name: "Ghost Scroll",
        kind: "skillScroll",
        skillId: "missing-skill",
      },
    });

    expect(() => loadContent(root)).toThrow(/teaches unknown skill "missing-skill"/);
  });

  it("refuses upgrade prerequisites from another skill", () => {
    const skill = (id: string) => ({
      id,
      name: id,
      description: id,
      effects: [{ type: "resistanceBonus", amount: 1 }],
    });
    const root = contentRoot({
      "skills/first.json": skill("first"),
      "skills/second.json": skill("second"),
      "upgrades/first-tier.json": {
        id: "first-tier",
        skillId: "first",
        name: "First Tier",
        description: "First.",
        tier: 1,
        effects: [{ type: "resistanceBonus", amount: 1 }],
      },
      "upgrades/wrong-tree.json": {
        id: "wrong-tree",
        skillId: "second",
        name: "Wrong Tree",
        description: "Wrong.",
        tier: 2,
        requires: ["first-tier"],
        effects: [{ type: "resistanceBonus", amount: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/requires an upgrade from a different skill/);
  });

  it("refuses duplicate upgrade tiers for one skill", () => {
    const root = contentRoot({
      "skills/iron-will.json": {
        id: "iron-will",
        name: "Iron Will",
        description: "Resist.",
        effects: [{ type: "resistanceBonus", amount: 1 }],
      },
      "upgrades/a.json": {
        id: "upgrade-a",
        skillId: "iron-will",
        name: "A",
        description: "A.",
        tier: 1,
        effects: [{ type: "resistanceBonus", amount: 1 }],
      },
      "upgrades/b.json": {
        id: "upgrade-b",
        skillId: "iron-will",
        name: "B",
        description: "B.",
        tier: 1,
        effects: [{ type: "resistanceBonus", amount: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/more than one tier 1 upgrade/);
  });

  it("refuses a template spawning a monster that does not exist", () => {
    const root = contentRoot({
      "dungeons/templates/hall.json": {
        id: "hall",
        name: "Hall",
        kind: "hall",
        tiles: ["###", "#.#", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
        monsters: [{ typeId: "no-such-monster", min: 1, max: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/unknown monster type "no-such-monster"/);
  });

  it("refuses a template spawning a trap that does not exist", () => {
    const root = contentRoot({
      "dungeons/templates/hall.json": {
        id: "hall",
        name: "Hall",
        kind: "trap",
        tiles: ["###", "#.#", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
        traps: [{ typeId: "no-such-trap", min: 1, max: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/unknown trap type "no-such-trap"/);
  });

  it("refuses a trap with no effect", () => {
    const root = contentRoot({
      "traps/dud.json": { id: "dud", name: "Dud", radius: 1 },
    });

    expect(() => loadContent(root)).toThrow(/at least one effect/);
  });

  it("refuses a ragged map, which collision would read past the end of", () => {
    const root = contentRoot({
      "dungeons/ragged.json": {
        id: "ragged",
        name: "Ragged",
        layout: "authored",
        tiles: ["#####", "#..#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/rows of differing lengths/);
  });

  it("refuses a template whose doorways do not connect through its own floor", () => {
    const root = contentRoot({
      "dungeons/templates/split.json": {
        id: "split",
        name: "Split",
        kind: "maze",
        // Two chambers with no way between them: a party walks in one side and finds no way through.
        tiles: ["#####", "#.#.#", "#.#.#", "#####"],
        doorways: [
          { x: 0, y: 1, side: "west" },
          { x: 4, y: 2, side: "east" },
        ],
      },
    });

    expect(() => loadContent(root)).toThrow(/do not connect through its own floor/);
  });

  it("refuses a generated profile asking for a room kind no template provides", () => {
    const root = contentRoot({
      "dungeons/templates/gate.json": {
        id: "gate",
        name: "Gate",
        kind: "entrance",
        tiles: ["###", "#.#", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
      },
      "dungeons/run.json": {
        id: "run",
        name: "Run",
        layout: "generated",
        width: 40,
        height: 40,
        slots: [{ kinds: ["boss"], min: 1, max: 1 }],
        exitDestination: "hub",
      },
    });

    expect(() => loadContent(root)).toThrow(/needs a template of kind boss/);
  });
});

describe("puzzle content", () => {
  it("ships paired levers in the puzzle room template", () => {
    expect(gameContent().puzzles.has("paired-levers")).toBe(true);
    expect(gameContent().templates.get("paired-levers")?.puzzles[0]?.plates).toHaveLength(2);
  });

  it("refuses a template spawning a puzzle that does not exist", () => {
    const root = contentRoot({
      "dungeons/templates/hall.json": {
        id: "hall",
        name: "Hall",
        kind: "puzzle",
        tiles: ["###", "#..", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
        puzzles: [{ typeId: "no-such-puzzle", plates: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }],
      },
    });
    expect(() => loadContent(root)).toThrow(/unknown puzzle type "no-such-puzzle"/);
  });

  it("refuses a puzzle with fewer than two plates", () => {
    const root = contentRoot({
      "puzzles/solo.json": {
        id: "solo",
        name: "Solo",
        plateRadius: 1,
        holdMs: 1000,
        minHoldMs: 500,
        rewardItemId: "copper-key",
      },
      "dungeons/templates/hall.json": {
        id: "hall",
        name: "Hall",
        kind: "puzzle",
        tiles: ["###", "#..", "###"],
        doorways: [{ x: 0, y: 1, side: "west" }],
        puzzles: [{ typeId: "solo", plates: [{ x: 1, y: 1 }] }],
      },
    });
    expect(() => loadContent(root)).toThrow(/plates/);
  });

  it("refuses a puzzle rewarding an unknown item", () => {
    const root = contentRoot({
      "puzzles/bad.json": {
        id: "bad",
        name: "Bad",
        plateRadius: 1,
        holdMs: 1000,
        minHoldMs: 500,
        rewardItemId: "no-such-item",
      },
    });
    expect(() => loadContent(root)).toThrow(/rewards unknown item "no-such-item"/);
  });

  it("refuses a minimum hold longer than the hold", () => {
    const root = contentRoot({
      "puzzles/bad.json": {
        id: "bad",
        name: "Bad",
        plateRadius: 1,
        holdMs: 500,
        minHoldMs: 1000,
        rewardItemId: "copper-key",
      },
    });
    expect(() => loadContent(root)).toThrow(/minHoldMs/);
  });
});
