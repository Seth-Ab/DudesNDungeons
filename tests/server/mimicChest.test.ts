import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import type { LootTableDefinition } from "../../src/server/content/schema.js";
import { chestInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
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
    // The chest is gone from the snapshot; the monster stands in its place.
    expect(frame.chests.map((chest) => chest.id)).not.toContain(CHEST_ID);
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
