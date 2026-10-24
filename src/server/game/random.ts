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
   * True with probability `p`. Draws nothing when `p` is 0 or 1, so a rule whose chance defaults
   * to certain or never leaves the rest of the stream where it was.
   */
  chance(p: number): boolean;
  /**
   * Picks one entry with probability proportional to its `weight`. Throws on an empty list or a
   * total weight that is not positive, and on a negative or non-finite weight, which are always
   * content authoring mistakes. A zero-weight entry is never picked.
   */
  weighted<T extends { readonly weight: number }>(entries: readonly T[]): T;
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
  /**
   * The stream's position as a 32-bit integer. `createRng(rng.state())` continues exactly where this
   * one is, which is how a saved run keeps rolling the drops it would have rolled.
   */
  state(): number;
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
    state: () => state,

    uuid() {
      // Version 4, variant 1: the literal "4" and the 8-b nibble are what make it parse as a v4.
      return `${hex(8)}-${hex(4)}-4${hex(3)}-${int(8, 11).toString(16)}${hex(3)}-${hex(12)}`;
    },

    chance(p) {
      if (p >= 1) return true;
      if (p <= 0) return false;
      return next() < p;
    },

    weighted(entries) {
      if (entries.length === 0) throw new Error("Cannot pick from an empty list");
      let total = 0;
      for (const entry of entries) {
        if (!Number.isFinite(entry.weight) || entry.weight < 0) {
          throw new Error(`Invalid weight: ${entry.weight}`);
        }
        total += entry.weight;
      }
      if (total <= 0) throw new Error("Cannot pick from entries with no weight");
      let roll = next() * total;
      for (const entry of entries) {
        roll -= entry.weight;
        if (roll < 0) return entry;
      }
      // Float rounding can leave the roll just above zero; the last entry with weight absorbs it.
      return [...entries].reverse().find((entry) => entry.weight > 0)!;
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

/**
 * A child seed derived from `seed` and `salt`, so a retry can re-roll with its own stream without
 * changing the run seed. Pure and stable: the same pair always gives the same 32-bit result, and
 * different salts give different streams.
 */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul((salt + 0x9e3779b9) >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
