import type { KeyValueStorage } from "../network/endpoints.js";
import {
  applyOverrides,
  bindingOverrides,
  onBindingsChange,
  sanitizeOverrides,
  type BindingOverrides,
} from "../input/keyBindings.js";

const BINDINGS_KEY = "dnd.keyBindings";

/** Anything unreadable is an empty set of overrides; stored data is never trusted. */
export function parseBindingOverrides(raw: string | null): BindingOverrides {
  if (!raw) return {};
  try {
    return sanitizeOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

export interface KeyBindingsStore {
  read(): BindingOverrides;
  /** An empty set removes the stored value, so resetting to defaults leaves nothing behind. */
  write(overrides: BindingOverrides): void;
}

/**
 * Bindings live in local storage so they outlive the tab. Losing them only costs a rebind, so
 * blocked storage degrades to the defaults silently.
 */
export function createLocalStorageKeyBindingsStore(storage: KeyValueStorage): KeyBindingsStore {
  return {
    read() {
      try {
        return parseBindingOverrides(storage.getItem(BINDINGS_KEY));
      } catch {
        return {};
      }
    },
    write(overrides) {
      try {
        if (Object.keys(overrides).length === 0) storage.removeItem(BINDINGS_KEY);
        else storage.setItem(BINDINGS_KEY, JSON.stringify(overrides));
      } catch {
        // The binding still applies for this page; it just will not be remembered.
      }
    },
  };
}

export function createMemoryKeyBindingsStore(): KeyBindingsStore {
  let saved: BindingOverrides = {};
  return {
    read: () => saved,
    write: (overrides) => {
      saved = overrides;
    },
  };
}

/** Loads the stored bindings into the live table, then saves after every change. Call before input starts. */
export function persistKeyBindings(store: KeyBindingsStore): () => void {
  applyOverrides(store.read());
  return onBindingsChange(() => store.write(bindingOverrides()));
}
