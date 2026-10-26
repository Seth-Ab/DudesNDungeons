/**
 * The generator v2 pipeline (decision 0016): recipe, layout, roles, room shapes, carve, populate and
 * validate, for a `delve` profile.
 *
 * Stage 1 reads the run seed directly, so a retry changes the layout but never the run's flow or
 * biome, or its omens. Stages 2 to 7 read `mixSeed(seed, attempt)`. An attempt that fails a stage, or whose
 * result fails validation, is thrown away and the next one starts from a new stream; after the
 * profile's `maxAttempts` the generator throws, naming the seed so the run can be reproduced.
 * Everything is a pure function of the seed and party size, so the same pair always builds the same
 * tiles and ids.
 */
import type { RoomState } from "../../../shared/types/core.js";
import type { GameContent } from "../../content/loadContent.js";
import type { BiomeDefinition, DelveDungeon, FlowDefinition, OmenDefinition, RoomKind, RoomTemplate } from "../../content/schema.js";
import type { BuiltDungeon } from "../dungeonBuilder.js";
import { createRng, mixSeed, type Rng } from "../random.js";
import { carveDungeon } from "./carve.js";
import { generateLayout } from "./layout.js";
import { chooseOmens, omenEffects, rollOmens } from "./omens.js";
import { populateDungeon } from "./populate.js";
import { assignRoles } from "./roles.js";
import {
  generateRoomShape,
  rollTransform,
  transformTiles,
  type RoomShapeId,
} from "./roomShapes.js";
import { validateDungeon } from "./validate.js";

/** Shapes a procedural room of each kind may take, and the sizes (odd, so sockets stay centred) it may be. */
const SHAPES: Readonly<Partial<Record<RoomKind, { shapes: readonly RoomShapeId[]; sizes: readonly number[] }>>> = {
  entrance: { shapes: ["plain", "pillars", "octagon"], sizes: [7, 9] },
  exit: { shapes: ["plain", "pillars", "octagon"], sizes: [7, 9] },
  boss: { shapes: ["plain", "ring", "octagon"], sizes: [11] },
  puzzle: { shapes: ["plain", "pillars", "ring"], sizes: [9, 11] },
  hall: { shapes: ["pillars", "block", "cross", "ring", "octagon", "alcoves", "cavern"], sizes: [9, 11] },
  maze: { shapes: ["maze"], sizes: [9, 11] },
  trap: { shapes: ["partition", "alcoves", "plain"], sizes: [9, 11] },
  cavern: { shapes: ["cavern"], sizes: [9, 11] },
  arena: { shapes: ["plain", "ring", "octagon"], sizes: [11] },
  camp: { shapes: ["plain", "octagon"], sizes: [7, 9] },
  shrine: { shapes: ["plain", "pillars", "octagon"], sizes: [7, 9] },
  secret: { shapes: ["plain", "alcoves"], sizes: [7] },
  vault: { shapes: ["plain", "pillars"], sizes: [7, 9] },
};

/**
 * Attempts a run that wants a vault spends looking for a layout that can hold one, before it
 * builds without rather than fail to build at all.
 */
const VAULT_ATTEMPTS = 120;
/** The `mixSeed` stream that decides whether a run has a vault, beyond any attempt number. */
const VAULT_STREAM = 1_000_003;

function withVaultBranch(flow: FlowDefinition): FlowDefinition {
  return { ...flow, branches: { min: flow.branches.min + 1, max: flow.branches.max + 1 } };
}

/** Chance a room is a hand-authored template, when one of its kind fits the cell. */
const TEMPLATE_CHANCE = 0.5;

/** Forces parts of the recipe, for a test or a tool that replays a particular run. */
export interface DelveOverrides {
  /** Omen ids to use instead of rolling. An empty list means no omens. */
  readonly omens?: readonly string[];
  /** Whether the run has a vault, instead of rolling the flow's `vaultChance`. */
  readonly vault?: boolean;
}

function recipe(
  definition: DelveDungeon,
  content: GameContent,
  seed: number,
  partySize: number,
  overrides: DelveOverrides,
): { flow: FlowDefinition; biome: BiomeDefinition; omens: OmenDefinition[]; vault: boolean } {
  const rng = createRng(seed);
  const flows = definition.flows
    .map((id) => content.flows.get(id)!)
    .filter((flow) => flow.minParty <= partySize);
  if (flows.length === 0) throw new Error(`Dungeon "${definition.id}" has no flow a party of ${partySize} can play`);
  const flow = rng.weighted(flows);
  const biome = content.biomes.get(rng.pick(definition.biomes))!;
  // Last, so the flow and biome a seed draws are the same whether or not omens exist.
  const rolled = rollOmens(rng, definition, content);
  const omens = overrides.omens ? chooseOmens(overrides.omens, content) : rolled;
  // Its own stream, so neither omens nor an attempt's stream move it. The flow's `vaultChance` is
  // the chance the run asks for a vault; `generateDelve` holds out for a layout with room for one.
  const vault = overrides.vault ?? createRng(mixSeed(seed, VAULT_STREAM)).chance(flow.vaultChance);
  return { flow, biome, omens, vault };
}

function roomTiles(
  rng: Rng,
  kind: RoomKind,
  biome: BiomeDefinition,
  content: GameContent,
  slack: number,
): string[] {
  const templates = [...content.templates.values()].filter(
    (template: RoomTemplate) =>
      template.kind === kind &&
      template.biomes.includes(biome.id) &&
      template.tiles.length <= slack &&
      (template.tiles[0]?.length ?? Infinity) <= slack &&
      template.tiles.length % 2 === 1 &&
      (template.tiles[0]?.length ?? 0) % 2 === 1,
  );
  if (templates.length > 0 && rng.chance(TEMPLATE_CHANCE)) {
    return transformTiles(rng.pick(templates).tiles, rollTransform(rng));
  }

  const choice = SHAPES[kind];
  if (!choice) throw new Error(`The delve generator has no room shape for kind "${kind}"`);
  const { shapes, sizes } = choice;
  return generateRoomShape(rng.pick(shapes), rng.pick(sizes), rng.pick(sizes), rng).tiles;
}

export function generateDelve(
  definition: DelveDungeon,
  content: GameContent,
  seed: number,
  partySize: number,
  overrides: DelveOverrides = {},
): BuiltDungeon {
  const { flow, biome, omens, vault } = recipe(definition, content, seed, partySize, overrides);
  const effects = omenEffects(omens);
  const { grid } = definition;
  const failures: string[] = [];

  for (let attempt = 0; attempt < definition.maxAttempts; attempt += 1) {
    const rng = createRng(mixSeed(seed, attempt));
    const wantsVault = vault && attempt < VAULT_ATTEMPTS;
    // A vault is one more dead-end branch than the flow draws, so a layout has one to spare for it.
    const graph = generateLayout(rng, wantsVault ? withVaultBranch(flow) : flow, grid);
    if (!graph) {
      failures.push("layout");
      continue;
    }
    const plan = assignRoles(rng, graph, flow, biome, wantsVault);
    if (!plan) {
      failures.push("roles");
      continue;
    }
    const rooms = plan.roles.map((kind) => roomTiles(rng, kind, biome, content, grid.cell - 2 * grid.margin));
    const world = carveDungeon(rng, graph, rooms, grid);
    if (!world) {
      failures.push("carve");
      continue;
    }

    let built: BuiltDungeon;
    try {
      const populated = populateDungeon(rng, { graph, plan, world, biome, content, partySize, omens: effects });
      const width = grid.cols * grid.cell;
      const height = grid.rows * grid.cell;
      const roomStates: RoomState[] = world.rooms.map((room) => {
        const kind = plan.roles[room.nodeId]!;
        return {
          id: rng.uuid(),
          name: rng.pick(biome.names[kind] ?? [kind]),
          kind,
          x: room.x,
          y: room.y,
          width: room.width,
          height: room.height,
        };
      });
      built = {
        dungeon: {
          map: { id: definition.id, name: definition.name, width, height, originX: 0, originY: 0, tiles: [...world.tiles], theme: biome.theme, ...(populated.seats.length > 0 ? { seats: populated.seats } : {}) },
          rooms: roomStates,
          monsters: populated.monsters,
          projectiles: [],
          loot: populated.loot,
          chests: populated.chests,
          traps: populated.traps,
          puzzles: populated.puzzles,
          doors: populated.doors,
          exits: populated.exits,
          lightSources: populated.lightSources,
          // Training dummies are a hub fixture; a generated run has none.
          dummies: [],
        },
        spawnPoints: populated.spawnPoints,
        seed,
        omens: omens.map((omen) => omen.id),
      };
    } catch (error) {
      // A room too cramped for what it was asked to hold: re-roll the layout, never ship it.
      failures.push(`populate: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const errors = validateDungeon(built, content, partySize);
    if (errors.length === 0) return built;
    failures.push(errors[0]!);
  }

  throw new Error(
    `Dungeon "${definition.id}" failed validation after ${definition.maxAttempts} attempts for seed ${seed} ` +
      `(party of ${partySize}, flow "${flow.id}"); last failures: ${failures.slice(-3).join("; ")}`,
  );
}
