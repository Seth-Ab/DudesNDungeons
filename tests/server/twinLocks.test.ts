import { describe, expect, it } from "vitest";
import { gameContent, type GameContent } from "../../src/server/content/loadContent.js";
import type { LootTableDefinition } from "../../src/server/content/schema.js";
import { chestInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { resolveTwinLocks, TWIN_LOCK_WINDOW_MS } from "../../src/server/game/twinLocks.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { captureRun, restoreRun } from "../../src/server/saves/roomSave.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { chestStateSchema, type ChestState } from "../../src/shared/types/core.js";
import { TEST_SEED, at, testPlayer, testSession } from "./fixtures.js";

const CHEST_ID = "d0000000-0000-4000-8000-000000000000";

/** A guaranteed pair of tonics, so a test can count exactly what one opening spills. */
const TWO_TONICS: LootTableDefinition = {
  id: "two-tonics",
  rolls: 2,
  entries: [{ itemId: "minor-tonic", weight: 1 }],
  nothingWeight: 0,
};

function contentWithTable(table: LootTableDefinition): GameContent {
  const base = gameContent();
  return { ...base, lootTables: new Map([...base.lootTables, [table.id, table]]) };
}

/** The Ember Vault with one twin-lock chest at authored tile (4, 4), and alpha and bravo either side of it. */
function vaultWithTwinLock(): { session: Session; chest: ChestState } {
  const content = contentWithTable(TWO_TONICS);
  const request = { dungeonId: "ember-vault", seed: TEST_SEED, content };
  const built = buildDungeon(request);
  const session = testSession([
    testPlayer("alpha", { position: at(4, 4, -0.9) }),
    testPlayer("bravo", { position: at(4, 4, 0.9) }),
  ]);
  session.dungeon = built.dungeon;
  session.runDungeon = request;
  session.lootRng = lootRngFor(built.seed, "ember-vault");

  const chest = chestInstance(TWO_TONICS.id, at(4, 4), CHEST_ID, false, true);
  session.dungeon.chests.push(chest);
  return { session, chest };
}

describe("a Twin-lock Chest", () => {
  it("opens when two players turn a keyhole within a second of each other", () => {
    const { session, chest } = vaultWithTwinLock();
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID, 10_000)).toEqual({ ok: true });
    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "alpha" });
    expect(session.dungeon.loot).toHaveLength(before);

    expect(interact(session, "bravo", CHEST_ID, 10_000 + TWIN_LOCK_WINDOW_MS)).toEqual({ ok: true });
    expect(chest).toMatchObject({ opened: true, keyTurnedBy: null });
    expect(session.dungeon.loot.slice(before).map((loot) => loot.name)).toEqual(["Minor Tonic", "Minor Tonic"]);
    expect(session.twinLockTurns.size).toBe(0);
  });

  it("does not open for one player turning both keyholes", () => {
    const { session, chest } = vaultWithTwinLock();

    interact(session, "alpha", CHEST_ID, 0);
    expect(interact(session, "alpha", CHEST_ID, 200)).toEqual({ ok: true });

    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "alpha" });
    // Turning again restarts alpha's second, so bravo still has a full window from there.
    expect(interact(session, "bravo", CHEST_ID, 200 + TWIN_LOCK_WINDOW_MS)).toEqual({ ok: true });
    expect(chest.opened).toBe(true);
  });

  it("resets when the second key comes too late, and the late turn becomes the first", () => {
    const { session, chest } = vaultWithTwinLock();

    interact(session, "alpha", CHEST_ID, 0);
    resolveTwinLocks(session, TWIN_LOCK_WINDOW_MS + 1);
    expect(chest.keyTurnedBy).toBeNull();
    expect(session.twinLockTurns.size).toBe(0);

    // Even without the tick between them, a turn past the window starts over rather than opening.
    interact(session, "alpha", CHEST_ID, 5_000);
    expect(interact(session, "bravo", CHEST_ID, 5_000 + TWIN_LOCK_WINDOW_MS + 1)).toEqual({ ok: true });
    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "bravo" });

    expect(interact(session, "alpha", CHEST_ID, 5_000 + TWIN_LOCK_WINDOW_MS + 2)).toEqual({ ok: true });
    expect(chest.opened).toBe(true);
  });

  it("lets go of a keyhole when its turner disconnects", () => {
    const { session, chest } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);
    session.players.get("alpha")!.connected = false;

    resolveTwinLocks(session, 100);
    expect(chest.keyTurnedBy).toBeNull();

    expect(interact(session, "bravo", CHEST_ID, 200)).toEqual({ ok: true });
    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "bravo" });
  });

  it("does not open from a turn left by a player who disconnected before the tick saw it", () => {
    const { session, chest } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);
    session.players.get("alpha")!.connected = false;

    interact(session, "bravo", CHEST_ID, 100);
    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "bravo" });
  });

  it("lets go of a keyhole when its turner goes down or leaves the party", () => {
    const { session, chest } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);
    session.players.get("alpha")!.health = 0;
    resolveTwinLocks(session, 100);
    expect(chest.keyTurnedBy).toBeNull();

    interact(session, "bravo", CHEST_ID, 200);
    session.players.delete("bravo");
    resolveTwinLocks(session, 300);
    expect(chest.keyTurnedBy).toBeNull();
    expect(session.twinLockTurns.size).toBe(0);
  });

  it("refuses an invalid turn and leaves the lock as it was", () => {
    const { session, chest } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);

    // Out of reach.
    session.players.get("bravo")!.position = at(2, 2);
    expect(interact(session, "bravo", CHEST_ID, 100)).toEqual({ ok: false, reason: "outOfRange" });
    // Downed or disconnected players cannot act at all.
    session.players.get("bravo")!.position = at(4, 4, 0.9);
    session.players.get("bravo")!.health = 0;
    expect(interact(session, "bravo", CHEST_ID, 100)).toEqual({ ok: false, reason: "notPermitted" });
    // An altar's choice means nothing on a chest.
    session.players.get("bravo")!.health = 100;
    expect(interact(session, "bravo", CHEST_ID, 100, "minor-tonic")).toEqual({ ok: false, reason: "notPermitted" });
    // Someone not in the session.
    expect(interact(session, "stranger", CHEST_ID, 100)).toEqual({ ok: false, reason: "notPermitted" });

    expect(chest).toMatchObject({ opened: false, keyTurnedBy: "alpha" });
    expect(session.twinLockTurns.get(CHEST_ID)).toEqual({ playerId: "alpha", at: 0 });
  });

  it("refuses every turn once it is open", () => {
    const { session, chest } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);
    interact(session, "bravo", CHEST_ID, 100);
    const after = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID, 200)).toEqual({ ok: false, reason: "notPermitted" });
    expect(chest.keyTurnedBy).toBeNull();
    expect(session.dungeon.loot).toHaveLength(after);
  });

  it("shows who turned a keyhole in the snapshot", () => {
    const { session } = vaultWithTwinLock();
    interact(session, "alpha", CHEST_ID, 0);

    const frame = visibilityFrameForPlayer(session, session.players.get("bravo")!);
    expect(frame.dungeon.chests.find((chest) => chest.id === CHEST_ID)).toMatchObject({
      twinLock: true,
      keyTurnedBy: "alpha",
    });
  });

  it("forgets a turned keyhole when the party leaves the dungeon", () => {
    const { session } = vaultWithTwinLock();
    session.location = "dungeon";
    interact(session, "alpha", CHEST_ID, 0);

    returnToHub(session, true);
    expect(session.twinLockTurns.size).toBe(0);
  });

  it("loads a saved run with both keyholes unturned", () => {
    const { session } = vaultWithTwinLock();
    session.location = "dungeon";
    interact(session, "alpha", CHEST_ID, 0);

    const run = captureRun(session, 100, "test");
    const restored = vaultWithTwinLock().session;
    restoreRun(restored, run, 50_000);

    expect(restored.twinLockTurns.size).toBe(0);
    expect(restored.dungeon.chests.find((chest) => chest.id === CHEST_ID)).toMatchObject({
      twinLock: true,
      opened: false,
      keyTurnedBy: null,
    });
  });

  it("reads a chest saved before twin locks as an ordinary one", () => {
    const saved = { id: CHEST_ID, lootTableId: "vault-chest", position: at(4, 4), opened: false, locked: false };

    expect(chestStateSchema.parse(saved)).toEqual({ ...saved, twinLock: false, keyTurnedBy: null });
  });
});
