import { ROOM_CODE_LENGTH } from "../../shared/constants/game.js";
import type { SavedRunCard } from "../../shared/protocol/index.js";
import type { SavedRunChoice } from "../network/sessionClient.js";
import type { SessionView } from "../network/sessionState.js";
import { createCharacterPreview, type PreviewPose } from "../rendering/characterPreview.js";
import { NO_COSMETIC_LOOK, type CharacterLook } from "../rendering/characters.js";
import { saveConfirmation } from "../state/saveQuit.js";
import { savedRunDetails, savedRunTitle } from "../state/savedRuns.js";

interface LobbyOptions {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string, savedRun?: SavedRunChoice) => void;
  /** Asks the server for this profile's Continue list; the answer arrives on `SessionView.savedRuns`. */
  onRequestSavedRuns?: () => void;
}

const STAND: PreviewPose = { facing: "down", mirror: false, pose: "stand", blinking: false };
/** The head and the hair above it: frame rows 3 to 16, as the design screen's hair tiles. */
const HEAD_CROP = { fromRow: 3, rows: 14 };
const HEAD_WIDTH = 16;
const PORTRAIT_SCALE = 3;
const TEAMMATE_SCALE = 2;

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

  // The server's list of runs this profile can continue, one card each. Hidden while empty.
  const continueList = document.createElement("section");
  continueList.className = "lobby__continue";
  continueList.setAttribute("aria-labelledby", "lobby-continue-title");
  continueList.hidden = true;
  const continueTitle = document.createElement("h3");
  continueTitle.id = "lobby-continue-title";
  continueTitle.textContent = "Continue a saved run";
  const cards = document.createElement("ul");
  cards.className = "lobby__cards";
  continueList.append(continueTitle, cards);

  const continueButtons: HTMLButtonElement[] = [];
  const portraits: { canvas: HTMLCanvasElement; look: CharacterLook; scale: number }[] = [];
  const preview = createCharacterPreview(() => paintPortraits());
  let listRequested = false;

  function paintPortraits(): void {
    for (const { canvas, look, scale } of portraits) {
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      preview.draw(ctx, look, STAND, 0, 0, scale, HEAD_CROP);
    }
  }

  function headCanvas(character: SavedRunCard["character"], scale: number, className: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = className;
    canvas.width = HEAD_WIDTH * scale;
    canvas.height = HEAD_CROP.rows * scale;
    canvas.title = character.name;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", character.name);
    const look = { ...character.appearance, partyColor: character.partyColor, ...NO_COSMETIC_LOOK } as CharacterLook;
    portraits.push({ canvas, look, scale });
    return canvas;
  }

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

  panel.append(heading, saved, continueList, form, createButton, prompt, message);
  element.append(panel);

  /** The list last drawn, so a view update that did not change it does not rebuild the cards. */
  let drawnRuns: readonly SavedRunCard[] | null = null;

  function showSavedRuns(runs: readonly SavedRunCard[] | null): void {
    if (runs === drawnRuns) return;
    drawnRuns = runs;
    portraits.length = 0;
    continueButtons.length = 0;
    cards.replaceChildren();
    continueList.hidden = runs === null || runs.length === 0;
    const now = Date.now();

    for (const run of runs ?? []) {
      const item = document.createElement("li");
      item.className = "lobby__card";

      const details = document.createElement("div");
      details.className = "lobby__card-details";
      const title = document.createElement("b");
      title.textContent = savedRunTitle(run.character.name, run.dungeonName);
      const info = document.createElement("small");
      info.textContent = savedRunDetails(run, now);
      details.append(title, info);

      if (run.teammates.length > 0) {
        const heads = document.createElement("div");
        heads.className = "lobby__heads";
        for (const teammate of run.teammates) heads.append(headCanvas(teammate, TEAMMATE_SCALE, "lobby__head"));
        details.append(heads);
      }

      const go = document.createElement("button");
      go.type = "button";
      go.className = "lobby__card-continue";
      go.textContent = "Continue";
      go.addEventListener("click", () => {
        // Typing a name is optional here: the card already names the character.
        const name = playerName() || run.character.name;
        message.textContent = "Joining...";
        hideSaved();
        codeInput.value = run.roomCode;
        options.onJoinRoom(run.roomCode, name, "continue");
      });
      continueButtons.push(go);

      item.append(headCanvas(run.character, PORTRAIT_SCALE, "lobby__portrait"), details, go);
      cards.append(item);
    }
    paintPortraits();
  }

  /** The saved-and-quit room already filled in, so a later view update does not refill it. */
  let handledQuitRoom: string | null = null;

  return {
    element,
    setMessage(text: string) {
      message.textContent = text;
    },
    /** Keeps the name field in step with a rename made on the design screen, so a rejoin sends it. */
    setPlayerName(name: string) {
      nameInput.value = name;
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
      for (const button of [continueButton, startFreshButton, discardButton, ...continueButtons]) {
        button.disabled = busy;
      }

      // Asked once the lobby shows with no session, and again after each return to it.
      if (view.phase === "inSession") listRequested = false;
      else if (view.phase === "offline" && !listRequested) {
        listRequested = true;
        options.onRequestSavedRuns?.();
      }
      showSavedRuns(view.savedRuns);

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
