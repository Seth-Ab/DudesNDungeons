import { expect, test, type Browser, type Page } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

/**
 * Two real browsers in one party, talking over a real WebRTC connection negotiated through the dev
 * server's signaling relay. Chromium's fake capture device stands in for a microphone, so nothing
 * here needs hardware or a permission prompt.
 */
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/**
 * Records every RTCPeerConnection and Audio element the page makes, so the test can read real
 * connection state and playback volume without the client exposing anything for it. Strings,
 * because the test project has no DOM types.
 */
const TRACK_PEER_CONNECTIONS = `
  const NativeConnection = window.RTCPeerConnection;
  window.__peerConnections = [];
  window.RTCPeerConnection = class extends NativeConnection {
    constructor(config) {
      super(config);
      window.__peerConnections.push(this);
    }
  };
  const NativeAudio = window.Audio;
  window.__audioElements = [];
  window.Audio = class extends NativeAudio {
    constructor(src) {
      super(src);
      window.__audioElements.push(this);
    }
  };
`;

/** The loudest remote stream currently playing; peers out of range or closed play at 0. */
const LOUDEST_REMOTE = `Math.max(0, ...window.__audioElements
  .filter((audio) => audio.srcObject !== null)
  .map((audio) => audio.volume))`;

const COUNT_CONNECTED = `window.__peerConnections.filter(
  (connection) => connection.connectionState === "connected",
).length`;

const REFUSE_MICROPHONE = `navigator.mediaDevices.getUserMedia = () =>
  Promise.reject(new DOMException("Permission denied", "NotAllowedError"))`;

async function loudestRemote(page: Page): Promise<number> {
  return page.evaluate<number>(LOUDEST_REMOTE);
}

async function connectedPeers(page: Page): Promise<number> {
  return page.evaluate<number>(COUNT_CONNECTED);
}

async function openPlayer(browser: Browser, grantMicrophone: boolean): Promise<Page> {
  const context = await browser.newContext({
    permissions: grantMicrophone ? ["microphone"] : [],
    // Both players on one machine: no STUN needed, and none reachable from CI anyway.
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript({ content: TRACK_PEER_CONNECTIONS });
  await page.goto("/");
  return page;
}

// In the camp menu; the assertions read it whether or not the menu is open.
const voiceStatus = (page: Page) => page.locator(".hud__stat", { hasText: "Voice:" });
const micChip = (page: Page) => page.locator(".hud__mic");

test.describe("Proximity voice", () => {
  test("connects two party members once both enable voice, with mute and deafen", async ({
    browser,
  }, testInfo) => {
    const host = await openPlayer(browser, true);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser, true);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.locator(".hud__stat", { hasText: "Room:" })).toContainText(roomCode);

    // Nothing is captured or connected until each player asks.
    await expect(voiceStatus(host)).toContainText("off");
    await expect(micChip(host)).toHaveText("Mic off");
    await expect(micChip(host)).toHaveAttribute("data-tone", "off");
    const hostCamp = await openCampMenu(host);
    await expect(hostCamp.getByRole("button", { name: "Mute" })).toBeDisabled();
    expect(await connectedPeers(host)).toBe(0);

    // The host's offer reaches a guest without voice and goes unanswered until the guest opts in.
    await host.getByRole("button", { name: "Enable Voice" }).click();
    await expect(voiceStatus(host)).toContainText("on, 0 peers");
    // The guest opens the menu from the mic chip, the touch-friendly way in.
    await micChip(guest).click();
    await guest.getByRole("button", { name: "Enable Voice" }).click();
    await guest.keyboard.press("Escape");
    await expect(campMenu(guest)).toBeHidden();
    await expect(micChip(guest)).toHaveAttribute("data-tone", "live");
    await expect(voiceStatus(guest)).toContainText("on, 1 peer", { timeout: 15_000 });
    await expect(voiceStatus(host)).toContainText("on, 1 peer", { timeout: 15_000 });

    await expect.poll(() => connectedPeers(host), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => connectedPeers(guest), { timeout: 15_000 }).toBe(1);
    await expect(host.getByRole("meter", { name: "Microphone input level" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("voice-live.png") });

    // Both stand in the lit hub, so the server puts each well inside the other's earshot.
    await expect.poll(() => loudestRemote(host), { timeout: 10_000 }).toBeGreaterThan(0);

    await host.getByRole("button", { name: "Mute" }).click();
    await expect(voiceStatus(host)).toContainText("muted");
    await expect(micChip(host)).toHaveText("Mic muted");
    await expect(host.getByRole("button", { name: "Unmute" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await host.getByRole("button", { name: "Deafen" }).click();
    await expect(voiceStatus(host)).toContainText("deafened");
    expect(await loudestRemote(host)).toBe(0);
    await host.getByRole("button", { name: "Undeafen" }).click();
    await host.getByRole("button", { name: "Unmute" }).click();
    await expect(voiceStatus(host)).toContainText("on, 1 peer");
    await expect.poll(() => loudestRemote(host)).toBeGreaterThan(0);

    // Disabling tears the link down on this side and frees the microphone.
    await host.getByRole("button", { name: "Disable Voice" }).click();
    await expect(voiceStatus(host)).toContainText("off");
    expect(await connectedPeers(host)).toBe(0);

    // Re-enabling builds a fresh connection the other side accepts.
    await host.getByRole("button", { name: "Enable Voice" }).click();
    await expect.poll(() => connectedPeers(host), { timeout: 15_000 }).toBe(1);

    // Leaving releases everything.
    await host.getByRole("button", { name: "Leave" }).click();
    await expect(campMenu(host)).toBeHidden();
    await expect(voiceStatus(host)).toContainText("off");
    expect(await connectedPeers(host)).toBe(0);

    await host.context().close();
    await guest.context().close();
  });

  test("says so when the microphone is refused", async ({ browser }) => {
    const page = await openPlayer(browser, false);
    // The fake-UI switch accepts every prompt, so the refusal is what the browser would report.
    await page.evaluate(REFUSE_MICROPHONE);
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);

    await openCampMenu(page);
    await page.getByRole("button", { name: "Enable Voice" }).click();
    await expect(voiceStatus(page)).toContainText("microphone blocked");
    await expect(micChip(page)).toHaveText("Mic blocked");
    await expect(micChip(page)).toHaveAttribute("data-tone", "warning");
    await expect(voiceStatus(page)).toHaveAttribute("title", /Allow it in the browser/);
    await expect(page.getByRole("button", { name: "Enable Voice" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Mute" })).toBeDisabled();

    await page.context().close();
  });
});
