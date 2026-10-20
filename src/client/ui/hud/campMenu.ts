interface CampMenuSection {
  title: string;
  elements: HTMLElement[];
}

const FOCUSABLE = "button, input, select";

/**
 * The camp menu: the session and voice controls a player reaches for a few times a session, kept off
 * the screen until Escape, the key-hint strip, or the mic chip opens it. It does not pause anything;
 * the server keeps the world running.
 *
 * Open, it owns the keyboard the way the emote wheel does: every keydown stops here in the capture
 * phase, so Space activates a button instead of swinging and the movement keys do not walk the
 * player around behind it. Tab stays inside the menu, and closing hands focus back to where it was.
 */
export function createCampMenu(sections: readonly CampMenuSection[]) {
  const element = document.createElement("div");
  element.className = "camp-menu";
  element.hidden = true;

  const panel = document.createElement("section");
  panel.className = "camp-menu__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "camp-menu-title");

  const heading = document.createElement("h2");
  heading.id = "camp-menu-title";
  heading.textContent = "Camp";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "camp-menu__close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "camp-menu__header";
  header.append(heading, closeButton);

  const note = document.createElement("p");
  note.className = "camp-menu__note";
  note.textContent = "The dungeon does not wait while you are here.";

  panel.append(
    header,
    note,
    ...sections.map((section) => {
      const group = document.createElement("section");
      group.className = "camp-menu__group";
      const title = document.createElement("h3");
      title.textContent = section.title;
      const body = document.createElement("div");
      body.className = "camp-menu__controls";
      body.append(...section.elements);
      group.append(title, body);
      return group;
    }),
  );
  element.append(panel);

  /** Where focus was before opening, so closing hands it back rather than dropping it on the body. */
  let returnFocus: HTMLElement | null = null;

  const focusables = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (candidate) =>
        !(candidate as HTMLButtonElement).disabled && candidate.getClientRects().length > 0,
    );

  function open(): void {
    if (!element.hidden) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.hidden = false;
    // The first live control, past the Close button, so Enter does something useful straight away.
    (focusables().find((candidate) => candidate !== closeButton) ?? closeButton).focus();
  }

  function close(): void {
    if (element.hidden) return;
    element.hidden = true;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
  }

  const trapTab = (event: KeyboardEvent): void => {
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const inside = panel.contains(document.activeElement);
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  window.addEventListener(
    "keydown",
    (event) => {
      if (element.hidden) return;
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) close();
        return;
      }
      if (event.key === "Tab") trapTab(event);
      // Enter and Space are left to their default, which clicks the focused button.
    },
    true,
  );

  // A click or tap outside the panel closes the menu.
  element.addEventListener("click", (event) => {
    if (event.target === element) close();
  });
  closeButton.addEventListener("click", close);

  return {
    element,
    open,
    close,
    isOpen(): boolean {
      return !element.hidden;
    },
  };
}
