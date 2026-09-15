/**
 * Deterministic pseudo-random source for dungeon generation.
 *
 * Generation must be replayable: the same seed has to produce the same dungeon, or a generated run
 * cannot be asserted on in a test and a bug found in play cannot be reproduced. `Math.random` gives
 * neither, so generation never calls it - a seed is drawn once per dungeon and everything downstream
 * is a pure function of it.
 *
 * mulberry32: small, fast, and good enough for scattering monsters and loot. Not for anything
 * security-sensitive; resume tokens and room codes still come from `node:crypto`.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Picks one element. Throws on an empty list, which is always a content authoring mistake. */
  pick<T>(items: readonly T[]): T;
  /** A copy of `items` in random order. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * A v4-shaped UUID drawn from this stream, not from `node:crypto`.
   *
   * Entity ids have to be UUIDs to satisfy the protocol, and they have to be part of the seeded
   * stream for a generated dungeon to be a pure function of its seed. An id that came from
   * `randomUUID()` would make the same seed produce a differently-identified dungeon each run,
   * which defeats replaying one in a test. These are not unguessable and are never used as
   * credentials; resume tokens and room codes still come from `node:crypto`.
   */
  uuid(): string;
}

export function createRng(seed: number): Rng {
  // Any 32-bit state works; the >>> 0 keeps it unsigned after the arithmetic below.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`Empty range: int(${min}, ${max})`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const hex = (length: number): string => {
    let out = "";
    for (let index = 0; index < length; index += 1) out += int(0, 15).toString(16);
    return out;
  };

  return {
    next,
    int,

    uuid() {
      // Version 4, variant 1: the literal "4" and the 8-b nibble are what make it parse as a v4.
      return `${hex(8)}-${hex(4)}-4${hex(3)}-${int(8, 11).toString(16)}${hex(3)}-${hex(12)}`;
    },

    pick(items) {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      // Non-null: int() is bounded by length - 1, and the list is not empty.
      return items[int(0, items.length - 1)]!;
    },

    shuffle(items) {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = int(0, index);
        [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
      }
      return copy;
    },
  };
}

/** A fresh seed for a new dungeon. The only place generation touches real randomness. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
