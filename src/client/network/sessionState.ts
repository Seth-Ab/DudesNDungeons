import type { ErrorCode, ServerMessage } from "../../shared/protocol/index.js";
import type { DungeonState, PlayerId, PlayerState } from "../../shared/types/core.js";

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
  dungeon: DungeonState | null;
  lastError: SessionError | null;
}

export const initialSessionView: SessionView = {
  phase: "offline",
  selfId: null,
  roomCode: null,
  tickRate: null,
  tick: 0,
  players: [],
  dungeon: null,
  lastError: null,
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
]);

function replacePlayer(
  players: PlayerState[],
  playerId: PlayerId,
  update: (player: PlayerState) => PlayerState,
): PlayerState[] {
  return players.map((player) => (player.id === playerId ? update(player) : player));
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

    case "stateSnapshot":
      // Snapshots can overtake each other; an older one must never undo a newer one.
      if (message.tick <= view.tick) return view;
      return { ...view, tick: message.tick, players: message.players, dungeon: message.dungeon };

    case "sessionError":
      return {
        ...view,
        phase: JOIN_REJECTIONS.has(message.code) ? "connected" : view.phase,
        lastError: { code: message.code, message: message.message },
      };

    // Combat, voice, and action feedback land in later steps; ignoring them keeps the view honest
    // rather than inventing state the client cannot yet act on.
    case "attackResolved":
    case "voiceRangeUpdated":
    case "voiceSignalRelay":
    case "actionRejected":
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
