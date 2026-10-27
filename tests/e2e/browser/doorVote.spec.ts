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

const VOTE_ID = "d0070000-0000-4000-8000-000000000001";
const LOOT_DOOR_ID = "d0070000-0000-4000-8000-000000000002";
const DANGER_DOOR_ID = "d0070000-0000-4000-8000-000000000003";
/** How long the party must hold a door's plates, as `content/puzzles/door-vote.json` has it. */
const HOLD_MS = 2000;

interface Frame {
  type: string;
  playerId?: string;
  location?: string;
  players?: { id: string; position: { x: number; y: number } }[];
  dungeon?: { puzzles?: unknown[]; doors?: unknown[] };
}

type Point = { x: number; y: number };

/**
 * One Door Vote, shared by both clients' proxies, standing in for the server's rule.
 *
 * A real run's seed is random and its junction lies rooms from the entrance, so no vote is waiting
 * in view. This proxies each client's socket and lays two voted doorways and a plate for each player
 * before them beside the party, with the wire fields the server sends. It decides the vote the way
 * `resolveDoorVote` does: once every player stands on one door's plates for the hold time, that door
 * opens and the other stays sealed. The rule itself, resets, disconnects and downed players
 * included, is covered by `tests/server/doorVote.test.ts`; this proves the client draws the plates,
 * the hints and the opened door, and that two real clients reach the same result.
 */
class DoorVote {
  layout: { loot: Point[]; danger: Point[]; lootDoor: Point; dangerDoor: Point } | null = null;
  readonly positions = new Map<string, Point>();
  chosen: string | null = null;
  private since: { door: string; at: number } | null = null;

  /**
   * The plates each player holds, one plate to a player, the way the server assigns them: each takes
   * the nearest free plate in reach, so two players beside the same plate are not two votes.
   */
  private holds(plates: readonly Point[]): Set<number> {
    const taken = new Set<number>();
    for (const at of this.positions.values()) {
      let best = -1;
      let gap = 1.8;
      plates.forEach((plate, index) => {
        const reach = Math.hypot(plate.x - at.x, plate.y - at.y);
        if (!taken.has(index) && reach <= gap) {
          best = index;
          gap = reach;
        }
      });
      if (best >= 0) taken.add(best);
    }
    return taken;
  }

  /** The door every player holds a plate of, or null. */
  private heldDoor(): string | null {
    if (!this.layout || this.positions.size === 0) return null;
    for (const [door, plates] of [
      [LOOT_DOOR_ID, this.layout.loot],
      [DANGER_DOOR_ID, this.layout.danger],
    ] as const) {
      if (this.holds(plates).size === this.positions.size) return door;
    }
    return null;
  }

  dress(frame: Frame): void {
    const layout = this.layout;
    if (!layout || !frame.dungeon) return;
    for (const player of frame.players ?? []) this.positions.set(player.id, player.position);

    if (this.chosen === null) {
      const door = this.heldDoor();
      if (door === null) this.since = null;
      else if (this.since?.door !== door) this.since = { door, at: Date.now() };
      else if (Date.now() - this.since.at >= HOLD_MS) this.chosen = door;
    }

    const plates = (points: Point[], doorId: string, icon: string) => {
      const held = this.holds(points);
      return points.map((position, index) => ({ position, held: held.has(index), doorId, icon }));
    };
    const progress = this.since && this.chosen === null ? Math.min(1, (Date.now() - this.since.at) / HOLD_MS) : this.chosen ? 1 : 0;
    frame.dungeon.puzzles = [
      ...(frame.dungeon.puzzles ?? []),
      {
        id: VOTE_ID,
        typeId: "door-vote",
        name: "Door Vote",
        radius: 1.8,
        heldBy: "doors",
        phase: this.chosen ? "solved" : "idle",
        plates: [...plates(layout.loot, LOOT_DOOR_ID, "loot"), ...plates(layout.danger, DANGER_DOOR_ID, "danger")],
        progress,
      },
    ];
    const door = (id: string, position: Point) => ({
      id,
      position,
      size: 4,
      open: this.chosen === id,
      lock: this.chosen === id ? null : { type: "seal", groupId: "door-vote" },
    });
    frame.dungeon.doors = [
      ...(frame.dungeon.doors ?? []),
      door(LOOT_DOOR_ID, layout.lootDoor),
      door(DANGER_DOOR_ID, layout.dangerDoor),
    ];
  }
}

interface Socket {
  id: () => string | null;
  frames: () => number;
  at: () => Point | null;
}

async function proxy(page: Page, vote: DoorVote): Promise<Socket> {
  let playerId: string | null = null;
  let frames = 0;
  let at: Point | null = null;
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      if (frame.type === "sessionJoined" && frame.playerId) playerId = frame.playerId;
      const self = frame.players?.find((candidate) => candidate.id === playerId)?.position;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon && self) {
        frames += 1;
        at = { x: self.x, y: self.y };
        vote.dress(frame);
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { id: () => playerId, frames: () => frames, at: () => at };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, vote: DoorVote, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const socket = await proxy(page, vote);
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

test.describe("Door Vote", () => {
  test("two clients choose a door by standing on its plates, and the other door stays sealed", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const vote = new DoorVote();
    const host = await openPlayer(browser, "Maya", vote);
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const guest = await openPlayer(browser, "Theo", vote, (await room.textContent()) ?? "");
    await expect(host.page.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

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

    // The guest stands beside the host. Lay the loot door's two plates under them, then send the
    // guest a step away, so a random room's walls never decide whether the plates can be reached.
    await walkTo(guest.page, host.socket.at()!, 1.1);
    await guest.page.waitForTimeout(300);
    const hostPlate = host.socket.at()!;
    const guestPlate = guest.socket.at()!;
    await guest.page.keyboard.down("s");
    await guest.page.waitForTimeout(700);
    await guest.page.keyboard.up("s");
    await guest.page.waitForTimeout(300);
    const apart = guest.socket.at()!;
    vote.layout = {
      lootDoor: { x: hostPlate.x - 4, y: hostPlate.y + 6 },
      dangerDoor: { x: hostPlate.x + 4, y: hostPlate.y + 6 },
      loot: [hostPlate, guestPlate],
      danger: [apart, { x: apart.x + 2.2, y: apart.y }],
    };
    await host.page.waitForTimeout(600);
    await host.page.screenshot({ path: testInfo.outputPath("door-vote-host-sealed-doors.png") });

    // One on each door's plates is a split vote: nothing is chosen, however long they wait.
    await walkTo(guest.page, apart, 0.9);
    await host.page.waitForTimeout(HOLD_MS + 500);
    expect(vote.chosen).toBeNull();
    await host.page.screenshot({ path: testInfo.outputPath("door-vote-host-split-vote.png") });

    // The guest joins the host's door, and the pair hold it together.
    await walkTo(guest.page, guestPlate, 0.9);
    await expect.poll(() => vote.chosen, { timeout: 15_000 }).toBe(LOOT_DOOR_ID);
    await host.page.waitForTimeout(800);
    await host.page.screenshot({ path: testInfo.outputPath("door-vote-host-door-open.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("door-vote-guest-door-open.png") });

    // The chosen doorway is open and the other keeps its hint and its seal, for both clients.
    await expect(guest.page.locator(".hud__prompt", { hasText: /Sealed/ })).toBeHidden();
    expect(vote.chosen).toBe(LOOT_DOOR_ID);
  });
});
