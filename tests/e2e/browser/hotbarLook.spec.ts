import { expect, test } from "@playwright/test";
import { enterHub } from "./designScreen.js";

test.describe("Hotbar look", () => {
  test("the hand slot is larger than the item slots, empty slots stay opaque, and the torch dims when out", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__hotbar")).toBeVisible();

    const hand = await page.locator(".hud__slot--held").boundingBox();
    const slots = page.locator(".hud__slot:not(.hud__slot--held)");
    const first = await slots.first().boundingBox();
    expect(hand!.width).toBeGreaterThan(first!.width);
    expect(hand!.height).toBeGreaterThan(first!.height);
    await expect(slots).toHaveCount(3);

    // Empty slots are no longer faded to 60%.
    for (const slot of await slots.all()) {
      await expect(slot).toHaveClass(/hud__slot--empty/);
      await expect(slot).toHaveCSS("opacity", "1");
    }

    // A fresh player in the hub carries no torch: the round slot is dim and says so.
    const torch = page.locator(".hud__torch");
    await expect(torch).not.toHaveClass(/hud__torch--lit/);
    await expect(torch).toHaveAttribute("aria-label", "Torch: none");
    await expect(torch).toHaveCSS("border-radius", "50%");
    await page.screenshot({ path: testInfo.outputPath("hotbar-hub.png") });
  });
});
