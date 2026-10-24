import { describe, expect, it } from "vitest";
import { createRng, mixSeed } from "../../src/server/game/random.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("seeded random", () => {
  it("replays the same stream for the same seed", () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return [rng.next(), rng.int(0, 100), rng.uuid(), rng.shuffle([1, 2, 3, 4, 5])];
    };

    expect(draw(1234)).toEqual(draw(1234));
    expect(draw(1234)).not.toEqual(draw(1235));
  });

  it("stays inside the requested integer range, including a single-value range", () => {
    const rng = createRng(7);

    for (let draw = 0; draw < 500; draw += 1) {
      const value = rng.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      expect(Number.isInteger(value)).toBe(true);
    }

    expect(rng.int(2, 2)).toBe(2);
  });

  it("picks from a list and refuses an empty one", () => {
    const rng = createRng(99);

    expect([..."abc"]).toContain(rng.pick([..."abc"]));
    expect(() => rng.pick([])).toThrow(/empty list/);
  });

  it("shuffles without mutating the input or losing elements", () => {
    const rng = createRng(5);
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);

    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
  });

  it("draws v4-shaped uuids, so generated entity ids satisfy the protocol", () => {
    const rng = createRng(2026);
    const ids = Array.from({ length: 200 }, () => rng.uuid());

    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps next, int, pick, shuffle and uuid on the same stream for a fixed seed", () => {
    const rng = createRng(1234);

    expect(rng.next()).toBe(0.07329497812315822);
    expect(rng.int(0, 100)).toBe(71);
    expect(rng.pick([..."abcdef"])).toBe("f");
    expect(rng.shuffle([1, 2, 3, 4, 5, 6])).toEqual([3, 2, 4, 5, 1, 6]);
    expect(rng.uuid()).toBe("6285f846-71fd-48fe-8a38-9ef5285af760");
  });

  it("draws nothing for chance(0) and chance(1), and one value otherwise", () => {
    const control = createRng(42);
    const rng = createRng(42);

    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.next()).toBe(control.next());

    rng.chance(0.5);
    control.next();
    expect(rng.next()).toBe(control.next());
  });

  it("returns true from chance about p of the time", () => {
    const rng = createRng(11);
    const hits = Array.from({ length: 4000 }, () => rng.chance(0.25)).filter(Boolean).length;

    expect(hits / 4000).toBeGreaterThan(0.22);
    expect(hits / 4000).toBeLessThan(0.28);
  });

  it("picks weighted entries in proportion to their weights and never a zero weight", () => {
    const rng = createRng(3);
    const entries = [
      { id: "a", weight: 1 },
      { id: "b", weight: 3 },
      { id: "never", weight: 0 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0, never: 0 };
    for (let draw = 0; draw < 4000; draw += 1) counts[rng.weighted(entries).id]! += 1;

    expect(counts.never).toBe(0);
    expect(counts.b! / 4000).toBeGreaterThan(0.72);
    expect(counts.b! / 4000).toBeLessThan(0.78);
  });

  it("refuses to pick a weighted entry from an empty list, a zero total or a bad weight", () => {
    const rng = createRng(1);

    expect(() => rng.weighted([])).toThrow(/empty list/);
    expect(() => rng.weighted([{ weight: 0 }, { weight: 0 }])).toThrow(/no weight/);
    expect(() => rng.weighted([{ weight: -1 }, { weight: 2 }])).toThrow(/Invalid weight/);
    expect(() => rng.weighted([{ weight: Number.NaN }])).toThrow(/Invalid weight/);
  });

  it("derives a stable child seed that differs per salt", () => {
    expect(mixSeed(1234, 0)).toBe(2662268301);
    expect(mixSeed(1234, 1)).toBe(1496940148);
    expect(mixSeed(1234, 2)).toBe(639808330);
    expect(mixSeed(1234, 1)).toBe(mixSeed(1234, 1));
    expect(new Set(Array.from({ length: 40 }, (_, salt) => mixSeed(1234, salt))).size).toBe(40);
    expect(mixSeed(1, 3)).not.toBe(mixSeed(2, 3));
  });
});
