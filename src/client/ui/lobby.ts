import { ROOM_CODE_LENGTH } from "../../shared/constants/game.js";
import type { SavedRunChoice } from "../network/sessionClient.js";
import type { SessionView } from "../network/sessionState.js";
import { saveConfirmation } from "../state/saveQuit.js";

interface LobbyOptions {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string, savedRun?: SavedRunChoice) => void;
}

export function createLobby(options: LobbyOptions) {
  const element = document.createElement("section");
  element.className = "lobby";

  const panel = document.createElement("div");
  panel.className = "lobby__panel";

  const heading = document.createElement("h2");
  heading.textContent = "Enter the dungeon";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Your name";
  nameInput.maxLength = 24;
  nameInput.autocomplete = "off";

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.placeholder = `Room code (${ROOM_CODE_LENGTH} characters)`;
  codeInput.maxLength = ROOM_CODE_LENGTH;
  codeInput.autocomplete = "off";
  // The server's alphabet is uppercase, so accept lowercase typing and fix it here.
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  const joinButton = document.createElement("button");
  joinButton.type = "submit";
  joinButton.textContent = "Join dungeon";

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "lobby__secondary";
  createButton.textContent = "Create a new dungeon";

  const message = document.createElement("p");
  message.className = "lobby__message";

  // Offered when the server answers a join with `savedRunExists`. Start fresh deletes the room's
  // save, so it asks a second time before it sends anything.
  const prompt = document.createElement("div");
  prompt.className = "lobby__prompt";
  prompt.setAttribute("role", "group");
  prompt.setAttribute("aria-labelledby", "lobby-prompt-title");
  prompt.hidden = true;

  const promptTitle = document.createElement("h3");
  promptTitle.id = "lobby-prompt-title";
  promptTitle.textContent = "This room has a saved run";

  const promptText = document.createElement("p");
  const promptActions = document.createElement("div");
  promptActions.className = "lobby__prompt-actions";

  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.textContent = "Continue";

  const startFreshButton = document.createElement("button");
  startFreshButton.type = "button";
  startFreshButton.className = "lobby__secondary";
  startFreshButton.textContent = "Start fresh";

  const notNowButton = document.createElement("button");
  notNowButton.type = "button";
  notNowButton.className = "lobby__secondary";
  notNowButton.textContent = "Not now";

  const discardButton = document.createElement("button");
  discardButton.type = "button";
  discardButton.textContent = "Delete saved run";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "lobby__secondary";
  cancelButton.textContent = "Cancel";

  prompt.append(promptTitle, promptText, promptActions);

  // Shown after Save and quit, and kept until the player joins, creates a room or dismisses it, so
  // the success is not a line of text that the next error can overwrite.
  const saved = document.createElement("div");
  saved.className = "lobby__saved";
  saved.setAttribute("role", "status");
  saved.setAttribute("aria-live", "polite");
  const savedTitle = document.createElement("h3");
  const savedText = document.createElement("p");
  const savedDismiss = document.createElement("button");
  savedDismiss.type = "button";
  savedDismiss.className = "lobby__secondary lobby__saved-dismiss";
  savedDismiss.textContent = "Dismiss";
  saved.append(savedTitle, savedText, savedDismiss);
  saved.hidden = true;

  const hideSaved = (): void => {
    saved.hidden = true;
  };
  savedDismiss.addEventListener("click", () => {
    hideSaved();
    nameInput.focus();
  });

  const form = document.createElement("form");
  form.className = "lobby__form";
  form.append(nameInput, codeInput, joinButton);

  const playerName = (): string => nameInput.value.trim();

  const requireName = (): boolean => {
    if (playerName().length > 0) return true;
    message.textContent = "Pick a name first.";
    nameInput.focus();
    return false;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireName()) return;

    const roomCode = codeInput.value.trim();
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      message.textContent = `Room codes are ${ROOM_CODE_LENGTH} characters.`;
      codeInput.focus();
      return;
    }

    message.textContent = "Joining...";
    hideSaved();
    options.onJoinRoom(roomCode, playerName());
  });

  createButton.addEventListener("click", () => {
    if (!requireName()) return;
    message.textContent = "Creating a dungeon...";
    hideSaved();
    options.onCreateRoom(playerName());
  });

  type PromptStep = "choose" | "confirm";
  /** Set by Not now, until the next join clears the error that raised the prompt. */
  let promptDismissed = false;

  function showPromptStep(step: PromptStep): void {
    if (step === "choose") {
      promptTitle.textContent = "This room has a saved run";
      promptText.textContent = "Continue it where you left off, or start fresh.";
      promptActions.replaceChildren(continueButton, startFreshButton, notNowButton);
      continueButton.focus();
    } else {
      promptTitle.textContent = "Delete the saved run?";
      promptText.textContent =
        "This deletes the saved run and everyone's characters in this room. The party vault is kept.";
      promptActions.replaceChildren(cancelButton, discardButton);
      cancelButton.focus();
    }
  }

  const rejoin = (savedRun: SavedRunChoice): void => {
    if (!requireName()) return;
    message.textContent = "Joining...";
    hideSaved();
    options.onJoinRoom(codeInput.value.trim(), playerName(), savedRun);
  };

  continueButton.addEventListener("click", () => rejoin("continue"));
  startFreshButton.addEventListener("click", () => showPromptStep("confirm"));
  cancelButton.addEventListener("click", () => showPromptStep("choose"));
  discardButton.addEventListener("click", () => rejoin("discard"));
  notNowButton.addEventListener("click", () => {
    promptDismissed = true;
    prompt.hidden = true;
    message.textContent = "";
    codeInput.focus();
  });

  panel.append(heading, saved, form, createButton, prompt, message);
  element.append(panel);

  /** The saved-and-quit room already filled in, so a later view update does not refill it. */
  let handledQuitRoom: string | null = null;

  return {
    element,
    setMessage(text: string) {
      message.textContent = text;
    },
    setRoomCode(roomCode: string) {
      codeInput.value = roomCode;
    },
    /** The lobby is only for players who are not yet in a dungeon. */
    syncTo(view: SessionView) {
      const busy = view.phase === "joining" || view.phase === "reconnecting";
      element.hidden = view.phase === "inSession";
      joinButton.disabled = busy;
      createButton.disabled = busy;
      for (const button of [continueButton, startFreshButton, discardButton]) button.disabled = busy;

      if (view.savedQuitRoomCode !== handledQuitRoom) {
        handledQuitRoom = view.savedQuitRoomCode;
        if (handledQuitRoom !== null) {
          codeInput.value = handledQuitRoom;
          message.textContent = "";
          const confirmation = saveConfirmation(handledQuitRoom);
          savedTitle.textContent = confirmation.title;
          savedText.textContent = confirmation.text;
          saved.hidden = false;
        }
      }

      const wantsPrompt = view.lastError?.code === "savedRunExists";
      if (!wantsPrompt) promptDismissed = false;
      const showPrompt = wantsPrompt && !promptDismissed;
      if (showPrompt && prompt.hidden) showPromptStep("choose");
      prompt.hidden = !showPrompt;

      if (view.lastError && !wantsPrompt) {
        message.textContent = view.lastError.message;
      } else if (showPrompt) {
        message.textContent = "";
      }
    },
    focus() {
      nameInput.focus();
    },
  };
}
