import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/** World position of the hub's first training dummy: authored tile (15, 7), centred in its block. */
const DUMMY = { x: 61.5, y: 29.5 };
const DUMMY_ID = "b1111111-1111-4111-8111-111111111111";
/** Where to stand to swing east at it: a body's length to its west, inside unarmed reach. */
const SWING_SPOT = { x: DUMMY.x - 0.7, y: DUMMY.y };
/** World position of the hub's Rusted Sword: authored tile (10, 8). */
const SWORD = { x: 41.5, y: 33.5 };

interface Readout {
  recentDamage: number;
  dps: number;
  attackers: { playerId: string; recentDamage: number; dps: number }[];
}

/**
 * Every snapshot's readout for the dummy, by tick, as this page received it off the socket. The
 * plate is canvas-drawn, so this is how the test sees the numbers the client was given to draw.
 */
function recordReadouts(page: Page): Map<number, Readout> {
  const byTick = new Map<number, Readout>();
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"stateSnapshot"')) return;
      const message = JSON.parse(payload) as {
        tick: number;
        dungeon: { dummies: ({ id: string } & Readout)[] };
      };
      const dummy = message.dungeon.dummies.find((candidate) => candidate.id === DUMMY_ID);
      if (dummy) {
        byTick.set(message.tick, {
          recentDamage: dummy.recentDamage,
          dps: dummy.dps,
          attackers: dummy.attackers,
        });
      }
    });
  });
  return byTick;
}

async function openPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/** Steers by the debug readout, as `hubSword.spec.ts` does, so a slow machine still arrives. */
async function walkTo(page: Page, target: { x: number; y: number }, reach: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const at = await position(page);
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (Math.hypot(dx, dy) <= reach) return;

    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "d" : "a") : dy > 0 ? "s" : "w";
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(Math.abs(dx), Math.abs(dy)) > 2 ? 200 : 40);
    await page.keyboard.up(key);
  }
  throw new Error(`Never reached ${JSON.stringify(target)}`);
}

/** Lines up west of the dummy, facing it, and swings until the action feed reports a hit. */
async function hitDummy(page: Page): Promise<void> {
  // North to the dummy's row first, then east along it, which keeps clear of the teammate standing
  // on the next spawn point. Within 0.4 of the spot is inside unarmed reach and the arc facing east.
  await walkTo(page, { x: (await position(page)).x, y: SWING_SPOT.y }, 0.4);
  await walkTo(page, SWING_SPOT, 0.4);
  const feed = page.locator(".hud__stat", { hasText: "Action:" });
  await expect(async () => {
    // A tap east turns to face the dummy without closing the gap past it.
    await page.keyboard.down("d");
    await page.waitForTimeout(20);
    await page.keyboard.up("d");
    await page.keyboard.press(" ");
    await expect(feed).toContainText("Hit target for 6", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** The latest tick both pages received a readout for, with what each was sent. */
function sharedReadout(host: Map<number, Readout>, guest: Map<number, Readout>) {
  const ticks = [...host.keys()].filter((tick) => guest.has(tick)).sort((a, b) => b - a);
  const tick = ticks[0];
  return tick === undefined ? null : { host: host.get(tick)!, guest: guest.get(tick)! };
}

test.describe("Training dummies", () => {
  test("a player hits a hub dummy unarmed and with the Rusted Sword, and a teammate sees the same readout", async ({
    browser,
  }, testInfo) => {
    // Two clients, two walks across the hub, and a detour for the sword.
    test.setTimeout(120_000);
    const host = await openPlayer(browser);
    const hostReadouts = recordReadouts(host);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser);
    const guestReadouts = recordReadouts(guest);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.locator(".hud__vitals")).toBeVisible();
    await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    // The guest watches from just south of the dummy, off the host's path along the dummy's row.
    await expect(guest.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await walkTo(guest, { x: DUMMY.x, y: (await position(guest)).y }, 0.6);
    await walkTo(guest, { x: DUMMY.x, y: DUMMY.y + 4 }, 0.6);

    // Unarmed.
    await hitDummy(host);
    // The guest is sent the same attackResolved, so it shows the same hit.
    await expect(guest.locator(".hud__stat", { hasText: "Action:" })).toContainText("Hit target for 6");
    await host.screenshot({ path: testInfo.outputPath("dummy-unarmed-host.png") });

    // With the Rusted Sword in hand.
    await walkTo(host, SWORD, 0.6);
    await expect(host.locator(".hud__prompt", { hasText: "Pick up Rusted Sword" })).toBeVisible();
    await expect(async () => {
      await host.keyboard.press("f");
      await expect(host.locator(".hud__slot--held")).toHaveAttribute("aria-label", /Rusted Sword/, {
        timeout: 1000,
      });
    }).toPass({ timeout: 10_000 });
    await hitDummy(host);
    // A second blow after the cooldown, so the window holds at least two sword hits whatever the
    // walk back from the sword cost the unarmed one.
    await host.waitForTimeout(600);
    await host.keyboard.press(" ");

    // Both clients are sent one readout for the same tick, and it counts the host's hits.
    await expect
      .poll(() => sharedReadout(hostReadouts, guestReadouts)?.host.recentDamage ?? 0, { timeout: 5000 })
      .toBeGreaterThanOrEqual(12);
    const shared = sharedReadout(hostReadouts, guestReadouts);
    expect(shared?.guest).toEqual(shared?.host);
    expect(shared?.host.attackers).toHaveLength(1);
    expect(shared?.host.dps).toBeGreaterThan(0);

    await host.screenshot({ path: testInfo.outputPath("dummy-sword-host.png") });
    await guest.screenshot({ path: testInfo.outputPath("dummy-sword-guest.png") });
  });
});
