import type { ControlsView } from "../../state/hudView.js";
import { readyLabel } from "../../state/hudView.js";
import { createButton, createStat } from "./dom.js";

interface SessionOptions {
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onOpenControls: () => void;
}

/**
 * Connection, room, and position stats plus the ready/leave/controls buttons, which live in the
 * camp menu. A second Ready button stays on screen in the hub, sharing the menu one's state. The
 * position is a debug readout: the HUD shows it only while the debug toggle is on.
 */
export function createSession(options: SessionOptions) {
  const connection = createStat("Connection", "offline");
  const room = createStat("Room", "-");
  const position = createStat("Position", "-");

  let ready = false;
  const toggleReady = (): void => {
    ready = !ready;
    options.onToggleReady(ready);
  };
  const readyButton = createButton("Ready", toggleReady);
  const hubReadyButton = createButton("Ready", toggleReady);
  hubReadyButton.className = "hud__hub-ready";
  hubReadyButton.hidden = true;
  const leaveButton = createButton("Leave", options.onLeave);
  const controlsButton = createButton("Controls", options.onOpenControls);

  return {
    connectionElement: connection.element,
    roomElement: room.element,
    positionElement: position.element,
    readyButton,
    leaveButton,
    controlsButton,
    hubReadyButton,

    setConnection(text: string) {
      connection.value.textContent = text;
    },
    setRoom(text: string) {
      room.value.textContent = text;
    },
    setPosition(text: string) {
      position.value.textContent = text;
    },

    update(view: ControlsView, selfReady: boolean | null, inHub: boolean) {
      readyButton.disabled = view.sessionControlsDisabled;
      hubReadyButton.disabled = view.sessionControlsDisabled;
      leaveButton.disabled = view.sessionControlsDisabled;
      hubReadyButton.hidden = !inHub;
      if (selfReady !== null && selfReady !== ready) ready = selfReady;
      readyButton.textContent = readyLabel(ready);
      hubReadyButton.textContent = readyLabel(ready);
    },
  };
}
