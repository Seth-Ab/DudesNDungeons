import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { generateLayout, type LayoutGraph } from "../../src/server/game/generation/layout.js";
import { assignRoles, type RoleAssignment } from "../../src/server/game/generation/roles.js";
import { createRng } from "../../src/server/game/random.js";

const GRID = { cols: 6, rows: 4 };
const SEEDS = 600;
const content = loadContent();
const flows = [...content.flows.values()];
const biome = content.biomes.get("cinder-depths")!;

interface Run {
  graph: LayoutGraph;
  plan: RoleAssignment;
}

function sweep(flow: (typeof flows)[number]): Run[] {
  const runs: Run[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const rng = createRng(seed);
    const graph = generateLayout(rng, flow, GRID);
    if (!graph) continue;
    const plan = assignRoles(rng, graph, flow, biome);
    if (plan) runs.push({ graph, plan });
  }
  expect(runs.length).toBeGreaterThan(SEEDS / 20);
  return runs;
}

function hops(graph: LayoutGraph, from: number, without = -1): number[] {
  const dist = new Array<number>(graph.nodes.length).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    for (const edge of graph.edges) {
      const next = edge.a === id ? edge.b : edge.b === id ? edge.a : -1;
      if (next < 0 || next === without || dist[next] !== Infinity) continue;
      dist[next] = dist[id]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

const degree = (graph: LayoutGraph, id: number): number =>
  graph.edges.filter((edge) => edge.a === id || edge.b === id).length;

describe("assignRoles", () => {
  it("has flows covering every key source", () => {
    expect(new Set(flows.map((flow) => flow.keySource)).size).toBeGreaterThanOrEqual(2);
  });

  it("is a pure function of the stream", () => {
    for (const flow of flows) {
      const make = (seed: number) => {
        const rng = createRng(seed);
        const graph = generateLayout(rng, flow, GRID);
        return graph ? assignRoles(rng, graph, flow, biome) : undefined;
      };
      for (const seed of [1, 2, 3]) expect(make(seed)).toEqual(make(seed));
    }
  });

  it("fixes the entrance, boss and exit and fills every room with a kind", () => {
    for (const flow of flows) {
      for (const { graph, plan } of sweep(flow)) {
        expect(plan.roles).toHaveLength(graph.nodes.length);
        expect(plan.roles[0]).toBe("entrance");
        expect(plan.roles[graph.pathLength - 1]).toBe("boss");
        expect(plan.roles[graph.pathLength]).toBe("exit");
        expect(plan.roles.filter((kind) => kind === "boss")).toHaveLength(1);
      }
    }
  });

  it("puts the key on a dead end farther from the entrance than the lock's room", () => {
    for (const flow of flows) {
      for (const { graph, plan } of sweep(flow)) {
        const dist = hops(graph, 0);
        const { nodeId } = plan.bossKey;
        expect(degree(graph, nodeId)).toBe(1);
        expect(nodeId).not.toBe(0);
        expect(dist[nodeId]!).toBeGreaterThan(dist[plan.bossLock.from]!);
        // The key is reachable without crossing the lock.
        expect(hops(graph, 0, plan.bossLock.to)[nodeId]).not.toBe(Infinity);
      }
    }
  });

  it("takes the farthest free dead end", () => {
    for (const flow of flows) {
      for (const { graph, plan } of sweep(flow)) {
        const dist = hops(graph, 0);
        const ends = graph.nodes.filter(
          (node) => degree(graph, node.id) === 1 && node.id !== 0 && node.id !== graph.pathLength,
        );
        expect(dist[plan.bossKey.nodeId]).toBe(Math.max(...ends.map((node) => dist[node.id]!)));
      }
    }
  });

  it("never repeats a kind on the critical path or opens with a trap", () => {
    for (const flow of flows) {
      for (const { graph, plan } of sweep(flow)) {
        const path = plan.roles.slice(0, graph.pathLength + 1);
        path.forEach((kind, index) => {
          if (index > 0) expect(kind).not.toBe(path[index - 1]);
        });
        expect(path[1]).not.toBe("trap");
      }
    }
  });

  it("makes the exit reachable only through the boss room", () => {
    for (const flow of flows) {
      for (const { graph, plan } of sweep(flow)) {
        const exit = graph.pathLength;
        expect(hops(graph, 0)[exit]).not.toBe(Infinity);
        expect(hops(graph, 0, plan.bossLock.to)[exit]).toBe(Infinity);
        expect(graph.edges.some((edge) => edge.a === plan.bossLock.from && edge.b === plan.bossLock.to)).toBe(true);
      }
    }
  });

  it("holds the key the way the flow says", () => {
    const via = { puzzle: "puzzle", branch: "loot", arena: "guardian" } as const;
    for (const flow of flows) {
      for (const { plan } of sweep(flow)) {
        const keyRoom = plan.bossKey.nodeId;
        expect(plan.bossKey.via).toBe(via[flow.keySource as keyof typeof via]);
        const reward = plan.puzzles.filter((puzzle) => puzzle.rewardsBossKey);
        if (flow.keySource === "puzzle") {
          expect(plan.roles[keyRoom]).toBe("puzzle");
          expect(reward).toEqual([{ nodeId: keyRoom, typeId: expect.any(String), rewardsBossKey: true }]);
          expect(biome.puzzles).toContain(reward[0]!.typeId);
        } else {
          expect(reward).toHaveLength(0);
        }
      }
    }
  });

  it("returns null for a flow whose layout has no free dead end beyond the lock", () => {
    // Entrance - A - boss - exit with one loop-free chain: the only dead ends are fixed rooms.
    const nodes = [0, 1, 2, 3].map((id) => ({ id, cell: { c: id, r: 0 }, pathIndex: id, branch: -1 }));
    const chain: LayoutGraph = {
      cols: 4,
      rows: 1,
      nodes,
      edges: [
        { a: 0, b: 1, kind: "open" },
        { a: 1, b: 2, kind: "open" },
        { a: 2, b: 3, kind: "open" },
      ],
      pathLength: 3,
    };
    const flow = { bossLock: "key", keySource: "branch" } as const;
    expect(assignRoles(createRng(1), chain, flow, biome)).toBeNull();

    // A branch that stops short of the lock's room is no use either.
    const shortBranch: LayoutGraph = {
      cols: 5,
      rows: 2,
      nodes: [
        ...[0, 1, 2, 3, 4].map((id) => ({ id, cell: { c: id, r: 0 }, pathIndex: id, branch: -1 })),
        { id: 5, cell: { c: 1, r: 1 }, pathIndex: -1, branch: 0 },
      ],
      edges: [
        { a: 0, b: 1, kind: "open" },
        { a: 1, b: 2, kind: "open" },
        { a: 2, b: 3, kind: "open" },
        { a: 3, b: 4, kind: "open" },
        { a: 1, b: 5, kind: "open" },
      ],
      pathLength: 4,
    };
    expect(assignRoles(createRng(1), shortBranch, flow, biome)).toBeNull();
    const longPath = { ...shortBranch, pathLength: 4 };
    expect(assignRoles(createRng(1), longPath, { bossLock: "seals", keySource: "branch" } as never, biome)).toBeNull();
  });

  it("returns null when the biome cannot avoid repeating a kind on the path", () => {
    const graph = generateLayout(createRng(7), flows[0]!, GRID);
    expect(graph).not.toBeNull();
    const flow = { bossLock: "key", keySource: "branch" } as const;
    expect(assignRoles(createRng(1), graph!, flow, { roomWeights: { hall: 1 }, puzzles: [] })).toBeNull();
  });

  describe("vaults", () => {
    /** Roles for the first 1,500 layouts of `flow`, asking for a vault. */
    function vaultRolls(flow: (typeof flows)[number]): { plan: RoleAssignment | null; graph: LayoutGraph }[] {
      const rolls: { plan: RoleAssignment | null; graph: LayoutGraph }[] = [];
      for (let seed = 0; seed < 1500; seed += 1) {
        const rng = createRng(seed);
        const graph = generateLayout(rng, flow, GRID);
        if (graph) rolls.push({ graph, plan: assignRoles(rng, graph, flow, biome, true) });
      }
      return rolls;
    }

    it("are only asked for, never added unasked", () => {
      for (const flow of flows) {
        for (const { plan } of sweep(flow)) expect(plan.vault).toBeNull();
      }
    });

    it("sit on a dead end of their own, with the elite in an open room that holds neither key", () => {
      for (const flow of flows) {
        const built = vaultRolls(flow).filter((roll) => roll.plan !== null);
        expect(built.length, flow.id).toBeGreaterThan(10);
        for (const { graph, plan } of built) {
          const { nodeId, from, eliteNodeId } = plan!.vault!;
          expect(plan!.roles[nodeId]).toBe("vault");
          expect(plan!.roles.filter((kind) => kind === "vault")).toHaveLength(1);
          expect(degree(graph, nodeId)).toBe(1);
          expect(graph.edges.some((edge) => (edge.a === nodeId && edge.b === from) || (edge.b === nodeId && edge.a === from))).toBe(true);
          expect(nodeId).not.toBe(plan!.bossKey.nodeId);
          expect(eliteNodeId).not.toBe(nodeId);
          expect(eliteNodeId).not.toBe(plan!.bossKey.nodeId);
          expect(["hall", "cavern", "maze", "arena"]).toContain(plan!.roles[eliteNodeId]);
        }
      }
    });

    it("are refused by a layout with no dead end to spare", () => {
      const graph = generateLayout(createRng(1), flows[0]!, GRID)!;
      const loopless = { ...graph, edges: graph.edges.filter((edge) => edge.kind === "open") };
      // Every leaf of a layout is a dead end, so closing them all leaves nothing: join each to the entrance.
      const closed = {
        ...loopless,
        edges: [
          ...loopless.edges,
          ...graph.nodes.filter((node) => node.id > 1 && degree(loopless, node.id) === 1).map((node) => ({ a: 1, b: node.id, kind: "loop" as const })),
        ],
      };
      expect(assignRoles(createRng(1), closed, flows[0]!, biome, true)).toBeNull();
    });
  });

  it("puts a shrine on a free dead end, the farthest after the key and vault, never twice", () => {
    for (const flow of flows) {
      let shrines = 0;
      for (let seed = 0; seed < SEEDS; seed += 1) {
        const rng = createRng(seed);
        const graph = generateLayout(rng, flow, GRID);
        const plan = graph && assignRoles(rng, graph, flow, biome, false, 1);
        if (!graph || !plan) continue;
        const dist = hops(graph, 0);
        const at = plan.roles.flatMap((kind, id) => (kind === "shrine" ? [id] : []));
        expect(at, `${flow.id} seed ${seed}`).toHaveLength(1);
        shrines += 1;
        const spot = at[0]!;
        if (degree(graph, spot) !== 1) {
          // Only a guaranteed shrine with no free dead end falls back, to a side room.
          expect(graph.nodes[spot]!.pathIndex).toBe(-1);
          continue;
        }
        const free = graph.nodes.filter(
          (node) => degree(graph, node.id) === 1 && node.id !== 0 && node.id !== graph.pathLength && node.id !== plan.bossKey.nodeId,
        );
        expect(dist[spot]).toBe(Math.max(...free.map((node) => dist[node.id]!)));
      }
      expect(shrines).toBeGreaterThan(SEEDS / 20);
    }
  });

  it("leaves a shrine out when the chance is zero, and fills no other room with one", () => {
    for (const flow of flows) {
      for (let seed = 0; seed < 100; seed += 1) {
        const rng = createRng(seed);
        const graph = generateLayout(rng, flow, GRID);
        const plan = graph && assignRoles(rng, graph, flow, { ...biome, roomWeights: { ...biome.roomWeights, shrine: 5 } }, false, 0);
        if (plan) expect(plan.roles).not.toContain("shrine");
      }
    }
  });
});
