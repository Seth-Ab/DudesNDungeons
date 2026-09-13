export interface Banner {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
}

interface OverlayOptions {
  onResume: () => void;
  onLeave: () => void;
}

const CONTROLS: [key: string, action: string][] = [
  ["WASD / arrows", "Move"],
  ["Space or J", "Attack in the direction you last moved"],
  ["E", "Pick up, open doors, take the exit"],
  ["Q", "Drink a tonic"],
  ["1-8", "Use an inventory slot"],
  ["Esc", "Open or close this menu"],
];

/**
 * Everything drawn over the canvas: a transient notice, a banner for being downed or clearing the
 * dungeon, and the menu. The server never pauses, so the menu only stops this client's input.
 */
export function createOverlay(options: OverlayOptions) {
  const element = document.createElement("div");
  element.className = "overlay";

  const notice = document.createElement("p");
  notice.className = "overlay__notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;

  const banner = document.createElement("div");
  banner.className = "overlay__banner";
  banner.hidden = true;
  const bannerTitle = document.createElement("h2");
  const bannerDetail = document.createElement("p");
  const bannerButton = document.createElement("button");
  bannerButton.type = "button";
  bannerButton.hidden = true;
  banner.append(bannerTitle, bannerDetail, bannerButton);

  let bannerAction: (() => void) | null = null;
  let bannerKey = "";
  bannerButton.addEventListener("click", () => {
    bannerButton.blur();
    bannerAction?.();
  });

  const menu = document.createElement("div");
  menu.className = "overlay__menu";
  menu.hidden = true;

  const panel = document.createElement("div");
  panel.className = "overlay__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Menu");

  const heading = document.createElement("h2");
  heading.textContent = "Menu";

  const hint = document.createElement("p");
  hint.className = "overlay__hint";
  hint.textContent = "The dungeon keeps going while this is open.";

  const controls = document.createElement("dl");
  controls.className = "overlay__controls";
  for (const [key, action] of CONTROLS) {
    const term = document.createElement("dt");
    term.textContent = key;
    const description = document.createElement("dd");
    description.textContent = action;
    controls.append(term, description);
  }

  const resumeButton = document.createElement("button");
  resumeButton.type = "button";
  resumeButton.textContent = "Resume";
  resumeButton.addEventListener("click", () => {
    resumeButton.blur();
    options.onResume();
  });

  const leaveButton = document.createElement("button");
  leaveButton.type = "button";
  leaveButton.textContent = "Leave dungeon";
  leaveButton.addEventListener("click", () => {
    leaveButton.blur();
    options.onLeave();
  });

  const actions = document.createElement("div");
  actions.className = "overlay__actions";
  actions.append(leaveButton, resumeButton);

  panel.append(heading, hint, controls, actions);
  menu.append(panel);
  element.append(notice, banner, menu);

  return {
    element,

    setNotice(text: string | null) {
      notice.hidden = text === null;
      if (text !== null && notice.textContent !== text) notice.textContent = text;
    },

    /** Called every frame, so it only touches the DOM when the banner actually changes. */
    setBanner(next: Banner | null) {
      const key = next ? `${next.title}\n${next.detail}\n${next.action?.label ?? ""}` : "";
      if (key === bannerKey) return;
      bannerKey = key;

      banner.hidden = next === null;
      if (!next) return;

      bannerTitle.textContent = next.title;
      bannerDetail.textContent = next.detail;
      bannerAction = next.action?.run ?? null;
      bannerButton.hidden = !next.action;
      bannerButton.textContent = next.action?.label ?? "";
    },

    setMenuOpen(open: boolean) {
      menu.hidden = !open;
      if (open) resumeButton.focus();
    },
  };
}
