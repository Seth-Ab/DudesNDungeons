import type { ControlsView } from "../../state/hudView.js";
import { readyLabel } from "../../state/hudView.js";
import { createButton, createStat } from "./dom.js";

interface SessionOptions {
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onOpenControls: () => void;
}

/**
 * Connection, room, and position stats plus the ready/leave/controls buttons. The position is a
 * debug readout: the HUD shows it only while the debug toggle is on.
 */
export function createSession(options: SessionOptions) {
  const connection = createStat("Connection", "offline");
  const room = createStat("Room", "-");
  const position = createStat("Position", "-");

  let ready = false;
  const readyButton = createButton("Ready", () => {
    ready = !ready;
    options.onToggleReady(ready);
  });
  const leaveButton = createButton("Leave", options.onLeave);
  const controlsButton = createButton("Controls", options.onOpenControls);

  return {
    connectionElement: connection.element,
    roomElement: room.element,
    positionElement: position.element,
    // Appended in this order by the HUD's session cluster.
    buttons: [readyButton, leaveButton, controlsButton],

    setConnection(text: string) {
      connection.value.textContent = text;
    },
    setRoom(text: string) {
      room.value.textContent = text;
    },
    setPosition(text: string) {
      position.value.textContent = text;
    },

    update(view: ControlsView, selfReady: boolean | null) {
      readyButton.disabled = view.sessionControlsDisabled;
      leaveButton.disabled = view.sessionControlsDisabled;
      if (selfReady !== null && selfReady !== ready) ready = selfReady;
      readyButton.textContent = readyLabel(ready);
    },
  };
}
