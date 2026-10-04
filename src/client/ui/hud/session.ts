import type { VoiceStatus } from "../../audio/proximityAudio.js";
import type { ControlsView } from "../../state/hudView.js";
import { readyLabel } from "../../state/hudView.js";
import { createButton, createStat } from "./dom.js";

interface SessionOptions {
  onEnableVoice: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onOpenControls: () => void;
}

/** Connection, room, position, and voice stats plus the ready/leave/controls/voice buttons. */
export function createSession(options: SessionOptions) {
  const connection = createStat("Connection", "offline");
  const room = createStat("Room", "-");
  const position = createStat("Position", "-");
  const voice = createStat("Voice", "voice disabled");

  let ready = false;
  const readyButton = createButton("Ready", () => {
    ready = !ready;
    options.onToggleReady(ready);
  });
  const leaveButton = createButton("Leave", options.onLeave);
  const controlsButton = createButton("Controls", options.onOpenControls);
  const voiceButton = createButton("Enable Voice", options.onEnableVoice);

  return {
    connectionElement: connection.element,
    roomElement: room.element,
    positionElement: position.element,
    // Appended in this order by the HUD, after the action buttons.
    buttons: [readyButton, leaveButton, controlsButton],
    voiceElements: [voice.element, voiceButton],

    setConnection(text: string) {
      connection.value.textContent = text;
    },
    setRoom(text: string) {
      room.value.textContent = text;
    },
    setPosition(text: string) {
      position.value.textContent = text;
    },
    setVoiceStatus(status: VoiceStatus) {
      voice.value.textContent = status;
    },

    update(view: ControlsView, selfReady: boolean | null) {
      readyButton.disabled = view.sessionControlsDisabled;
      leaveButton.disabled = view.sessionControlsDisabled;
      if (selfReady !== null && selfReady !== ready) ready = selfReady;
      readyButton.textContent = readyLabel(ready);
    },
  };
}
