import {
  HUD_DENSITIES,
  HUD_DENSITY_LABELS,
  hudFrameZoom,
  UI_SCALES,
  UI_SCALE_LABELS,
  type HudSettings,
  type HudSettingsStore,
} from "../state/hudSettings.js";

/** Fired on the root element after the settings are applied, so the HUD can re-evaluate at once. */
export const HUD_SETTINGS_CHANGED_EVENT = "hud-settings-changed";

/**
 * Reflects the settings onto the document: `data-reduced-motion` and `data-hud-density` for CSS, root font size for scale,
 * and `--hud-zoom`, the whole-number scale of the HUD frame art.
 */
export function applyHudSettings(settings: HudSettings, root: HTMLElement = document.documentElement): void {
  root.dataset.reducedMotion = String(settings.reducedMotion);
  root.dataset.hudDensity = settings.density;
  root.style.fontSize = `${settings.uiScale * 100}%`;
  root.style.setProperty("--hud-zoom", String(hudFrameZoom(settings.uiScale)));
  root.dispatchEvent(new Event(HUD_SETTINGS_CHANGED_EVENT));
}

/**
 * The accessibility section of the controls menu. Applies and persists each change at once, and
 * owns the current settings so the menu is the only writer.
 */
export function createHudSettingsSection(store: HudSettingsStore) {
  let settings = store.read();
  applyHudSettings(settings);

  const element = document.createElement("section");
  element.className = "controls-menu__group controls-menu__settings";

  const heading = document.createElement("h3");
  heading.textContent = "Accessibility";

  const motionLabel = document.createElement("label");
  motionLabel.className = "controls-menu__setting";
  const motion = document.createElement("input");
  motion.type = "checkbox";
  motion.checked = settings.reducedMotion;
  motionLabel.append(motion, " Reduce motion (no pulsing, flashing, or trailing bars)");

  const scaleLabel = document.createElement("label");
  scaleLabel.className = "controls-menu__setting";
  const scale = document.createElement("select");
  for (const value of UI_SCALES) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = UI_SCALE_LABELS[value] ?? String(value);
    scale.append(option);
  }
  scale.value = String(settings.uiScale);
  scaleLabel.append("UI scale ", scale);

  const densityLabel = document.createElement("label");
  densityLabel.className = "controls-menu__setting";
  const density = document.createElement("select");
  for (const value of HUD_DENSITIES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = HUD_DENSITY_LABELS[value];
    density.append(option);
  }
  density.value = settings.density;
  densityLabel.append("HUD density ", density);

  const update = (next: HudSettings): void => {
    settings = next;
    applyHudSettings(settings);
    store.write(settings);
  };
  motion.addEventListener("change", () => update({ ...settings, reducedMotion: motion.checked }));
  scale.addEventListener("change", () => update({ ...settings, uiScale: Number(scale.value) }));

  density.addEventListener("change", () => {
    const chosen = HUD_DENSITIES.find((value) => value === density.value);
    if (chosen) update({ ...settings, density: chosen });
  });

  element.append(heading, motionLabel, scaleLabel, densityLabel);
  return { element };
}
