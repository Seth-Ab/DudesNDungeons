import { rosterEntries } from "../../state/hudView.js";
import type { SessionView } from "../../network/sessionState.js";

export function createRoster() {
  const element = document.createElement("ul");
  element.className = "hud__roster";

  return {
    element,
    update(view: SessionView) {
      element.replaceChildren(
        ...rosterEntries(view).map((entry) => {
          const item = document.createElement("li");
          item.className = "hud__roster-entry";
          if (entry.offline) item.classList.add("hud__roster-entry--offline");
          if (entry.self) item.classList.add("hud__roster-entry--self");
          item.textContent = entry.text;
          return item;
        }),
      );
    },
  };
}
