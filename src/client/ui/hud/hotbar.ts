import type { GameplayAction } from "../../input/keyBindings.js";
import { SHEET_URL } from "../../rendering/tileset.js";
import { SHEET_HEIGHT, SHEET_WIDTH, spriteRect } from "../../rendering/tiles.js";
import {
  torchStatusLabel,
  type ActionPromptView,
  type HotbarSlotView,
} from "../../state/hudView.js";
import type { PlayerState } from "../../../shared/types/core.js";

/** Whole-number zoom, so the 16px art stays on a crisp pixel grid. */
const ICON_SCALE = 3;

interface HotbarOptions {
  onUseSlot: (slot: number) => void;
}

function paintIcon(icon: HTMLElement, sprite: string | null): void {
  if (!sprite) {
    icon.style.backgroundImage = "none";
    return;
  }
  const rect = spriteRect(sprite);
  icon.style.backgroundImage = `url("${SHEET_URL}")`;
  icon.style.backgroundSize = `${SHEET_WIDTH * ICON_SCALE}px ${SHEET_HEIGHT * ICON_SCALE}px`;
  icon.style.backgroundPosition = `-${rect.x * ICON_SCALE}px -${rect.y * ICON_SCALE}px`;
  icon.style.width = `${rect.width * ICON_SCALE}px`;
  icon.style.height = `${rect.height * ICON_SCALE}px`;
}

/**
 * Bottom-centre: the contextual prompt, the three item slots, and the torch pip. The pip is its own
 * element because a torch never takes a slot.
 */
export function createHotbar(options: HotbarOptions & { onAction: (action: GameplayAction) => void }) {
  const element = document.createElement("div");
  element.className = "hud__hotbar";

  const prompt = document.createElement("button");
  prompt.type = "button";
  prompt.className = "hud__prompt";
  prompt.hidden = true;
  let promptAction: GameplayAction | null = null;
  prompt.addEventListener("click", () => {
    if (promptAction) options.onAction(promptAction);
  });

  const bar = document.createElement("div");
  bar.className = "hud__hotbar-bar";

  const slots = [0, 1, 2].map((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud__slot hud__slot--empty";
    button.addEventListener("click", () => options.onUseSlot(slot));

    const key = document.createElement("span");
    key.className = "hud__slot-key";

    const icon = document.createElement("span");
    icon.className = "hud__slot-icon";
    icon.setAttribute("aria-hidden", "true");

    button.append(key, icon);
    return { button, key, icon };
  });

  const torch = document.createElement("div");
  torch.className = "hud__torch";
  torch.setAttribute("role", "img");

  const torchIcon = document.createElement("span");
  torchIcon.className = "hud__torch-icon";
  torchIcon.setAttribute("aria-hidden", "true");
  paintIcon(torchIcon, "loot-torch");
  torch.append(torchIcon);

  bar.append(...slots.map((slot) => slot.button), torch);
  element.append(prompt, bar);

  return {
    element,

    updateSlots(views: readonly HotbarSlotView[]) {
      views.forEach((view, index) => {
        const slot = slots[index];
        if (!slot) return;
        slot.key.textContent = view.keyHint;
        slot.button.disabled = view.disabled;
        slot.button.classList.toggle("hud__slot--empty", view.empty);
        const detail = view.description ? ` - ${view.description}` : "";
        slot.button.title = `${view.keyHint}: ${view.name}${detail}`;
        slot.button.setAttribute("aria-label", `Slot ${view.keyHint}: ${view.name}`);
        paintIcon(slot.icon, view.icon);
      });
    },

    updateTorch(self: PlayerState | null) {
      const carried = self?.carryingTorch === true;
      torch.classList.toggle("hud__torch--lit", carried);
      const label = `Torch: ${torchStatusLabel(self)}`;
      torch.title = label;
      torch.setAttribute("aria-label", label);
    },

    updatePrompt(view: ActionPromptView | null) {
      prompt.hidden = view === null;
      promptAction = view?.action ?? null;
      if (view) prompt.textContent = `[${view.keyHint}] ${view.text}`;
    },
  };
}
