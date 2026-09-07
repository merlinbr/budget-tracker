import { expect, test } from "@playwright/test";

test("loads the public Angular shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Budget Tracker" })).toBeVisible();
});
