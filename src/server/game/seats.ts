import { INTERACT_RANGE } from "../../shared/constants/game.js";
import { SEAT_FACING_VECTORS } from "../../shared/constants/scenery.js";
import { distance, isFloor, isOpen, tileOf } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { EntityId, MapSeat, Vector2 } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { blockingPlayerPositions, isDown, isSpawned } from "./dungeonState.js";

/**
 * Sitting on hub benches and the fountain rim.
 *
 * A seat sits on a solid tile, so a sitter is somewhere nobody could walk to. Every way off one
 * goes through `standUp`, which puts them back on the floor the seat faces rather than letting a
 * step carry them on through the bench.
 */

export type SeatResult = { ok: true } | { ok: false; reason: RejectionReason };

/** How many world tiles past a seat's own to look for the floor it faces. A wall is never thicker. */
const STAND_SEARCH_TILES = 8;

/**
 * Where a sitter may stand up to, best first: straight out from the seat, then a little to either
 * side along the edge, then a step further out, so a friend standing in front does not trap them.
 */
const STAND_OFFSETS: readonly { out: number; along: number }[] = [
  { out: 0, along: 0 },
  { out: 0, along: 0.75 },
  { out: 0, along: -0.75 },
  { out: 0, along: 1.5 },
  { out: 0, along: -1.5 },
  { out: 1, along: 0 },
];

export function seatById(session: Session, seatId: EntityId): MapSeat | undefined {
  return session.dungeon.map.seats?.find((seat) => seat.id === seatId);
}

function seatTaken(session: Session, seat: MapSeat): boolean {
  return [...session.players.values()].some((player) => player.seatId === seat.id);
}

/**
 * The first floor in front of a seat: straight out along its facing, on the first walkable world
 * tile, keeping the seat's position along the edge. Content guarantees the tile it faces is floor.
 */
export function standPointFor(session: Session, seat: MapSeat): Vector2 {
  const toward = SEAT_FACING_VECTORS[seat.facing];
  const tile = tileOf(seat);

  for (let step = 1; step <= STAND_SEARCH_TILES; step += 1) {
    const x = toward.x === 0 ? seat.x : tile.x + toward.x * step;
    const y = toward.y === 0 ? seat.y : tile.y + toward.y * step;
    if (isFloor(session.dungeon, { x, y })) return { x, y };
  }

  return { x: seat.x, y: seat.y };
}

/**
 * Sits a player on a seat. They must be standing in the world (designed, not downed, not carrying
 * or being carried, not already seated), within reach of it, and nobody else may be on it.
 */
export function sitOn(session: Session, player: SessionPlayer, seat: MapSeat): SeatResult {
  if (!isSpawned(player) || isDown(player)) return { ok: false, reason: "notPermitted" };
  if (player.carryingPlayerId !== null || player.carriedByPlayerId !== null) {
    return { ok: false, reason: "notPermitted" };
  }
  if (player.seatId !== null) return { ok: false, reason: "notPermitted" };
  if (distance(player.position, seat) > INTERACT_RANGE) return { ok: false, reason: "outOfRange" };
  if (seatTaken(session, seat)) return { ok: false, reason: "blocked" };

  player.seatId = seat.id;
  player.position = { x: seat.x, y: seat.y };
  player.facing = { ...SEAT_FACING_VECTORS[seat.facing] };
  return { ok: true };
}

/**
 * Stands a seated player up onto the floor their seat faces, choosing a spot nobody else is on.
 * When every spot is taken they stand at the first anyway: players who overlap can step apart, and
 * leaving them on the bench would strand them inside it. Safe to call on a player who is standing.
 */
export function standUp(session: Session, player: SessionPlayer): void {
  if (player.seatId === null) return;

  const seat = seatById(session, player.seatId);
  player.seatId = null;
  if (!seat) return;

  const toward = SEAT_FACING_VECTORS[seat.facing];
  const along = { x: -toward.y, y: toward.x };
  const base = standPointFor(session, seat);
  const others = blockingPlayerPositions(session, player);
  const candidates = STAND_OFFSETS.map(({ out, along: shift }) => ({
    x: base.x + toward.x * out + along.x * shift,
    y: base.y + toward.y * out + along.y * shift,
  }));

  player.position = candidates.find((candidate) => isOpen(session.dungeon, others, candidate)) ?? base;
}
