/**
 * Stage 3 of the dungeon generator (decision 0016): roles, the boss lock and its key.
 *
 * Shape first, story second: every role is decided from the layout graph's distances and dead ends.
 * The entrance, boss and exit are fixed by the path. The boss room is locked with the existing
 * locked door, on the edge in front of it, and the key goes on the farthest free dead end, which
 * must lie beyond the lock's room so the party carries it back. Every other room is drawn from the
 * biome's weights, never the same kind twice in a row on the critical path and never a trap first
 * after the entrance. An optional vault takes the next far dead end, behind a `vault-key` door, and
 * an elite in a hall, cavern, maze or arena elsewhere carries that key. A shrine takes the next far
 * dead end, at a set chance (always, when an omen asks). Camps and secrets wait for their own issues.
 */
import type {
  BiomeDefinition,
  FlowDefinition,
  RoomKind,
} from "../../content/schema.js";
import type { DoorVoteIcon } from "../../../shared/constants/game.js";
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
  /**
   * A Door Vote at a junction: the room whose branch doorways are voted on, each with the branch it
   * leads to and a hint of what lies in it. Null when the run asked for none or no junction fits.
   */
  readonly doorVote: {
    readonly nodeId: number;
    readonly typeId: string;
    readonly doors: readonly { readonly toNodeId: number; readonly icon: DoorVoteIcon }[];
  } | null;
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
];
/** Kinds with no threat budget: a party rests or prays there, so no guard or key holder is put in one. */
const CALM_KINDS: readonly RoomKind[] = ["camp", "shrine"];
/** Kinds an elite may roam: open enough to chase it through. */
const ELITE_KINDS: readonly RoomKind[] = ["hall", "cavern", "maze", "arena"];

/** How often a run has a shrine when no omen guarantees one. */
export const DEFAULT_SHRINE_CHANCE = 0.5;

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

/** Room kinds a Door Vote may not stand in: the party arrives, fights, or is locked in there. */
const NO_VOTE_KINDS: readonly RoomKind[] = ["entrance", "boss", "exit", "vault", "puzzle", "shrine"];

/** What a branch's rooms hint at, loudest first: a shrine, a fight, then loot, else a plain room. */
function iconFor(kinds: readonly RoomKind[]): DoorVoteIcon {
  if (kinds.includes("shrine")) return "shrine";
  if (kinds.some((kind) => kind === "trap" || kind === "arena")) return "danger";
  if (kinds.includes("maze")) return "loot";
  return "unknown";
}

/**
 * The junction a Door Vote goes in: the first room on the path, past the entrance, with two or more
 * branches growing from it. Each voted doorway leads into a branch that nothing the run needs lies
 * in (the boss key, the vault and its elite, a puzzle) and that never rejoins the path, so
 * whichever door the party picks, the way on stays open. The path doorways are never voted.
 */
function doorVoteJunction(
  graph: LayoutGraph,
  adjacent: readonly number[][],
  roles: readonly RoomKind[],
  mustStayOpen: ReadonlySet<number>,
  typeId: string,
): RoleAssignment["doorVote"] {
  for (const node of graph.nodes) {
    if (node.pathIndex < 1 || node.pathIndex >= graph.pathLength - 1 || NO_VOTE_KINDS.includes(roles[node.id]!)) continue;
    const roots = graph.edges
      .filter((edge) => edge.kind === "open" && (edge.a === node.id || edge.b === node.id))
      .map((edge) => (edge.a === node.id ? edge.b : edge.a))
      .filter((other) => graph.nodes[other]!.pathIndex === -1);
    if (roots.length < 2) continue;

    const doors: { toNodeId: number; icon: DoorVoteIcon }[] = [];
    let fits = true;
    for (const root of roots) {
      const seen = new Set([node.id, root]);
      const queue = [root];
      for (let head = 0; head < queue.length; head += 1) {
        for (const next of adjacent[queue[head]!]!) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      seen.delete(node.id);
      const branch = [...seen];
      if (branch.some((id) => graph.nodes[id]!.pathIndex !== -1 || mustStayOpen.has(id) || roles[id] === "puzzle")) {
        fits = false;
        break;
      }
      doors.push({ toNodeId: root, icon: iconFor(branch.map((id) => roles[id]!)) });
    }
    if (fits) return { nodeId: node.id, typeId, doors };
  }
  return null;
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
  shrineChance = DEFAULT_SHRINE_CHANCE,
  doorVoteTypeId: string | null = null,
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

  // A shrine on the next far dead end, so reaching it feels earned. A guaranteed one (an omen) falls
  // back to any free side room, and a layout with none cannot hold it: the caller retries.
  if (rng.chance(shrineChance)) {
    const free = nodes.filter((node) => roles[node.id] === undefined && node.id !== holder.id);
    const deadEnds = free.filter((node) => adjacent[node.id]!.length === 1);
    const spot = [...deadEnds].sort((a, b) => dist[b.id]! - dist[a.id]! || a.id - b.id)[0] ??
      (shrineChance >= 1 ? free.filter((node) => node.pathIndex === -1)[0] : undefined);
    if (spot) roles[spot.id] = "shrine";
    else if (shrineChance >= 1) return null;
  }

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

  const finalRoles = roles as RoomKind[];
  const mustStayOpen = new Set([holder.id, ...(vault ? [vault.nodeId, vault.eliteNodeId] : [])]);
  return {
    roles: finalRoles,
    bossLock: { from: lockRoom, to: bossId },
    bossKey: { nodeId: holder.id, via },
    puzzles,
    vault,
    doorVote: doorVoteTypeId ? doorVoteJunction(graph, adjacent, finalRoles, mustStayOpen, doorVoteTypeId) : null,
  };
}
