import { expect, test, type Page, type TestInfo } from "@playwright/test";

const householdPassword = process.env["BUDGET_E2E_HOUSEHOLD_PASSWORD"]!;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(householdPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("complete household workflow", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  for (const viewport of viewports) {
    const width = viewport.width;
    test(`full September workflow at ${width}px`, async ({ context, page }, testInfo: TestInfo) => {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-09-01T12:30:00Z") });
      await login(page, `e2e-household-${width}`);

      // 1. Checking account with 1000.00 initial (100000 cents).
      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await expect(page).toHaveURL(/\/accounts$/);
      await page.getByRole("button", { name: "Add account", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("Checking");
      await page.getByLabel("Type", { exact: true }).selectOption("checking");
      await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("1000.00");
      await page.getByRole("button", { name: "Save account", exact: true }).click();
      await expect(
        page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Checking", exact: true }) }),
      ).toContainText("1.000,00\u00a0€");

      // 2. Food category; expense -8472 on 2026-09-07.
      await page.getByRole("link", { name: "Categories", exact: true }).click();
      await expect(page).toHaveURL(/\/categories$/);
      await page.getByRole("button", { name: "Add category", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("Food");
      await page.getByLabel("Type", { exact: true }).selectOption("expense");
      await page.getByRole("button", { name: "Save category", exact: true }).click();
      await expect(page.getByRole("listitem").filter({ has: page.getByText("Food", { exact: true }) })).toBeVisible();

      await page.getByRole("link", { name: "Transactions", exact: true }).click();
      await expect(page).toHaveURL(/\/transactions$/);
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await page.locator("#transaction-type").selectOption("expense");
      await page.locator("#transaction-amount").fill("84.72");
      await page.locator("#transaction-date").fill("2026-09-07");
      await page.locator("#transaction-account").selectOption({ label: "Checking" });
      await page.locator("#transaction-category").selectOption({ label: "Food" });
      await page.locator("#transaction-description").fill("Groceries");
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toBeVisible();
      // Transaction row shows the negative euro amount in the UI locale.
      await expect(page.getByRole("list", { name: "Transaction history", exact: true })).toContainText("-84,72\u00a0€");

      // 3. September dashboard: income 0, expenses 84.72, net -84.72, balance 915.28.
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      function summary(term: string) {
        return page.locator("dl.summary > div").filter({ has: page.getByText(term, { exact: true }) }).locator("dd");
      }
      await expect(summary("Income this month")).toHaveText("0,00\u00a0€");
      await expect(summary("Expenses this month")).toHaveText("84,72\u00a0€");
      await expect(summary("Net this month")).toHaveText("-84,72\u00a0€");
      await expect(summary("Current account balance")).toHaveText("915,28\u00a0€");
      await expect(page.getByRole("list", { name: "Recent transactions", exact: true })).toContainText("Groceries");

      // 4. Food budget 600.00: spent 84.72, remaining 515.28, progress 0.1412.
      await page.getByRole("link", { name: "Budgets", exact: true }).click();
      await expect(page).toHaveURL(/\/budgets$/);
      await page.getByRole("button", { name: "Set limit", exact: true }).click();
      await page.locator("#budget-limit").fill("600.00");
      await page.getByRole("button", { name: "Save budget", exact: true }).click();
      const budgetRow = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Food", exact: true }) });
      await expect(budgetRow).toBeVisible();
      // User-visible: spent/limit line and remaining line (non-color budget state).
      await expect(budgetRow).toContainText("Spent 84,72\u00a0€ / Limit 600,00\u00a0€");
      await expect(budgetRow).toContainText("Remaining 515,28\u00a0€");
      // Percent progress renders as a readable percent (0.1412 → 14,12%).
      await expect(budgetRow).toContainText("14,12\u00a0%");
      // Dashboard budget row shows readable corresponding values.
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await expect(page.getByRole("list", { name: "Budget overview", exact: true })).toContainText("84,72");

      // 5. Export September through the real Settings UI; parse the saved bytes.
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole("status").filter({ hasText: "Loading filters" })).toHaveCount(0);
      await page.locator("#export-from").fill("2026-09-01");
      await page.locator("#export-to").fill("2026-09-30");
      const csvPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const download = await csvPromise;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe("transactions.csv");
      const savedPath = testInfo.outputPath("transactions.csv");
      await download.saveAs(savedPath);
      // Parse the actual file the browser wrote (real download, not an api call).
      const fs = require("node:fs") as typeof import("node:fs");
      const text = fs.readFileSync(savedPath, "utf8");
      const rows = text
        .split(/\r\n/)
        .filter((line) => line.length > 0)
        .map((line) => line.split(","));
      expect(rows).toEqual([
        ["date", "description", "account", "category", "type", "amount", "currency"],
        ["2026-09-07", "Groceries", "Checking", "Food", "expense", "-84.72", "EUR"],
      ]);

      // 6. Logout: financial routes and API denied.
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/budgets");
      await expect(page).toHaveURL(/\/login$/);
      const anonymous = await page.request.get("/api/dashboard?year=2026&month=9");
      expect(anonymous.status()).toBe(401);

      // Fresh login still shows the persisted data.
      await page.getByLabel("Username", { exact: true }).fill(`e2e-household-${width}`);
      await page.getByLabel("Password", { exact: true }).fill(householdPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(summary("Current account balance")).toHaveText("915,28\u00a0€");

      // Screenshots of the ready dashboard at this viewport.
      await page.screenshot({ path: testInfo.outputPath(`household-final-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
