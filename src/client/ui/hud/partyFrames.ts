import { partyFrames, VITAL_GLYPHS, type PartyFrameView } from "../../state/hudView.js";
import type { SessionView } from "../../network/sessionState.js";
import { characterLookKey } from "../../rendering/characters.js";
import { createCharacterPortraits } from "../../rendering/characterSprites.js";
import { createBar } from "./vitals.js";

type Portraits = ReturnType<typeof createCharacterPortraits>;

function createFrame(portraits: Portraits) {
  const element = document.createElement("li");
  element.className = "hud__frame";

  const portrait = portraits.createCanvas();
  portrait.className = "hud__frame-portrait";
  portrait.setAttribute("aria-hidden", "true");
  // Which look the canvas holds, so a snapshot that changes nothing does not repaint it.
  let paintedKey: string | null = null;

  const body = document.createElement("div");
  body.className = "hud__frame-body";

  const header = document.createElement("div");
  header.className = "hud__frame-header";
  const name = document.createElement("span");
  name.className = "hud__frame-name";
  const icon = document.createElement("span");
  icon.className = "hud__frame-state";
  icon.setAttribute("role", "img");
  header.append(name, icon);

  // A player still designing has no character to hurt yet, so their bars give way to what they
  // are doing instead.
  const caption = document.createElement("span");
  caption.className = "hud__frame-caption";

  const health = createBar(VITAL_GLYPHS.health, "Health", "health");
  const resistance = createBar(VITAL_GLYPHS.resistance, "Resistance", "resistance");
  body.append(header, caption, health.element, resistance.element);
  element.append(portrait, body);

  return {
    element,
    set(frame: PartyFrameView, sheetLoaded: boolean) {
      name.textContent = frame.name;
      icon.textContent = frame.icon;
      icon.title = frame.stateLabel;
      icon.setAttribute("aria-label", frame.stateLabel);
      element.dataset.state = frame.state;
      element.style.setProperty("--party-accent", frame.accent);

      const designing = frame.state === "designing";
      caption.textContent = designing ? frame.stateLabel : "";
      caption.hidden = !designing;
      health.element.hidden = designing;
      resistance.element.hidden = designing;
      health.set(frame.health);
      health.element.classList.toggle("hud__bar--low", frame.health.low);
      health.mark(frame.health.low ? VITAL_GLYPHS.low : "");
      resistance.set(frame.resistance);

      const key = sheetLoaded ? (frame.portrait ? characterLookKey(frame.portrait) : "silhouette") : null;
      if (key !== paintedKey) {
        portraits.paint(portrait, frame.portrait);
        paintedKey = key;
      }
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
  let sheetLoaded = false;
  let lastView: SessionView | null = null;

  // Portraits asked for before the sheet decodes are blank; repaint them from the last snapshot.
  const portraits = createCharacterPortraits(() => {
    sheetLoaded = true;
    if (lastView) update(lastView);
  });

  function update(view: SessionView) {
    lastView = view;
    const current = partyFrames(view);
    const ids = new Set(current.map((frame) => frame.id));
    for (const id of [...frames.keys()]) {
      if (!ids.has(id)) frames.delete(id);
    }

    element.replaceChildren(
      ...current.map((frame) => {
        let entry = frames.get(frame.id);
        if (!entry) {
          entry = createFrame(portraits);
          frames.set(frame.id, entry);
        }
        entry.set(frame, sheetLoaded);
        return entry.element;
      }),
    );
    element.hidden = current.length === 0;
  }

  return { element, update };
}
