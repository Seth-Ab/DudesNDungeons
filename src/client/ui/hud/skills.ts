import type { ScrollEntryView, SkillEntryView, SkillsPanelView } from "../../state/skillsView.js";

interface SkillsOptions {
  /** Opens the confirmation for a maxed scroll. Nothing is sent until that prompt is confirmed. */
  onConvert: (itemId: string) => void;
}

const STATUS_LABELS: Record<SkillEntryView["status"], string> = {
  permanent: "Permanent",
  provisional: "This run only",
  locked: "Locked",
  unavailable: "Unavailable",
};

function line(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function skillItem(entry: SkillEntryView): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `hud__skill hud__skill--${entry.status}`;

  const title = document.createElement("div");
  title.className = "hud__skill-title";
  const name = document.createElement("span");
  name.className = "hud__skill-name";
  name.textContent = entry.name;
  // The status is written out as well as coloured, so it does not rest on hue alone.
  const badge = document.createElement("span");
  badge.className = "hud__skill-badge";
  badge.textContent = entry.stackText === null ? STATUS_LABELS[entry.status] : `${STATUS_LABELS[entry.status]} · ${entry.stackText}`;
  title.append(name, badge);
  item.append(title, line("hud__skill-text", entry.description));

  if (entry.currentEffect) item.append(line("hud__skill-text hud__skill-effect", `Now: ${entry.currentEffect}`));
  if (entry.nextEffect) item.append(line("hud__skill-text", `Next stack: ${entry.nextEffect}`));
  if (entry.runStacks > 0 && entry.permanentStacks > 0) {
    item.append(line("hud__skill-text", `${entry.runStacks} of these stacks are lost unless you reach the hub.`));
  } else if (entry.status === "provisional") {
    item.append(line("hud__skill-text", "Lost unless you reach the hub."));
  }
  if (entry.missingPrerequisites.length > 0) {
    item.append(line("hud__skill-text hud__skill-need", `Requires ${entry.missingPrerequisites.join(", ")} first.`));
  }
  for (const way of entry.acquisition) item.append(line("hud__skill-text hud__skill-way", way));
  return item;
}

/**
 * The Skills panel, opened from the camp menu: what the player holds and what each stack does, what
 * is still locked and how it is earned, and the scrolls they carry that cannot be used yet. It is
 * read-only except for the one convert button on a maxed scroll, which only opens the confirmation.
 */
export function createSkills(options: SkillsOptions) {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";
  heading.textContent = "Skills";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hud__stash-close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "hud__stash-header";
  header.append(heading, closeButton);

  const balance = document.createElement("p");
  balance.className = "hud__stash-hint";

  const list = document.createElement("ul");
  list.className = "hud__skills";

  const scrollsHeading = document.createElement("p");
  scrollsHeading.className = "hud__stash-heading hud__skills-sub";
  scrollsHeading.textContent = "Scrolls to sort out";
  const scrolls = document.createElement("ul");
  scrolls.className = "hud__skills";

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__skills-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Skills");
  panel.hidden = true;
  panel.append(header, balance, list, scrollsHeading, scrolls);

  const close = (): void => {
    panel.hidden = true;
  };
  closeButton.addEventListener("click", close);

  function scrollItem(entry: ScrollEntryView): HTMLLIElement {
    const item = document.createElement("li");
    item.className = `hud__skill hud__skill--scroll-${entry.state}`;
    const title = document.createElement("div");
    title.className = "hud__skill-title";
    const name = document.createElement("span");
    name.className = "hud__skill-name";
    name.textContent = entry.name;
    const where = document.createElement("span");
    where.className = "hud__skill-badge";
    where.textContent = entry.where === "vault" ? "In the vault" : "Carried";
    title.append(name, where);
    item.append(title, line("hud__skill-text", entry.text));
    if (entry.canConvert) {
      const convert = document.createElement("button");
      convert.type = "button";
      convert.textContent = "Convert to coin…";
      convert.addEventListener("click", () => options.onConvert(entry.itemId));
      item.append(convert);
    }
    return item;
  }

  // Snapshots arrive every tick; rebuilding the lists each time would drop focus from a button.
  let lastSignature = "";

  return {
    panel,
    close,

    open() {
      panel.hidden = false;
      closeButton.focus();
    },

    isOpen(): boolean {
      return !panel.hidden;
    },

    update(view: SkillsPanelView) {
      const signature = JSON.stringify(view);
      if (signature === lastSignature) return;
      lastSignature = signature;
      balance.textContent = view.runCoin > 0 ? `Coin ${view.coin} (+${view.runCoin} this run)` : `Coin ${view.coin}`;
      if (!view.ready) {
        list.replaceChildren(line("hud__skill-text", "Waiting for the dungeon to share your skills."));
      } else {
        list.replaceChildren(...view.skills.map(skillItem));
      }
      scrolls.replaceChildren(...view.scrolls.map(scrollItem));
      scrollsHeading.hidden = view.scrolls.length === 0;
      scrolls.hidden = view.scrolls.length === 0;
    },
  };
}
