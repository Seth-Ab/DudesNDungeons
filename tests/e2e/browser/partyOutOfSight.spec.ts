import { expect, test, type Browser } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/**
 * Two real clients against the real server. The hub is lit end to end, so the host cannot lose sight
 * of the guest by walking; the host's socket instead drops the guest from each `stateSnapshot`, which
 * is exactly what the server does for an ally outside the viewer's sight. The server's own visibility
 * rules, and the roster payload's fields, are covered in the unit and session tests.
 */
async function openPlayer(browser: Browser, errors: string[], hideOthers?: { on: boolean }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  if (hideOthers) {
    let selfId: string | null = null;
    await page.routeWebSocket(/:8080/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        if (typeof message !== "string") return socket.send(message);
        const parsed = JSON.parse(message) as { type?: string; playerId?: string; players?: { id: string }[] };
        if (parsed.type === "sessionJoined") selfId = parsed.playerId ?? null;
        if (parsed.type === "stateSnapshot" && hideOthers.on && parsed.players) {
          parsed.players = parsed.players.filter((player) => player.id === selfId);
          return socket.send(JSON.stringify(parsed));
        }
        socket.send(message);
      });
    });
  }
  await page.goto("/");
  return page;
}

test.describe("Party frames for allies out of sight", () => {
  test("an ally who leaves sight keeps a greyed, captioned frame with no vitals, and returns live", async ({ browser }, testInfo) => {
    const errors: string[] = [];
    const sight = { on: false };
    const host = await openPlayer(browser, errors, sight);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);

    const guest = await openPlayer(browser, errors);
    await guest.getByPlaceholder("Your name").fill("Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);

    const frame = host.locator(".hud__frame", { hasText: "Sam" });
    await expect(frame).toHaveAttribute("data-state", "waiting", { timeout: 15_000 });
    await expect(frame.locator(".hud__bar").first()).toBeVisible();
    // Resistance is a number under the health bar, as on the self frame, not a bar of its own; the
    // health bar spans the frame instead of sharing its row with the digits.
    await expect(frame.locator(".hud__bar--resistance")).toHaveCount(0);
    await expect(frame.locator(".hud__frame-resistance")).toHaveAttribute("aria-label", /^Resistance \d+$/);
    await expect(frame.locator(".hud__frame-footer .hud__bar-value")).toHaveText(/^\d+\/\d+$/);
    const body = await frame.locator(".hud__frame-body").boundingBox();
    const track = await frame.locator(".hud__bar--health .hud__bar-track").boundingBox();
    expect(track!.width).toBeGreaterThan(body!.width * 0.6);
    expect(track!.height).toBeLessThanOrEqual(10);
    await host.waitForTimeout(300);
    await host.screenshot({ path: testInfo.outputPath("party-frame-in-sight.png") });

    sight.on = true;
    await expect(frame).toHaveAttribute("data-state", "outOfSight");
    await expect(frame.locator(".hud__frame-caption")).toHaveText("out of sight");
    await expect(frame.locator(".hud__frame-state")).toHaveText("◌");
    await expect(frame.locator(".hud__bar").first()).toBeHidden();
    await expect(frame.locator(".hud__frame-footer")).toBeHidden();
    await host.waitForTimeout(300);
    await host.screenshot({ path: testInfo.outputPath("party-frame-out-of-sight.png") });
    await host.screenshot({
      path: testInfo.outputPath("party-frame-out-of-sight-close-up.png"),
      clip: { x: 0, y: 60, width: 320, height: 180 },
    });

    sight.on = false;
    await expect(frame).toHaveAttribute("data-state", "waiting");
    await expect(frame.locator(".hud__bar").first()).toBeVisible();

    expect(errors).toEqual([]);
    for (const page of [host, guest]) await page.context().close();
  });
});
