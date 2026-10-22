import type { ControlsView } from "../../state/hudView.js";
import { readyLabel } from "../../state/hudView.js";
import { saveQuitButtonLabel, saveQuitStillPending } from "../../state/saveQuit.js";
import { createButton, createStat } from "./dom.js";

interface SessionOptions {
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  /** Returns false when the intent could not be sent, so the button can come back. */
  onSaveAndQuit: () => boolean;
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
  // Only in the dungeon: the hub has no run to save, and the server refuses it there.
  // Pending from the click until the server answers: a refusal or the return to the lobby ends it.
  let saveQuitPending = false;
  const saveQuitButton = createButton(saveQuitButtonLabel(false), () => {
    saveQuitPending = true;
    saveQuitButton.textContent = saveQuitButtonLabel(true);
    saveQuitButton.disabled = true;
    if (!options.onSaveAndQuit()) {
      saveQuitPending = false;
      saveQuitButton.textContent = saveQuitButtonLabel(false);
      saveQuitButton.disabled = false;
    }
  });
  saveQuitButton.hidden = true;
  const saveQuitNotice = document.createElement("p");
  saveQuitNotice.className = "camp-menu__refusal";
  saveQuitNotice.setAttribute("role", "status");
  saveQuitNotice.hidden = true;
  const controlsButton = createButton("Controls", options.onOpenControls);

  return {
    connectionElement: connection.element,
    roomElement: room.element,
    positionElement: position.element,
    readyButton,
    leaveButton,
    saveQuitButton,
    saveQuitNotice,
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

    update(
      view: ControlsView,
      selfReady: boolean | null,
      inHub: boolean,
      inDungeon: boolean,
      refusal: string | null,
    ) {
      readyButton.disabled = view.sessionControlsDisabled;
      hubReadyButton.disabled = view.sessionControlsDisabled;
      leaveButton.disabled = view.sessionControlsDisabled;
      saveQuitPending = saveQuitStillPending(saveQuitPending, refusal, inDungeon);
      saveQuitButton.textContent = saveQuitButtonLabel(saveQuitPending);
      saveQuitButton.disabled = view.sessionControlsDisabled || saveQuitPending;
      saveQuitButton.hidden = !inDungeon;
      saveQuitNotice.textContent = refusal ?? "";
      saveQuitNotice.hidden = !inDungeon || refusal === null;
      hubReadyButton.hidden = !inHub;
      if (selfReady !== null && selfReady !== ready) ready = selfReady;
      readyButton.textContent = readyLabel(ready);
      hubReadyButton.textContent = readyLabel(ready);
    },
  };
}
