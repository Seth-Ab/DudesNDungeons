import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileProfileStorage } from "../../src/server/profiles/fileProfileStorage.js";
import { markProfileChanged, profileFileSchema, toProfileState } from "../../src/server/profiles/profile.js";
import {
  createMemoryProfileStorage,
  ProfileStore,
  type ProfileStorage,
} from "../../src/server/profiles/profileStore.js";
import { TONIC_FIELDS } from "./fixtures.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210";

let counter = 0;

/** Real UUIDs, because the persisted schema requires them and a fake id only fails on write. */
function profileId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function newStore(storage: ProfileStorage, now = 1_000) {
  counter = 0;
  return new ProfileStore({
    storage,
    now: () => now,
    createProfileId: () => profileId((counter += 1)),
    createProfileSecret: () => SECRET,
  });
}

const temporaryRoots: string[] = [];

function temporaryDir(): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-profiles-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("identifying a profile", () => {
  it("finds a profile again by the secret it was issued", () => {
    const store = newStore(createMemoryProfileStorage());
    const { profile, secret } = store.create("Grix");

    expect(store.find(secret)).toBe(profile);
  });

  it("treats an unknown secret as a device with no profile", () => {
    const store = newStore(createMemoryProfileStorage());
    store.create("Grix");

    // Not an error: a player can do nothing about a profile the server never had, so the join that
    // follows mints a new one rather than refusing them.
    expect(store.find(OTHER_SECRET)).toBeNull();
    expect(store.find(null)).toBeNull();
    expect(store.find(undefined)).toBeNull();
  });

  it("keeps only a hash of the secret, never the secret itself", () => {
    const storage = createMemoryProfileStorage();
    const store = newStore(storage);
    const { profile, secret } = store.create("Grix");
    store.flush();

    expect(profile.secretHash).not.toBe(secret);
    expect(profile.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(storage.read())).not.toContain(secret);
  });

  it("leaves the secret out of what the owner is sent", () => {
    const store = newStore(createMemoryProfileStorage());
    const { profile } = store.create("Grix");

    expect(Object.keys(toProfileState(profile))).not.toContain("secretHash");
  });
});

describe("persisting profiles", () => {
  it("writes nothing when nothing has changed", () => {
    const storage = createMemoryProfileStorage();
    let writes = 0;
    const counted: ProfileStorage = {
      read: () => storage.read(),
      write: (file) => {
        writes += 1;
        storage.write(file);
      },
    };

    const store = newStore(counted);
    store.create("Grix");
    store.flush();
    store.flush();
    store.flush();

    expect(writes).toBe(1);
  });

  it("migrates banked items saved with the old tonic and ward kinds when it reads", () => {
    const file = {
      version: 1,
      profiles: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          secretHash: "a".repeat(64),
          displayName: "Grix",
          bankedItems: [
            { id: "11111111-1111-4111-8111-111111111111", name: "Minor Tonic", kind: "tonic" },
            { id: "22222222-2222-4222-8222-222222222222", name: "Warding Salve", kind: "ward" },
            { id: "44444444-4444-4444-8444-444444444444", name: "Copper Key", kind: "key" },
          ],
          unlockedSkillIds: [],
          unlockedUpgradeIds: [],
          runsEscaped: 0,
          runsLost: 0,
          createdAt: 0,
          lastSeenAt: 0,
        },
      ],
    };

    const parsed = profileFileSchema.parse(file);

    expect(parsed.profiles[0]?.bankedItems).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Minor Tonic",
        kind: "consumable",
        itemId: "minor-tonic",
        description: "Restores 35 health.",
        icon: "tonic",
        useOn: "self",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Warding Salve",
        kind: "consumable",
        itemId: "warding-salve",
        description: "Restores 25 resistance.",
        icon: "ward",
        useOn: "self",
      },
      { id: "44444444-4444-4444-8444-444444444444", name: "Copper Key", kind: "key" },
    ]);
    expect(() => profileFileSchema.parse({ ...file, profiles: [{ ...file.profiles[0], bankedItems: [{ id: "x", name: "?", kind: "constructor" }] }] })).toThrow();
  });

  it("writes again once a profile changes", () => {
    const storage = createMemoryProfileStorage();
    const store = newStore(storage);
    const { profile } = store.create("Grix");
    store.flush();

    profile.bankedItems.push({ id: "11111111-1111-4111-8111-111111111111", name: "Minor Tonic", ...TONIC_FIELDS });
    expect(store.dirty).toBe(false);

    // The mark is what makes a mutation visible to the store; the push alone is not.
    markProfileChanged(profile);
    expect(store.dirty).toBe(true);

    store.flush();
    expect(storage.read()?.profiles[0]?.bankedItems).toHaveLength(1);
  });

  it("gives a restarted server the same profile, bank and all", () => {
    const storage = createMemoryProfileStorage();

    const before = newStore(storage);
    const { profile, secret } = before.create("Grix");
    profile.bankedItems.push({ id: "11111111-1111-4111-8111-111111111111", name: "Copper Key", kind: "key" });
    profile.unlockedSkillIds.push("iron-will");
    profile.runsEscaped = 3;
    markProfileChanged(profile);
    before.flush();

    // A different store over the same storage is what a restart looks like from here.
    const after = newStore(storage);
    const restored = after.find(secret);

    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(profile.id);
    expect(restored?.bankedItems).toEqual([{ id: "11111111-1111-4111-8111-111111111111", name: "Copper Key", kind: "key" }]);
    expect(restored?.unlockedSkillIds).toEqual(["iron-will"]);
    expect(restored?.runsEscaped).toBe(3);
    // A profile read back has nothing outstanding to write until something changes it again.
    expect(after.dirty).toBe(false);
  });

  it("does not let a reloaded profile share arrays with the file it came from", () => {
    const storage = createMemoryProfileStorage();
    const before = newStore(storage);
    const { profile, secret } = before.create("Grix");
    profile.bankedItems.push({ id: "11111111-1111-4111-8111-111111111111", name: "Copper Key", kind: "key" });
    markProfileChanged(profile);
    before.flush();

    const after = newStore(storage);
    after.find(secret)?.bankedItems.push({ id: "22222222-2222-4222-8222-222222222222", name: "Minor Tonic", ...TONIC_FIELDS });

    expect(storage.read()?.profiles[0]?.bankedItems).toHaveLength(1);
  });
});

describe("the profile file", () => {
  it("round-trips through a real file", () => {
    const path = join(temporaryDir(), "profiles.json");
    const storage = createFileProfileStorage(path);

    const before = newStore(storage);
    const { secret } = before.create("Grix");
    before.flush();

    expect(newStore(createFileProfileStorage(path)).find(secret)).not.toBeNull();
  });

  it("creates the directory it was pointed at", () => {
    const path = join(temporaryDir(), "nested", "deeper", "profiles.json");
    const store = newStore(createFileProfileStorage(path));
    store.create("Grix");
    store.flush();

    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });

  it("reads a missing file as a server with no profiles yet", () => {
    const path = join(temporaryDir(), "profiles.json");

    expect(createFileProfileStorage(path).read()).toBeNull();
    expect(newStore(createFileProfileStorage(path)).size).toBe(0);
  });

  it("refuses a file it cannot trust rather than starting empty", () => {
    const path = join(temporaryDir(), "profiles.json");

    // Starting empty would be worse than failing: the first save would then overwrite whatever the
    // file still holds, and every player's bank would be gone for good.
    writeFileSync(path, "{ not json", "utf8");
    expect(() => createFileProfileStorage(path).read()).toThrow(/not valid JSON/);

    writeFileSync(path, JSON.stringify({ version: 1, profiles: [{ id: "nope" }] }), "utf8");
    expect(() => createFileProfileStorage(path).read()).toThrow(/not a valid profile file/);

    writeFileSync(path, JSON.stringify({ version: 99, profiles: [] }), "utf8");
    expect(() => createFileProfileStorage(path).read()).toThrow(/not a valid profile file/);
  });
});
