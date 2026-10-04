import type { BarView, VitalsView } from "../../state/hudView.js";

/** A labelled fill bar. The server owns the numbers; this only draws them. */
function createBar(label: string, modifier: string) {
  const element = document.createElement("div");
  element.className = "hud__bar";

  const name = document.createElement("span");
  name.className = "hud__bar-label";
  name.textContent = label;

  const track = document.createElement("div");
  track.className = "hud__bar-track";

  const fill = document.createElement("div");
  fill.className = `hud__bar-fill hud__bar-fill--${modifier}`;
  track.append(fill);

  const value = document.createElement("span");
  value.className = "hud__bar-value";

  element.append(name, track, value);

  return {
    element,
    set(bar: BarView) {
      fill.style.width = `${bar.ratio * 100}%`;
      value.textContent = bar.text;
    },
  };
}

export function createVitals() {
  const health = createBar("Health", "health");
  const resistance = createBar("Resistance", "resistance");
  const stamina = createBar("Stamina", "stamina");

  const element = document.createElement("div");
  element.className = "hud__vitals";
  element.append(health.element, resistance.element, stamina.element);

  return {
    element,
    update(view: VitalsView) {
      health.set(view.health);
      resistance.set(view.resistance);
      stamina.set(view.stamina);
    },
  };
}
