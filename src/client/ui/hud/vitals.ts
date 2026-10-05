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
export function createBar(glyph: string, name: string, modifier: string) {
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

  element.append(label, track, value);

  return {
    element,
    label,
    track,
    /** Appends a state glyph to the label, so a state shows by shape and not only by colour. */
    mark(suffix: string) {
      label.textContent = `${glyph}${suffix}`;
    },
    set(bar: BarView) {
      const width = `${bar.ratio * 100}%`;
      fill.style.width = width;
      ghost.style.width = width;
      value.textContent = bar.text;
      element.setAttribute("aria-valuenow", `${Math.round(bar.ratio * 100)}`);
    },
  };
}

export function createVitals() {
  const health = createBar(VITAL_GLYPHS.health, "Health", "health");
  const resistance = createBar(VITAL_GLYPHS.resistance, "Resistance", "resistance");
  const stamina = createBar(VITAL_GLYPHS.stamina, "Stamina", "stamina");

  const element = document.createElement("div");
  element.className = "hud__vitals";
  element.append(health.element, resistance.element, stamina.element);

  let previousHealth: number | null = null;
  let previousRefusals: number | null = null;

  return {
    element,

    /** `health` is the raw number, for the damage/heal diff; null when there is no local player. */
    update(view: VitalsView, rawHealth: number | null, staminaRefusals: number) {
      health.set(view.health);
      resistance.set(view.resistance);
      stamina.set(view.stamina);

      health.element.classList.toggle("hud__bar--low", view.health.low);
      resistance.element.classList.toggle("hud__bar--decaying", view.resistance.decaying);
      health.mark(view.health.low ? VITAL_GLYPHS.low : "");
      resistance.mark(view.resistance.decaying ? VITAL_GLYPHS.decaying : "");

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
