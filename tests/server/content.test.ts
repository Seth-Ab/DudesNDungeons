import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameContent, loadContent, resolveContentRoot } from "../../src/server/content/loadContent.js";
import { monsterTypeSchema } from "../../src/server/content/schema.js";

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

describe("monster wind-up content", () => {
  it("defaults the wind-up and arc, and validates their bounds", () => {
    const parsed = monsterTypeSchema.parse(ASH_IMP);
    expect(parsed.windupMs).toBeGreaterThan(0);
    expect(parsed.hitArcCos).toBe(0.5);
    expect(parsed.hitRange).toBeUndefined();
    expect(monsterTypeSchema.safeParse({ ...ASH_IMP, windupMs: 0 }).success).toBe(false);
    expect(monsterTypeSchema.safeParse({ ...ASH_IMP, hitArcCos: 2 }).success).toBe(false);
  });
});

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
    expect(content.skills.get("iron-will")).toMatchObject({ maxStacks: 3, requires: [] });
    expect(content.skills.get("iron-will")?.stackEffects).toHaveLength(2);
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

  it("gives every skill a scroll item", () => {
    // Milestone-only skills are granted straight to a profile, so they have no scroll.
    const content = loadContent();
    const taught = new Set(
      [...content.items.values()].flatMap((item) => (item.kind === "skillScroll" ? [item.skillId] : [])),
    );

    const milestoneOnly = new Set([...content.milestones.values()].map((milestone) => milestone.skillId));

    for (const skillId of content.skills.keys()) {
      if (milestoneOnly.has(skillId)) continue;
      expect(taught.has(skillId), skillId).toBe(true);
    }
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

  it("refuses every maxStacks and stack-effect combination decision 0014 rules out", () => {
    const effect = [{ type: "resistanceBonus", amount: 1 }];
    const refused = {
      "a missing maxStacks": {},
      "a zero maxStacks": { maxStacks: 0 },
      "a fractional maxStacks": { maxStacks: 1.5 },
      "stack effects on a non-stacking skill": { maxStacks: 1, perStackEffects: effect },
      "explicit stacks on a non-stacking skill": { maxStacks: 1, stackEffects: [] },
      "an unlimited skill without perStackEffects": { maxStacks: null },
      "an unlimited skill with stackEffects": { maxStacks: null, stackEffects: [effect] },
      "a capped stacking skill with no stack effects": { maxStacks: 3 },
      "too few stackEffects": { maxStacks: 3, stackEffects: [effect] },
      "too many stackEffects": { maxStacks: 2, stackEffects: [effect, effect] },
      "an empty stack": { maxStacks: 2, stackEffects: [[]] },
      "both kinds of stack effects": { maxStacks: 2, stackEffects: [effect], perStackEffects: effect },
      "a missing conversionCoin": { maxStacks: 1, conversionCoin: undefined },
      "a zero conversionCoin": { maxStacks: 1, conversionCoin: 0 },
      "a fractional conversionCoin": { maxStacks: 1, conversionCoin: 1.5 },
    };

    for (const [label, fields] of Object.entries(refused)) {
      const root = contentRoot({
        "skills/odd.json": { id: "odd", name: "Odd", description: "Odd.", effects: effect, conversionCoin: 1, ...fields },
      });
      expect(() => loadContent(root), label).toThrow(/odd\.json is not valid content/);
    }
  });

  it("accepts every stacking shape decision 0014 allows", () => {
    const effect = [{ type: "resistanceBonus", amount: 1 }];
    const allowed = {
      "a non-stacking skill": { maxStacks: 1 },
      "a capped skill with explicit stacks": { maxStacks: 3, stackEffects: [effect, effect] },
      "a capped skill with per-stack effects": { maxStacks: 3, perStackEffects: effect },
      "an unlimited skill": { maxStacks: null, perStackEffects: effect },
    };

    for (const [label, fields] of Object.entries(allowed)) {
      const root = contentRoot({
        "skills/fine.json": { id: "fine", name: "Fine", description: "Fine.", effects: effect, conversionCoin: 1, ...fields },
      });
      expect(() => loadContent(root), label).not.toThrow();
    }
  });

  const skill = (id: string, requires: string[]) => ({
    id,
    name: id,
    description: id,
    effects: [{ type: "resistanceBonus", amount: 1 }],
    maxStacks: 1,
    conversionCoin: 1,
    requires,
  });

  it("refuses a skill that requires a skill that does not exist", () => {
    const root = contentRoot({ "skills/lonely.json": skill("lonely", ["missing-skill"]) });

    expect(() => loadContent(root)).toThrow(/Skill "lonely" requires unknown skill "missing-skill"/);
  });

  it("refuses prerequisite cycles, including a skill requiring itself", () => {
    const loop = contentRoot({
      "skills/a.json": skill("a", ["b"]),
      "skills/b.json": skill("b", ["c"]),
      "skills/c.json": skill("c", ["a"]),
    });
    const self = contentRoot({ "skills/a.json": skill("a", ["a"]) });

    expect(() => loadContent(loop)).toThrow(/prerequisites form a cycle: a -> b -> c -> a/);
    expect(() => loadContent(self)).toThrow(/prerequisites form a cycle: a -> a/);
  });

  it("accepts prerequisites that share a skill without forming a cycle", () => {
    const root = contentRoot({
      "skills/base.json": skill("base", []),
      "skills/left.json": skill("left", ["base"]),
      "skills/right.json": skill("right", ["base"]),
      "skills/top.json": skill("top", ["left", "right"]),
    });

    expect(loadContent(root).skills.get("top")?.requires).toEqual(["left", "right"]);
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

  it("refuses a consumable effect of an unknown type, naming the file and the field", () => {
    const root = contentRoot({
      "items/elixir.json": {
        id: "elixir",
        name: "Elixir",
        kind: "consumable",
        description: "Does something.",
        effects: [{ type: "levitate", amount: 5 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/elixir\.json is not valid content.*effects/s);
  });

  it("refuses a consumable with no effects", () => {
    const root = contentRoot({
      "items/dud.json": { id: "dud", name: "Dud", kind: "consumable", description: "Nothing." , effects: [] },
    });

    expect(() => loadContent(root)).toThrow(/dud\.json is not valid content.*effects/s);
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

describe("boss content", () => {
  const WARDEN = { ...ASH_IMP, id: "warden", name: "Warden", boss: true };
  const room = (kind: string, monsters: unknown[]) => ({
    id: "room",
    name: "Room",
    kind,
    tiles: ["###", "#.#", "###"],
    doorways: [{ x: 0, y: 1, side: "west" }],
    monsters,
  });

  it("ships the Ember Warden as the boss of the Warden Crucible", () => {
    const content = gameContent();
    expect(content.monsters.get("ember-warden")?.boss).toBe(true);
    expect(content.templates.get("warden-crucible")?.kind).toBe("boss");
    expect(content.templates.get("warden-crucible")?.monsters).toContainEqual(
      expect.objectContaining({ typeId: "ember-warden", min: 1 }),
    );
  });

  it("refuses a boss spawning outside a boss room", () => {
    const root = contentRoot({
      "monsters/warden.json": WARDEN,
      "dungeons/templates/room.json": room("hall", [{ typeId: "warden", min: 1, max: 1 }]),
    });

    expect(() => loadContent(root)).toThrow(/spawns boss "warden" outside a boss room/);
  });

  it("refuses a boss room that can roll no boss", () => {
    const root = contentRoot({
      "monsters/warden.json": WARDEN,
      "dungeons/templates/room.json": room("boss", [{ typeId: "warden", min: 0, max: 1 }]),
    });

    expect(() => loadContent(root)).toThrow(/does not always spawn a boss/);
  });

  it("refuses an authored dungeon placing a boss outside a boss room", () => {
    const root = contentRoot({
      "monsters/warden.json": WARDEN,
      "dungeons/keep.json": {
        id: "keep",
        name: "Keep",
        layout: "authored",
        tiles: ["#####", "#...#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
        rooms: [{ id: "hall", name: "Hall", kind: "hall", x: 0, y: 0, width: 5, height: 3 }],
        monsters: [{ typeId: "warden", x: 3, y: 1 }],
      },
    });

    expect(() => loadContent(root)).toThrow(/places boss "warden" outside a boss room/);
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

describe("map scenery content", () => {
  /** A small authored map, 5x3 authored tiles, with whatever scenery a test gives it. */
  function plaza(scenery: Record<string, unknown>) {
    return contentRoot({
      "dungeons/plaza.json": {
        id: "plaza",
        name: "Plaza",
        layout: "authored",
        tiles: ["#####", "#.#.#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
        ...scenery,
      },
    });
  }

  it("ships a hub themed as forest, with props, that validates", () => {
    const hub = loadContent().dungeons.get("hub");

    expect(hub).toMatchObject({ layout: "authored", theme: "forest" });
    expect(hub?.layout === "authored" && hub.props.length).toBeGreaterThan(0);
  });

  it("defaults an authored map to stone with no props", () => {
    const plain = loadContent(plaza({})).dungeons.get("plaza");

    expect(plain).toMatchObject({ theme: "stone", props: [] });
  });

  it("accepts props that fit on the map, fractional placements included", () => {
    const root = plaza({
      theme: "forest",
      props: [
        { kind: "fountain", x: 2, y: 0 },
        { kind: "stall", x: 3, y: 2, label: "Torches" },
        { kind: "bush", x: 4.5, y: 2.5 },
      ],
    });

    expect(() => loadContent(root)).not.toThrow();
  });

  it("refuses an unknown theme", () => {
    expect(() => loadContent(plaza({ theme: "swamp" }))).toThrow(/plaza\.json is not valid content.*theme/s);
  });

  it("refuses an unknown prop kind", () => {
    expect(() => loadContent(plaza({ props: [{ kind: "windmill", x: 1, y: 1 }] }))).toThrow(
      /plaza\.json is not valid content.*props/s,
    );
  });

  it("refuses a prop that runs off the map", () => {
    // A stall is two authored tiles wide, so at x 4 its right half hangs past the last column.
    expect(() => loadContent(plaza({ props: [{ kind: "stall", x: 4, y: 1 }] }))).toThrow(
      /places a stall prop at \(4, 1\) that runs off the map/,
    );
    expect(() => loadContent(plaza({ props: [{ kind: "tree", x: 1, y: 3 }] }))).toThrow(/runs off the map/);
    expect(() => loadContent(plaza({ props: [{ kind: "tree", x: -1, y: 0 }] }))).toThrow(/props/);
  });

  it("refuses an unknown light tint", () => {
    const root = plaza({ lights: [{ name: "Lamp", x: 1, y: 1, radius: 5, tint: "green" }] });

    expect(() => loadContent(root)).toThrow(/tint/);
  });
});

describe("training dummy content", () => {
  const FIRST = "d1111111-1111-4111-8111-111111111111";
  const SECOND = "d2222222-2222-4222-8222-222222222222";

  /** The plaza from the scenery tests: floor at authored (1, 1) and (3, 1), wall everywhere else. */
  function yard(fields: Record<string, unknown>) {
    return contentRoot({
      "dungeons/yard.json": {
        id: "yard",
        name: "Yard",
        layout: "authored",
        tiles: ["#####", "#.#.#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
        ...fields,
      },
    });
  }

  it("accepts dummies on floor with distinct ids, and defaults to none", () => {
    const placed = loadContent(
      yard({ dummies: [{ entityId: FIRST, x: 1, y: 1 }, { entityId: SECOND, x: 3, y: 1 }] }),
    ).dungeons.get("yard");

    expect(placed?.layout === "authored" && placed.dummies).toHaveLength(2);
    expect(loadContent(yard({})).dungeons.get("yard")).toMatchObject({ dummies: [] });
  });

  it("refuses a dummy on a wall", () => {
    expect(() => loadContent(yard({ dummies: [{ entityId: FIRST, x: 2, y: 1 }] }))).toThrow(
      /places a training dummy at \(2, 1\) on a wall/,
    );
  });

  it("refuses a dummy off the map", () => {
    expect(() => loadContent(yard({ dummies: [{ entityId: FIRST, x: 5, y: 1 }] }))).toThrow(
      /places a training dummy at \(5, 1\) off the map/,
    );
    expect(() => loadContent(yard({ dummies: [{ entityId: FIRST, x: 1, y: -1 }] }))).toThrow(/off the map/);
  });

  it("refuses a duplicate id, between dummies or against another placement", () => {
    expect(() =>
      loadContent(yard({ dummies: [{ entityId: FIRST, x: 1, y: 1 }, { entityId: FIRST, x: 3, y: 1 }] })),
    ).toThrow(/reuses entity id "d1111111-1111-4111-8111-111111111111" for a training dummy/);
    expect(() =>
      loadContent(
        yard({
          lights: [{ entityId: FIRST, name: "Lamp", x: 3, y: 1, radius: 5 }],
          dummies: [{ entityId: FIRST, x: 1, y: 1 }],
        }),
      ),
    ).toThrow(/reuses entity id/);
  });

  it("refuses a dummy without an id", () => {
    expect(() => loadContent(yard({ dummies: [{ x: 1, y: 1 }] }))).toThrow(/yard\.json is not valid content.*dummies/s);
  });
});

describe("map ground content", () => {
  /** The same small plaza as above: 5x3 authored tiles, with whatever ground a test gives it. */
  function plaza(extra: Record<string, unknown>) {
    return contentRoot({
      "dungeons/plaza.json": {
        id: "plaza",
        name: "Plaza",
        layout: "authored",
        tiles: ["#####", "#.#.#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
        ...extra,
      },
    });
  }

  it("ships a hub whose ground grid matches its tiles", () => {
    const hub = loadContent().dungeons.get("hub");
    if (hub?.layout !== "authored") throw new Error("the hub is authored");

    expect(hub.ground).toHaveLength(hub.tiles.length);
    for (const [index, row] of (hub.ground ?? []).entries()) expect(row).toHaveLength(hub.tiles[index]!.length);
  });

  it("leaves ground optional, and accepts every ground character", () => {
    const plain = loadContent(plaza({})).dungeons.get("plaza");
    expect(plain?.layout === "authored" && plain.ground).toBeUndefined();

    expect(() => loadContent(plaza({ ground: [".....", ".gcd.", "....."] }))).not.toThrow();
  });

  it("refuses a ground grid of the wrong size", () => {
    expect(() => loadContent(plaza({ ground: [".....", "....."] }))).toThrow(
      /plaza" has a ground grid that is not the same size as its tiles/,
    );
    expect(() => loadContent(plaza({ ground: [".....", "......", "....."] }))).toThrow(/not the same size/);
    expect(() => loadContent(plaza({ ground: [".....", "....", "....."] }))).toThrow(/not the same size/);
  });

  it("refuses an unknown ground character", () => {
    expect(() => loadContent(plaza({ ground: [".....", ".gxd.", "....."] }))).toThrow(
      /plaza\.json is not valid content.*ground/s,
    );
    expect(() => loadContent(plaza({ ground: [".....", ".#...", "....."] }))).toThrow(/ground/);
  });

  it("takes a north facing on a stall or bench and refuses one on anything else, or one it does not know", () => {
    expect(() =>
      loadContent(plaza({ props: [{ kind: "stall", x: 1, y: 1, facing: "north" }, { kind: "bench", x: 1, y: 2, facing: "north" }] })),
    ).not.toThrow();
    expect(() => loadContent(plaza({ props: [{ kind: "fountain", x: 1, y: 1, facing: "south" }] }))).toThrow(
      /Only a stall or bench takes a facing/,
    );
    expect(() => loadContent(plaza({ props: [{ kind: "bench", x: 1, y: 1, facing: "east" }] }))).toThrow(
      /plaza\.json is not valid content.*facing/s,
    );
  });

  it("takes a tint on a stall and refuses one on anything else, or one it does not know", () => {
    expect(() => loadContent(plaza({ props: [{ kind: "stall", x: 1, y: 1, tint: "azure" }] }))).not.toThrow();
    expect(() => loadContent(plaza({ props: [{ kind: "tree", x: 1, y: 1, tint: "azure" }] }))).toThrow(
      /Only a stall takes a tint/,
    );
    expect(() => loadContent(plaza({ props: [{ kind: "stall", x: 1, y: 1, tint: "crimson" }] }))).toThrow(
      /plaza\.json is not valid content.*tint/s,
    );
  });
});

describe("seat content", () => {
  const FIRST = "e1111111-1111-4111-8111-111111111111";
  const SECOND = "e2222222-2222-4222-8222-222222222222";

  /** A bench at authored (2, 1) between two floor tiles, wall everywhere else. */
  function plaza(fields: Record<string, unknown>) {
    return contentRoot({
      "dungeons/plaza.json": {
        id: "plaza",
        name: "Plaza",
        layout: "authored",
        tiles: ["#####", "#.#.#", "#####"],
        spawnPoints: [{ x: 1, y: 1 }],
        ...fields,
      },
    });
  }

  it("accepts seats facing floor with distinct ids, and defaults to none", () => {
    const placed = loadContent(
      plaza({
        seats: [
          { entityId: FIRST, x: 2.4375, y: 1, facing: "east" },
          { entityId: SECOND, x: 1.5625, y: 1, facing: "west" },
        ],
      }),
    ).dungeons.get("plaza");

    expect(placed?.layout === "authored" && placed.seats).toHaveLength(2);
    expect(loadContent(plaza({})).dungeons.get("plaza")).toMatchObject({ seats: [] });
  });

  it("refuses a seat that faces no walkable floor", () => {
    expect(() =>
      loadContent(plaza({ seats: [{ entityId: FIRST, x: 2, y: 1, facing: "north" }] })),
    ).toThrow(/places a seat at \(2, 1\) facing north onto no walkable floor/);
  });

  it("refuses a seat off the map", () => {
    expect(() =>
      loadContent(plaza({ seats: [{ entityId: FIRST, x: 7, y: 1, facing: "west" }] })),
    ).toThrow(/places a seat at \(7, 1\) off the map/);
  });

  it("refuses a duplicate id, between seats or against another placement", () => {
    expect(() =>
      loadContent(
        plaza({
          seats: [
            { entityId: FIRST, x: 2, y: 1, facing: "east" },
            { entityId: FIRST, x: 2, y: 1, facing: "west" },
          ],
        }),
      ),
    ).toThrow(/reuses entity id "e1111111-1111-4111-8111-111111111111" for a seat/);
    expect(() =>
      loadContent(
        plaza({
          dummies: [{ entityId: FIRST, x: 1, y: 1 }],
          seats: [{ entityId: FIRST, x: 2, y: 1, facing: "east" }],
        }),
      ),
    ).toThrow(/reuses entity id/);
  });

  it("refuses a seat without an id or with an unknown facing", () => {
    expect(() => loadContent(plaza({ seats: [{ x: 2, y: 1, facing: "east" }] }))).toThrow(/seats/);
    expect(() =>
      loadContent(plaza({ seats: [{ entityId: FIRST, x: 2, y: 1, facing: "up" }] })),
    ).toThrow(/seats/);
  });
});

describe("ready plate content", () => {
  const FIRST = "f1111111-1111-4111-8111-111111111111";
  const SECOND = "f2222222-2222-4222-8222-222222222222";

  /** A floor strip three tiles wide at authored row 1, with a wall at (4, 1). */
  function strip(fields: Record<string, unknown>) {
    return contentRoot({
      "dungeons/strip.json": {
        id: "strip",
        name: "Strip",
        layout: "authored",
        tiles: ["######", "#...##", "######"],
        spawnPoints: [{ x: 1, y: 1 }],
        ...fields,
      },
    });
  }

  it("accepts plates on floor with distinct ids, including between two floor tiles, and defaults to none", () => {
    const placed = loadContent(
      strip({
        readyPlates: [
          { entityId: FIRST, x: 1, y: 1 },
          { entityId: SECOND, x: 2.5, y: 1 },
        ],
      }),
    ).dungeons.get("strip");

    expect(placed?.layout === "authored" && placed.readyPlates).toHaveLength(2);
    expect(loadContent(strip({})).dungeons.get("strip")).toMatchObject({ readyPlates: [] });
  });

  it("refuses a plate on a wall, or one that straddles a wall", () => {
    expect(() => loadContent(strip({ readyPlates: [{ entityId: FIRST, x: 4, y: 1 }] }))).toThrow(
      /places a ready plate at \(4, 1\) on a wall/,
    );
    expect(() => loadContent(strip({ readyPlates: [{ entityId: FIRST, x: 3.5, y: 1 }] }))).toThrow(
      /places a ready plate at \(3\.5, 1\) on a wall/,
    );
  });

  it("refuses a plate off the map", () => {
    expect(() => loadContent(strip({ readyPlates: [{ entityId: FIRST, x: 9, y: 1 }] }))).toThrow(
      /places a ready plate at \(9, 1\) off the map/,
    );
  });

  it("refuses a duplicate id, between plates or against another placement", () => {
    expect(() =>
      loadContent(
        strip({
          readyPlates: [
            { entityId: FIRST, x: 1, y: 1 },
            { entityId: FIRST, x: 2, y: 1 },
          ],
        }),
      ),
    ).toThrow(/reuses entity id "f1111111-1111-4111-8111-111111111111" for a ready plate/);
    expect(() =>
      loadContent(
        strip({
          dummies: [{ entityId: FIRST, x: 3, y: 1 }],
          readyPlates: [{ entityId: FIRST, x: 1, y: 1 }],
        }),
      ),
    ).toThrow(/reuses entity id/);
  });

  it("refuses a plate without an id", () => {
    expect(() => loadContent(strip({ readyPlates: [{ x: 1, y: 1 }] }))).toThrow(/readyPlates/);
  });
});
