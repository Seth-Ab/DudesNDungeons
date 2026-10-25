import { MILESTONE_STATS } from "../../shared/constants/game.js";
import type {
  ErrorCode,
  PartyRosterEntry,
  SavedRunCard,
  ServerMessage,
  WardrobeEntry,
} from "../../shared/protocol/index.js";
import type { AttackRecord } from "../state/combatFeedback.js";
import { applyMapDiscovery } from "../state/discoveredMap.js";
import { emoteFeedLine, type EmoteRecord } from "../state/emotes.js";
import { litTilesFrom, type LitTileSet } from "../state/litTiles.js";
import { rejectionMessage, roomAt, runOutcome, type RunOutcome } from "../state/runFlow.js";
import type {
  DungeonState,
  InventoryItem,
  PlayerId,
  PlayerState,
  RoomState,
  RunState,
  SkillStacks,
  MilestoneStats,
  MilestoneView,
  SkillView,
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

/** The player's own skill stacks, from the owner-only progression messages. */
export interface ProgressionView {
  /** Definitions for display, with stack limits and prerequisites. Empty until `progressionCatalog` arrives. */
  skills: SkillView[];
  /** Milestones the server grants skills for. Empty until `progressionCatalog` arrives. */
  milestones: MilestoneView[];
  /** Stacks kept between runs. */
  skillStacks: SkillStacks;
  /** Stacks learned this run and lost unless the player makes it back to the hub. */
  runSkillStacks: SkillStacks;
  /** What is actually in force now, capped at each skill's limit. */
  activeSkillStacks: SkillStacks;
  /** Banked coin on the profile. */
  coin: number;
  /** The run purse: carried this run, credited on extraction and lost otherwise. */
  runCoin: number;
  /** Lifetime stats milestones are measured against. */
  stats: MilestoneStats;
  /** Ids of milestones already earned. */
  earnedMilestones: string[];
  /** Cosmetic ids the profile owns, starters included. What is worn is on each `PlayerState`. */
  ownedCosmeticIds: string[];
}

export const emptyProgression: ProgressionView = {
  skills: [],
  milestones: [],
  skillStacks: {},
  runSkillStacks: {},
  activeSkillStacks: {},
  coin: 0,
  runCoin: 0,
  stats: Object.fromEntries(MILESTONE_STATS.map((stat) => [stat, 0])) as MilestoneStats,
  earnedMilestones: [],
  ownedCosmeticIds: [],
};

export interface SessionView {
  phase: ConnectionPhase;
  selfId: PlayerId | null;
  roomCode: string | null;
  tickRate: number | null;
  /**
   * What the last `sessionJoined` said: this slot has no character yet, so the player must design
   * one and send `setAppearance` before they can act. Until they do, the server leaves them out of
   * the world, and the snapshot shows their own entry with a null `appearance`.
   */
  needsAppearance: boolean;
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
   * The latest emotes this player was sent, newest last, for bubbles. The server only sends the
   * ones whose emoter this player can see. Capped like `recentAttacks`.
   */
  recentEmotes: EmoteRecord[];
  /** Sequence of the newest entry in `recentEmotes`. */
  emoteSeq: number;
  /**
   * Per-peer voice volume from the latest `voiceRangeUpdated`. A party member missing from it is
   * out of earshot or out of sight and must be silent.
   */
  voiceRange: VoicePeerRange[];
  /** Null until the server has sent this player's progression. */
  progression: ProgressionView | null;
  /**
   * Everyone in the party with a character, seen or not, from the latest `partyRoster`. Identity and
   * connection only: for a member outside `visiblePlayerIds` this is all the client knows.
   */
  partyRoster: PartyRosterEntry[];
  /**
   * The name of the room each ally was last seen in, by player id. Taken from snapshots the client
   * already holds, so it only ever names a room the server had shown this viewer. Forgotten when
   * the party moves between the hub and a run, since rooms do not carry over.
   */
  lastSeenRooms: Readonly<Record<PlayerId, string>>;
  /** What the party vault holds, from the latest `partyVault`. The same list for every member. */
  vault: InventoryItem[];
  /**
   * The scroll the player tried to use that the server refused as maxed, waiting on their answer to
   * the conversion prompt. Set and cleared by the session client, since a refusal does not name it.
   */
  convertPromptItemId: string | null;
  /** What the hub skill shop sells now, from the latest `skillShopStock`. The same for every member. */
  skillShop: SkillShopEntry[];
  /** The refusal to show inside the shop panel for the last purchase, or null. Set by the session client. */
  shopNotice: string | null;
  /** Every cosmetic and whether the wardrobe stall stocks it now, from the latest `wardrobeCatalog`. */
  wardrobe: WardrobeEntry[];
  /** The refusal to show inside the wardrobe for the last buy or equip, or null. Set by the session client. */
  wardrobeNotice: string | null;
  /** The refusal to show beside Save and quit in the camp menu, or null. Set by the session client. */
  saveQuitNotice: string | null;
  /**
   * The room the player just saved and quit, for the lobby to fill in. Set by `savedAndQuit` on a
   * view otherwise reset to the lobby's, so it is null for a player who left or never joined.
   */
  savedQuitRoomCode: string | null;
  /**
   * The runs this device's profile can continue, as the server listed them for the lobby. Null until
   * the server has answered; an empty list means it answered and there are none.
   */
  savedRuns: SavedRunCard[] | null;
}

export type SkillShopEntry = Extract<ServerMessage, { type: "skillShopStock" }>["entries"][number];

export type VoicePeerRange = Extract<ServerMessage, { type: "voiceRangeUpdated" }>["peers"][number];

const MAX_RECENT_ATTACKS = 32;
const MAX_RECENT_EMOTES = 16;

/** Shown when the last hub ready plate fills and the whole party is ready. */
export const PARTY_READY_CUE = "Everyone is ready. Head through the gate.";

export const initialSessionView: SessionView = {
  phase: "offline",
  selfId: null,
  roomCode: null,
  tickRate: null,
  needsAppearance: false,
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
  recentEmotes: [],
  emoteSeq: 0,
  voiceRange: [],
  progression: null,
  partyRoster: [],
  lastSeenRooms: {},
  vault: [],
  convertPromptItemId: null,
  skillShop: [],
  shopNotice: null,
  wardrobe: [],
  wardrobeNotice: null,
  saveQuitNotice: null,
  savedQuitRoomCode: null,
  savedRuns: null,
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
  "notSaveMember",
  "savedRunExists",
  "notPermitted",
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

function withoutKey(record: Readonly<Record<PlayerId, string>>, key: PlayerId): Record<PlayerId, string> {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

/**
 * Notes the room each visible ally stands in. `rooms` is the snapshot's own list, which holds only
 * rooms this viewer has discovered, so nothing undiscovered can be named. An ally between rooms
 * keeps the last room they were seen in.
 */
function rememberSeenRooms(
  known: Readonly<Record<PlayerId, string>>,
  selfId: PlayerId | null,
  visible: readonly PlayerState[],
  rooms: readonly RoomState[],
): Readonly<Record<PlayerId, string>> {
  let next: Record<PlayerId, string> | null = null;
  for (const player of visible) {
    if (player.id === selfId) continue;
    const name = roomAt(rooms, player.position)?.name;
    if (!name || known[player.id] === name) continue;
    next ??= { ...known };
    next[player.id] = name;
  }
  return next ?? known;
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
        needsAppearance: message.needsAppearance,
        players: message.players,
        visiblePlayerIds: message.players.map((player) => player.id),
        lastError: null,
        // A new join is a new profile's view; nothing of an earlier one carries over.
        progression: null,
        partyRoster: [],
        lastSeenRooms: {},
        vault: [],
        convertPromptItemId: null,
        skillShop: [],
        shopNotice: null,
        wardrobe: [],
        wardrobeNotice: null,
      };

    case "partyRoster":
      return { ...view, partyRoster: message.members };

    case "partyVault":
      return { ...view, vault: message.items };

    case "skillShopStock":
      return { ...view, skillShop: message.entries };

    case "wardrobeCatalog":
      return { ...view, wardrobe: message.entries };

    case "progressionCatalog":
      return {
        ...view,
        progression: {
          ...(view.progression ?? emptyProgression),
          skills: message.skills,
          milestones: message.milestones,
        },
      };

    case "progressionUpdated":
      return {
        ...view,
        progression: {
          ...(view.progression ?? emptyProgression),
          skillStacks: message.skillStacks,
          runSkillStacks: message.runSkillStacks,
          activeSkillStacks: message.activeSkillStacks,
          coin: message.coin,
          runCoin: message.runCoin,
          stats: message.stats,
          earnedMilestones: message.earnedMilestones,
          ownedCosmeticIds: message.ownedCosmeticIds,
        },
      };

    case "playerJoined":
      if (view.players.some((player) => player.id === message.player.id)) return view;
      return { ...view, players: [...view.players, message.player] };

    case "playerLeft":
      return {
        ...view,
        players: view.players.filter((player) => player.id !== message.playerId),
        partyRoster: view.partyRoster.filter((entry) => entry.playerId !== message.playerId),
        lastSeenRooms: withoutKey(view.lastSeenRooms, message.playerId),
      };

    case "savedRuns":
      return { ...view, savedRuns: message.runs };

    // The session client closes the socket on this; the reducer only returns the view to the lobby's.
    case "savedAndQuit":
      return { ...initialSessionView, phase: "offline", savedQuitRoomCode: message.roomCode };

    // Shown beside the camp menu's button; the player stays in the run.
    case "saveAndQuitRefused":
      return {
        ...view,
        lastAction: rejectionMessage(message.reason),
        saveQuitNotice: rejectionMessage(message.reason),
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
        // The last ready plate filling is the party's cue to head through the gate.
        ...(message.partyReady ? { lastAction: PARTY_READY_CUE } : {}),
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
        lastSeenRooms: rememberSeenRooms(
          view.location === null || view.location === message.location ? view.lastSeenRooms : {},
          view.selfId,
          message.players,
          message.dungeon.rooms,
        ),
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
            swing: message.swing,
          },
        ].slice(-MAX_RECENT_ATTACKS),
        lastAction:
          message.damage > 0
            ? `${message.targetDefeated ? "Defeated target" : "Hit target"} for ${message.damage}`
            : "Swing missed",
      };

    case "playerEmoted":
      return {
        ...view,
        emoteSeq: view.emoteSeq + 1,
        recentEmotes: [
          ...view.recentEmotes,
          { seq: view.emoteSeq + 1, playerId: message.playerId, kind: message.kind },
        ].slice(-MAX_RECENT_EMOTES),
        lastAction: emoteFeedLine(view.players, view.selfId, message.playerId, message.kind),
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

/**
 * Party members who have a character, the only ones in the world. One still designing is in the
 * roster but stands nowhere: the server lets them block nobody, so the client draws and predicts
 * around them the same way.
 */
export function spawnedOthersOf(view: SessionView): PlayerState[] {
  return othersOf(view).filter((player) => player.appearance !== null);
}

export function visibleOthersOf(view: SessionView): PlayerState[] {
  const visible = new Set(view.visiblePlayerIds);
  return spawnedOthersOf(view).filter((player) => visible.has(player.id));
}
