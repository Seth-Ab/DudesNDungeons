import { expect, test, type Locator } from "@playwright/test";

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe("Minimap", () => {
  test("shows in the corner without covering other HUD modules, and toggles with M", async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await host.setViewportSize({ width: 1280, height: 720 });
    await host.goto("/");
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await expect(host.locator(".hud__hub-status")).toBeVisible();
    const code = await host.locator(".hud__panel--session").innerText();
    const roomCode = /[A-Z0-9]{4,8}/.exec(code.replace(/Room:?/i, ""))?.[0];
    expect(roomCode).toBeTruthy();

    await guest.setViewportSize({ width: 1280, height: 720 });
    await guest.goto("/");
    await guest.getByPlaceholder("Your name").fill("Noor");
    await guest.getByPlaceholder(/room/i).fill(roomCode ?? "");
    await guest.getByRole("button", { name: /join/i }).click();
    await expect(host.locator(".hud__frame")).toHaveCount(1);

    const minimap = host.locator(".hud__minimap");
    await expect(minimap).toBeVisible();

    for (const size of [
      { width: 1280, height: 720 },
      { width: 800, height: 600 },
    ]) {
      await host.setViewportSize(size);
      const mini = await box(minimap);
      expect(mini.x + mini.width).toBeLessThanOrEqual(size.width);
      for (const other of [".hud__panel--party", ".hud__panel--actions", ".hud__frames", ".hud__toasts", ".hud__hotbar"]) {
        const target = host.locator(other).first();
        if (!(await target.isVisible())) continue;
        expect(overlaps(mini, await box(target)), `${other} at ${size.width}px`).toBe(false);
      }
      await host.screenshot({ path: testInfo.outputPath(`minimap-${size.width}.png`) });
    }

    await host.keyboard.press("m");
    await expect(minimap).toBeHidden();
    await host.keyboard.press("m");
    await expect(minimap).toBeVisible();

    await hostContext.close();
    await guestContext.close();
  });
});
