import { expect, test } from "@playwright/test";

const e2eUsername = process.env["BUDGET_E2E_USERNAME"]!;
const e2ePassword = process.env["BUDGET_E2E_PASSWORD"]!;
const e2eExpiredSessionToken = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;

test("logs in, restores, logs out, and protects the dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in to Budget Tracker" })).toBeVisible();
  await page.getByLabel("Username").focus();
  await page.keyboard.type(e2eUsername);
  await page.keyboard.press("Tab");
  await page.keyboard.type(e2ePassword);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, E2E User" })).toBeVisible();
  await expect(page.getByText("E2E Household")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, E2E User" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("recovers from an expired valid session before login", async ({ context, page }) => {
  await context.addCookies([{
    name: "budget_session",
    value: e2eExpiredSessionToken,
    domain: "127.0.0.1",
    path: "/",
  }]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username").fill(e2eUsername);
  await page.getByLabel("Password").fill(e2ePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
