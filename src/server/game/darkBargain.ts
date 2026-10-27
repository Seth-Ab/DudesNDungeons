import {
  DARK_BARGAIN_MS,
  ELITE_CALL_MS,
  DARK_BARGAIN_WAVE_MAX_COST,
  DARK_BARGAIN_WAVE_PER_PLAYER,
} from "../../shared/constants/game.js";
import { distance, isFloor, isOpen } from "../../shared/game/movement.js";
import { roomAt } from "../../shared/game/rooms.js";
import type { DarkBargainState, RoomState, Vector2 } from "../../shared/types/core.js";
import type { MonsterType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { monsterInstance } from "./dungeonBuilder.js";
import { DEFAULT_DUNGEON_ID, isDown, isSpawned } from "./dungeonState.js";
import { contentForSession } from "./progression.js";

/**
 * The Dark Bargain. A shrine room's candle stays lit and asks for the party's light: when every
 * torch carried into the room is out (and at least one is carried unlit) for `DARK_BARGAIN_MS`, the
 * room's chests improve one loot tier and the dark sends monsters, once per shrine per run.
 *
 * Lighting any torch in the room while the dark counts down, whether by relighting from the candle
 * or from another torch, a carrier walking in with a lit one, or a downed carrier's burning one,
 * breaks the bargain for the run. The countdown lives in `session.darkBargains`, server-side;
 * `struck` and `broken` are saved with the run, a countdown is not, so a resumed party starts over.
 */

export type DarkBargainStatus = DarkBargainState["status"];

export interface DarkBargain {
  status: DarkBargainStatus;
  /** When the dark began counting; meaningful only while `counting`. */
  since: number;
  remainingMs: number;
}

/** Who stands in `room`: spawned, connected players, whether on their feet or down. */
function playersIn(session: Session, room: RoomState): SessionPlayer[] {
  return [...session.players.values()].filter(
    (player) => player.connected && isSpawned(player) && roomAt([room], player.position) !== null,
  );
}

/** A carried torch that is burning. A disconnected player's has gone out with them. */
function burning(player: SessionPlayer): boolean {
  return player.carryingTorch && player.torchLit;
}

/** Breaks a counting bargain in the shrine this player stands in, for a torch lit this instant. */
export function noteTorchLit(session: Session, player: SessionPlayer): void {
  const room = roomAt(session.dungeon.rooms, player.position);
  if (!room || room.kind !== "shrine") return;
  const bargain = session.darkBargains.get(room.id);
  if (bargain?.status === "counting") session.darkBargains.set(room.id, { ...bargain, status: "broken" });
}

/** Improves every unopened, honest chest in `room` to its table's next tier. */
function improveChests(session: Session, room: RoomState): void {
  const tables = contentForSession(session).lootTables;
  for (const chest of session.dungeon.chests) {
    if (chest.opened || chest.mimic || roomAt([room], chest.position) === null) continue;
    const next = tables.get(chest.lootTableId)?.upgradesTo;
    if (next !== undefined) chest.lootTableId = next;
  }
}

/** The cheap monsters of the run's biomes, as the dark's wave may send. */
function waveRoster(session: Session): { type: MonsterType; weight: number }[] {
  const content = contentForSession(session);
  const definition = content.dungeons.get(session.runDungeon.dungeonId ?? DEFAULT_DUNGEON_ID);
  if (definition?.layout !== "delve") return [];

  const roster: { type: MonsterType; weight: number }[] = [];
  for (const biomeId of definition.biomes) {
    for (const entry of content.biomes.get(biomeId)?.roster ?? []) {
      const type = content.monsters.get(entry.typeId);
      if (type && !type.boss && entry.cost <= DARK_BARGAIN_WAVE_MAX_COST) roster.push({ type, weight: entry.weight });
    }
  }
  return roster;
}

/**
 * Tiles just outside the room's openings (or the opening itself when nothing is open beyond it),
 * farthest from the nearest standing player first, so the dark comes from where the party looks least.
 */
function doorwaySpawns(session: Session, room: RoomState): Vector2[] {
  const spawns: Vector2[] = [];
  const edge = (x: number, y: number, outward: Vector2): void => {
    const doorway = { x, y };
    if (!isFloor(session.dungeon, doorway)) return;
    const beyond = { x: x + outward.x, y: y + outward.y };
    spawns.push(isFloor(session.dungeon, beyond) ? beyond : doorway);
  };
  for (let x = room.x; x < room.x + room.width; x += 1) {
    edge(x, room.y, { x: 0, y: -1 });
    edge(x, room.y + room.height - 1, { x: 0, y: 1 });
  }
  for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
    edge(room.x, y, { x: -1, y: 0 });
    edge(room.x + room.width - 1, y, { x: 1, y: 0 });
  }

  const standing = [...session.players.values()].filter((player) => player.connected && isSpawned(player) && !isDown(player));
  const nearest = (spot: Vector2): number => Math.min(...standing.map((player) => distance(player.position, spot)), Infinity);
  return spawns.sort((a, b) => nearest(b) - nearest(a) || a.y - b.y || a.x - b.x);
}

/** Sends the dark's wave, scaled to the party, hunting from the shrine's doorways. */
function sendWave(session: Session, room: RoomState, now: number): void {
  const roster = waveRoster(session);
  if (roster.length === 0) return;

  const party = [...session.players.values()].filter((player) => player.connected && isSpawned(player) && !isDown(player));
  const count = party.length * DARK_BARGAIN_WAVE_PER_PLAYER;
  const spawns = doorwaySpawns(session, room);
  if (spawns.length === 0) return;

  const bodies = party.map((player) => player.position);
  for (let index = 0; index < count; index += 1) {
    const spot = spawns[index % spawns.length]!;
    const place = [
      spot,
      ...[-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: spot.x + dx, y: spot.y + dy }))),
    ].find((candidate) => isOpen(session.dungeon, bodies, candidate));
    if (!place) continue;

    const { type } = session.lootRng.weighted(roster);
    const monster = monsterInstance(type, place, session.lootRng.uuid());
    session.dungeon.monsters.push(monster);
    session.monsterPosts.set(monster.id, { spawn: { ...place }, engaged: true, lastThreatAt: now, calledUntil: now + ELITE_CALL_MS });
  }
}

/** Advances every shrine's bargain: starts it, breaks it, or strikes it when the dark has run its course. */
export function advanceDarkBargains(session: Session, now: number): void {
  if (session.location !== "dungeon") return;

  for (const room of session.dungeon.rooms) {
    if (room.kind !== "shrine") continue;
    const bargain = session.darkBargains.get(room.id);
    if (bargain && bargain.status !== "counting") continue;

    const inside = playersIn(session, room);
    if (inside.some(burning)) {
      // A lit torch breaks a bargain already counting; before that the room is simply lit.
      if (bargain) session.darkBargains.set(room.id, { ...bargain, status: "broken" });
      continue;
    }

    // The dark needs someone on their feet who chose to put a carried torch out.
    const offered = inside.some((player) => !isDown(player) && player.carryingTorch);
    if (!offered) {
      session.darkBargains.delete(room.id);
      continue;
    }

    const since = bargain?.since ?? now;
    const remainingMs = Math.max(0, DARK_BARGAIN_MS - (now - since));
    if (remainingMs > 0) {
      session.darkBargains.set(room.id, { status: "counting", since, remainingMs });
      continue;
    }

    session.darkBargains.set(room.id, { status: "struck", since, remainingMs: 0 });
    improveChests(session, room);
    sendWave(session, room, now);
  }
}

/** The bargain in the shrine room this viewer stands in, for their snapshot; undefined elsewhere. */
export function darkBargainFor(session: Session, viewer: SessionPlayer): DarkBargainState | undefined {
  const room = roomAt(session.dungeon.rooms, viewer.position);
  const bargain = room && session.darkBargains.get(room.id);
  return room && bargain ? { roomId: room.id, status: bargain.status, remainingMs: Math.ceil(bargain.remainingMs) } : undefined;
}
