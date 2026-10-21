import { characterLookKey } from "../../rendering/characters.js";
import { createCharacterPortraits } from "../../rendering/characterSprites.js";
import {
  VITAL_GLYPHS,
  staminaRefused,
  vitalChange,
  type BarView,
  type VitalsView,
} from "../../state/hudView.js";

/** Re-triggers a CSS animation class even when it is already applied. */
function flash(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

/**
 * A bar with a glyph label. The ghost sits under the fill and lags behind it (a CSS transition),
 * which is what shows how much a hit just took. The server owns the numbers; this only draws them.
 */
export function createBar(glyph: string, name: string, modifier: string, numberInside = false) {
  const element = document.createElement("div");
  element.className = `hud__bar hud__bar--${modifier}`;

  const label = document.createElement("span");
  label.className = "hud__bar-label";
  label.textContent = glyph;
  label.title = name;
  label.setAttribute("role", "img");
  label.setAttribute("aria-label", name);

  const track = document.createElement("div");
  track.className = "hud__bar-track";

  const ghost = document.createElement("div");
  ghost.className = "hud__bar-ghost";

  const fill = document.createElement("div");
  fill.className = `hud__bar-fill hud__bar-fill--${modifier}`;
  track.append(ghost, fill);

  const value = document.createElement("span");
  value.className = "hud__bar-value";

  if (numberInside) {
    // The digits sit on the bar itself, over the fill; the bar's own text equivalent is set below.
    value.classList.add("hud__bar-value--inside");
    track.append(value);
    element.append(label, track);
  } else {
    element.append(label, track, value);
  }

  return {
    element,
    label,
    track,
    /** The digits; a caller may move them out of the bar's row. */
    value,
    /** Appends a state glyph to the label, so a state shows by shape and not only by colour. */
    mark(suffix: string) {
      label.textContent = `${glyph}${suffix}`;
    },
    set(bar: BarView, spoken?: string) {
      const width = `${bar.ratio * 100}%`;
      fill.style.width = width;
      ghost.style.width = width;
      value.textContent = bar.text;
      element.setAttribute("aria-valuenow", `${Math.round(bar.ratio * 100)}`);
      if (spoken) {
        element.setAttribute("role", "meter");
        element.setAttribute("aria-label", spoken);
        element.setAttribute("aria-valuemin", "0");
        element.setAttribute("aria-valuemax", "100");
      }
    },
  };
}

/**
 * The bottom-left self frame: the local character's portrait with the resistance badge on its
 * corner, their name, a health bar with its digits inside it, and a thin stamina bar beneath.
 * Health is the largest element; resistance is a number, not a bar.
 */
export function createVitals() {
  const health = createBar(VITAL_GLYPHS.health, "Health", "health", true);
  const stamina = createBar(VITAL_GLYPHS.stamina, "Stamina", "stamina");

  let lastPortrait: VitalsView["portrait"] = null;
  let sheetLoaded = false;
  let paintedKey: string | null = null;
  const portraits = createCharacterPortraits(() => {
    sheetLoaded = true;
    paintPortrait();
  });
  const portrait = portraits.createCanvas();
  portrait.className = "hud__vitals-portrait";
  portrait.setAttribute("aria-hidden", "true");

  function paintPortrait(): void {
    if (!sheetLoaded) return;
    const key = lastPortrait ? characterLookKey(lastPortrait) : "silhouette";
    if (key === paintedKey) return;
    portraits.paint(portrait, lastPortrait);
    paintedKey = key;
  }

  // The shield badge: the glyph (with ▼ while decaying) and the bare number. Its own text
  // equivalent stands in for both, so the parts are hidden from assistive tech.
  const badge = document.createElement("div");
  badge.className = "hud__badge hud__badge--resistance";
  badge.setAttribute("role", "img");
  const badgeLabel = document.createElement("span");
  badgeLabel.className = "hud__bar-label";
  badgeLabel.setAttribute("aria-hidden", "true");
  badgeLabel.textContent = VITAL_GLYPHS.resistance;
  const badgeNumber = document.createElement("span");
  badgeNumber.className = "hud__badge-number";
  badgeNumber.setAttribute("aria-hidden", "true");
  badge.append(badgeLabel, badgeNumber);

  const avatar = document.createElement("div");
  avatar.className = "hud__vitals-avatar";
  avatar.append(portrait, badge);

  // The name heads the bars, as it does on an ally's frame.
  const name = document.createElement("span");
  name.className = "hud__vitals-name";

  const bars = document.createElement("div");
  bars.className = "hud__vitals-bars";
  bars.append(name, health.element, stamina.element);

  const element = document.createElement("div");
  element.className = "hud__vitals";
  element.append(avatar, bars);

  let previousHealth: number | null = null;
  let previousRefusals: number | null = null;

  return {
    element,

    /** `health` is the raw number, for the damage/heal diff; null when there is no local player. */
    update(view: VitalsView, rawHealth: number | null, staminaRefusals: number) {
      name.textContent = view.name;
      health.set(view.health, view.health.spoken);
      stamina.set(view.stamina);

      health.element.classList.toggle("hud__bar--low", view.health.low);
      health.mark(view.health.low ? VITAL_GLYPHS.low : "");
      stamina.element.classList.toggle("hud__bar--full", view.stamina.full);

      badge.classList.toggle("hud__badge--decaying", view.resistance.decaying);
      badge.setAttribute("aria-label", view.resistance.spoken);
      badge.title = view.resistance.spoken;
      badgeLabel.textContent = `${VITAL_GLYPHS.resistance}${view.resistance.decaying ? VITAL_GLYPHS.decaying : ""}`;
      badgeNumber.textContent = view.resistance.text;

      if (view.accent) element.style.setProperty("--party-accent", view.accent);
      else element.style.removeProperty("--party-accent");
      lastPortrait = view.portrait;
      paintPortrait();

      const change = vitalChange(previousHealth, rawHealth);
      if (change) flash(health.track, `hud__bar-track--${change}`);
      previousHealth = rawHealth;

      // The first update only establishes the baseline, so a reconnect is not a refusal.
      if (previousRefusals !== null && staminaRefused(previousRefusals, staminaRefusals)) {
        flash(stamina.track, "hud__bar-track--refused");
      }
      previousRefusals = staminaRefusals;
    },
  };
}
