import { expect, type Page } from "@playwright/test";

/**
 * Gets a page from the lobby into the hub. A new slot passes through the character design screen,
 * so this confirms whatever look it opened with; specs that care about the look drive the screen.
 */
export async function enterHub(page: Page): Promise<void> {
  const enter = page.getByRole("button", { name: "Enter the hub" });
  await expect(enter).toBeVisible();
  await enter.click();
  await expect(enter).toBeHidden();
}
