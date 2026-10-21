import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { storeInVault } from "../../src/server/game/vault.js";
import { createMemoryProfileStorage, ProfileStore } from "../../src/server/profiles/profileStore.js";
import { toProfileState } from "../../src/server/profiles/profile.js";
import { SessionStore, toOwnerPlayerState } from "../../src/server/sessions/sessionStore.js";
import { createFileVaultStorage } from "../../src/server/vaults/fileVaultStorage.js";
import { markVaultChanged } from "../../src/server/vaults/partyVault.js";
import {
  createMemoryVaultStorage,
  VaultStore,
  type VaultStorage,
} from "../../src/server/vaults/vaultStore.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { joinRequest, TONIC_FIELDS } from "./fixtures.js";

const ROOM = "BCDFGH";
const OTHER_ROOM = "JKLMNP";

const TONIC: InventoryItem = { id: "11111111-1111-4111-8111-111111111111", name: "Minor Tonic", ...TONIC_FIELDS };
const KEY: InventoryItem = { id: "22222222-2222-4222-8222-222222222222", name: "Copper Key", kind: "key" };

/** A store that hands out the room codes given, in order, so a test can name the room it gets. */
function sessionStore(storage: VaultStorage, codes: string[] = [ROOM]) {
  const queue = [...codes];
  return new SessionStore({
    vaults: new VaultStore(storage),
    createRoomCode: () => queue.shift() ?? OTHER_ROOM,
  });
}

const temporaryRoots: string[] = [];

function temporaryDir(): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-vaults-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("a vault across a restart", () => {
  it("survives under its room code, and joining that code reopens the room with it", () => {
    const storage = createMemoryVaultStorage();
    const before = sessionStore(storage);
    const session = before.createSession();
    storeInVault(session, { ...TONIC });
    before.vaults.flush();

    // A new store over the same storage is what a restart looks like from here: no sessions at all.
    const after = sessionStore(storage, [OTHER_ROOM]);
    expect(after.getSession(ROOM)).toBeUndefined();

    const joined = after.join(joinRequest({ roomCode: ROOM, playerName: "Grix" }));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.session.location).toBe("hub");
    expect(joined.session.vault.items).toEqual([TONIC]);
    // Nothing changed since it was read back, so there is nothing to write.
    expect(after.vaults.dirty).toBe(false);
  });

  it("reopens a room whose session was swept, with the vault it had", () => {
    const vaults = new VaultStore();
    let now = 0;
    const store = new SessionStore({ vaults, now: () => now, emptySessionTtlMs: 10, createRoomCode: () => ROOM });
    storeInVault(store.createSession(), { ...KEY });

    now = 100;
    store.sweep();
    expect(store.getSession(ROOM)).toBeUndefined();

    const joined = store.join(joinRequest({ roomCode: ROOM, playerName: "Grix" }));
    expect(joined.ok && joined.session.vault.items).toEqual([KEY]);
  });

  it("writes nothing for a room nobody stored in, so its code does not reopen", () => {
    const storage = createMemoryVaultStorage();
    const before = sessionStore(storage);
    before.createSession();
    before.vaults.flush();
    expect(storage.read()).toBeNull();

    const after = sessionStore(storage);
    const joined = after.join(joinRequest({ roomCode: ROOM, playerName: "Grix" }));
    expect(joined).toMatchObject({ ok: false, code: "sessionNotFound" });
  });

  it("never hands a new room a code whose vault is saved", () => {
    const storage = createMemoryVaultStorage();
    const before = sessionStore(storage);
    storeInVault(before.createSession(), { ...TONIC });
    before.vaults.flush();

    // The first code offered is the saved room's, so the store must pass over it.
    const after = sessionStore(storage, [ROOM, OTHER_ROOM]);
    const fresh = after.createSession();

    expect(fresh.roomCode).toBe(OTHER_ROOM);
    expect(fresh.vault.items).toEqual([]);
  });

  it("keeps a vault emptied by withdrawals, so the room can still be reopened", () => {
    const storage = createMemoryVaultStorage();
    const before = sessionStore(storage);
    const session = before.createSession();
    storeInVault(session, { ...TONIC });
    before.vaults.flush();
    session.vault.items = [];
    markVaultChanged(session.vault);
    before.vaults.flush();

    expect(storage.read()?.vaults).toEqual([{ roomCode: ROOM, items: [] }]);
    expect(new VaultStore(storage).has(ROOM)).toBe(true);
  });

  it("does not let a reloaded vault share arrays with the file it came from", () => {
    const storage = createMemoryVaultStorage();
    const before = new VaultStore(storage);
    const vault = before.open(ROOM);
    vault.items.push({ ...TONIC });
    markVaultChanged(vault);
    before.flush();

    new VaultStore(storage).open(ROOM).items.push({ ...KEY });

    expect(storage.read()?.vaults[0]?.items).toEqual([TONIC]);
  });
});

describe("legacy personal banks", () => {
  it("still load, stay readable, and are not added to by an escape", () => {
    const profileStorage = createMemoryProfileStorage();
    const profiles = new ProfileStore({ storage: profileStorage });
    const { profile, secret } = profiles.create("Grix");
    profile.bankedItems.push({ ...KEY });
    profiles.flush();

    const restarted = new ProfileStore({ storage: profileStorage });
    const legacy = restarted.find(secret);
    expect(legacy?.bankedItems).toEqual([KEY]);
    if (!legacy) return;

    const store = sessionStore(createMemoryVaultStorage());
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: ROOM, playerName: "Grix", profile: legacy }));
    if (!joined.ok) throw new Error("expected the join to succeed");
    joined.player.inventory = [{ ...TONIC }];
    session.location = "dungeon";

    returnToHub(session, true);

    expect(toProfileState(legacy).bankedItems).toEqual([KEY]);
    expect(toOwnerPlayerState(joined.player, session).bankedItems).toEqual([KEY]);
    expect(session.vault.items).toEqual([TONIC]);
  });
});

describe("the vault file", () => {
  it("round-trips through a real file", () => {
    const path = join(temporaryDir(), "vaults.json");
    const before = new VaultStore(createFileVaultStorage(path));
    const vault = before.open(ROOM);
    vault.items.push({ ...TONIC }, { id: "33333333-3333-4333-8333-333333333333", name: "Arrows", kind: "ammo", itemId: "arrow", count: 5 });
    markVaultChanged(vault);
    before.flush();

    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
    expect(new VaultStore(createFileVaultStorage(path)).open(ROOM).items).toEqual(vault.items);
  });

  it("reads a missing file as a server with no vaults yet", () => {
    const path = join(temporaryDir(), "vaults.json");

    expect(createFileVaultStorage(path).read()).toBeNull();
    expect(new VaultStore(createFileVaultStorage(path)).size).toBe(0);
  });

  it("refuses a file it cannot trust rather than starting empty", () => {
    const path = join(temporaryDir(), "vaults.json");

    writeFileSync(path, "{ not json", "utf8");
    expect(() => createFileVaultStorage(path).read()).toThrow(/not valid JSON/);

    writeFileSync(path, JSON.stringify({ version: 1, vaults: [{ roomCode: "nope", items: [] }] }), "utf8");
    expect(() => createFileVaultStorage(path).read()).toThrow(/not a valid vault file/);

    writeFileSync(path, JSON.stringify({ version: 99, vaults: [] }), "utf8");
    expect(() => createFileVaultStorage(path).read()).toThrow(/not a valid vault file/);
  });
});
