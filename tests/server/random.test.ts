import { describe, expect, it } from "vitest";
import { createRng } from "../../src/server/game/random.js";

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

  it("refuses an inverted range rather than returning nonsense", () => {
    expect(() => createRng(1).int(5, 4)).toThrow(/Empty range/);
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
});
