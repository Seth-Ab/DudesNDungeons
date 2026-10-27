import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { liftPlayer } from "../../src/server/game/carrying.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import { IDOL_ITEM_ID, lootInstance, puzzleInstance } from "../../src/server/game/dungeonBuilder.js";
import { monsterStatsFor, movePlayer } from "../../src/server/game/dungeonState.js";
import { resolveIdols } from "../../src/server/game/idols.js";
import { dropItem, giveItem, interact, pickupItem, useItem } from "../../src/server/game/items.js";
import { MonsterPlanner } from "../../src/server/game/monsterAi.js";
import { resolvePuzzles } from "../../src/server/game/puzzles.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { captureRun, restoreRun } from "../../src/server/saves/roomSave.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { IDOL_STAMINA_COST, MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import { PLAYER_STEP_DISTANCE, distance } from "../../src/shared/game/movement.js";
import { puzzleStateSchema, type PuzzleState } from "../../src/shared/types/core.js";
import { ASH_IMP_ID, at, monster, testPlayer, testSession } from "./fixtures.js";

const content = loadContent();
const type = content.puzzles.get("idol-carry")!;
const idolItem = content.items.get(IDOL_ITEM_ID)!;
const ALTAR = at(3, 6);
const IDOL_AT = at(12, 6);
const IDOL_ID = "abababab-abab-4bab-8bab-abababababab";
const ALTAR_ID = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";

/** The Ember Vault's bottom row with an altar at its west end and the idol at its east end. */
function sanctum(names: string[] = ["alpha"]): { session: Session; altar: PuzzleState } {
  const session = testSession(names.map((name) => testPlayer(name, { position: { ...IDOL_AT } })));
  session.dungeon.monsters = [];
  session.dungeon.loot = [lootInstance(idolItem, IDOL_AT, IDOL_ID)];
  const altar = puzzleInstance(type, [ALTAR], ALTAR_ID);
  session.dungeon.puzzles = [altar];
  return { session, altar };
}

const idolsOnFloor = (session: Session) => session.dungeon.loot.filter((loot) => loot.kind === "idol" && !loot.pickedUp);

describe("the Idol Carry", () => {
  it("is carried by a solo player to the altar, set on it, and pays out the boss key", () => {
    const { session, altar } = sanctum();
    const alpha = session.players.get("alpha")!;

    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: true });
    expect(alpha.stamina).toBe(100 - IDOL_STAMINA_COST);
    expect(alpha.inventory.map((item) => item.kind)).toEqual(["idol"]);

    alpha.position = { ...ALTAR };
    expect(interact(session, "alpha", ALTAR_ID, 0)).toEqual({ ok: true });
    expect(alpha.inventory).toEqual([]);
    expect(idolsOnFloor(session).map((loot) => loot.position)).toEqual([ALTAR]);

    resolvePuzzles(session, 0);
    expect(altar.plates[0]!.held).toBe(true);
    resolvePuzzles(session, type.holdMs);
    expect(altar.phase).toBe("solved");
    // The altar keeps the idol, and the reward lies on it. Nobody pulled a lever.
    expect(idolsOnFloor(session)).toEqual([]);
    expect(session.dungeon.loot.map((loot) => loot.name)).toContain("Boss Key");
    expect(alpha.runStats.leverPuzzlesSolved).toBe(0);
  });

  it("is never held by a player standing on the altar", () => {
    const { session, altar } = sanctum(["alpha", "bravo"]);
    session.players.get("alpha")!.position = { ...ALTAR };

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs * 2);
    expect(altar.plates[0]!.held).toBe(false);
    expect(altar.phase).toBe("idle");
  });

  it("solves when the idol is simply dropped on the altar", () => {
    const { session, altar } = sanctum();
    const alpha = session.players.get("alpha")!;
    pickupItem(session, "alpha", IDOL_ID);
    alpha.position = at(3, 6, 0.6, 0);
    expect(dropItem(session, "alpha", IDOL_ID)).toEqual({ ok: true });

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs);
    expect(altar.phase).toBe("solved");
  });

  it("halves the carrier's step and takes their swing", () => {
    const { session } = sanctum();
    const alpha = session.players.get("alpha")!;
    pickupItem(session, "alpha", IDOL_ID);

    alpha.position = at(6, 6);
    const from = { ...alpha.position };
    expect(movePlayer(session, "alpha", { x: -1, y: 0 }, 0)).toMatchObject({ ok: true });
    expect(distance(from, alpha.position)).toBeCloseTo(PLAYER_STEP_DISTANCE / 2);
    expect(resolvePlayerAttack(session, "alpha", { x: -1, y: 0 }, null, 0)).toEqual({ ok: false, reason: "notPermitted" });

    // Set down, the same player walks and swings as usual.
    expect(dropItem(session, "alpha", IDOL_ID)).toEqual({ ok: true });
    const next = { ...alpha.position };
    movePlayer(session, "alpha", { x: -1, y: 0 }, 1000);
    expect(distance(next, alpha.position)).toBeCloseTo(PLAYER_STEP_DISTANCE);
    expect(resolvePlayerAttack(session, "alpha", { x: -1, y: 0 }, null, 1000).ok).toBe(true);
  });

  it("draws a monster to the carrier over a nearer player", () => {
    const session = testSession([testPlayer("alpha"), testPlayer("bravo")]);
    const imp = monster(session, ASH_IMP_ID);
    session.dungeon.monsters = [imp];
    const alpha = session.players.get("alpha")!;
    const bravo = session.players.get("bravo")!;
    bravo.position = { x: imp.position.x - 1, y: imp.position.y };
    alpha.position = { x: imp.position.x + 3, y: imp.position.y };

    expect(new MonsterPlanner(session).target(imp, monsterStatsFor(imp), 0)?.id).toBe("bravo");

    alpha.inventory = [{ id: IDOL_ID, name: idolItem.name, kind: "idol" }];
    expect(new MonsterPlanner(session).target(imp, monsterStatsFor(imp), 0)?.id).toBe("alpha");
  });

  it("refuses invalid interacts and lifts, changing nothing", () => {
    const { session, altar } = sanctum(["alpha", "bravo"]);
    const alpha = session.players.get("alpha")!;
    const bravo = session.players.get("bravo")!;

    // An altar without an idol in hand.
    alpha.position = { ...ALTAR };
    expect(interact(session, "alpha", ALTAR_ID, 0)).toEqual({ ok: false, reason: "notPermitted" });

    // Too tired to lift it, then too far from it, then with no slot for it.
    alpha.position = { ...IDOL_AT };
    alpha.stamina = IDOL_STAMINA_COST - 1;
    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: false, reason: "exhausted" });
    alpha.stamina = 100;
    alpha.position = { ...ALTAR };
    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: false, reason: "outOfRange" });
    alpha.position = { ...IDOL_AT };
    alpha.inventory = Array.from({ length: MAX_INVENTORY_SIZE }, (_, index) => ({
      id: `fill-${index}`,
      name: "Copper Key",
      kind: "key" as const,
      itemId: "copper-key",
    }));
    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: false, reason: "notPermitted" });
    alpha.inventory = [];
    expect(idolsOnFloor(session)).toHaveLength(1);
    expect(alpha.stamina).toBe(100);

    // Carrying, it cannot be handed over, used, or joined by a body or a second idol.
    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: true });
    expect(giveItem(session, "alpha", IDOL_ID, "bravo")).toEqual({ ok: false, reason: "notPermitted" });
    expect(useItem(session, "alpha", IDOL_ID)).toEqual({ ok: false, reason: "notPermitted" });
    bravo.health = 0;
    expect(liftPlayer(session, "alpha", "bravo")).toEqual({ ok: false, reason: "notPermitted" });
    session.dungeon.loot.push(lootInstance(idolItem, IDOL_AT, "efefefef-efef-4fef-8fef-efefefefefef"));
    expect(pickupItem(session, "alpha", "efefefef-efef-4fef-8fef-efefefefefef")).toEqual({ ok: false, reason: "notPermitted" });

    // Out of the altar's reach, and at a puzzle that is not an altar.
    expect(interact(session, "alpha", ALTAR_ID, 0)).toEqual({ ok: false, reason: "outOfRange" });
    const levers = puzzleInstance(content.puzzles.get("paired-levers")!, [{ ...IDOL_AT }], "12121212-1212-4212-8212-121212121212");
    session.dungeon.puzzles.push(levers);
    expect(interact(session, "alpha", levers.id, 0)).toEqual({ ok: false, reason: "notPermitted" });
    expect(alpha.inventory.map((item) => item.id)).toEqual([IDOL_ID]);

    // A downed carrier cannot set it down on the altar either; and a solved altar takes no second idol.
    alpha.position = { ...ALTAR };
    alpha.health = 0;
    expect(interact(session, "alpha", ALTAR_ID, 0)).toEqual({ ok: false, reason: "notPermitted" });
    alpha.health = 100;
    altar.phase = "solved";
    expect(interact(session, "alpha", ALTAR_ID, 0)).toEqual({ ok: false, reason: "notPermitted" });
    expect(alpha.inventory.map((item) => item.id)).toEqual([IDOL_ID]);
  });

  it("is set down where a carrier disconnects, for an ally to carry on", () => {
    const { session, altar } = sanctum(["alpha", "bravo"]);
    const alpha = session.players.get("alpha")!;
    const bravo = session.players.get("bravo")!;
    pickupItem(session, "alpha", IDOL_ID);
    alpha.position = at(7, 6);

    alpha.connected = false;
    resolveIdols(session);
    expect(alpha.inventory).toEqual([]);
    expect(idolsOnFloor(session).map((loot) => [loot.id, loot.position])).toEqual([[IDOL_ID, at(7, 6)]]);
    // One entry for the idol, not a picked-up one left behind beside the new one.
    expect(session.dungeon.loot.filter((loot) => loot.id === IDOL_ID)).toHaveLength(1);

    bravo.position = at(7, 6);
    expect(pickupItem(session, "bravo", IDOL_ID)).toEqual({ ok: true });
    bravo.position = { ...ALTAR };
    expect(interact(session, "bravo", ALTAR_ID, 0)).toEqual({ ok: true });
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs);
    expect(altar.phase).toBe("solved");
  });

  it("is set down where a carrier goes down", () => {
    const { session } = sanctum();
    const alpha = session.players.get("alpha")!;
    pickupItem(session, "alpha", IDOL_ID);
    alpha.health = 0;

    resolveIdols(session);
    expect(alpha.inventory).toEqual([]);
    expect(idolsOnFloor(session)).toHaveLength(1);
  });

  it("resets the hold when the idol is lifted off the altar early", () => {
    const { session, altar } = sanctum();
    const alpha = session.players.get("alpha")!;
    pickupItem(session, "alpha", IDOL_ID);
    alpha.position = { ...ALTAR };
    interact(session, "alpha", ALTAR_ID, 0);

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs / 2);
    expect(altar.progress).toBeCloseTo(0.5);

    expect(pickupItem(session, "alpha", IDOL_ID)).toEqual({ ok: true });
    resolvePuzzles(session, type.holdMs / 2 + 50);
    expect(altar).toMatchObject({ phase: "idle", progress: 0 });
    expect(altar.plates[0]!.held).toBe(false);

    // Set back on it, the hold starts over from nothing.
    alpha.stamina = 100;
    interact(session, "alpha", ALTAR_ID, 1000);
    resolvePuzzles(session, 1000);
    resolvePuzzles(session, 1000 + type.holdMs - 1);
    expect(altar.phase).toBe("idle");
    resolvePuzzles(session, 1000 + type.holdMs);
    expect(altar.phase).toBe("solved");
  });

  it("is not banked when its carrier escapes", () => {
    const { session } = sanctum();
    pickupItem(session, "alpha", IDOL_ID);
    returnToHub(session, true);
    expect(session.vault.items.some((item) => item.kind === "idol")).toBe(false);
  });

  it("survives a save with the idol on the floor and the altar still an altar", () => {
    const { session } = sanctum();
    const alpha = session.players.get("alpha")!;
    pickupItem(session, "alpha", IDOL_ID);
    alpha.position = at(8, 6);
    dropItem(session, "alpha", IDOL_ID);

    const restored = sanctum().session;
    restoreRun(restored, captureRun(session, 100, "test"), 50_000);

    expect(restored.dungeon.puzzles[0]).toMatchObject({ id: ALTAR_ID, heldBy: "idol", phase: "idle" });
    expect(idolsOnFloor(restored).map((loot) => loot.position)).toEqual([at(8, 6)]);
  });

  it("reads a puzzle saved before idols as one players hold", () => {
    const saved = { id: ALTAR_ID, typeId: "paired-levers", name: "Paired Levers", radius: 1.8, phase: "idle", plates: [], progress: 0 };
    expect(puzzleStateSchema.parse(saved).heldBy).toBe("players");
  });
});
