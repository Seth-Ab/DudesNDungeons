import {
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_STAMINA,
} from "../../src/shared/constants/game.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";

/**
 * The Ember Vault is authored content, not a generated run, so its entity ids and positions are
 * fixed. That is what lets these tests assert on a known world; generated dungeons are covered
 * separately in `generation.test.ts` by seed instead.
 */
export const TEST_DUNGEON_ID = "ember-vault";

/** Pinned Ember Vault entity ids, from `content/dungeons/ember-vault.json`. */
export const ASH_IMP_ID = "11111111-1111-4111-8111-111111111111";
export const CINDER_SLIME_ID = "22222222-2222-4222-8222-222222222222";
export const COPPER_KEY_ID = "33333333-3333-4333-8333-333333333333";
export const MINOR_TONIC_ID = "44444444-4444-4444-8444-444444444444";
export const WARDING_SALVE_ID = "99999999-9999-4999-8999-999999999999";
export const VAULT_DOOR_ID = "55555555-5555-4555-8555-555555555555";
export const VAULT_EXIT_ID = "66666666-6666-4666-8666-666666666666";

export function testPlayer(id: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    id,
    name: id,
    position: { x: 2, y: 2 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: PLAYER_BASE_RESISTANCE,
    stamina: PLAYER_MAX_STAMINA,
    ready: false,
    connected: true,
    inventory: [],
    carryingTorch: true,
    discoveredTiles: new Set(),
    resumeToken: id.padEnd(32, "0"),
    disconnectedAt: null,
    nextMoveAt: null,
    nextAttackAt: null,
    respawnAt: null,
    enteredDungeonAt: 0,
    ...overrides,
  };
}

export function testSession(players: SessionPlayer[]): Session {
  const built = buildDungeon({ dungeonId: TEST_DUNGEON_ID });

  return {
    id: "session-1",
    roomCode: "ROOM01",
    createdAt: 0,
    dungeon: built.dungeon,
    spawnPoints: built.spawnPoints,
    seed: built.seed,
    tick: 0,
    players: new Map(players.map((member) => [member.id, member])),
    simulatedAt: null,
    monsterCooldowns: new Map(),
  };
}

export function monster(session: Session, id: string) {
  const found = session.dungeon.monsters.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No monster ${id}`);
  return found;
}
