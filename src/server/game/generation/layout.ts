/**
 * Stage 2 of the dungeon generator (decision 0016): the layout graph.
 *
 * A self-avoiding walk across the grid is the critical path (entrance, then rooms, then boss, then
 * exit). The flow's branches grow from it into free cells, and loops join adjacent rooms that are
 * at least three hops apart. The result is a pure graph of nodes and edges drawn from the seeded
 * stream alone; roles, room shapes and tiles are later stages.
 */
import type { FlowDefinition } from "../../content/schema.js";
import type { Rng } from "../random.js";

export interface GridCell {
  readonly c: number;
  readonly r: number;
}

export interface LayoutNode {
  /** Index into `LayoutGraph.nodes`. The path comes first, so path node `i` has id `i`. */
  readonly id: number;
  readonly cell: GridCell;
  /** Position along the critical path, or -1 for a branch room. */
  readonly pathIndex: number;
  /** Which branch the room belongs to, or -1 for a path room. */
  readonly branch: number;
}

export interface LayoutEdge {
  readonly a: number;
  readonly b: number;
  readonly kind: "open" | "loop";
}

export interface LayoutGraph {
  readonly cols: number;
  readonly rows: number;
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  /**
   * Steps from entrance to exit along the path, as the flow counts them: the path holds
   * `pathLength + 1` rooms, the boss at `pathLength - 1` and the exit at `pathLength`.
   */
  readonly pathLength: number;
}

export interface LayoutGrid {
  readonly cols: number;
  readonly rows: number;
}

const DIRECTIONS: readonly GridCell[] = [
  { c: 1, r: 0 },
  { c: -1, r: 0 },
  { c: 0, r: 1 },
  { c: 0, r: -1 },
];

/** Steps the walk may spend backtracking before it gives up, so a cramped grid cannot hang it. */
const WALK_BUDGET = 4000;
/** Loops only join rooms at least this many hops apart, so a loop is a real shortcut. */
const MIN_LOOP_HOPS = 3;

export interface LayoutOptions {
  /**
   * Grow the first two branches from one early path room, a junction a Door Vote can stand in.
   * The flow must draw at least two branches.
   */
  readonly junction?: boolean;
}

/** A junction is no later than this many rooms in, so the run's far dead ends are not in its branches. */
const JUNCTION_MAX_PATH_INDEX = 3;

type LayoutFlow = Pick<FlowDefinition, "path" | "branches" | "branchLength" | "loops" | "branchFrom" | "hubIndex">;

const cellKey = (cell: GridCell): string => `${cell.c},${cell.r}`;

function walkPath(rng: Rng, grid: LayoutGrid, rooms: number): GridCell[] | null {
  const inGrid = (cell: GridCell): boolean => cell.c >= 0 && cell.r >= 0 && cell.c < grid.cols && cell.r < grid.rows;
  const start = { c: rng.int(0, grid.cols - 1), r: rng.int(0, grid.rows - 1) };
  const path: GridCell[] = [start];
  const used = new Set([cellKey(start)]);
  let budget = WALK_BUDGET;

  const step = (): boolean => {
    if (path.length === rooms) return true;
    budget -= 1;
    if (budget <= 0) return false;
    const here = path[path.length - 1]!;
    for (const dir of rng.shuffle(DIRECTIONS)) {
      const next = { c: here.c + dir.c, r: here.r + dir.r };
      if (!inGrid(next) || used.has(cellKey(next))) continue;
      used.add(cellKey(next));
      path.push(next);
      if (step()) return true;
      path.pop();
      used.delete(cellKey(next));
    }
    return false;
  };

  return step() ? path : null;
}

/** Hop counts from `from` to every reachable node over `edges`. */
function hopsFrom(nodeCount: number, edges: readonly LayoutEdge[], from: number): number[] {
  const adjacent: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    adjacent[edge.a]!.push(edge.b);
    adjacent[edge.b]!.push(edge.a);
  }
  const dist = new Array<number>(nodeCount).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    for (const next of adjacent[id]!) {
      if (dist[next] !== Infinity) continue;
      dist[next] = dist[id]! + 1;
      queue.push(next);
    }
  }
  return dist;
}

/**
 * Lays out one run. Returns null when the walk cannot fit the path on the grid within its budget,
 * or when the grid has no room for the flow's minimum branches or loops, so the caller can retry
 * with another stream rather than loop forever or ship a run that is not the flow it drew.
 */
export function generateLayout(
  rng: Rng,
  flow: LayoutFlow,
  grid: LayoutGrid,
  options: LayoutOptions = {},
): LayoutGraph | null {
  const pathLength = rng.int(flow.path.min, flow.path.max);
  const cells = walkPath(rng, grid, pathLength + 1);
  if (!cells) return null;

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const byCell = new Map<string, LayoutNode>();
  const addNode = (cell: GridCell, pathIndex: number, branch: number): LayoutNode => {
    const node = { id: nodes.length, cell, pathIndex, branch };
    nodes.push(node);
    byCell.set(cellKey(cell), node);
    return node;
  };
  const addEdge = (a: LayoutNode, b: LayoutNode, kind: LayoutEdge["kind"] = "open"): void => {
    edges.push({ a: a.id, b: b.id, kind });
  };

  cells.forEach((cell, index) => {
    const node = addNode(cell, index, -1);
    if (index > 0) addEdge(nodes[index - 1]!, node);
  });
  const boss = nodes[pathLength - 1]!;
  const exit = nodes[pathLength]!;

  const freeNeighbors = (node: LayoutNode): GridCell[] =>
    DIRECTIONS.map((dir) => ({ c: node.cell.c + dir.c, r: node.cell.r + dir.r })).filter(
      (cell) =>
        cell.c >= 0 && cell.r >= 0 && cell.c < grid.cols && cell.r < grid.rows && !byCell.has(cellKey(cell)),
    );

  const branchCount = rng.int(flow.branches.min, flow.branches.max);
  let grownBranches = 0;
  let junctionAnchor: LayoutNode | null = null;
  const hub = flow.hubIndex !== undefined ? nodes[flow.hubIndex] : undefined;
  for (let branch = 0; branch < branchCount; branch += 1) {
    // Branches grow only from rooms that are not the boss, the exit or another branch's room.
    const anchors = nodes.filter(
      (node) => node !== boss && node !== exit && node.branch === -1 && freeNeighbors(node).length > 0,
    );
    if (anchors.length === 0) break;
    let anchor = rng.pick(anchors);
    if (options.junction && branch < 2) {
      if (branch === 0) {
        const early = anchors.filter(
          (node) =>
            node.pathIndex >= 1 && node.pathIndex <= JUNCTION_MAX_PATH_INDEX && freeNeighbors(node).length >= 2,
        );
        if (early.length === 0) return null;
        anchor = rng.pick(early);
        junctionAnchor = anchor;
      } else if (junctionAnchor && freeNeighbors(junctionAnchor).length > 0) {
        anchor = junctionAnchor;
      } else {
        return null;
      }
    }
    if (flow.branchFrom === "hub" && hub && hub !== boss && hub !== exit && !(options.junction && branch < 2)) {
      if (freeNeighbors(hub).length > 0) {
        anchor = hub;
      } else {
        const near = anchors.filter(
          (node) => Math.abs(node.cell.c - hub.cell.c) + Math.abs(node.cell.r - hub.cell.r) === 1,
        );
        if (near.length > 0) anchor = rng.pick(near);
      }
    }
    const length = rng.int(flow.branchLength.min, flow.branchLength.max);
    let previous = anchor;
    grownBranches += 1;
    for (let index = 0; index < length; index += 1) {
      const options = freeNeighbors(previous);
      if (options.length === 0) break;
      const node = addNode(rng.pick(options), -1, branch);
      addEdge(previous, node);
      previous = node;
    }
  }

  if (grownBranches < flow.branches.min) return null;

  const isVoted = (node: LayoutNode): boolean => node.branch === 0 || node.branch === 1;
  const loopCount = rng.int(flow.loops.min, flow.loops.max);
  let addedLoops = 0;
  if (loopCount > 0) {
    const candidates: Array<[LayoutNode, LayoutNode]> = [];
    for (const node of nodes) {
      const dist = hopsFrom(nodes.length, edges, node.id);
      for (const dir of DIRECTIONS) {
        const other = byCell.get(cellKey({ c: node.cell.c + dir.c, r: node.cell.r + dir.r }));
        if (!other || other.id <= node.id) continue;
        if (node === boss || node === exit || other === boss || other === exit) continue;
        // A junction's voted branches stay dead ends, or sealing their doorways would shut nothing.
        if (options.junction && (isVoted(node) || isVoted(other))) continue;
        if (dist[other.id]! < MIN_LOOP_HOPS) continue;
        candidates.push([node, other]);
      }
    }
    for (const [a, b] of rng.shuffle(candidates)) {
      if (addedLoops >= loopCount) break;
      // An earlier loop may have shortened this pair's distance.
      if (hopsFrom(nodes.length, edges, a.id)[b.id]! < MIN_LOOP_HOPS) continue;
      addEdge(a, b, "loop");
      addedLoops += 1;
    }
  }
  if (addedLoops < flow.loops.min) return null;

  return { cols: grid.cols, rows: grid.rows, nodes, edges, pathLength };
}
