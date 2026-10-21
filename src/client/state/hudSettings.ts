import type { KeyValueStorage } from "../network/endpoints.js";

export interface HudSettings {
  reducedMotion: boolean;
  /** One of `UI_SCALES`; scales every rem-sized element, the HUD and menus included. */
  uiScale: number;
  /** How much of the HUD stays lit when it is quiet; see `HUD_DENSITY_RULES` in `hudFade.ts`. */
  density: HudDensity;
}

export const HUD_DENSITIES = ["full", "calm", "minimal"] as const;

export type HudDensity = (typeof HUD_DENSITIES)[number];

export const HUD_DENSITY_LABELS: Record<HudDensity, string> = {
  full: "Full (never fade)",
  calm: "Calm (fade when quiet)",
  minimal: "Minimal (fade more, hide key hints)",
};

export const DEFAULT_HUD_DENSITY: HudDensity = "calm";

/** Reads a density back from the document's `data-hud-density`; anything unknown is the default. */
export function hudDensityFrom(value: string | undefined): HudDensity {
  return HUD_DENSITIES.find((density) => density === value) ?? DEFAULT_HUD_DENSITY;
}

export const UI_SCALES = [0.85, 1, 1.15, 1.3] as const;

export const UI_SCALE_LABELS: Record<number, string> = {
  0.85: "Small",
  1: "Default",
  1.15: "Large",
  1.3: "Extra large",
};

/**
 * How many screen pixels each pixel of the HUD frame art covers at a UI scale: always a whole
 * number, so the 9-slice frame and its studs never land between device pixels. It is 2 up to
 * "Large" and 3 at "Extra large", where the panels have grown enough to carry a chunkier frame.
 */
export function hudFrameZoom(uiScale: number): number {
  return Math.max(2, Math.round(uiScale * 2));
}

const SETTINGS_KEY = "dnd.hudSettings";

export function defaultHudSettings(prefersReducedMotion: boolean): HudSettings {
  return { reducedMotion: prefersReducedMotion, uiScale: 1, density: DEFAULT_HUD_DENSITY };
}

/** Anything unreadable falls back to the default for that field; stored data is never trusted. */
export function parseHudSettings(raw: string | null, fallback: HudSettings): HudSettings {
  if (!raw) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof data !== "object" || data === null) return fallback;
  const record = data as Record<string, unknown>;
  return {
    reducedMotion:
      typeof record.reducedMotion === "boolean" ? record.reducedMotion : fallback.reducedMotion,
    uiScale: UI_SCALES.find((scale) => scale === record.uiScale) ?? fallback.uiScale,
    density: HUD_DENSITIES.find((density) => density === record.density) ?? fallback.density,
  };
}

export interface HudSettingsStore {
  read(): HudSettings;
  write(settings: HudSettings): void;
}

/**
 * Settings live in local storage so they outlive the tab. Unlike the profile secret they are
 * harmless to lose, so blocked storage degrades to the defaults silently. The reduced-motion
 * default follows the OS preference until the player chooses.
 */
export function createLocalStorageHudSettingsStore(
  storage: KeyValueStorage,
  prefersReducedMotion: () => boolean,
): HudSettingsStore {
  return {
    read() {
      const fallback = defaultHudSettings(prefersReducedMotion());
      try {
        return parseHudSettings(storage.getItem(SETTINGS_KEY), fallback);
      } catch {
        return fallback;
      }
    },
    write(settings) {
      try {
        storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // The setting still applies for this page; it just will not be remembered.
      }
    },
  };
}

export function createMemoryHudSettingsStore(prefersReducedMotion: () => boolean): HudSettingsStore {
  let saved: HudSettings | null = null;
  return {
    read: () => saved ?? defaultHudSettings(prefersReducedMotion()),
    write: (settings) => {
      saved = settings;
    },
  };
}
