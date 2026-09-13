import type { VoiceStatus } from "../audio/proximityAudio";
import type { ConnectionStatus } from "../network/gameClient";
import type { Position } from "../state/gameState";

type HudOptions = {
  onEnableVoice: () => void;
};

export function createHud(options: HudOptions) {
  const element = document.createElement("header");
  element.className = "hud";

  const title = document.createElement("h1");
  title.className = "hud__title";
  title.textContent = "DudesNDungeons";

  const connectionStatus = createStat("Connection", "offline");
  const voiceStatus = createStat("Voice", "voice disabled");
  const positionStatus = createStat("Position", "2, 2");
  const voiceButton = document.createElement("button");
  voiceButton.type = "button";
  voiceButton.textContent = "Enable Voice";
  voiceButton.addEventListener("click", options.onEnableVoice);

  const leftGroup = document.createElement("div");
  leftGroup.className = "hud__group";
  leftGroup.append(title, connectionStatus.element, positionStatus.element);

  const rightGroup = document.createElement("div");
  rightGroup.className = "hud__group";
  rightGroup.append(voiceStatus.element, voiceButton);

  element.append(leftGroup, rightGroup);

  return {
    element,
    setConnectionStatus(status: ConnectionStatus) {
      connectionStatus.value.textContent = status;
    },
    setVoiceStatus(status: VoiceStatus) {
      voiceStatus.value.textContent = status;
    },
    setPosition(position: Position) {
      positionStatus.value.textContent = `${position.x}, ${position.y}`;
    },
  };
}

function createStat(label: string, initialValue: string) {
  const element = document.createElement("div");
  element.className = "hud__stat";

  const value = document.createElement("span");
  value.textContent = initialValue;
  element.textContent = `${label}: `;
  element.append(value);

  return { element, value };
}
