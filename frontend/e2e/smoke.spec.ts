import { expect, test } from "@playwright/test";

test("redirects the public entry point to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to Budget Tracker" }),
  ).toBeVisible();
});
