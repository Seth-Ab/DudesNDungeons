import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import type { RoomTemplate } from "../../src/server/content/schema.js";
import {
  midpointSockets,
  transformPoint,
  transformTiles,
  type RoomTransform,
} from "../../src/server/game/generation/roomShapes.js";

const ORIENTATIONS: RoomTransform[] = ([0, 1, 2, 3] as const).flatMap((turns) => [
  { turns, mirror: false },
  { turns, mirror: true },
]);

const CINDER_DEPTHS = [...gameContent().templates.values()].filter((template) => template.biomes.includes("cinder-depths"));
const KIND_COUNTS = { entrance: 3, exit: 3, boss: 1, puzzle: 3, hall: 2, maze: 1, trap: 1 } as const;

function reachable(tiles: readonly string[], from: { x: number; y: number }): Set<string> {
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${x + dx},${y + dy}`;
      if (tiles[y + dy]?.[x + dx] !== "." || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

/** Every authored point a rule places by hand, local to the template. */
function authoredPoints(template: RoomTemplate): { label: string; x: number; y: number }[] {
  return [
    ...template.lights.map((light) => ({ label: `light "${light.name}"`, x: light.x, y: light.y })),
    ...template.puzzles.flatMap((puzzle) => puzzle.plates.map((plate) => ({ label: "puzzle plate", ...plate }))),
  ];
}

describe("Cinder Depths room templates", () => {
  it("authors 12 to 15 templates in the kinds the issue names", () => {
    expect(CINDER_DEPTHS.length).toBeGreaterThanOrEqual(12);
    expect(CINDER_DEPTHS.length).toBeLessThanOrEqual(15);
    for (const [kind, count] of Object.entries(KIND_COUNTS)) {
      expect(CINDER_DEPTHS.filter((template) => template.kind === kind), kind).toHaveLength(count);
    }
  });

  it("uses odd sizes and midpoint sockets, and allows rotation", () => {
    for (const template of CINDER_DEPTHS) {
      expect(template.sockets, template.id).toBe("midpoints");
      expect(template.transform, template.id).toBe(true);
      expect(template.tiles.length % 2, template.id).toBe(1);
      expect(template.tiles[0]!.length % 2, template.id).toBe(1);
    }
  });

  it("keeps every socket joined to every other in all eight orientations", () => {
    for (const template of CINDER_DEPTHS) {
      for (const transform of ORIENTATIONS) {
        const tiles = transformTiles(template.tiles, transform);
        const sockets = Object.values(midpointSockets(tiles[0]!.length, tiles.length));
        const label = `${template.id} turns ${transform.turns} mirror ${transform.mirror}`;
        const reach = reachable(tiles, sockets[0]!.inward);
        for (const socket of sockets) {
          expect(tiles[socket.inward.y]![socket.inward.x], label).toBe(".");
          expect(reach.has(`${socket.inward.x},${socket.inward.y}`), label).toBe(true);
        }
      }
    }
  });

  it("puts no light or plate on a wall tile in any orientation", () => {
    for (const template of CINDER_DEPTHS) {
      const width = template.tiles[0]!.length;
      const height = template.tiles.length;
      for (const transform of ORIENTATIONS) {
        const tiles = transformTiles(template.tiles, transform);
        for (const point of authoredPoints(template)) {
          const at = transformPoint(point, width, height, transform);
          expect(tiles[at.y]![at.x], `${template.id} ${point.label}`).toBe(".");
        }
      }
    }
  });

  it("leaves enough floor for every spawn rule", () => {
    for (const template of CINDER_DEPTHS) {
      const floor = template.tiles.join("").split(".").length - 1;
      const most = [...template.monsters, ...template.loot, ...template.traps, ...template.chests].reduce(
        (sum, rule) => sum + rule.max,
        0,
      );
      expect(floor, template.id).toBeGreaterThan(most * 4);
    }
  });

  it("gives each boss arena exactly one guaranteed boss", () => {
    for (const template of CINDER_DEPTHS.filter((candidate) => candidate.kind === "boss")) {
      const bosses = template.monsters.filter((rule) => gameContent().monsters.get(rule.typeId)?.boss);
      expect(bosses, template.id).toHaveLength(1);
      expect(bosses[0]!.min, template.id).toBeGreaterThanOrEqual(1);
      expect(bosses[0]!.max, template.id).toBe(1);
    }
  });

  it("keeps monsters out of entrances, exits and puzzle rooms", () => {
    for (const template of CINDER_DEPTHS.filter((candidate) => ["entrance", "exit", "puzzle"].includes(candidate.kind))) {
      expect(template.monsters, template.id).toHaveLength(0);
    }
  });
});
