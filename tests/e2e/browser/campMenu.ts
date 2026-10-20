import { expect, type Locator, type Page } from "@playwright/test";

/** The camp menu dialog, which holds Ready, Leave, Stash, Controls, and the voice settings. */
export function campMenu(page: Page): Locator {
  return page.getByRole("dialog", { name: "Camp" });
}

/**
 * Opens the camp menu with Escape, the way a keyboard player reaches the session controls. The menu
 * opens only once the server has placed the player, which can land a snapshot after the design
 * screen closes, so an early press is retried rather than failing the spec.
 */
export async function openCampMenu(page: Page): Promise<Locator> {
  const menu = campMenu(page);
  await expect(async () => {
    if (!(await menu.isVisible())) await page.keyboard.press("Escape");
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  return menu;
}
