import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import type { LootTableDefinition } from "../../src/server/content/schema.js";
import { chestInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { NO_MARKERS, rememberMarkers } from "../../src/client/state/minimap.js";
import type { ChestState } from "../../src/shared/types/core.js";
import { isOpen } from "../../src/shared/game/movement.js";
import { damageMonster } from "../../src/server/game/monsterDamage.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { TEST_SEED, at, testPlayer, testSession } from "./fixtures.js";

const CHEST_ID = "c0000000-0000-4000-8000-000000000000";

const TWO_TONICS: LootTableDefinition = {
  id: "two-tonics",
  rolls: 2,
  entries: [{ itemId: "minor-tonic", weight: 1 }],
  nothingWeight: 0,
};

/** The Ember Vault with one Mimic Chest at authored tile (4, 4) and alpha standing beside it. */
function vaultWithMimic(mimic = true): Session {
  const base = gameContent();
  const content = { ...base, lootTables: new Map([...base.lootTables, [TWO_TONICS.id, TWO_TONICS]]) };
  const request = { dungeonId: "ember-vault", seed: TEST_SEED, content };
  const built = buildDungeon(request);
  const session = testSession([testPlayer("alpha", { position: at(4, 4, -0.9) })]);
  session.dungeon = built.dungeon;
  session.runDungeon = request;
  session.lootRng = lootRngFor(built.seed, "ember-vault");
  session.dungeon.chests.push(chestInstance(TWO_TONICS.id, at(4, 4), CHEST_ID, false, false, mimic));
  return session;
}

describe("a Mimic Chest", () => {
  it("is sent exactly as a chest is, so a snapshot cannot tell them apart", () => {
    const mimic = vaultWithMimic(true);
    const plain = vaultWithMimic(false);

    const sent = visibilityFrameForPlayer(mimic, mimic.players.get("alpha")!).dungeon;
    const control = visibilityFrameForPlayer(plain, plain.players.get("alpha")!).dungeon;

    expect(sent.chests).toEqual(control.chests);
    expect(sent.chests.find((chest) => chest.id === CHEST_ID)?.mimic).toBe(false);
    expect(sent.monsters).toEqual(control.monsters);
  });

  it("wakes a mimic where it stood instead of spilling its table", () => {
    const session = vaultWithMimic();
    const loot = session.dungeon.loot.length;
    const monsters = session.dungeon.monsters.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

    expect(session.dungeon.loot).toHaveLength(loot);
    expect(session.dungeon.monsters).toHaveLength(monsters + 1);
    const woken = session.dungeon.monsters.find((monster) => monster.id === CHEST_ID)!;
    expect(woken).toMatchObject({ typeId: "mimic", alive: true, boss: false, elite: false, position: at(4, 4) });

    const frame = visibilityFrameForPlayer(session, session.players.get("alpha")!).dungeon;
    expect(frame.monsters.map((monster) => monster.id)).toContain(CHEST_ID);
    // The chest is still sent, opened like any other, so a remembered minimap icon stops showing it closed.
    expect(frame.chests.find((chest) => chest.id === CHEST_ID)).toMatchObject({ opened: true, mimic: false });
  });

  it("flips a remembered minimap icon to opened once it wakes, without marking it a mimic", () => {
    const session = vaultWithMimic();
    const alpha = session.players.get("alpha")!;
    const seen = (): ChestState[] => visibilityFrameForPlayer(session, alpha).dungeon.chests;

    const before = rememberMarkers(NO_MARKERS, "run", { exits: [], chests: seen() });
    expect(before.chests.get(CHEST_ID)?.opened).toBe(false);

    interact(session, "alpha", CHEST_ID);
    const after = rememberMarkers(before, "run", { exits: [], chests: seen() });
    expect(after.chests.get(CHEST_ID)?.opened).toBe(true);
  });

  it("wakes clear of a player standing on the chest, who can then walk away", () => {
    const session = vaultWithMimic();
    const alpha = session.players.get("alpha")!;
    alpha.position = at(4, 4);

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

    const woken = session.dungeon.monsters.find((monster) => monster.id === CHEST_ID)!;
    expect(Math.hypot(woken.position.x - alpha.position.x, woken.position.y - alpha.position.y)).toBeGreaterThanOrEqual(0.7);
    const step = { x: alpha.position.x + 0.1, y: alpha.position.y };
    expect(isOpen(session.dungeon, [], step, alpha.position)).toBe(true);
  });

  describe("beside a wall", () => {
    /** A one-tile pocket holding the chest at (3, 2), a one-tile wall, and open floor beyond it. */
    function pocketWithMimic(): Session {
      const session = vaultWithMimic();
      session.dungeon.map = {
        ...session.dungeon.map,
        originX: 0,
        originY: 0,
        width: 9,
        height: 5,
        tiles: ["#########", "#########", "###.#...#", "#########", "#########"],
      };
      session.dungeon.monsters = [];
      session.dungeon.doors = [];
      session.dungeon.chests = [chestInstance(TWO_TONICS.id, { x: 3, y: 2 }, CHEST_ID, false, false, true)];
      session.players.get("alpha")!.position = { x: 3, y: 2 };
      return session;
    }

    it("never wakes on the far side, falling back to the chest's own spot when its side is full", () => {
      const session = pocketWithMimic();
      // Players on the pocket's four corners and its middle leave no spot on the chest's side.
      [{ x: 2.5, y: 1.5 }, { x: 3.5, y: 1.5 }, { x: 2.5, y: 2.5 }, { x: 3.5, y: 2.5 }].forEach((position, index) => {
        session.players.set(`guard${index}`, testPlayer(`guard${index}`, { position }));
      });

      expect(isOpen(session.dungeon, [], { x: 5, y: 2 })).toBe(true);
      expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

      const woken = session.dungeon.monsters.find((monster) => monster.id === CHEST_ID)!;
      expect(woken.position).toEqual({ x: 3, y: 2 });
    });

    it("still wakes beside the chest on its own side when there is room", () => {
      const session = pocketWithMimic();
      session.dungeon.map.tiles = ["#########", "#########", "#.....#.#", "#########", "#########"];

      expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

      const woken = session.dungeon.monsters.find((monster) => monster.id === CHEST_ID)!;
      expect(woken.position.x).toBeLessThan(5);
      expect(Math.hypot(woken.position.x - 3, woken.position.y - 2)).toBeGreaterThanOrEqual(0.7);
    });
  });

  it("refuses a second open and wakes only one mimic", () => {
    const session = vaultWithMimic();
    interact(session, "alpha", CHEST_ID);
    const monsters = session.dungeon.monsters.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(session.dungeon.monsters).toHaveLength(monsters);
  });

  it("drops the chest's table when killed, wherever it walked to", () => {
    const session = vaultWithMimic();
    interact(session, "alpha", CHEST_ID);
    const woken = session.dungeon.monsters.find((monster) => monster.id === CHEST_ID)!;
    woken.position = at(5, 4);
    const before = session.dungeon.loot.length;

    damageMonster(session, woken, woken.health);

    expect(woken.alive).toBe(false);
    expect(session.dungeon.loot.slice(before).map((loot) => loot.name)).toEqual(["Minor Tonic", "Minor Tonic"]);
  });
});

describe("generated mimics", () => {
  it("places some in a swept set of seeds, never in a vault or the boss room", () => {
    let mimics = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const { dungeon } = buildDungeon({ dungeonId: "vault-run", seed });
      for (const chest of dungeon.chests) {
        if (!chest.mimic) continue;
        mimics += 1;
        expect(chest.lootTableId).not.toBe("vault-chest");
        expect(chest.locked).toBe(false);
        expect(chest.twinLock).toBe(false);
      }
    }
    expect(mimics).toBeGreaterThan(0);
  });
});
