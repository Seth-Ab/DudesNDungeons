import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { generateLayout, type LayoutGraph } from "../../src/server/game/generation/layout.js";
import { createRng } from "../../src/server/game/random.js";

const GRID = { cols: 6, rows: 4 };
const SEEDS = 600;
const flows = [...loadContent().flows.values()];

function reachable(graph: LayoutGraph): number {
  const seen = new Set([0]);
  const queue = [0];
  for (let head = 0; head < queue.length; head += 1) {
    for (const edge of graph.edges) {
      const id = queue[head]!;
      const next = edge.a === id ? edge.b : edge.b === id ? edge.a : -1;
      if (next >= 0 && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

/** Every layout the flow produces over the sweep; a null is a retry, not a failure. */
function sweep(flow: (typeof flows)[number]): LayoutGraph[] {
  const graphs: LayoutGraph[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const graph = generateLayout(createRng(seed), flow, GRID);
    if (graph) graphs.push(graph);
  }
  expect(graphs.length).toBeGreaterThan(SEEDS / 10);
  return graphs;
}

const degree = (graph: LayoutGraph, id: number): number =>
  graph.edges.filter((edge) => edge.a === id || edge.b === id).length;

describe("generateLayout", () => {
  it("has flows to sweep", () => {
    expect(flows.length).toBeGreaterThanOrEqual(3);
  });

  it("gives the same graph for the same seed and different graphs for different seeds", () => {
    for (const flow of flows) {
      const make = (seed: number) => generateLayout(createRng(seed), flow, GRID);
      for (const seed of [42, 43, 44]) expect(make(seed)).toEqual(make(seed));
      const distinct = new Set(Array.from({ length: 40 }, (_, seed) => JSON.stringify(make(seed))));
      expect(distinct.size).toBeGreaterThan(10);
    }
  });

  it("keeps every graph connected, on its own cells, and as long as the flow says", () => {
    for (const flow of flows) {
      for (const graph of sweep(flow)) {
        expect(reachable(graph)).toBe(graph.nodes.length);
        expect(new Set(graph.nodes.map((node) => `${node.cell.c},${node.cell.r}`)).size).toBe(graph.nodes.length);
        expect(graph.pathLength).toBeGreaterThanOrEqual(flow.path.min);
        expect(graph.pathLength).toBeLessThanOrEqual(flow.path.max);
        expect(graph.nodes.filter((node) => node.pathIndex >= 0)).toHaveLength(graph.pathLength + 1);
        for (const node of graph.nodes) {
          expect(node.cell.c).toBeGreaterThanOrEqual(0);
          expect(node.cell.c).toBeLessThan(GRID.cols);
          expect(node.cell.r).toBeGreaterThanOrEqual(0);
          expect(node.cell.r).toBeLessThan(GRID.rows);
        }
      }
    }
  });

  it("keeps the boss and exit off loops and branches, with the exit a dead end behind the boss", () => {
    for (const flow of flows) {
      for (const graph of sweep(flow)) {
        const boss = graph.pathLength - 1;
        const exit = graph.pathLength;
        for (const edge of graph.edges) {
          if (edge.kind === "loop") {
            expect([edge.a, edge.b]).not.toContain(boss);
            expect([edge.a, edge.b]).not.toContain(exit);
          }
        }
        expect(degree(graph, exit)).toBe(1);
        expect(graph.edges.some((edge) => Math.min(edge.a, edge.b) === boss && Math.max(edge.a, edge.b) === exit)).toBe(true);
        expect(degree(graph, boss)).toBe(2);
      }
    }
  });

  it("stays inside the flow's branch and loop ranges", () => {
    for (const flow of flows) {
      for (const graph of sweep(flow)) {
        const branches = new Set(graph.nodes.filter((node) => node.branch >= 0).map((node) => node.branch));
        const loops = graph.edges.filter((edge) => edge.kind === "loop").length;
        expect(branches.size).toBeLessThanOrEqual(flow.branches.max);
        expect(loops).toBeLessThanOrEqual(flow.loops.max);
        expect(branches.size).toBeGreaterThanOrEqual(flow.branches.min);
        expect(loops).toBeGreaterThanOrEqual(flow.loops.min);
        for (const branch of branches) {
          const length = graph.nodes.filter((node) => node.branch === branch).length;
          expect(length).toBeGreaterThanOrEqual(1);
          expect(length).toBeLessThanOrEqual(flow.branchLength.max);
        }
      }
    }
  });

  it("returns null instead of looping when the path cannot fit", () => {
    const flow = flows[0]!;
    expect(generateLayout(createRng(1), { ...flow, path: { min: 30, max: 30 } }, GRID)).toBeNull();
    expect(generateLayout(createRng(1), flow, { cols: 2, rows: 2 })).toBeNull();
  });

  it("grows branches from the hub room when the flow asks", () => {
    const flow = { ...flows[0]!, branchFrom: "hub" as const, hubIndex: 2, branches: { min: 1, max: 1 } };
    let fromHub = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      const graph = generateLayout(createRng(seed), flow, GRID);
      const first = graph?.nodes.find((node) => node.branch === 0);
      if (!graph || !first) continue;
      const anchor = graph.edges.find((edge) => edge.b === first.id)!.a;
      if (anchor === 2) fromHub += 1;
    }
    expect(fromHub).toBeGreaterThan(50);
  });
});
