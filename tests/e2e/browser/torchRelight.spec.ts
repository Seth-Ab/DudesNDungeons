import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

/** A Traveler's Torch on the Torch Supply counter; see `darkness.spec.ts`. */
const TORCH = { x: 25.5, y: 22.75 };
const TO_TORCHES = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 25.5 },
];
const AROUND_FOUNTAIN = [
  { x: 57.5, y: 29.5 },
  { x: 57.5, y: 41.5 },
  { x: 33.5, y: 41.5 },
  { x: 33.5, y: 29.5 },
];
/**
 * Where each player stands once armed with a torch: side by side on the road south of the supply,
 * a good way from every fixed lantern, so the only flame in reach is the other player's.
 */
const HOST_SPOT = { x: 36.5, y: 29.5 };
/** A step south of the host, so neither blocks the other's way along the road. */
const GUEST_SPOT = { x: 35.5, y: 31.5 };
/** Down the road, clear of every flame. */
const AWAY = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 41.5 },
];

interface Snapshot {
  players: { id: string; carryingTorch: boolean; torchLit: boolean }[];
}

/** Reads the player's own torch state off the wire, independent of the HUD under test. */
function watchTorch(page: Page) {
  const seen = { selfId: null as string | null, latest: null as Snapshot | null };
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload) as { type: string; playerId?: string };
      if (message.type === "sessionJoined") seen.selfId = message.playerId ?? null;
      if (message.type === "stateSnapshot") seen.latest = message as unknown as Snapshot;
    }),
  );
  return () => seen.latest?.players.find((player) => player.id === seen.selfId) ?? null;
}

const track = trackContexts();

async function openPlayer(browser: Browser, errors: string[]) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const torch = watchTorch(page);
  await page.goto("/?debug");
  return { page, torch };
}

/** Walks to a spot north of the other player, well inside the reach of their flame. */
async function standBeside(page: Page, other: Page) {
  const at = await position(other);
  await walkTo(page, { x: at.x, y: at.y - 1 }, 0.15);
}

async function takeTorch(page: Page, torch: () => { carryingTorch: boolean } | null, at: { x: number; y: number }, supplyX: number) {
  // The second spawn is on the far side of the fountain: go round its south end.
  if ((await position(page)).x > 45) for (const waypoint of AROUND_FOUNTAIN) await walkTo(page, waypoint, 0.6);
  for (const waypoint of TO_TORCHES) await walkTo(page, waypoint, 0.6);
  await walkTo(page, { x: supplyX, y: TORCH.y + 1.75 }, 0.3);
  await expect(async () => {
    // The counter is solid: line up below the torch and walk into it, again if a retry finds it out of reach.
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    await page.keyboard.press("f");
    expect(torch()?.carryingTorch).toBe(true);
  }).toPass({ timeout: 15_000 });
  for (const waypoint of [...TO_TORCHES].reverse()) await walkTo(page, waypoint, 0.6);
  await walkTo(page, { x: 33.5, y: at.y }, 0.6);
  await walkTo(page, at, 0.5);
}

test.describe("Putting out and relighting a torch", () => {
  test("a torch put out is relit from another player's flame, and only within reach", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];

    const host = await openPlayer(browser, errors);
    await host.page.getByPlaceholder("Your name").fill("Maya");
    await host.page.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host.page);

    const guest = await openPlayer(browser, errors);
    await guest.page.getByPlaceholder("Your name").fill("Sam");
    await guest.page.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.page.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest.page);

    // Both carry a torch from the supply, then stand side by side.
    await takeTorch(host.page, host.torch, HOST_SPOT, TORCH.x);
    await takeTorch(guest.page, guest.torch, GUEST_SPOT, TORCH.x + 1.5);

    const hostSlot = host.page.locator(".hud__torch");
    const guestSlot = guest.page.locator(".hud__torch");
    await expect(hostSlot).toHaveClass(/hud__torch--lit/);
    expect(host.torch()?.torchLit).toBe(true);

    // Maya puts her torch out: her own slot dims, and Sam sees the unlit state on the wire.
    await host.page.keyboard.press("y");
    await expect.poll(() => host.torch()?.torchLit).toBe(false);
    await expect(hostSlot).not.toHaveClass(/hud__torch--lit/);
    await expect(hostSlot).toHaveAttribute("aria-label", "Torch: out");
    await expect(guestSlot).toHaveClass(/hud__torch--lit/);
    // Each walk stops within half a tile of its spot, so close up on where Sam really stands.
    await standBeside(host.page, guest.page);
    await expect(host.page.locator(".hud__prompt", { hasText: "Light your torch" })).toBeVisible();
    await host.page.screenshot({ path: testInfo.outputPath("torch-out-flame-in-reach.png") });

    // Out of reach of Sam's flame, there is nothing to light it from: no prompt, and the key does nothing.
    for (const waypoint of AWAY) await walkTo(host.page, waypoint, 0.6);
    await expect(host.page.locator(".hud__prompt", { hasText: "Light your torch" })).toBeHidden();
    await host.page.keyboard.press("y");
    await host.page.waitForTimeout(500);
    expect(host.torch()?.torchLit).toBe(false);

    // Back beside Sam, the key relights it from his flame.
    for (const waypoint of [...AWAY].reverse()) await walkTo(host.page, waypoint, 0.6);
    await standBeside(host.page, guest.page);
    await expect(host.page.locator(".hud__prompt", { hasText: "Light your torch" })).toBeVisible();
    await host.page.keyboard.press("y");
    await expect.poll(() => host.torch()?.torchLit).toBe(true);
    await expect(hostSlot).toHaveClass(/hud__torch--lit/);
    await expect(hostSlot).toHaveAttribute("aria-label", "Torch: carried");
    await host.page.screenshot({ path: testInfo.outputPath("torch-relit.png") });

    expect(errors).toEqual([]);
  });
});
