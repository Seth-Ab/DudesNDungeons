import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";
import { GAME_SOCKET } from "./ports.js";

/** The hub gate in world units, and the road up to it from the spawn beside the fountain. */
const GATE = { x: 45.5, y: 5.5 };
const TO_GATE = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

const CHEST_ID = "7a1c0000-0000-4000-8000-000000000001";
/** The server's `TWIN_LOCK_WINDOW_MS`. */
const WINDOW_MS = 1000;

interface Frame {
  type: string;
  playerId?: string;
  location?: string;
  players?: { id: string; position: { x: number; y: number } }[];
  dungeon?: { chests?: unknown[] };
}

type Point = { x: number; y: number };

/**
 * One twin-lock chest shared by both clients' proxies, standing in for the server's rule.
 *
 * A real run's seed is random and its vault sits behind a door the elite's key opens, so no
 * twin-lock chest is waiting in view. This proxies each client's socket and stands one beside the
 * two players, with the wire fields the server sends. Each client's real `playerInteract`
 * for it is applied here the way `turnTwinLock` applies it, and every later frame carries the
 * result, to prove the client draws the three states, words the prompt for the turner and the ally,
 * and sends the interact. The rule itself, disconnects and resets included, is covered by
 * `tests/server/twinLocks.test.ts`.
 */
class TwinLock {
  position: Point | null = null;
  turnedBy: string | null = null;
  turnedAt = 0;
  opened = false;
  readonly interacts: string[] = [];

  turn(playerId: string): void {
    this.interacts.push(playerId);
    if (this.opened) return;
    const now = Date.now();
    if (this.turnedBy !== null && this.turnedBy !== playerId && now - this.turnedAt <= WINDOW_MS) {
      this.opened = true;
      this.turnedBy = null;
      return;
    }
    this.turnedBy = playerId;
    this.turnedAt = now;
  }

  wire(): Record<string, unknown> | null {
    if (!this.position) return null;
    if (this.turnedBy !== null && Date.now() - this.turnedAt > WINDOW_MS) this.turnedBy = null;
    return {
      id: CHEST_ID,
      lootTableId: "vault-chest",
      position: this.position,
      opened: this.opened,
      locked: false,
      twinLock: true,
      keyTurnedBy: this.turnedBy,
    };
  }
}

interface Socket {
  id: () => string | null;
  frames: () => number;
  /** Where the server last put this client's player in the dungeon. */
  at: () => Point | null;
}

async function proxy(page: Page, lock: TwinLock): Promise<Socket> {
  let playerId: string | null = null;
  let frames = 0;
  let at: Point | null = null;
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => {
      // The real server has no such chest and would refuse it, so the proxy answers instead.
      if (typeof message === "string" && message.includes('"playerInteract"') && message.includes(CHEST_ID)) {
        if (playerId) lock.turn(playerId);
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      if (frame.type === "sessionJoined" && frame.playerId) playerId = frame.playerId;
      const self = frame.players?.find((candidate) => candidate.id === playerId)?.position;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon && self) {
        frames += 1;
        at = { x: self.x, y: self.y };
        const chest = lock.wire();
        if (chest) frame.dungeon.chests = [...(frame.dungeon.chests ?? []), chest];
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { id: () => playerId, frames: () => frames, at: () => at };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, lock: TwinLock, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const socket = await proxy(page, lock);
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill(name);
  if (roomCode) {
    await page.getByPlaceholder(/Room code/).fill(roomCode);
    await page.getByRole("button", { name: "Join dungeon" }).click();
  } else {
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
  }
  await enterHub(page);
  await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
  return { page, socket };
}

const prompt = (page: Page) => page.locator(".hud__prompt");

test.describe("Twin-lock Chest", () => {
  test("two clients turn its keyholes within a second and it opens; one alone resets", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const lock = new TwinLock();
    const host = await openPlayer(browser, "Maya", lock);
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const guest = await openPlayer(browser, "Theo", lock, (await room.textContent()) ?? "");
    await expect(host.page.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

    // The guest spawns on the host's road to the gate, and bodies block, so it steps aside first,
    // then only readies up; the host walks to the gate for the party.
    await guest.page.keyboard.down("s");
    await guest.page.waitForTimeout(900);
    await guest.page.keyboard.up("s");
    for (const { page } of [host, guest]) await page.getByRole("button", { name: "Ready" }).click();
    for (const waypoint of TO_GATE) await walkTo(host.page, waypoint, 0.8);
    await walkTo(host.page, GATE, 1);
    await expect(async () => {
      await host.page.keyboard.press("e");
      await host.page.waitForTimeout(250);
      expect(host.socket.frames()).toBeGreaterThan(0);
      expect(guest.socket.frames()).toBeGreaterThan(0);
    }).toPass({ timeout: 40_000 });

    // The guest walks up to the host, and the chest stands beside the pair: off the line between
    // them by 0.9, so neither body hides it and both are within the 1.2 reach of it.
    await walkTo(guest.page, host.socket.at()!, 1.1);
    await guest.page.waitForTimeout(300);
    const a = host.socket.at()!;
    const b = guest.socket.at()!;
    const gap = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const side = { x: -(b.y - a.y) / gap, y: (b.x - a.x) / gap };
    const toward = side.y >= 0 ? 0.9 : -0.9;
    lock.position = { x: (a.x + b.x) / 2 + side.x * toward, y: (a.y + b.y) / 2 + side.y * toward };
    for (const { page } of [host, guest]) await expect(prompt(page)).toContainText("Turn a keyhole", { timeout: 10_000 });
    await host.page.screenshot({ path: testInfo.outputPath("twin-lock-host-closed.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("twin-lock-guest-closed.png") });

    // One keyhole: the host is told to wait, the guest to turn the other.
    await host.page.keyboard.press("e");
    await expect.poll(() => lock.interacts.length).toBe(1);
    expect(lock.interacts[0]).toBe(host.socket.id());
    await expect(prompt(host.page)).toContainText("Waiting for a second key");
    await expect(prompt(guest.page)).toContainText("Turn the other keyhole");
    await host.page.screenshot({ path: testInfo.outputPath("twin-lock-host-turned.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("twin-lock-guest-turned.png") });

    // Nobody answers inside the second, so the keyhole lets go and the chest stays shut.
    for (const { page } of [host, guest]) await expect(prompt(page)).toContainText("Turn a keyhole", { timeout: 5_000 });
    expect(lock.opened).toBe(false);

    // Both inside the second: it opens, and neither is offered a keyhole any more.
    await host.page.keyboard.press("e");
    await guest.page.keyboard.press("e");
    await expect.poll(() => lock.opened).toBe(true);
    expect(lock.interacts.slice(-2)).toEqual([host.socket.id(), guest.socket.id()]);
    for (const { page } of [host, guest]) {
      await expect(page.locator(".hud__prompt", { hasText: /keyhole|second key/ })).toBeHidden({ timeout: 5_000 });
    }
    await host.page.screenshot({ path: testInfo.outputPath("twin-lock-host-opened.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("twin-lock-guest-opened.png") });
  });
});
