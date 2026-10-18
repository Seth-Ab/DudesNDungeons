import type { ErrorCode, ServerMessage } from "../../shared/protocol/index.js";
import type { AttackRecord } from "../state/combatFeedback.js";
import { applyMapDiscovery } from "../state/discoveredMap.js";
import { litTilesFrom, type LitTileSet } from "../state/litTiles.js";
import { rejectionMessage, runOutcome, type RunOutcome } from "../state/runFlow.js";
import type {
  DungeonState,
  PlayerId,
  PlayerState,
  RunState,
  SkillView,
  SessionLocation,
  UpgradeView,
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

/** The player's own skills and upgrades, from the owner-only progression messages. */
export interface ProgressionView {
  /** Definitions for display. Empty until `progressionCatalog` arrives. */
  skills: SkillView[];
  upgrades: UpgradeView[];
  /** Kept between runs. */
  unlockedSkillIds: string[];
  unlockedUpgradeIds: string[];
  /** Learned this run and lost unless the player makes it back to the hub. */
  runSkillIds: string[];
  /** What is actually in force now. */
  activeSkillIds: string[];
  activeUpgradeIds: string[];
}

export const emptyProgression: ProgressionView = {
  skills: [],
  upgrades: [],
  unlockedSkillIds: [],
  unlockedUpgradeIds: [],
  runSkillIds: [],
  activeSkillIds: [],
  activeUpgradeIds: [],
};

export interface SessionView {
  phase: ConnectionPhase;
  selfId: PlayerId | null;
  roomCode: string | null;
  tickRate: number | null;
  tick: number;
  players: PlayerState[];
  visiblePlayerIds: PlayerId[];
  dungeon: DungeonState | null;
  /**
   * The tiles the viewer's light reaches, from the newest snapshot. Null until the first one. Every
   * other discovered tile in `dungeon.map` is remembered and draws dark.
   */
  lit: LitTileSet | null;
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
  /**
   * How many actions the server has refused for lack of stamina. A counter rather than a flag so
   * two refusals in a row are two events; the HUD flashes the stamina bar when it goes up.
   */
  staminaRefusals: number;
  /**
   * The latest resolved attacks, newest last, for floating damage numbers. The server sends every
   * attack in the session to every member, so this includes fights the player cannot see; the
   * consumer decides which have a visible target. Capped so a long run does not grow it.
   */
  recentAttacks: AttackRecord[];
  /** Sequence of the newest entry in `recentAttacks`. */
  attackSeq: number;
  /**
   * Per-peer voice volume from the latest `voiceRangeUpdated`. A party member missing from it is
   * out of earshot or out of sight and must be silent.
   */
  voiceRange: VoicePeerRange[];
  /** Null until the server has sent this player's progression. */
  progression: ProgressionView | null;
}

export type VoicePeerRange = Extract<ServerMessage, { type: "voiceRangeUpdated" }>["peers"][number];

const MAX_RECENT_ATTACKS = 32;

export const initialSessionView: SessionView = {
  phase: "offline",
  selfId: null,
  roomCode: null,
  tickRate: null,
  tick: 0,
  players: [],
  visiblePlayerIds: [],
  dungeon: null,
  lit: null,
  location: null,
  run: null,
  runOutcome: null,
  lastError: null,
  lastAction: null,
  staminaRefusals: 0,
  recentAttacks: [],
  attackSeq: 0,
  voiceRange: [],
  progression: null,
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
  "profileInUse",
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
        // A new join is a new profile's view; nothing of an earlier one carries over.
        progression: null,
      };

    case "progressionCatalog":
      return {
        ...view,
        progression: {
          ...(view.progression ?? emptyProgression),
          skills: message.skills,
          upgrades: message.upgrades,
        },
      };

    case "progressionUpdated":
      return {
        ...view,
        progression: {
          ...(view.progression ?? emptyProgression),
          unlockedSkillIds: message.unlockedSkillIds,
          unlockedUpgradeIds: message.unlockedUpgradeIds,
          runSkillIds: message.runSkillIds,
          activeSkillIds: message.activeSkillIds,
          activeUpgradeIds: message.activeUpgradeIds,
        },
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
      // The map arrives as a delta, so it is folded in even from a snapshot that is otherwise
      // stale: the sender will not repeat tiles it has already sent, and skipping one would leave
      // a hole in the geometry for good.
      const map = applyMapDiscovery(view.dungeon?.map ?? null, message.dungeon.map);

      // Snapshots can overtake each other; an older one must never undo a newer one.
      if (message.tick <= view.tick) {
        return view.dungeon && map !== view.dungeon.map
          ? { ...view, dungeon: { ...view.dungeon, map } }
          : view;
      }

      const next: SessionView = {
        ...view,
        tick: message.tick,
        players: mergePlayers(view.players, message.players),
        visiblePlayerIds: message.players.map((player) => player.id),
        dungeon: { ...message.dungeon, map },
        // Unlike the map, light is the whole set every time, so a stale snapshot's is just dropped.
        lit: litTilesFrom(message.dungeon.map),
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
        attackSeq: view.attackSeq + 1,
        recentAttacks: [
          ...view.recentAttacks,
          {
            seq: view.attackSeq + 1,
            attackerId: message.attackerId,
            targetId: message.targetId,
            damage: message.damage,
            targetDefeated: message.targetDefeated,
          },
        ].slice(-MAX_RECENT_ATTACKS),
        lastAction:
          message.damage > 0
            ? `${message.targetDefeated ? "Defeated target" : "Hit target"} for ${message.damage}`
            : "Swing missed",
      };

    case "actionRejected":
      return {
        ...view,
        lastAction: rejectionMessage(message.reason),
        staminaRefusals: view.staminaRefusals + (message.reason === "exhausted" ? 1 : 0),
      };

    case "voiceRangeUpdated":
      return { ...view, voiceRange: message.peers };

    // A handshake is an event for the voice mesh, not state: the session client hands it straight
    // to its `onVoiceSignal` listeners.
    case "voiceSignalRelay":
      return view;
  }
}

/**
 * Whether the player still belongs to a party. True through a reconnect, so voice survives a
 * dropped socket; false once they leave, the reconnect window closes, or the rejoin is refused.
 */
export function inParty(view: SessionView): boolean {
  switch (view.phase) {
    case "inSession":
    case "reconnecting":
    case "connecting":
    case "joining":
      return true;
    // Also passed through for a moment on every reconnect, between the socket opening and the
    // rejoin going out; only a refused join means the party is gone.
    case "connected":
      return view.lastError === null || !JOIN_REJECTIONS.has(view.lastError.code);
    case "offline":
    case "failed":
      return false;
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
