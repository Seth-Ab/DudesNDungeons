import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent, resolveContentRoot } from "../../src/server/content/loadContent.js";
import { type DelveDungeon, omenDefinitionSchema } from "../../src/server/content/schema.js";
import type { BuiltDungeon } from "../../src/server/game/dungeonBuilder.js";
import { DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { generateDelve } from "../../src/server/game/generation/delve.js";
import { chooseOmens, NO_OMEN_EFFECTS, omenEffects, rollOmens } from "../../src/server/game/generation/omens.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";
import { createRng } from "../../src/server/game/random.js";

const content = loadContent();
const profile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
const PARTY = 3;
const SEEDS = Array.from({ length: 24 }, (_, index) => index * 37 + 5);

const build = (seed: number, omens: readonly string[]): BuiltDungeon =>
  generateDelve(profile, content, seed, PARTY, { omens });

/** Sums `count` over every seed, built with `omens` and, as the baseline, with none. */
function totals(omens: string[], count: (built: BuiltDungeon) => number): { withOmen: number; without: number } {
  let withOmen = 0;
  let without = 0;
  for (const seed of SEEDS) {
    withOmen += count(build(seed, omens));
    without += count(build(seed, []));
  }
  return { withOmen, without };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the shipped content with some files added or replaced. */
function shippedWith(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-omens-"));
  roots.push(root);
  cpSync(resolveContentRoot(), root, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
  }
  return root;
}

describe("omen content", () => {
  it("ships three warnings and three anomalies", () => {
    const omens = [...content.omens.values()];
    expect(omens.filter((omen) => omen.type === "warning").map((omen) => omen.id).sort()).toEqual([
      "brittle-floors",
      "restless-dead",
      "smothering-dark",
    ]);
    expect(omens.filter((omen) => omen.type === "anomaly").map((omen) => omen.id).sort()).toEqual([
      "golden-hoard",
      "lantern-festival",
      "scroll-cache",
    ]);
    expect(content.traps.get("collapsing-floor")?.rearmMs).toBeUndefined();
  });

  it("rejects an omen that changes nothing or has a stray field", () => {
    const base = { id: "plain", name: "Plain", type: "warning", description: "Nothing happens." };
    expect(omenDefinitionSchema.safeParse(base).success).toBe(false);
    expect(omenDefinitionSchema.safeParse({ ...base, budgetMult: 2 }).success).toBe(true);
    expect(omenDefinitionSchema.safeParse({ ...base, budgetMult: 2, lightMulti: 2 }).success).toBe(false);
    expect(omenDefinitionSchema.safeParse({ ...base, budgetMult: 0 }).success).toBe(false);
    expect(omenDefinitionSchema.safeParse({ ...base, type: "curse", budgetMult: 2 }).success).toBe(false);
    expect(omenDefinitionSchema.safeParse({ ...base, overrides: { decayGraceMs: 360_000 } }).success).toBe(true);
  });

  it("refuses an omen naming a trap that does not exist or that rearms", () => {
    const omen = { id: "cracked", name: "Cracked", type: "warning", description: "Cracks.", corridorTraps: "no-such-trap" };
    expect(() => loadContent(shippedWith({ "omens/cracked.json": omen }))).toThrow(
      /cracked\.json field corridorTraps names unknown trap "no-such-trap"/,
    );
    expect(() => loadContent(shippedWith({ "omens/cracked.json": { ...omen, corridorTraps: "spike-plate" } }))).toThrow(
      /cracked\.json field corridorTraps names "spike-plate", which rearms/,
    );
  });

  it("gives a profile the design's odds unless it sets its own", () => {
    expect(profile.omens).toEqual({ warningChance: 0.35, anomalyChance: 0.3 });
  });
});

describe("rolling omens", () => {
  it("never rolls two warnings or two anomalies, and rolls every combination", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed += 1) {
      const rolled = rollOmens(createRng(seed), { omens: { warningChance: 1, anomalyChance: 1 } }, content);
      expect(rolled.map((omen) => omen.type)).toEqual(["warning", "anomaly"]);
      rolled.forEach((omen) => seen.add(omen.id));

      const types = rollOmens(createRng(seed), profile, content).map((omen) => omen.type);
      expect(types.filter((type) => type === "warning").length).toBeLessThanOrEqual(1);
      expect(types.filter((type) => type === "anomaly").length).toBeLessThanOrEqual(1);
    }
    expect([...seen].sort()).toEqual([...content.omens.keys()].sort());
  });

  it("rolls roughly the profile's odds, and none when the odds are zero", () => {
    let warnings = 0;
    let anomalies = 0;
    const runs = 2000;
    for (let seed = 0; seed < runs; seed += 1) {
      const rolled = rollOmens(createRng(seed), profile, content);
      warnings += rolled.filter((omen) => omen.type === "warning").length;
      anomalies += rolled.filter((omen) => omen.type === "anomaly").length;
    }
    expect(warnings / runs).toBeCloseTo(0.35, 1);
    expect(anomalies / runs).toBeCloseTo(0.3, 1);
    expect(rollOmens(createRng(1), { omens: { warningChance: 0, anomalyChance: 0 } }, content)).toEqual([]);
  });

  it("rolls the same omens from the same seed, in a built run too", () => {
    for (const seed of SEEDS) {
      const first = generateDelve(profile, content, seed, PARTY);
      const again = generateDelve(profile, content, seed, PARTY);
      expect(again.omens).toEqual(first.omens);
      expect(again.dungeon).toEqual(first.dungeon);
      expect(first.omens!.length).toBeLessThanOrEqual(2);
    }
    const rolled = SEEDS.map((seed) => generateDelve(profile, content, seed, PARTY).omens!.join("+"));
    expect(new Set(rolled).size).toBeGreaterThan(2);
  });

  it("keeps the same flow and biome whatever omens roll", () => {
    const flowless = { ...profile, omens: { warningChance: 0, anomalyChance: 0 } };
    for (const seed of SEEDS) {
      const plain = generateDelve(flowless, content, seed, PARTY);
      const omened = generateDelve({ ...profile, omens: { warningChance: 1, anomalyChance: 1 } }, content, seed, PARTY);
      expect(omened.dungeon.rooms.map((room) => room.kind)).toEqual(plain.dungeon.rooms.map((room) => room.kind));
    }
  });

  it("refuses to force two omens of one kind or an unknown omen", () => {
    expect(() => chooseOmens(["smothering-dark", "restless-dead"], content)).toThrow(/at most one warning/);
    expect(() => chooseOmens(["golden-hoard", "scroll-cache"], content)).toThrow(/at most one anomaly/);
    expect(() => chooseOmens(["no-such-omen"], content)).toThrow(/Unknown omen/);
    expect(chooseOmens(["restless-dead", "golden-hoard"], content)).toHaveLength(2);
  });

  it("folds omens into neutral effects when none roll", () => {
    expect(omenEffects([])).toEqual(NO_OMEN_EFFECTS);
    expect(omenEffects(chooseOmens(["smothering-dark", "lantern-festival"], content))).toMatchObject({
      lightMult: 0.8,
      radiusMult: 0.8,
    });
  });
});

describe("what each omen does to a run", () => {
  const lights = (built: BuiltDungeon): number => built.dungeon.lightSources.length;
  const monsters = (built: BuiltDungeon): number => built.dungeon.monsters.length;
  const chests = (built: BuiltDungeon): number => built.dungeon.chests.length;
  const cracks = (built: BuiltDungeon): number =>
    built.dungeon.traps.filter((trap) => trap.typeId === "collapsing-floor").length;
  const scrolls = (built: BuiltDungeon): number =>
    built.dungeon.loot.filter((loot) => loot.kind === "skillScroll").length;
  const widestTorch = (built: BuiltDungeon): number =>
    Math.max(...built.dungeon.lightSources.filter((l) => l.name === "Gate Brazier").map((l) => l.radius));

  it("Smothering Dark lights fewer places, and less far", () => {
    const { withOmen, without } = totals(["smothering-dark"], lights);
    expect(withOmen).toBeLessThan(without * 0.75);
    for (const seed of SEEDS.slice(0, 6)) {
      expect(widestTorch(build(seed, ["smothering-dark"]))).toBeCloseTo(widestTorch(build(seed, [])) * 0.8, 1);
    }
  });

  it("Lantern Festival lights more places", () => {
    const { withOmen, without } = totals(["lantern-festival"], lights);
    expect(withOmen).toBeGreaterThan(without * 1.1);
  });

  it("Restless Dead raises the monster count", () => {
    const { withOmen, without } = totals(["restless-dead"], monsters);
    expect(withOmen).toBeGreaterThan(without * 1.15);
  });

  it("Golden Hoard places more chests", () => {
    const { withOmen, without } = totals(["golden-hoard"], chests);
    expect(withOmen).toBeGreaterThan(without * 1.2);
  });

  it("Brittle Floors drops single-use collapsing floors in the corridors, and nothing else does", () => {
    const { withOmen, without } = totals(["brittle-floors"], cracks);
    expect(without).toBe(0);
    expect(withOmen).toBeGreaterThan(SEEDS.length);
    for (const seed of SEEDS.slice(0, 6)) {
      const built = build(seed, ["brittle-floors"]);
      const rooms = built.dungeon.rooms;
      for (const trap of built.dungeon.traps.filter((candidate) => candidate.typeId === "collapsing-floor")) {
        expect(trap.phase).toBe("armed");
        const inRoom = rooms.some(
          (room) =>
            trap.position.x >= room.x && trap.position.x < room.x + room.width &&
            trap.position.y >= room.y && trap.position.y < room.y + room.height,
        );
        expect(inRoom, `seed ${seed} trap at ${trap.position.x},${trap.position.y}`).toBe(false);
      }
    }
  });

  it("Scroll Cache guarantees a skill scroll on the floor", () => {
    for (const seed of SEEDS) {
      expect(scrolls(build(seed, ["scroll-cache"])), `seed ${seed}`).toBe(1);
      expect(scrolls(build(seed, [])), `seed ${seed} baseline`).toBe(0);
    }
  });

  it("changes nothing else about the layout, and every omened run still validates", () => {
    for (const omen of content.omens.keys()) {
      for (const seed of SEEDS.slice(0, 8)) {
        const built = build(seed, [omen]);
        expect(built.omens).toEqual([omen]);
        expect(validateDungeon(built, content, PARTY), `${omen} seed ${seed}`).toEqual([]);
        expect(built.dungeon.map.tiles).toEqual(build(seed, []).dungeon.map.tiles);
      }
    }
    const sweep = [...content.omens.keys()];
    for (const omen of sweep) {
      for (const partySize of [1, 2, 3, 4]) {
        for (let seed = 0; seed < 40; seed += 1) {
          const built = generateDelve(profile, content, seed, partySize, { omens: [omen] });
          expect(validateDungeon(built, content, partySize), `${omen} seed ${seed} party ${partySize}`).toEqual([]);
        }
      }
    }
    const both = build(SEEDS[0]!, ["brittle-floors", "scroll-cache"]);
    expect(validateDungeon(both, content, PARTY)).toEqual([]);
  });
});
