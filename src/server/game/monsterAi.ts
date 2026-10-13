import { MONSTER_HEARING_RANGE, MONSTER_LEASH_MS } from "../../shared/constants/game.js";
import { distance, isOpen, normalizeDirection, tileOf } from "../../shared/game/movement.js";
import type { MonsterState, Vector2 } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, monsterStatsFor, type MonsterStats } from "./dungeonState.js";
import { FlowField, walkableGridFor, type WalkableGrid } from "./flowField.js";
import { hasLineOfSight } from "./visibility.js";

/** What the server remembers about one monster between ticks. Never sent to clients. */
export interface MonsterPost {
  /** Where the monster stood the first time it acted, which is where it spawned. */
  spawn: Vector2;
  /** Hunting: it noticed someone, and has not yet lost every player for `MONSTER_LEASH_MS`. */
  engaged: boolean;
  /** The last time a player was inside its aggro range while it hunted. */
  lastThreatAt: number;
}

/**
 * A walk around walls is longer than the straight line. A route up to this many times the aggro
 * range is still followed; one longer than that is treated as no route at all, which is what stops
 * a player sealed away by a detour from holding a monster to them forever.
 */
const PATH_REACH_FACTOR = 1.5;

/** Close enough to spawn to count as home. */
const HOME_TOLERANCE = 0.25;

/** The reusable search buffers for one world, kept so a tick allocates nothing. */
interface Fields {
  hunt: FlowField;
  home: FlowField;
}

const fieldCache = new WeakMap<WalkableGrid, Fields>();

function fieldsFor(grid: WalkableGrid): Fields {
  let fields = fieldCache.get(grid);
  if (!fields) {
    fields = {
      hunt: new FlowField(grid.width, grid.height),
      home: new FlowField(grid.width, grid.height),
    };
    fieldCache.set(grid, fields);
  }
  return fields;
}

/**
 * Decides where monsters look and where they walk for one simulation tick.
 *
 * One distance field per tick is flooded from every standing, connected player, so any number of
 * monsters steer by the same search rather than each running their own. It is flooded only when a
 * monster actually needs to go around something, so a quiet dungeon costs nothing.
 */
export class MonsterPlanner {
  readonly #session: Session;
  readonly #grid: WalkableGrid;
  readonly #fields: Fields;
  readonly #targets: SessionPlayer[] = [];
  readonly #blockers: Vector2[] = [];
  #hunting = false;

  constructor(session: Session) {
    this.#session = session;
    this.#grid = walkableGridFor(session.dungeon);
    this.#fields = fieldsFor(this.#grid);

    for (const player of session.players.values()) {
      if (isDown(player)) continue;
      this.#blockers.push(player.position);
      // Disconnected players are not hunted: a dropped connection should not come back to a wipe.
      if (player.connected) this.#targets.push(player);
    }
  }

  /**
   * The player this monster is after, if any. Someone is noticed when they are inside aggro range
   * and either seen or very close, so a wall hides a player from a monster as it does from the
   * party. A monster already hunting keeps any player in range even around a corner, provided a
   * route to them exists, because that is the point of walking round to find them.
   */
  target(monster: MonsterState, stats: MonsterStats, now: number): SessionPlayer | undefined {
    const post = this.#postFor(monster, now);

    let nearest: SessionPlayer | undefined;
    let nearestDistance = stats.aggroRange;
    for (const player of this.#targets) {
      const gap = distance(monster.position, player.position);
      if (gap > nearestDistance) continue;

      const noticed =
        gap <= MONSTER_HEARING_RANGE ||
        hasLineOfSight(this.#session.dungeon, monster.position, player.position);
      if (!noticed && !(post.engaged && this.#canReachHunted(monster))) continue;

      nearest = player;
      nearestDistance = gap;
    }

    if (nearest) {
      post.engaged = true;
      post.lastThreatAt = now;
    } else if (post.engaged && now - post.lastThreatAt >= MONSTER_LEASH_MS) {
      post.engaged = false;
    }
    return nearest;
  }

  /** Moves toward a player: straight when it can see them, round the walls when it cannot. */
  chase(monster: MonsterState, goal: Vector2, stepDistance: number): void {
    if (stepDistance <= 0) return;

    if (
      hasLineOfSight(this.#session.dungeon, monster.position, goal) &&
      this.#stepDirect(monster, goal, stepDistance)
    ) {
      return;
    }

    this.#hunt();
    this.#stepAlong(this.#fields.hunt, monster, stepDistance);
  }

  /** Backs directly away from a point, for a ranged monster that has been crowded. */
  retreat(monster: MonsterState, from: Vector2, stepDistance: number): void {
    if (stepDistance <= 0) return;

    const away = normalizeDirection({
      x: monster.position.x - from.x,
      y: monster.position.y - from.y,
    });
    if (!away) return;

    this.#stepDirect(monster, {
      x: monster.position.x + away.x * stepDistance,
      y: monster.position.y + away.y * stepDistance,
    }, stepDistance);
  }

  /** Walks a monster that has given up back to where it spawned. */
  returnHome(monster: MonsterState, now: number, stepDistance: number): void {
    const post = this.#postFor(monster, now);
    if (post.engaged || stepDistance <= 0) return;

    const gap = distance(monster.position, post.spawn);
    if (gap <= HOME_TOLERANCE) return;

    if (
      hasLineOfSight(this.#session.dungeon, monster.position, post.spawn) &&
      this.#stepDirect(monster, post.spawn, stepDistance)
    ) {
      return;
    }

    const { home } = this.#fields;
    home.compute(this.#grid, [post.spawn], Math.ceil(gap * PATH_REACH_FACTOR) + 8);
    if (!this.#stepAlong(home, monster, stepDistance)) this.#stepDirect(monster, post.spawn, stepDistance);
  }

  #postFor(monster: MonsterState, now: number): MonsterPost {
    let post = this.#session.monsterPosts.get(monster.id);
    if (!post) {
      post = { spawn: { ...monster.position }, engaged: false, lastThreatAt: now };
      this.#session.monsterPosts.set(monster.id, post);
    }
    return post;
  }

  /** Floods the shared field from every target, once per tick, reaching as far as any monster hunts. */
  #hunt(): void {
    if (this.#hunting) return;
    this.#hunting = true;

    let reach = 0;
    for (const other of this.#session.dungeon.monsters) {
      if (other.alive) reach = Math.max(reach, monsterStatsFor(other).aggroRange);
    }
    this.#fields.hunt.compute(
      this.#grid,
      this.#targets.map((player) => player.position),
      Math.ceil(reach * PATH_REACH_FACTOR),
    );
  }

  #canReachHunted(monster: MonsterState): boolean {
    this.#hunt();
    const tile = tileOf(monster.position);
    return this.#fields.hunt.distanceAt(tile.x, tile.y) !== Number.POSITIVE_INFINITY;
  }

  /** One step along the field toward its sources, trying each tile that gets closer. */
  #stepAlong(field: FlowField, monster: MonsterState, stepDistance: number): boolean {
    const tile = tileOf(monster.position);
    return field.descend(this.#grid, tile.x, tile.y, (x, y) =>
      this.#stepDirect(monster, { x, y }, stepDistance),
    );
  }

  /** Moves straight at the goal, sliding along one axis when the direct path is blocked. */
  #stepDirect(monster: MonsterState, goal: Vector2, stepDistance: number): boolean {
    const dx = goal.x - monster.position.x;
    const dy = goal.y - monster.position.y;
    // Never step past the goal, which would shuffle a monster back and forth over a tile centre.
    const step = Math.min(stepDistance, Math.hypot(dx, dy));
    const heading = normalizeDirection({ x: dx, y: dy });
    if (!heading) return false;

    const { x, y } = monster.position;
    const candidates = [
      { x: x + heading.x * step, y: y + heading.y * step },
      { x: x + Math.sign(heading.x) * step, y },
      { x, y: y + Math.sign(heading.y) * step },
    ];

    const next = candidates.find(
      (candidate) =>
        (candidate.x !== x || candidate.y !== y) &&
        isOpen(this.#session.dungeon, this.#blockers, candidate, undefined, monster),
    );
    if (!next) return false;

    monster.position = next;
    return true;
  }
}
