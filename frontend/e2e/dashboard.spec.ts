import { expect, test, type Page } from "@playwright/test";

const dashboardPassword = process.env["BUDGET_E2E_DASHBOARD_PASSWORD"]!;
const e2eExpiredSessionToken = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(dashboardPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function apiHeaders(page: Page): Promise<Record<string, string>> {
  await page.request.get("/api/auth/csrf");
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "XSRF-TOKEN")?.value ?? "";
  return { Origin: new URL(page.url()).origin, "X-XSRF-TOKEN": token };
}

// Clears only this disposable household's financial activity so a CI retry starts clean.
async function resetHousehold(page: Page): Promise<void> {
  const headers = await apiHeaders(page);
  const transactions = await (await page.request.get("/api/transactions", { headers })).json();
  for (const transaction of transactions) {
    await page.request.delete(`/api/transactions/${transaction.id}`, { headers });
  }
  const accounts = await (await page.request.get("/api/accounts", { headers })).json();
  for (const account of accounts) {
    await page.request.post(`/api/accounts/${account.id}/archive`, { headers });
  }
}

async function saveAccount(page: Page, name: string): Promise<{ id: number }> {
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Type", { exact: true }).selectOption("checking");
  await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("1000.00");
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/accounts") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function saveCategory(page: Page, name: string, type: "income" | "expense"): Promise<{ id: number }> {
  await page.getByRole("link", { name: "Categories", exact: true }).click();
  await expect(page).toHaveURL(/\/categories$/);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Type", { exact: true }).selectOption(type);
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/categories") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function addTransaction(
  page: Page,
  accountName: string,
  categoryName: string,
  type: "income" | "expense",
  amount: string,
  description: string,
  date: string,
): Promise<void> {
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await page.locator("#transaction-type").selectOption(type);
  await page.locator("#transaction-amount").fill(amount);
  await page.locator("#transaction-date").fill(date);
  await page.locator("#transaction-account").selectOption({ label: accountName });
  await page.locator("#transaction-category").selectOption({ label: categoryName });
  await page.locator("#transaction-description").fill(description);
  const listResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/transactions") && response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Save transaction", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toBeVisible();
  expect((await listResponsePromise).ok()).toBeTruthy();
}

async function openDashboard(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toHaveCount(0);
}

function summaryCard(page: Page, term: string) {
  return page.locator("dl.summary > div").filter({ has: page.getByText(term, { exact: true }) });
}

test.describe("real dashboard", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  for (const viewport of viewports) {
    test(`renders the selected-month dashboard at ${viewport.width}px`, async ({ context, page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-08-31T12:30:00Z") });
      await login(page, `e2e-dashboard-${viewport.width}`);
      await resetHousehold(page);

      // Local September while UTC is still August.
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");

      const suffix = crypto.randomUUID().slice(0, 8);
      const accountName = `Checking ${suffix}`;
      const salaryName = `Salary ${suffix}`;
      const groceriesName = `Groceries ${suffix}`;
      const netflixName = `Netflix ${suffix}`;
      const groceriesDescription = `Groceries ${suffix} <script>alert(1)</script>`;

      await saveAccount(page, accountName);
      await saveCategory(page, salaryName, "income");
      await saveCategory(page, groceriesName, "expense");
      await saveCategory(page, netflixName, "expense");
      await addTransaction(page, accountName, salaryName, "income", "3500.00", `Salary ${suffix}`, "2026-09-07");
      await addTransaction(page, accountName, groceriesName, "expense", "84.72", groceriesDescription, "2026-09-07");
      await addTransaction(page, accountName, netflixName, "expense", "17.99", `Netflix ${suffix}`, "2026-10-01");

      await openDashboard(page);
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await expect(summaryCard(page, "Current account balance").locator("dd")).toHaveText("4.397,29\u00a0€");
      await expect(summaryCard(page, "Income this month").locator("dd")).toHaveText("3.500,00\u00a0€");
      await expect(summaryCard(page, "Expenses this month").locator("dd")).toHaveText("84,72\u00a0€");
      await expect(summaryCard(page, "Net this month").locator("dd")).toHaveText("3.415,28\u00a0€");
      const septemberSpending = page.getByRole("list", { name: "Spending by category", exact: true });
      await expect(septemberSpending).toContainText(groceriesName);
      await expect(septemberSpending).toContainText("84,72\u00a0€");
      const septemberRecent = page.getByRole("list", { name: "Recent transactions", exact: true });
      await expect(septemberRecent).toContainText("2026-09-07");
      await expect(septemberRecent).toContainText("<script>alert(1)</script>");
      await expect(septemberRecent).toContainText("3.500,00\u00a0€");
      await expect(septemberRecent).not.toContainText("2026-10-01");
      await expect(septemberRecent.locator("script")).toHaveCount(0);

      // Next month: October activity with an unchanged all-time balance.
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
      await expect(summaryCard(page, "Current account balance").locator("dd")).toHaveText("4.397,29\u00a0€");
      await expect(summaryCard(page, "Income this month").locator("dd")).toHaveText("0,00\u00a0€");
      await expect(summaryCard(page, "Expenses this month").locator("dd")).toHaveText("17,99\u00a0€");
      await expect(summaryCard(page, "Net this month").locator("dd")).toHaveText("-17,99\u00a0€");
      await expect(page.getByRole("list", { name: "Recent transactions", exact: true })).toContainText("2026-10-01");

      // November: explicit empty lists, nonzero balance.
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-11");
      await expect(summaryCard(page, "Current account balance").locator("dd")).toHaveText("4.397,29\u00a0€");
      await expect(summaryCard(page, "Net this month").locator("dd")).toHaveText("0,00\u00a0€");
      await expect(page.getByText("No spending this month.", { exact: true })).toBeVisible();
      await expect(page.getByText("No transactions this month.", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-empty-${viewport.width}.png`), fullPage: true });

      // Keyboard navigation and December/January rollover.
      await page.getByLabel("Month", { exact: true }).fill("2026-12");
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-12");
      await page.getByRole("button", { name: "Next month", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2027-01");
      await page.getByRole("button", { name: "Previous month", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-12");

      // Returning to September refetches fresh data after visiting other pages.
      await page.getByLabel("Month", { exact: true }).fill("2026-09");
      await openDashboard(page);
      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await expect(page).toHaveURL(/\/accounts$/);
      await openDashboard(page);
      await expect(summaryCard(page, "Income this month").locator("dd")).toHaveText("3.500,00\u00a0€");

      // Archive the only account: balance drops to zero, monthly history is preserved.
      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await page.getByRole("button", { name: `Archive account ${accountName}`, exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
      await openDashboard(page);
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await expect(summaryCard(page, "Current account balance").locator("dd")).toHaveText("0,00\u00a0€");
      await expect(summaryCard(page, "Income this month").locator("dd")).toHaveText("3.500,00\u00a0€");
      await expect(summaryCard(page, "Expenses this month").locator("dd")).toHaveText("84,72\u00a0€");
      await expect(page.getByRole("list", { name: "Recent transactions", exact: true })).toContainText(groceriesName);

      // Real reload resets a nondefault selection to the local current month.
      await page.getByLabel("Month", { exact: true }).fill("2026-10");
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
      await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toHaveCount(0);
      await expect(summaryCard(page, "Expenses this month").locator("dd")).toHaveText("17,99\u00a0€");
      await page.reload();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toHaveCount(0);
      await expect(summaryCard(page, "Expenses this month").locator("dd")).toHaveText("84,72\u00a0€");

      // Deterministic loading visual: delay only the real dashboard GET, then continue it.
      let releaseLoading = (): void => {};
      const loadingGate = new Promise<void>((resolve) => {
        releaseLoading = resolve;
      });
      await page.route("**/api/dashboard**", async (route) => {
        await loadingGate;
        await route.continue();
      });
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-loading-${viewport.width}.png`), fullPage: true });
      releaseLoading();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
      await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toHaveCount(0);
      await page.unroute("**/api/dashboard**");

      // Ready screenshot and layout checks.
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
      await page.screenshot({ path: testInfo.outputPath(`dashboard-ready-${viewport.width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Real connection failure: no old/zero/empty financial data; Retry keeps the period.
      await context.setOffline(true);
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Could not connect. Check your connection and try again.");
      await expect(summaryCard(page, "Current account balance")).toHaveCount(0);
      await expect(page.getByText("No transactions this month.", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-error-${viewport.width}.png`), fullPage: true });
      await context.setOffline(false);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-11");
      await expect(page.getByRole("status").filter({ hasText: "Loading dashboard" })).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(summaryCard(page, "Current account balance").locator("dd")).toHaveText("0,00\u00a0€");
      await expect(summaryCard(page, "Net this month").locator("dd")).toHaveText("0,00\u00a0€");
      await expect(page.getByText("No transactions this month.", { exact: true })).toBeVisible();

      // Expired valid session on a month request redirects to login and removes financial DOM.
      await context.addCookies([{
        name: "budget_session",
        value: e2eExpiredSessionToken,
        domain: "127.0.0.1",
        path: "/",
      }]);
      await page.request.get(`${new URL(page.url()).origin}/api/auth/csrf`);
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText("Current account balance", { exact: true })).toHaveCount(0);

      await login(page, `e2e-dashboard-${viewport.width}`);
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});