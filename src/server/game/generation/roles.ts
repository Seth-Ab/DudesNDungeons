/**
 * Stage 3 of the dungeon generator (decision 0016): roles, the boss lock and its key.
 *
 * Shape first, story second: every role is decided from the layout graph's distances and dead ends.
 * The entrance, boss and exit are fixed by the path. The boss room is locked with the existing
 * locked door, on the edge in front of it, and the key goes on the farthest free dead end, which
 * must lie beyond the lock's room so the party carries it back. Every other room is drawn from the
 * biome's weights, never the same kind twice in a row on the critical path and never a trap first
 * after the entrance. An optional vault takes the next far dead end, behind a `vault-key` door, and
 * an elite in a hall, cavern, maze or arena elsewhere carries that key. Shrines, camps and secrets
 * wait for their own issues.
 */
import type {
  BiomeDefinition,
  FlowDefinition,
  RoomKind,
} from "../../content/schema.js";
import type { Rng } from "../random.js";
import type { LayoutGraph } from "./layout.js";

/** How the party comes by the boss key: a puzzle's reward, a room's loot, or a guardian's drop. */
export type KeyVia = "puzzle" | "loot" | "guardian";

export interface RoleAssignment {
  /** Room kind per layout node, indexed by node id. */
  readonly roles: readonly RoomKind[];
  /** The locked door: the edge from the lock's room (`from`) into the boss room (`to`). */
  readonly bossLock: { readonly from: number; readonly to: number };
  readonly bossKey: { readonly nodeId: number; readonly via: KeyVia };
  /**
   * The vault on a far dead end and the one room next to it (`from`) whose door it hides behind,
   * with the room whose elite carries the vault key. Null when none was asked for.
   */
  readonly vault: {
    readonly nodeId: number;
    readonly from: number;
    readonly eliteNodeId: number;
  } | null;
  /** Rooms that get a puzzle. `rewardsBossKey` marks the one that holds the boss key. */
  readonly puzzles: readonly {
    readonly nodeId: number;
    readonly typeId: string;
    readonly rewardsBossKey: boolean;
  }[];
}

type RoleFlow = Pick<FlowDefinition, "bossLock" | "keySource">;
type RoleBiome = Pick<BiomeDefinition, "roomWeights" | "puzzles">;

/** Kinds the fill step may draw; the rest are fixed by the path or belong to the hub. */
const FILL_KINDS: readonly RoomKind[] = [
  "hall",
  "maze",
  "trap",
  "puzzle",
  "cavern",
  "arena",
  "camp",
  "shrine",
];
/** Kinds with no threat budget: a party rests or prays there, so no guard or key holder is put in one. */
const CALM_KINDS: readonly RoomKind[] = ["camp", "shrine"];
/** Kinds an elite may roam: open enough to chase it through. */
const ELITE_KINDS: readonly RoomKind[] = ["hall", "cavern", "maze", "arena"];

function adjacency(graph: LayoutGraph): number[][] {
  const adjacent: number[][] = Array.from(
    { length: graph.nodes.length },
    () => [],
  );
  for (const edge of graph.edges) {
    adjacent[edge.a]!.push(edge.b);
    adjacent[edge.b]!.push(edge.a);
  }
  return adjacent;
}

function hopsFromEntrance(adjacent: readonly number[][]): number[] {
  const dist = new Array<number>(adjacent.length).fill(Infinity);
  dist[0] = 0;
  const queue = [0];
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
 * Assigns a room kind to every node and places the boss lock and key. Returns null when the
 * layout cannot hold them: the flow asks for a lock this stage cannot build, no free dead end lies
 * beyond the lock's room, or the biome cannot fill the critical path without repeating a kind, so
 * the caller retries with another stream rather than ship a key somewhere unreachable.
 */
export function assignRoles(
  rng: Rng,
  graph: LayoutGraph,
  flow: RoleFlow,
  biome: RoleBiome,
  wantVault = false,
): RoleAssignment | null {
  if (flow.bossLock !== "key") return null;
  const { nodes, pathLength } = graph;
  const adjacent = adjacency(graph);
  const dist = hopsFromEntrance(adjacent);
  const bossId = pathLength - 1;
  const exitId = pathLength;
  const lockRoom = pathLength - 2;

  // Dead ends beyond the lock's room. The entrance, boss and exit are dead ends too, but fixed.
  const holder = nodes
    .filter(
      (node) =>
        node.id !== 0 &&
        node.id !== bossId &&
        node.id !== exitId &&
        adjacent[node.id]!.length === 1,
    )
    .filter((node) => dist[node.id]! > dist[lockRoom]!)
    .sort((a, b) => dist[b.id]! - dist[a.id]! || a.id - b.id)[0];
  if (!holder) return null;

  const roles: (RoomKind | undefined)[] = new Array(nodes.length).fill(
    undefined,
  );
  roles[0] = "entrance";
  roles[bossId] = "boss";
  roles[exitId] = "exit";

  const puzzles: { nodeId: number; typeId: string; rewardsBossKey: boolean }[] =
    [];
  const weights = Object.entries(biome.roomWeights)
    .map(([kind, weight]) => ({ kind: kind as RoomKind, weight }))
    .filter(
      (entry) =>
        FILL_KINDS.includes(entry.kind) &&
        (entry.kind !== "puzzle" || biome.puzzles.length > 0),
    );

  let via: KeyVia;
  if (flow.keySource === "puzzle") {
    if (biome.puzzles.length === 0) return null;
    roles[holder.id] = "puzzle";
    puzzles.push({
      nodeId: holder.id,
      typeId: rng.pick(biome.puzzles),
      rewardsBossKey: true,
    });
    via = "puzzle";
  } else {
    // A branch's loot or a guarded room: any body kind, preferring one that is not a plain hall.
    // A camp or shrine is a breather with no monsters, so it never holds a guarded key.
    const fighting = weights.filter(
      (entry) => !CALM_KINDS.includes(entry.kind),
    );
    const pool = fighting.length > 0 ? fighting : weights;
    const special = pool.filter(
      (entry) => entry.kind !== "hall" && entry.kind !== "puzzle",
    );
    roles[holder.id] = rng.weighted(special.length > 0 ? special : pool).kind;
    via = flow.keySource === "branch" ? "loot" : "guardian";
  }

  // A vault, when the run asked for one, on the farthest dead end still free. It is a leaf, so one
  // door shuts it off completely. A layout with no such dead end cannot hold it: the caller retries.
  const vaultSpot = nodes
    .filter(
      (node) =>
        roles[node.id] === undefined &&
        node.id !== holder.id &&
        adjacent[node.id]!.length === 1,
    )
    .sort((a, b) => dist[b.id]! - dist[a.id]! || a.id - b.id)[0];
  if (wantVault && !vaultSpot) return null;
  const vaultNodeId = wantVault ? vaultSpot!.id : null;
  if (vaultNodeId !== null) roles[vaultNodeId] = "vault";

  // Fill the path in order, then the branches. A kind never follows itself along the path, and a
  // trap never comes first after the entrance.
  const order = [...nodes].sort(
    (a, b) =>
      (a.pathIndex === -1 ? Infinity : a.pathIndex) -
        (b.pathIndex === -1 ? Infinity : b.pathIndex) || a.id - b.id,
  );
  for (const node of order) {
    if (roles[node.id] !== undefined) continue;
    const previous = roles[node.id - 1];
    let options = weights;
    if (node.pathIndex >= 0) {
      options = options.filter(
        (entry) => entry.kind !== previous && entry.kind !== roles[node.id + 1],
      );
      if (node.pathIndex === 1)
        options = options.filter((entry) => entry.kind !== "trap");
    }
    if (options.length === 0) return null;
    const kind = rng.weighted(options).kind;
    roles[node.id] = kind;
    if (kind === "puzzle")
      puzzles.push({
        nodeId: node.id,
        typeId: rng.pick(biome.puzzles),
        rewardsBossKey: false,
      });
  }

  // The elite goes in a room away from the vault and the boss key, so no one room holds both keys.
  let vault: RoleAssignment["vault"] = null;
  if (vaultNodeId !== null) {
    const carriers = nodes.filter(
      (node) => ELITE_KINDS.includes(roles[node.id]!) && node.id !== holder.id,
    );
    if (carriers.length === 0) return null;
    vault = {
      nodeId: vaultNodeId,
      from: adjacent[vaultNodeId]![0]!,
      eliteNodeId: rng.pick(carriers).id,
    };
  }

  return {
    roles: roles as RoomKind[],
    bossLock: { from: lockRoom, to: bossId },
    bossKey: { nodeId: holder.id, via },
    puzzles,
    vault,
  };
}
