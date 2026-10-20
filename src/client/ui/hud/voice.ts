import { voiceStatusLabel, type VoiceState } from "../../audio/voiceMesh.js";
import { micChipView } from "../../state/hudView.js";
import { createButton, createStat } from "./dom.js";

interface VoiceOptions {
  onToggleVoice: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  /** The mic chip is the way to the voice settings, which live in the camp menu. */
  onOpenSettings: () => void;
}

const initialState: VoiceState = { status: "off", muted: false, deafened: false, peerCount: 0 };

const DENIED_HINT =
  "Microphone access was refused. Allow it in the browser's site settings, then enable voice again.";
const UNAVAILABLE_HINT = "No usable microphone was found, or another application is using it.";

/**
 * The Voice readout, the input level meter, and the voice/mute/deafen buttons, which live in the camp
 * menu, plus the mic chip that stays on screen. Every control here reflects the voice mesh's state;
 * none of them keeps a state of its own.
 */
export function createVoice(options: VoiceOptions) {
  const status = createStat("Voice", voiceStatusLabel(initialState));

  const meter = document.createElement("div");
  meter.className = "hud__meter";
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", "Microphone input level");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  const meterFill = document.createElement("div");
  meterFill.className = "hud__meter-fill";
  meter.append(meterFill);
  meter.hidden = true;

  const voiceButton = createButton("Enable Voice", options.onToggleVoice);
  const muteButton = createButton("Mute", options.onToggleMute);
  const deafenButton = createButton("Deafen", options.onToggleDeafen);

  const chip = createButton("", options.onOpenSettings);
  chip.className = "hud__mic";
  chip.setAttribute("aria-haspopup", "dialog");

  let state: VoiceState = initialState;
  let inSession = false;
  let shownLevel = -1;

  function render(): void {
    const live = state.status === "live";
    const busy = state.status === "requesting";

    status.value.textContent = voiceStatusLabel(state);
    status.element.classList.toggle(
      "hud__stat--warning",
      state.status === "denied" || state.status === "unavailable",
    );
    const hint = state.status === "denied" ? DENIED_HINT : state.status === "unavailable" ? UNAVAILABLE_HINT : "";
    status.element.title = hint;

    const mic = micChipView(state);
    chip.textContent = mic.text;
    chip.dataset.tone = mic.tone;
    chip.title = hint;
    chip.setAttribute("aria-label", `${mic.text}. Open voice settings`);

    voiceButton.textContent = live || busy ? "Disable Voice" : "Enable Voice";
    // Enabling only makes sense with a party to talk to; disabling is always allowed.
    voiceButton.disabled = !live && !busy && !inSession;

    muteButton.textContent = state.muted ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-pressed", String(state.muted));
    muteButton.disabled = !live;

    deafenButton.textContent = state.deafened ? "Undeafen" : "Deafen";
    deafenButton.setAttribute("aria-pressed", String(state.deafened));
    deafenButton.disabled = !live;

    meter.hidden = !live;
  }

  render();

  return {
    statusElement: status.element,
    meterElement: meter,
    chipElement: chip,
    buttons: [voiceButton, muteButton, deafenButton],

    setState(next: VoiceState) {
      state = next;
      render();
    },

    setInSession(next: boolean) {
      if (inSession === next) return;
      inSession = next;
      render();
    },

    /** Called every frame, so it writes to the DOM only when the reading changes. */
    setLevel(level: number) {
      const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
      if (percent === shownLevel) return;
      shownLevel = percent;
      meterFill.style.width = `${percent}%`;
      meter.setAttribute("aria-valuenow", String(percent));
    },
  };
}
