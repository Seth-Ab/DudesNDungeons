import { partyFrames, VITAL_GLYPHS, type PartyFrameView } from "../../state/hudView.js";
import type { SessionView } from "../../network/sessionState.js";
import { characterLookKey } from "../../rendering/characters.js";
import { createCharacterPortraits } from "../../rendering/characterSprites.js";
import { createBar } from "./vitals.js";

type Portraits = ReturnType<typeof createCharacterPortraits>;

/** Printed on the portrait beside the ring, so speaking never reads from colour alone. */
export const SPEAKING_GLYPH = "♪";

function createFrame(portraits: Portraits) {
  const element = document.createElement("li");
  element.className = "hud__frame";

  const avatar = document.createElement("div");
  avatar.className = "hud__frame-avatar";
  const portrait = portraits.createCanvas();
  portrait.className = "hud__frame-portrait";
  portrait.setAttribute("aria-hidden", "true");
  const speakingBadge = document.createElement("span");
  speakingBadge.className = "hud__frame-speaking";
  speakingBadge.textContent = SPEAKING_GLYPH;
  speakingBadge.title = "Speaking";
  speakingBadge.setAttribute("role", "img");
  speakingBadge.setAttribute("aria-label", "Speaking");
  speakingBadge.hidden = true;
  avatar.append(portrait, speakingBadge);
  let speaking = false;
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
  element.append(avatar, body);

  return {
    element,
    /** Called every display frame, so it writes to the DOM only when the state flips. */
    setSpeaking(next: boolean) {
      if (speaking === next) return;
      speaking = next;
      element.dataset.speaking = String(next);
      speakingBadge.hidden = !next;
    },
    set(frame: PartyFrameView, sheetLoaded: boolean) {
      name.textContent = frame.name;
      icon.textContent = frame.icon;
      icon.title = frame.stateLabel;
      icon.setAttribute("aria-label", frame.stateLabel);
      element.dataset.state = frame.state;
      element.style.setProperty("--party-accent", frame.accent);

      // Without vitals (still designing, or out of sight) the bars give way to a words caption, so
      // the state never reads from the grey frame alone.
      const hasVitals = frame.health !== null && frame.resistance !== null && frame.state !== "designing";
      const captioned = !hasVitals;
      caption.textContent = captioned ? frame.stateLabel : "";
      caption.hidden = !captioned;
      health.element.hidden = !hasVitals;
      resistance.element.hidden = !hasVitals;
      if (frame.health && frame.resistance && hasVitals) {
        health.set(frame.health);
        health.element.classList.toggle("hud__bar--low", frame.health.low);
        health.mark(frame.health.low ? VITAL_GLYPHS.low : "");
        resistance.set(frame.resistance);
      }

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
 * has left the party has their frame removed outright.
 */
export function createPartyFrames() {
  const element = document.createElement("ul");
  element.className = "hud__frames";
  const frames = new Map<string, ReturnType<typeof createFrame>>();
  let sheetLoaded = false;
  let lastView: SessionView | null = null;
  /** Who the voice mesh last heard talking, so a frame made by a later snapshot starts right. */
  let speaking: ReadonlySet<string> = new Set();

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
        entry.setSpeaking(speaking.has(frame.id));
        return entry.element;
      }),
    );
    element.hidden = current.length === 0;
  }

  function setSpeaking(next: ReadonlySet<string>) {
    speaking = next;
    for (const [id, entry] of frames) entry.setSpeaking(next.has(id));
  }

  return { element, update, setSpeaking };
}
