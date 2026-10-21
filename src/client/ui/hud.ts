import type { VoiceState } from "../audio/voiceMesh.js";
import { isTypingTarget } from "../input/inputController.js";
import { DEBUG_KEY, type GameplayAction } from "../input/keyBindings.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import { followTouchControls } from "../state/touchControls.js";
import { itemFeedbackEvents } from "../state/itemFeedback.js";
import { createHudFade, type HudModuleId } from "../state/hudFade.js";
import { hudDensityFrom } from "../state/hudSettings.js";
import { HUD_SETTINGS_CHANGED_EVENT } from "./hudSettings.js";
import { minimapRoomName, minimapWorldKey } from "../state/minimap.js";
import {
  connectionLabel,
  actionPrompt,
  controlsView,
  hubStatusView,
  runClockView,
  heldView,
  hotbarView,
  hubReadyVisible,
  newServerAction,
  partyFrames as partyFramesView,
  positionLabel,
  torchView,
  vitalChange,
  roomCodeLabel,
  toastMessages,
  vaultPanelView,
  vitalsView,
} from "../state/hudView.js";
import { coinReadout, convertPromptView } from "../state/convertPrompt.js";
import { skillsPanelView } from "../state/skillsView.js";
import { inVaultArea } from "../state/runFlow.js";
import type { Vector2 } from "../../shared/types/core.js";
import { createActions } from "./hud/actions.js";
import { createDrawReadout } from "./hud/drawReadout.js";
import { createCampMenu } from "./hud/campMenu.js";
import { createConvertPrompt } from "./hud/convertPrompt.js";
import { createDamageVignette } from "./hud/damageVignette.js";
import { createHubStatus } from "./hud/hubStatus.js";
import { createRunClock } from "./hud/runClock.js";
import { createButton, createPanel } from "./hud/dom.js";
import { createHotbar } from "./hud/hotbar.js";
import { createInventory } from "./hud/inventory.js";
import { createItemFeedback } from "./hud/itemFeedback.js";
import { createKeyHints } from "./hud/keyHints.js";
import { createMinimap } from "./hud/minimap.js";
import { createPartyFrames } from "./hud/partyFrames.js";
import { createSkills } from "./hud/skills.js";
import { createSession } from "./hud/session.js";
import { createNoticeStack, createToasts } from "./hud/toasts.js";
import { createVault } from "./hud/vault.js";
import { createVitals } from "./hud/vitals.js";
import { createVoice } from "./hud/voice.js";

/** How often the fade re-checks which modules have gone quiet. */
const FADE_TICK_MS = 250;

interface HudOptions {
  onToggleVoice: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onAttack: () => void;
  onAction: (action: GameplayAction) => void;
  onUseSlot: (slot: number) => void;
  onOpenControls: () => void;
  onOpenEmotes: () => void;
  onWithdrawVaultItem: (itemId: string) => void;
  onDepositVaultItem: (itemId: string) => void;
  onConvertScroll: (itemId: string) => void;
  onDismissConvert: () => void;
  onRequestConvert: (itemId: string) => void;
}

/**
 * Composes the HUD from the modules under `hud/`; what each element shows lives in
 * `state/hudView.ts`. The HUD is a set of overlay panels over the full-viewport canvas: the root
 * ignores the pointer, and only the panels' own buttons take it.
 */
export function createHud(options: HudOptions) {
  const element = document.createElement("div");
  element.className = "hud";

  /**
   * The last server action shown, so a client-side message is not wiped by the next snapshot 50ms
   * later. See `newServerAction`.
   */
  let lastServerAction: string | null = null;

  // Declared before the modules that open it; assigned once they exist.
  let openCamp = (): void => {};
  let closeCamp = (): void => {};
  // Only once the player is in the world: the lobby and the design screen have their own controls.
  let campAvailable = false;

  const session = createSession({
    onToggleReady: options.onToggleReady,
    onLeave: () => {
      closeCamp();
      options.onLeave();
    },
    onOpenControls: () => {
      closeCamp();
      options.onOpenControls();
    },
  });
  const voice = createVoice({ ...options, onOpenSettings: () => openCamp() });
  const keyHints = createKeyHints({ onOpenCamp: () => openCamp() });
  const vitals = createVitals();
  const partyFrames = createPartyFrames();
  const inventory = createInventory();
  const vault = createVault({
    onWithdraw: options.onWithdrawVaultItem,
    onDeposit: options.onDepositVaultItem,
  });
  const skills = createSkills({ onConvert: options.onRequestConvert });
  const minimap = createMinimap();
  const convertPrompt = createConvertPrompt({
    onConfirm: options.onConvertScroll,
    onCancel: options.onDismissConvert,
  });
  let noteCombat = (): void => {};
  const actions = createActions({
    ...options,
    onAttack: () => {
      noteCombat();
      options.onAttack();
    },
  });
  const runClock = createRunClock();
  const hubStatus = createHubStatus();
  const drawReadout = createDrawReadout();
  const vignette = createDamageVignette();
  const hotbar = createHotbar(options);
  const itemFeedback = createItemFeedback(element, hotbar.slotElement);
  // Everything that used to be its own message line: the hub gate, the run outcome, the torch and
  // decay warnings, and the error box.
  const toasts = createToasts();

  const stashButton = createButton("Stash", () => {
    closeCamp();
    inventory.open();
  });
  stashButton.setAttribute("aria-haspopup", "dialog");

  const skillsButton = createButton("Skills", () => {
    closeCamp();
    skills.open();
  });
  skillsButton.setAttribute("aria-haspopup", "dialog");

  const camp = createCampMenu([
    { title: "Party", elements: [session.readyButton, session.leaveButton] },
    { title: "Camp", elements: [skillsButton, stashButton, session.controlsButton] },
    { title: "Voice", elements: [voice.statusElement, voice.meterElement, ...voice.buttons] },
  ]);
  openCamp = () => {
    if (campAvailable) camp.open();
  };
  closeCamp = camp.close;

  // The camp menu's way in. The controls menu, the emote wheel, and the open camp menu all see Escape
  // first and claim it (preventDefault, or stopping it outright), so one press never does two things.
  // The Stash and the vault have no handler of their own, so they are closed here before the menu
  // would open.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    if (convertPrompt.isOpen()) {
      options.onDismissConvert();
    } else if (skills.isOpen()) {
      skills.close();
    } else if (vault.isOpen()) {
      vault.close();
    } else if (inventory.isOpen()) {
      inventory.close();
    } else if (campAvailable) {
      camp.open();
    } else {
      return;
    }
    event.preventDefault();
  });

  // Under the room code rather than the self frame: a taller self frame reaches the bow's draw meter.
  const coin = document.createElement("p");
  coin.className = "hud__coin";
  coin.setAttribute("aria-label", "Coin");
  coin.hidden = true;

  const sessionPanel = createPanel("hud__panel hud__panel--session");
  sessionPanel.append(
    voice.chipElement,
    session.roomElement,
    coin,
    session.connectionElement,
    session.hubReadyButton,
    session.positionElement,
  );

  // The top-right corner: the minimap is first, so its anchor never moves, and the session panel
  // stacks under it. A hidden minimap takes no space, so the panel rises into the corner.
  const corner = document.createElement("div");
  corner.className = "hud__corner";
  corner.append(minimap.element, runClock.element, sessionPanel);

  // The top-left column: key hints, then the party frames stacked under them.
  const topLeft = document.createElement("div");
  topLeft.className = "hud__top-left";
  topLeft.append(keyHints.element, partyFrames.element);

  const partyPanel = createPanel("hud__panel hud__panel--party");
  partyPanel.append(vitals.element);

  const actionPanel = createPanel("hud__panel hud__panel--actions");
  const actionButtons = document.createElement("div");
  actionButtons.className = "hud__buttons";
  // The wheel's touch way in. Not one of `actions`: a downed player can still call for help.
  const emoteButton = createButton("Emote", options.onOpenEmotes);
  emoteButton.setAttribute("aria-haspopup", "dialog");
  actionButtons.append(...actions.elements, emoteButton);
  actionPanel.append(actionButtons);

  // Hidden buttons are neither drawn nor focusable, so the panel would be an empty box and hides too.
  const refreshActionPanel = (): void => {
    actionPanel.hidden = actionButtons.hidden;
  };
  followTouchControls(
    (query) => window.matchMedia(query),
    (visible) => {
      actionButtons.hidden = !visible;
      refreshActionPanel();
    },
  );

  element.append(
    vignette.element,
    topLeft,
    drawReadout.element,
    createNoticeStack(hubStatus.element, toasts.element),
    corner,
    partyPanel,
    actionPanel,
    hotbar.element,
    inventory.panel,
    skills.panel,
    vault.panel,
    convertPrompt.panel,
    camp.element,
  );

  // Quiet modules dim to `--hud-fade-opacity` (see styles.css). Each snapshot reports which modules
  // changed; the timer only re-evaluates, so a module fades even when snapshots stop changing it.
  const fadeModules: Record<HudModuleId, HTMLElement> = {
    vitals: partyPanel,
    party: partyFrames.element,
    hotbar: hotbar.element,
    minimap: minimap.element,
    session: sessionPanel,
    hints: keyHints.element,
    actions: actionPanel,
  };
  const fadeIds = Object.keys(fadeModules) as HudModuleId[];
  const fade = createHudFade(fadeIds, Date.now());
  const signatures = new Map<HudModuleId, string>();
  let warned = new Set<HudModuleId>();
  let lastHealth: number | null = null;
  const noteSignature = (id: HudModuleId, signature: string): void => {
    if (signatures.get(id) !== signature) {
      if (signatures.has(id)) fade.changed(id, Date.now());
      signatures.set(id, signature);
    }
  };
  const applyFade = (): void => {
    const now = Date.now();
    const pinned = new Set<HudModuleId>(warned);
    const density = hudDensityFrom(document.documentElement.dataset.hudDensity);
    // The camp menu, the Stash and the vault own the keyboard; nothing dims behind them.
    if (camp.isOpen() || inventory.isOpen() || skills.isOpen() || vault.isOpen()) for (const id of fadeIds) pinned.add(id);
    for (const id of fadeIds) {
      if (fadeModules[id].contains(document.activeElement)) pinned.add(id);
    }
    for (const id of fadeIds) {
      fadeModules[id].dataset.faded = String(fade.isFaded(id, now, { pinned, density }));
    }
  };
  noteCombat = () => {
    fade.combat(Date.now());
    applyFade();
  };
  window.addEventListener(
    "keydown",
    () => {
      fade.changedAll(Date.now());
      applyFade();
    },
    true,
  );
  document.documentElement.addEventListener(HUD_SETTINGS_CHANGED_EVENT, applyFade);
  window.addEventListener("focusin", applyFade);
  window.addEventListener("focusout", () => setTimeout(applyFade, 0));
  window.setInterval(applyFade, FADE_TICK_MS);

  // The prompt follows the predicted position, which moves between snapshots.
  let currentView: SessionView | null = null;
  let currentPosition: Vector2 = { x: 0, y: 0 };
  const refreshPrompt = (): void => {
    hotbar.updatePrompt(
      currentView ? actionPrompt(currentView, selfOf(currentView), currentPosition) : null,
    );
  };
  /** The vault panel only stays open while the player can use it: in the hub, in the vault area. */
  const canUseVault = (): boolean => {
    const self = currentView ? selfOf(currentView) : null;
    return (
      currentView !== null &&
      currentView.phase === "inSession" &&
      self !== null &&
      self.health > 0 &&
      inVaultArea(currentView.location, currentView.dungeon?.rooms ?? [], currentPosition)
    );
  };
  const refreshVault = (): void => {
    if (!vault.isOpen()) return;
    if (!canUseVault() || !currentView) {
      vault.close();
      return;
    }
    vault.update(vaultPanelView(currentView, selfOf(currentView)));
  };

  const setDebug = (on: boolean): void => {
    sessionPanel.classList.toggle("hud__panel--debug", on);
    session.positionElement.hidden = !on;
  };
  setDebug(new URLSearchParams(window.location.search).has("debug"));

  // `?debug` in the URL starts with the readouts on.
  window.addEventListener("keydown", (event) => {
    if (event.key !== DEBUG_KEY || event.repeat || isTypingTarget(event.target)) return;
    setDebug(session.positionElement.hidden);
  });

  return {
    element,

    setVoiceState(state: VoiceState) {
      voice.setState(state);
    },

    setVoiceLevel(level: number) {
      voice.setLevel(level);
    },

    /** Who rings as speaking on the party frames; called every display frame. */
    setSpeaking(playerIds: ReadonlySet<string>) {
      partyFrames.setSpeaking(playerIds);
    },

    setPosition(position: Vector2) {
      session.setPosition(positionLabel(position));
      currentPosition = position;
      minimap.setPosition(position);
      refreshPrompt();
      refreshVault();
    },

    /** Opens the party vault, if the player is where they can use it. False when they are not. */
    openVault(): boolean {
      if (!canUseVault() || !currentView) return false;
      inventory.close();
      vault.update(vaultPanelView(currentView, selfOf(currentView)));
      vault.open();
      applyFade();
      return true;
    },

    toggleMinimap() {
      minimap.toggle();
    },

    /** The answer to something the player just tried, such as "No loot nearby". */
    setActionStatus(status: string) {
      toasts.say("action", status);
    },

    syncTo(view: SessionView) {
      const self = selfOf(view);
      const controls = controlsView(view, self);

      session.setConnection(connectionLabel(view));
      session.setRoom(roomCodeLabel(view));
      session.update(controls, self ? self.ready : null, hubReadyVisible(view));
      voice.setInSession(!controls.sessionControlsDisabled);
      campAvailable = view.phase === "inSession" && self !== null && self.appearance !== null;
      if (!campAvailable) {
        camp.close();
        skills.close();
      }
      const coinText = coinReadout(view);
      coin.hidden = coinText === null;
      coin.textContent = coinText ?? "";
      convertPrompt.update(convertPromptView(view));
      vitals.update(vitalsView(self, view.run), self ? self.health : null, view.staminaRefusals);

      vignette.update(self ? self.health : null);
      runClock.update(runClockView(view));
      refreshActionPanel();
      hubStatus.update(hubStatusView(view));
      toasts.update(toastMessages(view, self));

      actions.update(controls);
      drawReadout.update(self ? self.drawFraction : null);
      emoteButton.disabled = controls.sessionControlsDisabled;

      const serverAction = newServerAction(view, lastServerAction);
      if (serverAction) {
        lastServerAction = serverAction;
        toasts.say("action", serverAction);
      }

      if (vitalChange(lastHealth, self ? self.health : null) === "damage") fade.combat(Date.now());
      lastHealth = self ? self.health : null;
      const vitalsSnapshot = vitalsView(self, view.run);
      warned = new Set<HudModuleId>();
      if (self && (vitalsSnapshot.health.low || vitalsSnapshot.resistance.decaying)) warned.add("vitals");
      const frames = partyFramesView(view);
      if (frames.some((frame) => frame.state === "downed" || frame.state === "beingCarried")) {
        warned.add("party");
      }
      noteSignature("vitals", JSON.stringify(vitalsSnapshot));
      noteSignature("party", JSON.stringify(frames.map(({ portrait: _portrait, ...rest }) => rest)));
      noteSignature(
        "hotbar",
        JSON.stringify([hotbarView(view, self), heldView(view, self), torchView(self)]),
      );
      noteSignature(
        "minimap",
        `${minimapWorldKey(view)}|${minimapRoomName(view, currentPosition)}`,
      );
      noteSignature(
        "session",
        JSON.stringify([connectionLabel(view), roomCodeLabel(view), self ? self.ready : null, controls]),
      );
      applyFade();

      const itemEvents = currentView ? itemFeedbackEvents(currentView, view) : [];
      currentView = view;
      hotbar.updateSlots(hotbarView(view, self));
      hotbar.updateHeld(heldView(view, self));
      hotbar.updateTorch(self);
      itemFeedback.play(itemEvents, currentPosition);
      refreshPrompt();

      inventory.update(self);
      skills.update(skillsPanelView(view));
      refreshVault();
      partyFrames.update(view);
      minimap.update(view);
    },
  };
}
