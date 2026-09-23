import { expect, test } from "@playwright/test";

test("client boots and renders the canvas", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("DudesNDungeons");
  await expect(page.locator("#app canvas")).toBeVisible();
});
