import type { ErrorCode, ServerMessage } from "../../shared/protocol/index.js";
import { rejectionMessage, runOutcome, type RunOutcome } from "../state/runFlow.js";
import type {
  DungeonState,
  PlayerId,
  PlayerState,
  RunState,
  SessionLocation,
} from "../../shared/types/core.js";

/**
 * Distinct enough to tell "no socket" apart from "socket open but not in a dungeon". The UI needs
 * that difference: one is a server problem, the other is waiting on the player.
 */
export type ConnectionPhase =
  | "offline"
  | "connecting"
  | "connected"
  | "joining"
  | "inSession"
  | "reconnecting"
  | "failed";

export interface SessionError {
  code: ErrorCode;
  message: string;
}

export interface SessionView {
  phase: ConnectionPhase;
  selfId: PlayerId | null;
  roomCode: string | null;
  tickRate: number | null;
  tick: number;
  players: PlayerState[];
  visiblePlayerIds: PlayerId[];
  dungeon: DungeonState | null;
  location: SessionLocation | null;
  /** The server's run clock for this player. Null until the first snapshot. */
  run: RunState | null;
  /**
   * How the last run ended for this player, kept while they are back in the hub. Null during a run
   * and before the first one, so the hub reports the trip the player just made and nothing else.
   */
  runOutcome: RunOutcome | null;
  lastError: SessionError | null;
  lastAction: string | null;
}

export const initialSessionView: SessionView = {
  phase: "offline",
  selfId: null,
  roomCode: null,
  tickRate: null,
  tick: 0,
  players: [],
  visiblePlayerIds: [],
  dungeon: null,
  location: null,
  run: null,
  runOutcome: null,
  lastError: null,
  lastAction: null,
};

/**
 * Errors that end a join attempt rather than a whole connection. The socket stays usable, so the
 * player can correct the room code and try again instead of reloading.
 */
const JOIN_REJECTIONS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "sessionNotFound",
  "sessionFull",
  "protocolVersionMismatch",
  "alreadyInSession",
  "runInProgress",
]);

function replacePlayer(
  players: PlayerState[],
  playerId: PlayerId,
  update: (player: PlayerState) => PlayerState,
): PlayerState[] {
  return players.map((player) => (player.id === playerId ? update(player) : player));
}

function mergePlayers(known: PlayerState[], visible: PlayerState[]): PlayerState[] {
  const merged = new Map(known.map((player) => [player.id, player]));
  for (const player of visible) merged.set(player.id, player);
  return [...merged.values()];
}

/**
 * Folds one server message into the client's view of the dungeon. Pure, so the whole session
 * lifecycle can be tested without a socket.
 */
export function applyServerMessage(view: SessionView, message: ServerMessage): SessionView {
  switch (message.type) {
    case "sessionJoined":
      return {
        ...view,
        phase: "inSession",
        selfId: message.playerId,
        roomCode: message.roomCode,
        tickRate: message.tickRate,
        players: message.players,
        visiblePlayerIds: message.players.map((player) => player.id),
        lastError: null,
      };

    case "playerJoined":
      if (view.players.some((player) => player.id === message.player.id)) return view;
      return { ...view, players: [...view.players, message.player] };

    case "playerLeft":
      return {
        ...view,
        players: view.players.filter((player) => player.id !== message.playerId),
      };

    // A drop is not a departure: the player keeps their slot for the server's grace window.
    case "playerConnectionChanged":
      return {
        ...view,
        players: replacePlayer(view.players, message.playerId, (player) => ({
          ...player,
          connected: message.connected,
        })),
      };

    case "playerReadyChanged":
      return {
        ...view,
        players: replacePlayer(view.players, message.playerId, (player) => ({
          ...player,
          ready: message.ready,
        })),
      };

    case "stateSnapshot": {
      // Snapshots can overtake each other; an older one must never undo a newer one.
      if (message.tick <= view.tick) return view;

      const next: SessionView = {
        ...view,
        tick: message.tick,
        players: mergePlayers(view.players, message.players),
        visiblePlayerIds: message.players.map((player) => player.id),
        dungeon: message.dungeon,
        location: message.location,
        run: message.run,
      };

      // The party moves between the hub and a run as one, and protocol v8 announces neither: the
      // only sign either happened is that two consecutive snapshots disagree about where everyone
      // is. Read here rather than in the UI, so an outcome survives a frame that was never drawn.
      if (view.location === null || view.location === message.location) return next;

      if (message.location === "dungeon") {
        return { ...next, runOutcome: null, lastAction: "The run has begun." };
      }

      return { ...next, runOutcome: runOutcome(selfOf(view), selfOf(next)) };
    }

    case "sessionError":
      return {
        ...view,
        phase: JOIN_REJECTIONS.has(message.code) ? "connected" : view.phase,
        lastError: { code: message.code, message: message.message },
      };

    case "attackResolved":
      return {
        ...view,
        lastAction:
          message.damage > 0
            ? `${message.targetDefeated ? "Defeated target" : "Hit target"} for ${message.damage}`
            : "Swing missed",
      };

    case "actionRejected":
      return { ...view, lastAction: rejectionMessage(message.reason) };

    // Voice feedback lands in later steps; ignoring it keeps the view honest rather than inventing
    // state the client cannot yet act on.
    case "voiceRangeUpdated":
    case "voiceSignalRelay":
      return view;
  }
}

export function selfOf(view: SessionView): PlayerState | null {
  if (view.selfId === null) return null;
  return view.players.find((player) => player.id === view.selfId) ?? null;
}

export function othersOf(view: SessionView): PlayerState[] {
  return view.players.filter((player) => player.id !== view.selfId);
}

export function visibleOthersOf(view: SessionView): PlayerState[] {
  const visible = new Set(view.visiblePlayerIds);
  return othersOf(view).filter((player) => visible.has(player.id));
}
