import { describe, expect, it } from "vitest";
import {
  createLocalStorageHudSettingsStore,
  createMemoryHudSettingsStore,
  defaultHudSettings,
  parseHudSettings,
} from "../../src/client/state/hudSettings.js";

const fallback = defaultHudSettings(false);

function fakeStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}

describe("parseHudSettings", () => {
  it("reads valid settings", () => {
    expect(parseHudSettings('{"reducedMotion":true,"uiScale":1.3}', fallback)).toEqual({
      reducedMotion: true,
      uiScale: 1.3,
    });
  });

  it("falls back per field for bad values and wholesale for bad JSON", () => {
    expect(parseHudSettings('{"reducedMotion":"yes","uiScale":9}', fallback)).toEqual(fallback);
    expect(parseHudSettings("{nope", fallback)).toEqual(fallback);
    expect(parseHudSettings("null", fallback)).toEqual(fallback);
    expect(parseHudSettings(null, fallback)).toEqual(fallback);
  });
});

describe("hud settings stores", () => {
  it("defaults reduced motion to the OS preference", () => {
    const store = createLocalStorageHudSettingsStore(fakeStorage(), () => true);
    expect(store.read()).toEqual({ reducedMotion: true, uiScale: 1 });
  });

  it("round-trips through storage, and a saved choice beats the OS preference", () => {
    const storage = fakeStorage();
    createLocalStorageHudSettingsStore(storage, () => true).write({ reducedMotion: false, uiScale: 1.15 });
    expect(createLocalStorageHudSettingsStore(storage, () => true).read()).toEqual({
      reducedMotion: false,
      uiScale: 1.15,
    });
  });

  it("survives storage that throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const store = createLocalStorageHudSettingsStore(blocked, () => false);
    expect(store.read()).toEqual(fallback);
    expect(() => store.write(fallback)).not.toThrow();
  });

  it("keeps settings in memory when storage is unavailable", () => {
    const store = createMemoryHudSettingsStore(() => false);
    store.write({ reducedMotion: true, uiScale: 0.85 });
    expect(store.read()).toEqual({ reducedMotion: true, uiScale: 0.85 });
  });
});
