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

const IDOL_ID = "1d010000-0000-4000-8000-000000000001";
const ALTAR_ID = "1d010000-0000-4000-8000-000000000002";

interface Frame {
  type: string;
  playerId?: string;
  location?: string;
  players?: { id: string; position: { x: number; y: number }; inventory: unknown[] }[];
  dungeon?: { loot?: unknown[]; puzzles?: unknown[] };
}

type Point = { x: number; y: number };

/**
 * One Heavy Idol and its altar, shared by both clients' proxies, standing in for the server's rule.
 *
 * A real run's seed is random, and its idol lies rooms away from its altar, so neither is waiting in
 * view. This proxies each client's socket and lays both beside the party with the wire fields the
 * server sends. Each client's real `pickupItem`, `dropItem` and `playerInteract` for them is applied
 * here the way `pickupItem`, `dropItem` and `placeIdol` apply it, and every later frame carries the
 * result, to prove the client draws the idol on the floor, over its carrier and on the solved altar,
 * prompts the carrier and nobody else, and sends the intents. The rule itself, half speed, monster
 * targeting, disconnects and resets included, is covered by `tests/server/idols.test.ts`.
 */
class IdolCarry {
  idolAt: Point | null = null;
  altarAt: Point | null = null;
  carrier: string | null = null;
  solved = false;
  readonly intents: string[] = [];
  /** Where the server last put each player, so a dropped idol lands at its carrier's feet. */
  readonly positions = new Map<string, Point>();

  apply(playerId: string, type: string): void {
    this.intents.push(`${type}:${playerId}`);
    if (type === "pickupItem" && this.carrier === null && !this.solved) this.carrier = playerId;
    else if (type === "dropItem" && this.carrier === playerId) {
      this.idolAt = { ...this.positions.get(playerId)! };
      this.carrier = null;
    } else if (type === "playerInteract" && this.carrier === playerId) {
      this.carrier = null;
      this.solved = true;
    }
  }

  dress(frame: Frame): void {
    if (!this.idolAt || !this.altarAt || !frame.dungeon) return;
    for (const player of frame.players ?? []) {
      this.positions.set(player.id, player.position);
      if (player.id === this.carrier) player.inventory = [...player.inventory, { id: IDOL_ID, name: "Heavy Idol", kind: "idol" }];
    }
    if (this.carrier === null && !this.solved) {
      frame.dungeon.loot = [
        ...(frame.dungeon.loot ?? []),
        { id: IDOL_ID, name: "Heavy Idol", kind: "idol", position: this.idolAt, pickedUp: false },
      ];
    }
    frame.dungeon.puzzles = [
      ...(frame.dungeon.puzzles ?? []),
      {
        id: ALTAR_ID,
        typeId: "idol-carry",
        name: "Idol Carry",
        radius: 1.8,
        heldBy: "idol",
        phase: this.solved ? "solved" : "idle",
        plates: [{ position: this.altarAt, held: this.solved }],
        progress: this.solved ? 1 : 0,
      },
    ];
  }
}

interface Socket {
  id: () => string | null;
  frames: () => number;
  /** Where the server last put this client's player in the dungeon. */
  at: () => Point | null;
}

async function proxy(page: Page, idol: IdolCarry): Promise<Socket> {
  let playerId: string | null = null;
  let frames = 0;
  let at: Point | null = null;
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => {
      // The real server has neither the idol nor its altar and would refuse them, so the proxy answers.
      if (typeof message === "string" && (message.includes(IDOL_ID) || message.includes(ALTAR_ID))) {
        const { type } = JSON.parse(message) as { type: string };
        if (playerId) idol.apply(playerId, type);
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
        idol.dress(frame);
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { id: () => playerId, frames: () => frames, at: () => at };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, idol: IdolCarry, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const socket = await proxy(page, idol);
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

test.describe("Idol Carry", () => {
  test("one client lifts the idol, sets it down and lifts it again, then sets it on the altar", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const idol = new IdolCarry();
    const host = await openPlayer(browser, "Maya", idol);
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const guest = await openPlayer(browser, "Theo", idol, (await room.textContent()) ?? "");
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

    // The guest walks up to the host. The idol lies beside the host, off the line to the guest so no
    // body hides it, and the altar stands out of reach on the host's far side from the guest.
    await walkTo(guest.page, host.socket.at()!, 1.1);
    await guest.page.waitForTimeout(300);
    const a = host.socket.at()!;
    const b = guest.socket.at()!;
    const gap = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const away = { x: (a.x - b.x) / gap, y: (a.y - b.y) / gap };
    idol.altarAt = { x: a.x + away.x * 1.6, y: a.y + away.y * 1.6 };
    idol.idolAt = { x: a.x - away.y * 0.9, y: a.y + away.x * 0.9 };
    await expect(prompt(host.page)).toContainText("Pick up Heavy Idol", { timeout: 10_000 });
    await host.page.screenshot({ path: testInfo.outputPath("idol-carry-host-idol-on-floor.png") });

    // Lifted: the host is told how to set it down, and the guest is offered no altar.
    await host.page.keyboard.press("f");
    await expect.poll(() => idol.carrier).toBe(host.socket.id());
    await expect(prompt(host.page)).toContainText("Set down the Heavy Idol");
    await expect(guest.page.locator(".hud__prompt", { hasText: /altar|Heavy Idol/ })).toBeHidden();
    // Past the pickup's fly-in to the hotbar, so the pictures show only the idol held overhead.
    await host.page.waitForTimeout(1000);
    await host.page.screenshot({ path: testInfo.outputPath("idol-carry-host-carrying.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("idol-carry-guest-sees-carrier.png") });

    // Set down to fight, then lifted again.
    await host.page.keyboard.press("q");
    await expect.poll(() => idol.carrier).toBeNull();
    await expect(prompt(host.page)).toContainText("Pick up Heavy Idol");
    await host.page.keyboard.press("f");
    await expect.poll(() => idol.carrier).toBe(host.socket.id());

    // A step toward the altar brings it into reach; the host sets the idol on it and it is solved.
    await walkTo(host.page, idol.altarAt, 0.9);
    await expect(prompt(host.page)).toContainText("Set the Heavy Idol on the altar", { timeout: 10_000 });
    await host.page.screenshot({ path: testInfo.outputPath("idol-carry-host-at-altar.png") });
    await host.page.keyboard.press("e");
    await expect.poll(() => idol.solved).toBe(true);
    expect(idol.intents).toEqual([
      `pickupItem:${host.socket.id()}`,
      `dropItem:${host.socket.id()}`,
      `pickupItem:${host.socket.id()}`,
      `playerInteract:${host.socket.id()}`,
    ]);
    for (const { page } of [host, guest]) {
      await expect(page.locator(".hud__prompt", { hasText: /altar|Heavy Idol/ })).toBeHidden({ timeout: 5_000 });
    }
    await host.page.waitForTimeout(1000);
    await host.page.screenshot({ path: testInfo.outputPath("idol-carry-host-solved.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("idol-carry-guest-solved.png") });
  });
});
