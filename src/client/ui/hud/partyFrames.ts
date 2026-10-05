import { partyFrames, VITAL_GLYPHS, type PartyFrameView } from "../../state/hudView.js";
import type { SessionView } from "../../network/sessionState.js";
import { createBar } from "./vitals.js";

function createFrame() {
  const element = document.createElement("li");
  element.className = "hud__frame";

  const header = document.createElement("div");
  header.className = "hud__frame-header";
  const name = document.createElement("span");
  name.className = "hud__frame-name";
  const icon = document.createElement("span");
  icon.className = "hud__frame-state";
  icon.setAttribute("role", "img");
  header.append(name, icon);

  const health = createBar(VITAL_GLYPHS.health, "Health", "health");
  const resistance = createBar(VITAL_GLYPHS.resistance, "Resistance", "resistance");
  element.append(header, health.element, resistance.element);

  return {
    element,
    set(frame: PartyFrameView) {
      name.textContent = frame.name;
      icon.textContent = frame.icon;
      icon.title = frame.stateLabel;
      icon.setAttribute("aria-label", frame.stateLabel);
      element.dataset.state = frame.state;
      health.set(frame.health);
      health.element.classList.toggle("hud__bar--low", frame.health.low);
      health.mark(frame.health.low ? VITAL_GLYPHS.low : "");
      resistance.set(frame.resistance);
    },
  };
}

/**
 * Frames are kept per player id so a bar's ghost trail survives between snapshots; a player who
 * is no longer in the snapshot has their frame removed outright.
 */
export function createPartyFrames() {
  const element = document.createElement("ul");
  element.className = "hud__frames";
  const frames = new Map<string, ReturnType<typeof createFrame>>();

  return {
    element,
    update(view: SessionView) {
      const current = partyFrames(view);
      const ids = new Set(current.map((frame) => frame.id));
      for (const id of [...frames.keys()]) {
        if (!ids.has(id)) frames.delete(id);
      }

      element.replaceChildren(
        ...current.map((frame) => {
          let entry = frames.get(frame.id);
          if (!entry) {
            entry = createFrame();
            frames.set(frame.id, entry);
          }
          entry.set(frame);
          return entry.element;
        }),
      );
      element.hidden = current.length === 0;
    },
  };
}
