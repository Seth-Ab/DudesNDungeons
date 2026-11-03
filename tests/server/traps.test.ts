import { describe, expect, it } from "vitest";
import { PLAYER_BASE_RESISTANCE, PLAYER_MAX_STAMINA } from "../../src/shared/constants/game.js";
import { gameContent } from "../../src/server/content/loadContent.js";
import { trapInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon, movePlayer } from "../../src/server/game/dungeonState.js";
import { damageMultiplier } from "../../src/server/game/vitals.js";
import { resolveTraps } from "../../src/server/game/traps.js";
import { lightTorch, putOutTorch } from "../../src/server/game/torches.js";
import { simulate } from "../../src/server/game/combat.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import type { TrapState } from "../../src/shared/types/core.js";
import { at, testPlayer, testSession } from "./fixtures.js";

const content = gameContent();
const TRAP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Places one trap of a content type at an Ember Vault tile, away from the pinned monsters. */
function withTrap(typeId: string, tile = { x: 8, y: 1 }) {
  const player = testPlayer("p1", { position: at(2, 2) });
  const session = testSession([player]);
  session.dungeon.monsters = [];
  const trap = trapInstance(content.traps.get(typeId)!, at(tile.x, tile.y), TRAP_ID);
  session.dungeon.traps = [trap];
  return { session, player, trap };
}

function standOn(player: { position: unknown }, trap: TrapState): void {
  player.position = { ...trap.position };
}

describe("trap triggering", () => {
  it("fires when a standing player is in reach and damages through resistance", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);

    const fired = resolveTraps(session, 1000);

    expect(fired.map((entry) => entry.id)).toEqual([TRAP_ID]);
    const expected = Math.round(14 * damageMultiplier(PLAYER_BASE_RESISTANCE));
    expect(player.health).toBe(100 - expected);
    expect(trap.phase).toBe("triggered");
  });

  it("leaves a player who avoids it alone", () => {
    const { session, player, trap } = withTrap("spike-plate");
    player.position = { x: trap.position.x + trap.radius + 0.5, y: trap.position.y };

    expect(resolveTraps(session, 1000)).toEqual([]);
    expect(player.health).toBe(100);
    expect(trap.phase).toBe("armed");
  });

  it("is triggered by moving onto it, resolved by the server from the move", () => {
    const { session, player, trap } = withTrap("spike-plate");
    player.position = { x: trap.position.x - 1.5, y: trap.position.y };

    const moved = movePlayer(session, "p1", { x: 1, y: 0 }, 0);
    expect(moved.ok).toBe(true);
    resolveTraps(session, 0);

    expect(trap.phase).toBe("triggered");
    expect(player.health).toBeLessThan(100);
  });

  it("hits once per entry: a rearming trap waits for its footprint to clear", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    resolveTraps(session, 1000);
    const afterFirst = player.health;

    // Past the rearm time but still standing on it: no second hit.
    resolveTraps(session, 1000 + 4001);
    expect(player.health).toBe(afterFirst);
    expect(trap.phase).toBe("triggered");

    // Step off, let it rearm, step back on.
    player.position = at(2, 2);
    resolveTraps(session, 6000);
    expect(trap.phase).toBe("armed");
    standOn(player, trap);
    resolveTraps(session, 6100);
    expect(player.health).toBeLessThan(afterFirst);
  });

  it("does not rearm before its delay has passed", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    resolveTraps(session, 1000);
    player.position = at(2, 2);

    resolveTraps(session, 2000);
    expect(trap.phase).toBe("triggered");
  });

  it("disables a single-use trap for the rest of the run", () => {
    const { session, player, trap } = withTrap("snare-wire");
    standOn(player, trap);
    resolveTraps(session, 1000);
    player.position = at(2, 2);
    resolveTraps(session, 60_000);
    standOn(player, trap);
    player.stamina = PLAYER_MAX_STAMINA;
    resolveTraps(session, 61_000);

    expect(trap.phase).toBe("disabled");
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA);
  });

  it("ignores downed and disconnected players", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    player.health = 0;
    expect(resolveTraps(session, 1000)).toEqual([]);

    player.health = 100;
    player.connected = false;
    expect(resolveTraps(session, 1000)).toEqual([]);
    expect(trap.phase).toBe("armed");

    // On reconnect the player is physically there, so the server resolves it then.
    player.connected = true;
    expect(resolveTraps(session, 1100)).toHaveLength(1);
  });

  it("can down a player, who then stops triggering anything", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    player.health = 3;

    resolveTraps(session, 1000);

    expect(player.health).toBe(0);
    player.position = at(2, 2);
    resolveTraps(session, 6000);
    standOn(player, trap);
    resolveTraps(session, 6100);
    expect(player.health).toBe(0);
  });

  it("hits every player in reach", () => {
    const { session, player, trap } = withTrap("spike-plate");
    const other = testPlayer("p2", { position: { ...trap.position, x: trap.position.x + 1 } });
    session.players.set("p2", other);
    standOn(player, trap);

    resolveTraps(session, 1000);

    expect(player.health).toBeLessThan(100);
    expect(other.health).toBeLessThan(100);
  });

  it("scales damage with resistance", () => {
    const warded = withTrap("spike-plate");
    warded.player.resistance = 100;
    standOn(warded.player, warded.trap);
    const bare = withTrap("spike-plate");
    bare.player.resistance = 0;
    standOn(bare.player, bare.trap);

    resolveTraps(warded.session, 1000);
    resolveTraps(bare.session, 1000);

    expect(100 - warded.player.health).toBeLessThan(100 - bare.player.health);
    expect(bare.player.health).toBe(100 - 14);
  });

  it("removes resistance and never takes it below zero", () => {
    const { session, player, trap } = withTrap("ember-vent");
    standOn(player, trap);
    player.resistance = 5;

    resolveTraps(session, 1000);

    expect(player.resistance).toBe(0);
  });

  it("drains stamina through the vitals model and floors at zero", () => {
    const { session, player, trap } = withTrap("snare-wire");
    standOn(player, trap);

    resolveTraps(session, 1000);
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA - 45);

    const low = withTrap("snare-wire");
    standOn(low.player, low.trap);
    low.player.stamina = 10;
    resolveTraps(low.session, 1000);
    expect(low.player.stamina).toBe(0);
  });

  it("fires on the simulation tick for a player who stands still", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);

    simulate(session, 1000);

    expect(trap.phase).toBe("triggered");
  });

  it("does nothing in the hub", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    session.location = "hub";

    expect(resolveTraps(session, 1000)).toEqual([]);
  });

  it("rebuilds traps armed after a run ends", () => {
    const { session, player, trap } = withTrap("spike-plate");
    standOn(player, trap);
    resolveTraps(session, 1000);

    returnToHub(session, true);

    expect(session.trapRearmAt.size).toBe(0);
    expect(session.dungeon.traps).toEqual([]);
  });
});

describe("trap visibility", () => {
  it("sends a trap, with its phase, only while its tile is visible", () => {
    const { session, player, trap } = withTrap("spike-plate", { x: 3, y: 3 });
    standOn(player, trap);
    session.dungeon.lightSources = [];

    const seen = visibilityFrameForPlayer(session, player).dungeon.traps;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: TRAP_ID, phase: "armed" });

    resolveTraps(session, 1000);
    expect(visibilityFrameForPlayer(session, player).dungeon.traps[0]?.phase).toBe("triggered");

    // Far from every light, the trap is not part of what this player can see.
    player.carryingTorch = false;
    player.position = at(14, 6);
    expect(visibilityFrameForPlayer(session, player).dungeon.traps).toEqual([]);
  });

  it("keeps triggered state across a reconnect", () => {
    const { session, player, trap } = withTrap("spike-plate", { x: 3, y: 3 });
    standOn(player, trap);
    resolveTraps(session, 1000);

    player.connected = false;
    player.connected = true;

    const traps = visibilityFrameForPlayer(session, player).dungeon.traps;
    expect(traps[0]?.phase).toBe("triggered");
    expect(player.health).toBeLessThan(100);
  });
});

describe("authored trap rooms", () => {
  it("places traps from the collapsing span template in a generated run", () => {
    let withTraps = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { dungeon } = buildDungeon({ dungeonId: "vault-run", seed, content });
      const span = dungeon.rooms.find((room) => room.name === "Collapsing Span");
      if (!span) continue;

      const inside = dungeon.traps.filter(
        (trap) =>
          trap.position.x >= span.x &&
          trap.position.x < span.x + span.width &&
          trap.position.y >= span.y &&
          trap.position.y < span.y + span.height,
      );
      expect(inside.length).toBeGreaterThanOrEqual(3);
      for (const trap of inside) expect(trap.phase).toBe("armed");
      withTraps += 1;
    }

    expect(withTraps).toBeGreaterThan(0);
  });

  it("builds the same traps from the same seed", () => {
    const a = buildDungeon({ dungeonId: "vault-run", seed: 7, content }).dungeon.traps;
    const b = buildDungeon({ dungeonId: "vault-run", seed: 7, content }).dungeon.traps;
    expect(a).toEqual(b);
  });
});

describe("snuffer vent", () => {
  const SNUFF_MS = 8000;
  const FLARE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function withVent() {
    const scene = withTrap("snuffer-vent");
    scene.session.dungeon.lightSources = [];
    standOn(scene.player, scene.trap);
    return scene;
  }

  function lightFlare(session: ReturnType<typeof withVent>["session"], trap: TrapState, burnsOutAt: number) {
    session.dungeon.lightSources.push({
      id: FLARE_ID,
      name: "Flare",
      kind: "flare",
      position: { ...trap.position },
      radius: 6,
    });
    session.flareExpiresAt.set(FLARE_ID, burnsOutAt);
  }

  it("carries its effect on the trap state and does no damage", () => {
    const { session, player, trap } = withVent();

    expect(trap.effect).toBe("snuffTorch");
    resolveTraps(session, 1000);

    expect(player.health).toBe(100);
    expect(trap.phase).toBe("triggered");
  });

  it("puts out a held torch for 8 seconds, then relights it", () => {
    const { session, player } = withVent();
    resolveTraps(session, 1000);
    expect(player.torchLit).toBe(false);

    player.position = at(2, 2);
    resolveTraps(session, 1000 + SNUFF_MS - 1);
    expect(player.torchLit).toBe(false);

    resolveTraps(session, 1000 + SNUFF_MS);
    expect(player.torchLit).toBe(true);
    expect(session.snuffedTorchUntil.size).toBe(0);
  });

  it("gives no light while snuffed and refuses a relight from a nearby flame", () => {
    const { session, player } = withVent();
    resolveTraps(session, 1000);

    expect(lightTorch(session, player.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.torchLit).toBe(false);
  });

  it("leaves a torch the player had already put out unlit when the wait ends", () => {
    const { session, player } = withVent();
    putOutTorch(session, player.id);

    resolveTraps(session, 1000);
    player.position = at(2, 2);
    resolveTraps(session, 1000 + SNUFF_MS);

    expect(player.torchLit).toBe(false);
  });

  it("does not light a torch that was dropped while snuffed", () => {
    const { session, player } = withVent();
    resolveTraps(session, 1000);
    player.carryingTorch = false;

    resolveTraps(session, 1000 + SNUFF_MS);

    expect(player.torchLit).toBe(false);
  });

  it("snuffs a flare for the same wait and does not spend it", () => {
    const { session, trap } = withVent();
    lightFlare(session, trap, 5000);

    resolveTraps(session, 1000);
    expect(session.snuffedFlareUntil.get(FLARE_ID)).toBe(1000 + SNUFF_MS);
    expect(session.flareExpiresAt.get(FLARE_ID)).toBe(5000 + SNUFF_MS);

    session.players.get("p1")!.position = at(2, 2);
    simulate(session, 1000 + SNUFF_MS);
    expect(session.snuffedFlareUntil.has(FLARE_ID)).toBe(false);
    expect(session.dungeon.lightSources.map((light) => light.id)).toEqual([FLARE_ID]);
  });

  it("hides a snuffed flare from the viewer's lights until it burns again", () => {
    const { session, player, trap } = withVent();
    lightFlare(session, trap, 60_000);
    const flaresSeen = () =>
      visibilityFrameForPlayer(session, player).dungeon.lightSources.filter((light) => light.kind === "flare").length;
    expect(flaresSeen()).toBe(1);

    resolveTraps(session, 1000);
    expect(flaresSeen()).toBe(0);

    resolveTraps(session, 1000 + SNUFF_MS);
    expect(flaresSeen()).toBe(1);
  });

  it("leaves a torch and a flare outside its radius alone", () => {
    const { session, player, trap } = withVent();
    const bystander = testPlayer("p2", { position: { x: trap.position.x + trap.radius + 1, y: trap.position.y } });
    session.players.set(bystander.id, bystander);
    lightFlare(session, trap, 5000);
    session.dungeon.lightSources[0]!.position = { x: trap.position.x + trap.radius + 1, y: trap.position.y };

    resolveTraps(session, 1000);

    expect(player.torchLit).toBe(false);
    expect(bystander.torchLit).toBe(true);
    expect(session.snuffedFlareUntil.size).toBe(0);
  });

  it("snuffs a downed player's torch, but does not fire for them alone", () => {
    const { session, player, trap } = withVent();
    const down = testPlayer("p2", { position: { ...trap.position } });
    down.health = 0;
    session.players.set(down.id, down);
    player.position = at(2, 2);
    expect(resolveTraps(session, 1000)).toEqual([]);
    expect(down.torchLit).toBe(true);

    standOn(player, trap);
    resolveTraps(session, 2000);

    expect(down.torchLit).toBe(false);
    resolveTraps(session, 2000 + SNUFF_MS);
    expect(down.torchLit).toBe(true);
  });

  it("does not snuff the torch of a disconnected player, and holds the relight of one who dropped out mid-wait until they return", () => {
    const { session, player, trap } = withVent();
    const gone = testPlayer("p2", { position: { ...trap.position } });
    gone.connected = false;
    session.players.set(gone.id, gone);

    resolveTraps(session, 1000);
    expect(gone.torchLit).toBe(true);
    expect(player.torchLit).toBe(false);

    player.connected = false;
    resolveTraps(session, 1000 + SNUFF_MS);
    expect(player.torchLit).toBe(false);
    expect(session.snuffedTorchUntil.has(player.id)).toBe(true);

    player.connected = true;
    resolveTraps(session, 1000 + SNUFF_MS + 50);
    expect(player.torchLit).toBe(true);
    expect(session.snuffedTorchUntil.size).toBe(0);
  });

  it("snuffs again on a rearm, restarting the wait", () => {
    const { session, player, trap } = withVent();
    const rearmMs = content.traps.get("snuffer-vent")!.rearmMs!;
    resolveTraps(session, 1000);

    player.position = at(2, 2);
    resolveTraps(session, 1000 + SNUFF_MS);
    expect(player.torchLit).toBe(true);
    expect(trap.phase).toBe("triggered");

    resolveTraps(session, 1000 + rearmMs);
    expect(trap.phase).toBe("armed");

    standOn(player, trap);
    resolveTraps(session, 20_000);
    expect(player.torchLit).toBe(false);
    expect(session.snuffedTorchUntil.get(player.id)).toBe(20_000 + SNUFF_MS);
  });

  it("does not shorten a wait when a second hit lands on an already snuffed torch", () => {
    const { session, player, trap } = withVent();
    resolveTraps(session, 1000);
    trap.phase = "armed";
    session.trapRearmAt.delete(trap.id);

    resolveTraps(session, 3000);

    expect(session.snuffedTorchUntil.get(player.id)).toBe(3000 + SNUFF_MS);
  });

  it("lets a player keep the torch out by putting it out during the wait", () => {
    const { session, player } = withVent();
    resolveTraps(session, 1000);
    expect(player.torchLit).toBe(false);

    expect(putOutTorch(session, player.id)).toEqual({ ok: true });
    expect(session.snuffedTorchUntil.has(player.id)).toBe(false);

    resolveTraps(session, 1000 + SNUFF_MS);
    expect(player.torchLit).toBe(false);
    expect(putOutTorch(session, player.id).ok).toBe(false);
  });

  it("is cleared when a run ends", () => {
    const { session } = withVent();
    resolveTraps(session, 1000);
    returnToHub(session, true);

    expect(session.snuffedTorchUntil.size).toBe(0);
  });
});
