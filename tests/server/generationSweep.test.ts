import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import { generateDungeon } from "../../src/server/game/dungeonGenerator.js";
import { DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";

/**
 * The seed sweep for the delve generator. Kept in its own file so Vitest runs it beside the rest of
 * the suite rather than after it: 4,000 runs at about a millisecond each.
 */
const content = loadContent();
const delveProfile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
const PARTY_SIZES = [1, 2, 3, 4];
const SWEEP_SEEDS = 1000;

describe("the delve generator seed sweep", () => {
  // The invariants that decide whether a run is finishable at all, swept rather than sampled: a
  // generator that only usually holds them ships an unplayable dungeon to somebody. Generation
  // already validates before returning, so this also proves no seed exhausts its attempts.
  it.each(PARTY_SIZES)("builds a finishable run for a party of %i over 1,000 seeds", (partySize) => {
    for (let seed = 0; seed < SWEEP_SEEDS; seed += 1) {
      const built = generateDungeon(delveProfile, content, seed, partySize);
      expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      expect(built.dungeon.rooms.filter((room) => room.kind === "boss")).toHaveLength(1);
      // The party arrives inside the entrance's light, not in the dark beside it. Radii are world
      // units and positions authored tiles, which `TILE_SCALE` world units span.
      const spawn = built.spawnPoints[0]!;
      const lit = built.dungeon.lightSources.some(
        (light) => Math.hypot(light.position.x - spawn.x, light.position.y - spawn.y) * TILE_SCALE <= light.radius,
      );
      expect(lit, `seed ${seed} spawn ${spawn.x},${spawn.y}`).toBe(true);
    }
  });

  it.each([...content.flows.keys()])("builds a finishable %s run for every party size", (flowId) => {
    for (const partySize of PARTY_SIZES) {
      for (let seed = 0; seed < 60; seed += 1) {
        const built = generateDungeon({ ...delveProfile, flows: [flowId] }, content, seed, partySize);
        expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      }
    }
  });
});
