import { describe, expect, it } from "vitest";
import { interact } from "../../src/server/game/items.js";
import { openSealedDoors } from "../../src/server/game/switches.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { switchStateSchema, type SwitchState } from "../../src/shared/types/core.js";
import { VAULT_DOOR_ID, at, testPlayer, testSession } from "./fixtures.js";

const FIRST_ID = "a1000000-0000-4000-8000-000000000001";
const SECOND_ID = "a1000000-0000-4000-8000-000000000002";
const STRANGER_ID = "a1000000-0000-4000-8000-000000000003";

function brazier(id: string, x: number, y: number, groupId = "braziers"): SwitchState {
  return { id, kind: "brazier", position: at(x, y), groupId, active: false };
}

/** The Ember Vault with two braziers in a group sealing its door, and alpha beside the first. */
function sealed(overrides: Parameters<typeof testPlayer>[1] = {}): { session: Session; door: Session["dungeon"]["doors"][number] } {
  const session = testSession([testPlayer("alpha", { position: at(5, 5), carryingTorch: true, ...overrides })]);
  const door = session.dungeon.doors.find((candidate) => candidate.id === VAULT_DOOR_ID)!;
  door.lock = { type: "seal", groupId: "braziers" };
  session.dungeon.switches.push(
    brazier(FIRST_ID, 5, 5),
    brazier(SECOND_ID, 9, 9),
    brazier(STRANGER_ID, 5, 6, "other-group"),
  );
  return { session, door };
}

const lever = (session: Session, id: string) => session.dungeon.switches.find((candidate) => candidate.id === id)!;

describe("switches and seal locks", () => {
  it("opens a seal door only once every switch in its group is lit", () => {
    const { session, door } = sealed();
    const alpha = session.players.get("alpha")!;

    expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: true });
    expect(lever(session, FIRST_ID).active).toBe(true);
    expect(door).toMatchObject({ open: false, lock: { type: "seal" } });

    alpha.position = at(9, 9);
    expect(interact(session, "alpha", SECOND_ID)).toEqual({ ok: true });
    expect(door).toMatchObject({ open: true, lock: null });
  });

  it("ignores switches of another group", () => {
    const { session, door } = sealed();
    lever(session, STRANGER_ID).active = true;

    openSealedDoors(session);

    expect(door.open).toBe(false);
  });

  it("never opens a door whose group has no switches", () => {
    const { session, door } = sealed();
    door.lock = { type: "seal", groupId: "empty" };

    expect(openSealedDoors(session)).toEqual([]);
    expect(door.open).toBe(false);
  });

  it("does not open a seal door by interacting with the door itself", () => {
    const { session, door } = sealed({ position: at(10, 6, 1.9) });

    expect(interact(session, "alpha", VAULT_DOOR_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(door.open).toBe(false);
  });

  it("stays open: nothing reseals the door", () => {
    const { session, door } = sealed();
    lever(session, FIRST_ID).active = true;
    lever(session, SECOND_ID).active = true;
    openSealedDoors(session);
    expect(door.open).toBe(true);

    lever(session, SECOND_ID).active = false;
    expect(openSealedDoors(session)).toEqual([]);
    expect(door).toMatchObject({ open: true, lock: null });
  });

  it("needs a torch to light a brazier", () => {
    const { session } = sealed({ carryingTorch: false });

    expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(lever(session, FIRST_ID).active).toBe(false);
  });

  it("needs the torch to be lit to light a brazier", () => {
    const { session } = sealed({ torchLit: false });

    expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(lever(session, FIRST_ID).active).toBe(false);
  });

  it("refuses a light out of reach", () => {
    const { session } = sealed();

    expect(interact(session, "alpha", SECOND_ID)).toEqual({ ok: false, reason: "outOfRange" });
    expect(lever(session, SECOND_ID).active).toBe(false);
  });

  it("refuses a disconnected or downed player", () => {
    for (const overrides of [{ connected: false }, { health: 0 }]) {
      const { session } = sealed(overrides);

      expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: false, reason: "notPermitted" });
      expect(lever(session, FIRST_ID).active).toBe(false);
    }
  });

  it("refuses a switch lit twice and leaves it on", () => {
    const { session } = sealed();

    expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: true });
    expect(interact(session, "alpha", FIRST_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(lever(session, FIRST_ID).active).toBe(true);
  });

  it("rejects an unknown kind in the schema, so a client has no way to name one", () => {
    expect(switchStateSchema.safeParse({ ...brazier(FIRST_ID, 1, 1), kind: "padlock" }).success).toBe(false);
  });
});
