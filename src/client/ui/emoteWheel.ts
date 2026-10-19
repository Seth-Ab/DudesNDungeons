import { EMOTES, type EmoteKind } from "../../shared/constants/emotes.js";
import type { PlayerState } from "../../shared/types/core.js";
import { actionForKey } from "../input/keyBindings.js";
import { EMOTE_TEXT, emoteAllowed, emoteForDigit } from "../state/emotes.js";

interface EmoteWheelOptions {
  onEmote: (kind: EmoteKind) => void;
}

/** Keys that move focus around the ring, as a step through `EMOTES`. */
const FOCUS_STEPS = new Map<string, number>([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);

/**
 * The emote wheel: eight buttons in a ring, opened on its rebindable key or the HUD's Emote button.
 * Mouse and touch pick a button; while it is open, keys 1-8 pick by number, the arrows walk focus
 * around the ring, Enter or Space picks the focused one, and Escape or the wheel key closes it.
 *
 * Open, it owns the keyboard: every keydown stops here in the capture phase, so a number picks an
 * emote instead of using an inventory slot and Space activates a button instead of swinging. Keyups
 * pass, so a movement key held when the wheel opened is still released.
 */
export function createEmoteWheel(options: EmoteWheelOptions) {
  const element = document.createElement("div");
  element.className = "emote-wheel";
  element.hidden = true;

  const ring = document.createElement("div");
  ring.className = "emote-wheel__ring";
  ring.setAttribute("role", "dialog");
  ring.setAttribute("aria-modal", "true");
  ring.setAttribute("aria-label", "Emotes");

  const hint = document.createElement("p");
  hint.className = "emote-wheel__hint";
  hint.textContent = "Pick an emote";

  const buttons = EMOTES.map((kind, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emote-wheel__option";
    // Clockwise from the top, so the number keys read around the ring like a clock face.
    const angle = (index / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
    button.style.setProperty("--x", Math.cos(angle).toFixed(3));
    button.style.setProperty("--y", Math.sin(angle).toFixed(3));

    const number = document.createElement("span");
    number.className = "emote-wheel__number";
    number.textContent = `${index + 1}`;
    number.setAttribute("aria-hidden", "true");
    button.append(number, EMOTE_TEXT[kind].name);
    button.setAttribute("aria-keyshortcuts", `${index + 1}`);
    button.addEventListener("click", () => pick(kind));
    return button;
  });

  ring.append(hint, ...buttons);
  element.append(ring);

  /** Where focus was before opening, so closing hands it back rather than dropping it on the body. */
  let returnFocus: HTMLElement | null = null;
  let self: PlayerState | null = null;

  const refresh = (): void => {
    EMOTES.forEach((kind, index) => {
      buttons[index]!.disabled = !emoteAllowed(self, kind);
    });
    hint.textContent = self && self.health <= 0 ? "Downed: only Help" : "Pick an emote";
  };

  function open(): void {
    if (!element.hidden) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    refresh();
    element.hidden = false;
    (buttons.find((button) => !button.disabled) ?? buttons[0])?.focus();
  }

  function close(): void {
    if (element.hidden) return;
    element.hidden = true;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
  }

  function pick(kind: EmoteKind): void {
    if (!emoteAllowed(self, kind)) return;
    options.onEmote(kind);
    close();
  }

  const moveFocus = (step: number): void => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    for (let offset = 1; offset <= buttons.length; offset += 1) {
      const index = (((current + step * offset) % buttons.length) + buttons.length) % buttons.length;
      const next = buttons[index]!;
      if (!next.disabled) {
        next.focus();
        return;
      }
    }
  };

  window.addEventListener(
    "keydown",
    (event) => {
      if (element.hidden) return;
      // Tab still walks the buttons, and a modifier alone means nothing yet.
      if (event.key === "Tab" || event.key === "Shift") return;
      event.stopPropagation();

      if (event.key === "Escape" || (!event.repeat && actionForKey(event.key) === "emoteWheel")) {
        event.preventDefault();
        close();
        return;
      }

      const step = FOCUS_STEPS.get(event.key);
      if (step !== undefined) {
        event.preventDefault();
        moveFocus(step);
        return;
      }

      const kind = emoteForDigit(event.key);
      if (kind) {
        event.preventDefault();
        if (!event.repeat) pick(kind);
        return;
      }

      // Enter and Space are left to their default, which clicks the focused button. Anything else
      // is swallowed so the game behind the wheel does not act on it.
      if (event.key !== "Enter" && event.key !== " ") event.preventDefault();
    },
    true,
  );

  // A click or tap outside the ring closes the wheel.
  element.addEventListener("click", (event) => {
    if (event.target === element) close();
  });

  return {
    element,
    open,
    close,
    toggle(): void {
      if (element.hidden) open();
      else close();
    },
    isOpen(): boolean {
      return !element.hidden;
    },
    /** Keeps the greyed-out options in step with whether the local player is downed. */
    setSelf(player: PlayerState | null): void {
      self = player;
      if (!element.hidden) refresh();
    },
  };
}
