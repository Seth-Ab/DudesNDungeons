import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
} from "../../shared/constants/appearance.js";
import { MAX_PARTY_SIZE } from "../../shared/constants/game.js";
import type { PlayerAppearance, PlayerState } from "../../shared/types/core.js";
import type { SessionError, SessionView } from "../network/sessionState.js";
import { selfOf } from "../network/sessionState.js";
import { HAIR_RAMPS, SKIN_RAMPS } from "../rendering/characterPalettes.js";
import {
  createCharacterPreview,
  drawPartyRing,
  PREVIEW_TURNS,
  type PreviewPose,
} from "../rendering/characterPreview.js";
import {
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  createBlinkClock,
  NO_COSMETIC_LOOK,
  walkPose,
  type CharacterLook,
} from "../rendering/characters.js";
import {
  designScreenState,
  randomLook,
  startingLook,
  type LookStore,
} from "../state/characterDesign.js";

interface CharacterDesignOptions {
  store: LookStore;
  /** Sends the look. False when there is no connection to send it on. */
  onConfirm: (look: PlayerAppearance) => boolean;
  /** Gives up the reserved slot and returns to the lobby. */
  onBack: () => void;
}

/** Art pixels the large preview is drawn at: 10x, or 6x at phone width. */
const LARGE_SCALE = 10;
const PHONE_LARGE_SCALE = 6;
const PHONE_QUERY = "(max-width: 600px)";
/** The in-game panel is drawn at the scale the world renders players at. */
const GAME_SCALE = 2;
const FLAG_SIZE = 16;

const FLAG_COLOURS = ["#3a3835", "#34322f", "#3e3b38"] as const;

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  /** Fills the option's button: a swatch colour, or a canvas painted by `paint`. */
  swatch?: string;
  canvas?: { width: number; height: number };
}

/**
 * A radio group: one tab stop, arrows move the choice within it. Selecting on arrow is the point of
 * the screen, since the preview answers each key press.
 */
function createChoiceGroup<T extends string>(config: {
  label: string;
  options: readonly ChoiceOption<T>[];
  className: string;
  onChange: (id: T) => void;
}) {
  const element = document.createElement("div");
  element.className = "design__group";

  const title = document.createElement("span");
  title.className = "design__group-label";
  title.id = `design-group-${config.label.toLowerCase().replace(/\s+/g, "-")}`;
  title.textContent = config.label;

  const row = document.createElement("div");
  row.className = `design__choices ${config.className}`;
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-labelledby", title.id);

  const buttons = new Map<T, HTMLButtonElement>();
  const canvases = new Map<T, HTMLCanvasElement>();
  let current: T = config.options[0]!.id;

  const refresh = (): void => {
    for (const [id, button] of buttons) {
      const selected = id === current;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("design__choice--selected", selected);
    }
  };

  const select = (id: T, focus: boolean): void => {
    if (id !== current) {
      current = id;
      config.onChange(id);
    }
    refresh();
    if (focus) buttons.get(id)?.focus();
  };

  config.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "design__choice";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-label", option.label);
    button.title = option.label;
    if (option.swatch) {
      button.classList.add("design__choice--swatch");
      button.style.setProperty("--swatch", option.swatch);
    }
    if (option.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = option.canvas.width;
      canvas.height = option.canvas.height;
      canvas.setAttribute("aria-hidden", "true");
      button.append(canvas);
      canvases.set(option.id, canvas);
    }
    if (!option.swatch && !option.canvas) button.textContent = option.label;
    button.addEventListener("click", () => select(option.id, false));
    button.addEventListener("keydown", (event) => {
      const last = config.options.length - 1;
      let target: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") target = index === last ? 0 : index + 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = index === 0 ? last : index - 1;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = last;
      if (target === null) return;
      event.preventDefault();
      select(config.options[target]!.id, true);
    });
    buttons.set(option.id, button);
    row.append(button);
  });

  element.append(title, row);
  refresh();

  return {
    element,
    canvases,
    /** Sets the choice without announcing it, for a look chosen by the screen itself. */
    setValue(id: T) {
      current = id;
      refresh();
    },
    focus() {
      buttons.get(current)?.focus();
    },
  };
}

export function createCharacterDesign(options: CharacterDesignOptions) {
  const element = document.createElement("section");
  element.className = "design";
  element.hidden = true;
  element.setAttribute("aria-labelledby", "design-title");

  let look: PlayerAppearance = startingLook(options.store);
  let partyColor: CharacterLook["partyColor"] = "ember";
  let facingIndex = 0;
  let walking = false;
  let party: PlayerState[] = [];
  let selfId: string | null = null;
  let sentAgainst: SessionError | null | undefined;
  let lastError: SessionError | null = null;
  let shown = false;
  let frame = 0;

  const preview = createCharacterPreview(() => paintAll());
  const blinks = createBlinkClock();
  const phone = window.matchMedia(PHONE_QUERY);

  const fullLook = (): CharacterLook => ({ ...look, partyColor, ...NO_COSMETIC_LOOK });
  const largeScale = (): number => (phone.matches ? PHONE_LARGE_SCALE : LARGE_SCALE);

  // Stage: the large preview, turn and walk controls, and the in-game scale panel.
  const stage = document.createElement("div");
  stage.className = "design__stage";

  const large = document.createElement("canvas");
  large.className = "design__large";
  large.setAttribute("role", "img");
  large.setAttribute("aria-label", "Preview of your character");

  const turnLeft = document.createElement("button");
  turnLeft.type = "button";
  turnLeft.textContent = "◀ Turn";
  const walkToggle = document.createElement("button");
  walkToggle.type = "button";
  walkToggle.setAttribute("aria-pressed", "false");
  walkToggle.textContent = "Walk";
  const turnRight = document.createElement("button");
  turnRight.type = "button";
  turnRight.textContent = "Turn ▶";
  const turns = document.createElement("div");
  turns.className = "design__turns";
  turns.append(turnLeft, walkToggle, turnRight);

  const gameCaption = document.createElement("span");
  gameCaption.className = "design__caption";
  gameCaption.textContent = "In-game size, with your party";
  const game = document.createElement("canvas");
  game.className = "design__game";
  game.setAttribute("role", "img");
  game.setAttribute("aria-label", "Your character at in-game size among your party");
  stage.append(large, turns, gameCaption, game);

  // Options.
  const form = document.createElement("div");
  form.className = "design__form";

  const heading = document.createElement("h2");
  heading.id = "design-title";
  heading.textContent = "Create your adventurer";

  const roomLine = document.createElement("p");
  roomLine.className = "design__room";

  const nameRow = document.createElement("div");
  nameRow.className = "design__name";
  const nameLabel = document.createElement("span");
  nameLabel.className = "design__group-label";
  nameLabel.textContent = "Name";
  const nameValue = document.createElement("span");
  nameValue.className = "design__name-value";
  const partyChip = document.createElement("span");
  partyChip.className = "design__chip";
  nameRow.append(nameLabel, nameValue, partyChip);

  const bodyGroup = createChoiceGroup({
    label: "Body",
    className: "design__choices--tiles",
    options: BODY_TYPES.map((id) => ({
      id,
      label: id === "guy" ? "Guy" : "Girl",
      canvas: { width: CHARACTER_FRAME_WIDTH * 2, height: CHARACTER_FRAME_HEIGHT * 2 },
    })),
    onChange: (body) => change({ body }),
  });
  const skinGroup = createChoiceGroup({
    label: "Skin tone",
    className: "design__choices--swatches",
    options: SKIN_TONES.map((id) => ({ id, label: titleCase(id), swatch: SKIN_RAMPS[id][1] })),
    onChange: (skinTone) => change({ skinTone }),
  });
  const hairStyleGroup = createChoiceGroup({
    label: "Hair style",
    className: "design__choices--tiles",
    options: HAIR_STYLES.map((id) => ({
      id,
      label: titleCase(id),
      canvas: { width: CHARACTER_FRAME_WIDTH * 3, height: 14 * 3 },
    })),
    onChange: (hairStyle) => change({ hairStyle }),
  });
  const hairColorGroup = createChoiceGroup({
    label: "Hair colour",
    className: "design__choices--swatches",
    options: HAIR_COLORS.map((id) => ({ id, label: titleCase(id), swatch: HAIR_RAMPS[id][1] })),
    onChange: (hairColor) => change({ hairColor }),
  });

  const randomize = document.createElement("button");
  randomize.type = "button";
  randomize.className = "design__secondary";
  randomize.textContent = "Randomize (R)";

  const error = document.createElement("p");
  error.className = "design__error";
  error.setAttribute("role", "alert");

  const back = document.createElement("button");
  back.type = "button";
  back.className = "design__secondary";
  back.textContent = "Back";
  const enter = document.createElement("button");
  enter.type = "button";
  enter.textContent = "Enter the hub";
  const actions = document.createElement("div");
  actions.className = "design__actions";
  actions.append(back, enter);

  form.append(
    heading,
    roomLine,
    nameRow,
    bodyGroup.element,
    skinGroup.element,
    hairStyleGroup.element,
    hairColorGroup.element,
    randomize,
    error,
    actions,
  );

  const panel = document.createElement("div");
  panel.className = "design__panel";
  panel.append(stage, form);
  element.append(panel);

  function change(patch: Partial<PlayerAppearance>): void {
    look = { ...look, ...patch };
    paintAll();
  }

  function setLook(next: PlayerAppearance): void {
    look = next;
    bodyGroup.setValue(look.body);
    skinGroup.setValue(look.skinTone);
    hairStyleGroup.setValue(look.hairStyle);
    hairColorGroup.setValue(look.hairColor);
    paintAll();
  }

  function currentPose(now: number): PreviewPose {
    const turn = PREVIEW_TURNS[facingIndex]!;
    return {
      facing: turn.facing,
      mirror: turn.mirror,
      pose: walkPose(walking, now),
      blinking: blinks.blinking("design-preview", now),
    };
  }

  const STAND: PreviewPose = { facing: "down", mirror: false, pose: "stand", blinking: false };

  /** The option tiles show the look being built, so a skin or hair change re-tints every one. */
  function paintTiles(): void {
    const draw = (canvas: HTMLCanvasElement, tile: CharacterLook, px: number, crop?: { fromRow: number; rows: number }) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      preview.draw(ctx, tile, STAND, 0, 0, px, crop);
    };
    for (const [id, canvas] of bodyGroup.canvases) draw(canvas, { ...fullLook(), body: id }, 2);
    // The head and the hair above it: frame rows 3 to 16.
    for (const [id, canvas] of hairStyleGroup.canvases) {
      draw(canvas, { ...fullLook(), hairStyle: id }, 3, { fromRow: 3, rows: 14 });
    }
  }

  function paintLarge(now: number): void {
    const px = largeScale();
    const width = CHARACTER_FRAME_WIDTH * px;
    const height = CHARACTER_FRAME_HEIGHT * px;
    if (large.width !== width || large.height !== height) {
      large.width = width;
      large.height = height;
    }
    const ctx = large.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawPartyRing(ctx, 8 * px, 23 * px, px, preview.ringColor(partyColor));
    preview.draw(ctx, fullLook(), currentPose(now), 0, 0, px);
  }

  /** You and whoever has a look already, standing on flagstones the way the hub draws them. */
  function paintGame(now: number): void {
    const others = party.filter((player) => player.id !== selfId && player.appearance !== null).slice(0, MAX_PARTY_SIZE - 1);
    const count = others.length + 1;
    const slot = 16 * GAME_SCALE + 8 * GAME_SCALE;
    const width = Math.max(count, 2) * slot + 16 * GAME_SCALE;
    const height = 36 * GAME_SCALE + 14;
    if (game.width !== width || game.height !== height) {
      game.width = width;
      game.height = height;
    }
    const ctx = game.getContext("2d");
    if (!ctx) return;
    for (let y = 0; y * FLAG_SIZE * GAME_SCALE < height; y += 1) {
      for (let x = 0; x * FLAG_SIZE * GAME_SCALE < width; x += 1) {
        ctx.fillStyle = FLAG_COLOURS[(x * 7 + y * 3) % FLAG_COLOURS.length]!;
        const size = FLAG_SIZE * GAME_SCALE;
        ctx.fillRect(x * size, y * size, size, size);
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.fillRect(x * size, y * size, size, 1);
        ctx.fillRect(x * size, y * size, 1, size);
      }
    }

    const people: { id: string; name: string; look: CharacterLook; pose: PreviewPose }[] = [
      { id: "self", name: nameValue.textContent ?? "", look: fullLook(), pose: { ...STAND, pose: walkPose(walking, now), blinking: blinks.blinking("design-game", now) } },
      ...others.map((player) => ({
        id: player.id,
        name: player.name,
        look: { ...player.appearance!, partyColor: player.partyColor } as CharacterLook,
        pose: { ...STAND, blinking: blinks.blinking(player.id, now) },
      })),
    ];
    const start = (width - count * slot) / 2 + (slot - 16 * GAME_SCALE) / 2;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    people.forEach((person, index) => {
      const left = Math.round(start + index * slot);
      const top = 6;
      const feetY = top + 24 * GAME_SCALE;
      drawPartyRing(ctx, left + 8 * GAME_SCALE, feetY - GAME_SCALE, GAME_SCALE, preview.ringColor(person.look.partyColor));
      preview.draw(ctx, person.look, person.pose, left, top, GAME_SCALE);
      ctx.strokeStyle = "#0b0b0b";
      ctx.fillStyle = preview.ringColor(person.look.partyColor);
      ctx.strokeText(person.name, left + 8 * GAME_SCALE, feetY + 13);
      ctx.fillText(person.name, left + 8 * GAME_SCALE, feetY + 13);
    });
  }

  function paintAll(): void {
    if (!shown) return;
    paintTiles();
    const now = performance.now();
    paintLarge(now);
    paintGame(now);
  }

  function loop(): void {
    if (!shown) return;
    const now = performance.now();
    paintLarge(now);
    paintGame(now);
    frame = requestAnimationFrame(loop);
  }

  function turn(step: number): void {
    facingIndex = (facingIndex + step + PREVIEW_TURNS.length) % PREVIEW_TURNS.length;
  }

  turnLeft.addEventListener("click", () => turn(-1));
  turnRight.addEventListener("click", () => turn(1));
  walkToggle.addEventListener("click", () => {
    walking = !walking;
    walkToggle.setAttribute("aria-pressed", String(walking));
    walkToggle.classList.toggle("design__toggle--on", walking);
  });

  randomize.addEventListener("click", () => setLook(randomLook()));

  enter.addEventListener("click", () => {
    if (enter.disabled) return;
    const confirmed = { ...look };
    options.store.write(confirmed);
    if (options.onConfirm(confirmed)) {
      sentAgainst = lastError;
      error.textContent = "";
      enter.disabled = true;
      enter.textContent = "Entering…";
    } else {
      error.textContent = "No connection to the dungeon. Try again in a moment.";
    }
  });
  back.addEventListener("click", () => options.onBack());

  // The screen owns the keyboard while it is up, so game keys held for the dungeon never fire.
  element.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "r" || event.key === "R") {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      setLook(randomLook());
    }
  });

  return {
    element,
    /** Shows or hides the step for a view; opening it picks the starting look. */
    syncTo(view: SessionView) {
      lastError = view.lastError;
      const state = designScreenState(view, sentAgainst, MAX_PARTY_SIZE);
      const self = selfOf(view);
      party = view.players;
      selfId = view.selfId;
      partyColor = self?.partyColor ?? partyColor;
      nameValue.textContent = self?.name ?? "";
      partyChip.textContent = `Party colour: ${titleCase(partyColor)}`;
      partyChip.style.setProperty("--chip", preview.ringColor(partyColor));
      roomLine.textContent = state.roomLine ?? "";

      if (state.visible && !shown) {
        shown = true;
        element.hidden = false;
        sentAgainst = undefined;
        facingIndex = 0;
        walking = false;
        walkToggle.setAttribute("aria-pressed", "false");
        walkToggle.classList.remove("design__toggle--on");
        enter.disabled = false;
        enter.textContent = "Enter the hub";
        error.textContent = "";
        setLook(startingLook(options.store));
        bodyGroup.focus();
        frame = requestAnimationFrame(loop);
      } else if (!state.visible && shown) {
        shown = false;
        element.hidden = true;
        cancelAnimationFrame(frame);
      }

      if (!shown) return;
      if (!state.entering && sentAgainst !== undefined) {
        // The server answered the look with a refusal: let the player fix it and try again.
        enter.disabled = false;
        enter.textContent = "Enter the hub";
        error.textContent = state.error ?? "";
        sentAgainst = undefined;
      }
      paintAll();
    },
  };
}
