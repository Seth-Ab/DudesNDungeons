import type { ServerMessage } from "../../shared/protocol/index.js";
import type { Session } from "../sessions/sessionStore.js";
import { recipe } from "./generation/delve.js";
import { contentForSession } from "./progression.js";
import { DEFAULT_DUNGEON_ID } from "./dungeonState.js";

export type HubStateMessage = Extract<ServerMessage, { type: "hubState" }>;

/**
 * What the board in the hub shows about the next run. It reads the recipe the run will be built
 * from (the stored seed and the party as it stands), so what is shown is what is built. An authored
 * run has no recipe and shows nothing.
 */
export function hubStateMessage(session: Session): HubStateMessage {
  const content = contentForSession(session);
  const definition = content.dungeons.get(session.runDungeon.dungeonId ?? DEFAULT_DUNGEON_ID);
  if (definition?.layout !== "delve" || session.nextRunSeed === null) return { type: "hubState", nextRun: { omens: [] } };

  const { flow, biome, omens } = recipe(definition, content, session.nextRunSeed, Math.max(1, session.players.size), {});
  return {
    type: "hubState",
    nextRun: {
      flowName: flow.name,
      biomeName: biome.name,
      omens: omens.map((omen) => ({ id: omen.id, name: omen.name, type: omen.type, description: omen.description })),
    },
  };
}
