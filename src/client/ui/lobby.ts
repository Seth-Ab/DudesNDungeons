import { ROOM_CODE_LENGTH } from "../../shared/constants/game.js";
import type { SessionView } from "../network/sessionState.js";

interface LobbyOptions {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
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
    options.onJoinRoom(roomCode, playerName());
  });

  createButton.addEventListener("click", () => {
    if (!requireName()) return;
    message.textContent = "Creating a dungeon...";
    options.onCreateRoom(playerName());
  });

  panel.append(heading, form, createButton, message);
  element.append(panel);

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

      if (view.lastError) {
        message.textContent = view.lastError.message;
      }
    },
    focus() {
      nameInput.focus();
    },
  };
}
