import { expect, test } from "@playwright/test";
import { enterHub } from "./designScreen.js";

test.describe("Hub overlay", () => {
  test("shows the gate status and a toggleable stash, with no run clock", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);

    const status = page.locator(".hud__hub-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Waiting on Maya");
    await expect(page.locator(".hud__clock")).toBeHidden();

    const stash = page.locator(".hud__stash");
    await expect(stash).toBeHidden();
    await page.getByRole("button", { name: "Stash" }).click();
    await expect(stash).toBeVisible();
    await expect(stash).toContainText("Nothing banked yet");
    await page.screenshot({ path: testInfo.outputPath("hub-overlay.png") });

    await page.getByRole("button", { name: "Stash" }).click();
    await expect(stash).toBeHidden();

    await page.getByRole("button", { name: "Ready" }).click();
    await expect(status).toContainText("Party ready");
  });
});
