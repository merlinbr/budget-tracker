import { expect, test, type Locator, type Page } from "@playwright/test";

const budgetsPassword = process.env["BUDGET_E2E_BUDGETS_PASSWORD"]!;
const expiredSessionToken = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];
const exercisedMonths = ["2026-08", "2026-09", "2026-10", "2026-12", "2027-01", "2027-02"];

function period(month: string): string {
  const [year, number] = month.split("-");
  return `year=${Number(year)}&month=${Number(number)}`;
}

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(budgetsPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function apiHeaders(page: Page): Promise<Record<string, string>> {
  expect((await page.request.get("/api/auth/csrf")).ok()).toBeTruthy();
  const token = (await page.context().cookies()).find((cookie) => cookie.name === "XSRF-TOKEN")!.value;
  return { Origin: new URL(page.url()).origin, "X-XSRF-TOKEN": token };
}

// Only the logged-in disposable household and these scenario months are touched on retry.
async function resetHousehold(page: Page): Promise<void> {
  const headers = await apiHeaders(page);
  for (const month of exercisedMonths) {
    const response = await page.request.get(`/api/budgets?${period(month)}`);
    expect(response.ok()).toBeTruthy();
    for (const budget of await response.json()) {
      expect((await page.request.delete(`/api/budgets/${budget.categoryId}?${period(month)}`, { headers })).status()).toBe(204);
    }
  }
  const transactions = await page.request.get("/api/transactions");
  expect(transactions.ok()).toBeTruthy();
  for (const transaction of await transactions.json()) {
    expect((await page.request.delete(`/api/transactions/${transaction.id}`, { headers })).status()).toBe(204);
  }
  for (const resource of ["accounts", "categories"]) {
    const response = await page.request.get(`/api/${resource}`);
    expect(response.ok()).toBeTruthy();
    for (const item of await response.json()) {
      expect((await page.request.post(`/api/${resource}/${item.id}/archive`, { headers })).ok()).toBeTruthy();
    }
  }
}

async function saveAccount(page: Page, name: string): Promise<{ id: number }> {
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Type", { exact: true }).selectOption("checking");
  await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("1000.00");
  const response = page.waitForResponse((result) => result.url().endsWith("/api/accounts") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBeTruthy();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) })).toBeVisible();
  return saved.json();
}

async function saveCategory(page: Page, name: string, type: "expense" | "income"): Promise<{ id: number }> {
  await page.getByRole("link", { name: "Categories", exact: true }).click();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Type", { exact: true }).selectOption(type);
  const response = page.waitForResponse((result) => result.url().endsWith("/api/categories") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Save category", exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBeTruthy();
  await expect(page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) })).toBeVisible();
  return saved.json();
}

function card(page: Page, name: string, dashboard = false): Locator {
  const root = dashboard ? page.getByRole("list", { name: "Budget overview", exact: true }) : page;
  return root.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function usage(row: Locator, limit: string, spent: string, remaining: string, percentage?: string): Promise<void> {
  await expect(row).toContainText(new RegExp(`Spent\\s*${spent}\\s*€`));
  await expect(row).toContainText(new RegExp(`Limit\\s*${limit}\\s*€`));
  if (remaining.startsWith("-")) {
    await expect(row).toContainText(new RegExp(`Over budget\\s*by\\s*${remaining.slice(1)}\\s*€`));
  } else if (remaining === "0,00") {
    await expect(row).toContainText(/At budget|Zero budget — no spending/);
  } else {
    await expect(row).toContainText(new RegExp(`Remaining\\s*${remaining}\\s*€`));
  }
  if (percentage) await expect(row).toContainText(new RegExp(`${percentage}\\s*%`));
  else await expect(row).not.toContainText(/%|NaN|Infinity|undefined/);
}

async function openPage(page: Page, name: "Budgets" | "Dashboard"): Promise<void> {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
  await expect(page.getByRole("status").filter({ hasText: `Loading ${name.toLowerCase()}` })).toHaveCount(0);
}

async function selectMonth(page: Page, month: string): Promise<void> {
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return url.pathname === "/api/budgets" && result.request().method() === "GET"
      && `${url.searchParams.get("year")}-${url.searchParams.get("month")?.padStart(2, "0")}` === month;
  });
  await page.getByLabel("Month", { exact: true }).fill(month);
  expect((await response).ok()).toBeTruthy();
  await expect(page.getByRole("status").filter({ hasText: "Loading budgets" })).toHaveCount(0);
}

async function saveBudget(page: Page, name: string, amount: string): Promise<void> {
  await card(page, name).getByRole("button", { name: /^(Set|Edit) limit$/ }).click();
  await page.getByLabel("Monthly limit (EUR)", { exact: true }).fill(amount);
  const response = page.waitForResponse((result) => result.url().includes("/api/budgets/") && result.request().method() === "PUT");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.getByLabel("Monthly limit (EUR)", { exact: true })).toHaveCount(0);
  await expect(card(page, name).getByRole("button", { name: "Edit limit", exact: true })).toBeVisible();
}

async function copyPrevious(page: Page, status: number, confirm = false, keyboard = false): Promise<void> {
  const response = page.waitForResponse((result) => result.url().endsWith("/api/budgets/copy-previous") && result.request().method() === "POST");
  const button = page.getByRole("button", { name: confirm ? "Confirm overwrite" : "Copy previous month", exact: true });
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Enter");
  } else await button.click();
  expect((await response).status()).toBe(status);
}

// Pause Chromium's actual response after the server executes once; never fetch/fulfill/replay a write.
async function holdBudgetResponse(page: Page, method: "PUT" | "GET") {
  const cdp = await page.context().newCDPSession(page);
  let resolvePaused!: (id: string) => void;
  const paused = new Promise<string>((resolve) => { resolvePaused = resolve; });
  cdp.on("Fetch.requestPaused", (event) => {
    if (event.request.method === method) resolvePaused(event.requestId);
    else void cdp.send("Fetch.continueResponse", { requestId: event.requestId });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/budgets*", requestStage: "Response" }] });
  return {
    paused,
    release: async () => {
      await cdp.send("Fetch.continueResponse", { requestId: await paused });
      await cdp.send("Fetch.disable");
      await cdp.detach();
    },
  };
}

function expenses(page: Page): Locator {
  return page.locator("dl.summary > div").filter({ has: page.getByText("Expenses this month", { exact: true }) }).locator("dd");
}

test.describe("real monthly budgets", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  for (const viewport of viewports) {
    test(`completes the budget lifecycle at ${viewport.width}px`, async ({ context, page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-08-31T12:30:00Z") });
      const username = `e2e-budgets-${viewport.width}`;
      await login(page, username);
      await resetHousehold(page);
      const screenshot = async (state: string) => {
        await page.screenshot({ path: testInfo.outputPath(`budgets-${state}-${viewport.width}.png`), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      };
      const suffix = crypto.randomUUID().slice(0, 8);
      const accountName = `Checking ${suffix}`;
      const groceriesName = `Groceries ${suffix}`;
      const restaurantsName = `Restaurants ${suffix}`;
      const salaryName = `Salary ${suffix}`;
      const transportName = `Transport ${suffix}`;
      const account = await saveAccount(page, accountName);
      const groceries = await saveCategory(page, groceriesName, "expense");
      const restaurants = await saveCategory(page, restaurantsName, "expense");
      await saveCategory(page, salaryName, "income");
      await page.getByRole("link", { name: "Transactions", exact: true }).click();
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      const transactionForm = page.getByRole("form", { name: "Add transaction", exact: true });
      await transactionForm.getByLabel("Type", { exact: true }).selectOption("expense");
      await transactionForm.getByLabel("Amount (EUR)", { exact: true }).fill("84.72");
      await transactionForm.getByLabel("Date", { exact: true }).fill("2026-09-07");
      await transactionForm.getByLabel("Account", { exact: true }).selectOption({ label: accountName });
      await transactionForm.getByLabel("Category", { exact: true }).selectOption({ label: groceriesName });
      await transactionForm.getByLabel("Description (optional)", { exact: true }).fill(`Weekly groceries ${suffix}`);
      const expenseSaved = page.waitForResponse((result) => result.url().endsWith("/api/transactions") && result.request().method() === "POST");
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      expect((await expenseSaved).ok()).toBeTruthy();
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toBeVisible();

      await openPage(page, "Budgets");
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await expect(card(page, groceriesName)).toContainText("No budget");
      await expect(card(page, restaurantsName)).toContainText("No budget");
      await expect(card(page, salaryName)).toHaveCount(0);
      await screenshot("empty");
      await openPage(page, "Dashboard");
      await expect(page.getByText("No budgets for this month.", { exact: true })).toBeVisible();
      await expect(expenses(page)).toHaveText(/84,72\s*€/);
      await screenshot("dashboard-empty");
      await openPage(page, "Budgets");
      await saveBudget(page, groceriesName, "600,00");
      await usage(card(page, groceriesName), "600,00", "84,72", "515,28", "14,12");
      await expect(card(page, restaurantsName)).toContainText("No budget");
      await screenshot("ready");
      await openPage(page, "Dashboard");
      await usage(card(page, groceriesName, true), "600,00", "84,72", "515,28", "14,12");
      await expect(expenses(page)).toHaveText(/84,72\s*€/);
      await screenshot("dashboard-ready");
      await page.reload();
      await usage(card(page, groceriesName, true), "600,00", "84,72", "515,28", "14,12");
      await openPage(page, "Budgets");

      await saveBudget(page, groceriesName, "80.00");
      await usage(card(page, groceriesName), "80,00", "84,72", "-4,72", "105,9");
      await expect(card(page, groceriesName)).toContainText(/Over budget.*4,72\s*€/);
      await screenshot("over");
      await openPage(page, "Dashboard");
      await usage(card(page, groceriesName, true), "80,00", "84,72", "-4,72", "105,9");
      await expect(card(page, groceriesName, true)).toContainText(/Over budget.*4,72\s*€/);
      await screenshot("dashboard-over");
      await openPage(page, "Budgets");
      await saveBudget(page, groceriesName, "0");
      await usage(card(page, groceriesName), "0,00", "84,72", "-84,72");
      await expect(card(page, groceriesName)).toContainText(/Over budget.*84,72\s*€/);
      await saveBudget(page, restaurantsName, "0");
      await usage(card(page, restaurantsName), "0,00", "0,00", "0,00");
      await expect(card(page, restaurantsName)).toContainText("Zero budget — no spending");
      await screenshot("zero");
      await openPage(page, "Dashboard");
      await usage(card(page, groceriesName, true), "0,00", "84,72", "-84,72");
      await expect(card(page, restaurantsName, true)).toContainText("Zero budget — no spending");
      await screenshot("dashboard-zero");
      await openPage(page, "Budgets");
      await card(page, groceriesName).getByRole("button", { name: "Remove budget", exact: true }).click();
      await expect(page.getByRole("button", { name: "Confirm removal", exact: true })).toBeVisible();
      await screenshot("remove-confirmation");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await usage(card(page, groceriesName), "0,00", "84,72", "-84,72");
      await card(page, groceriesName).getByRole("button", { name: "Remove budget", exact: true }).click();
      const removed = page.waitForResponse((result) => result.url().includes("/api/budgets/") && result.request().method() === "DELETE");
      await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
      expect((await removed).status()).toBe(204);
      await expect(card(page, groceriesName)).toContainText("No budget");
      await openPage(page, "Dashboard");
      await expect(card(page, groceriesName, true)).toHaveCount(0);
      await expect(card(page, restaurantsName, true)).toContainText("Zero budget — no spending");
      await expect(expenses(page)).toHaveText(/84,72\s*€/);

      // Supplemental copy fixtures: A/B source, A/C target, with distinct source spending.
      const headers = await apiHeaders(page);
      const transportResponse = await page.request.post("/api/categories", { headers, data: { name: transportName, type: "expense" } });
      expect(transportResponse.ok()).toBeTruthy();
      const transport = await transportResponse.json();
      const putLimit = async (id: number, month: string, limitAmount: number) => {
        expect((await page.request.put(`/api/budgets/${id}?${period(month)}`, { headers, data: { limitAmount } })).status()).toBe(200);
      };
      expect((await page.request.delete(`/api/budgets/${restaurants.id}?${period("2026-09")}`, { headers })).status()).toBe(204);
      await putLimit(groceries.id, "2026-08", 60000);
      await putLimit(restaurants.id, "2026-08", 20000);
      await putLimit(groceries.id, "2026-09", 8000);
      await putLimit(transport.id, "2026-09", 30000);
      expect((await page.request.post("/api/transactions", { headers, data: {
        accountId: account.id, categoryId: groceries.id, amount: -1200,
        transactionDate: "2026-08-07", description: `Copy source ${suffix}`,
      } })).ok()).toBeTruthy();
      await openPage(page, "Budgets");
      await copyPrevious(page, 409);
      await expect(page.getByRole("button", { name: "Confirm overwrite", exact: true })).toBeVisible();
      await expect(page.getByText(/2026-08.*2026-09/)).toBeVisible();
      await screenshot("copy-confirmation");
      await usage(card(page, groceriesName), "80,00", "84,72", "-4,72", "105,9");
      await expect(card(page, restaurantsName)).toContainText("No budget");
      const readSeptember = async () => {
        const response = await page.request.get(`/api/budgets?${period("2026-09")}`);
        expect(response.ok()).toBeTruthy();
        return response.json();
      };
      const beforeCancel = await readSeptember();
      expect(beforeCancel.map((budget: { categoryId: number; limitAmount: number }) => [budget.categoryId, budget.limitAmount]).sort()).toEqual([[groceries.id, 8000], [transport.id, 30000]].sort());
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await readSeptember()).toEqual(beforeCancel);
      await copyPrevious(page, 409);
      await copyPrevious(page, 200, true, true);
      await usage(card(page, groceriesName), "600,00", "84,72", "515,28", "14,12");
      await usage(card(page, restaurantsName), "200,00", "0,00", "200,00", "0");
      await usage(card(page, transportName), "300,00", "0,00", "300,00", "0");
      expect((await readSeptember()).map((budget: { categoryId: number; limitAmount: number }) => [budget.categoryId, budget.limitAmount]).sort()).toEqual([[groceries.id, 60000], [restaurants.id, 20000], [transport.id, 30000]].sort());

      await putLimit(groceries.id, "2026-12", 11100);
      await putLimit(restaurants.id, "2026-12", 22200);
      await putLimit(transport.id, "2027-01", 33300);
      await selectMonth(page, "2026-12");
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2027-01");
      await usage(card(page, transportName), "333,00", "0,00", "333,00", "0");
      await copyPrevious(page, 200);
      await usage(card(page, groceriesName), "111,00", "0,00", "111,00", "0");
      await usage(card(page, restaurantsName), "222,00", "0,00", "222,00", "0");
      expect((await page.request.post(`/api/categories/${restaurants.id}/archive`, { headers })).ok()).toBeTruthy();
      await page.reload();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await selectMonth(page, "2027-01");
      await expect(card(page, restaurantsName)).toContainText("Archived");
      await usage(card(page, restaurantsName), "222,00", "0,00", "222,00", "0");
      await screenshot("archived-history");
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2027-02");
      await expect(card(page, groceriesName)).toContainText("No budget");
      await copyPrevious(page, 200);
      await usage(card(page, groceriesName), "111,00", "0,00", "111,00", "0");
      await usage(card(page, transportName), "333,00", "0,00", "333,00", "0");
      await expect(card(page, restaurantsName)).toHaveCount(0);
      await page.reload();
      await selectMonth(page, "2027-02");
      await usage(card(page, groceriesName), "111,00", "0,00", "111,00", "0");
      await expect(card(page, restaurantsName)).toHaveCount(0);

      // Keyboard save and a real delayed write response exercise the shared pending guard.
      await selectMonth(page, "2026-09");
      await card(page, groceriesName).getByRole("button", { name: "Edit limit", exact: true }).focus();
      await page.keyboard.press("Enter");
      const amount = page.getByLabel("Monthly limit (EUR)", { exact: true });
      await amount.focus();
      await amount.press("ControlOrMeta+A");
      await page.keyboard.type("650.00");
      await expect(page.getByLabel("Month", { exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Copy previous month", exact: true })).toBeDisabled();
      const writeGate = await holdBudgetResponse(page, "PUT");
      let writeCount = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/budgets/") && request.method() === "PUT") writeCount++;
      });
      const saved = page.waitForResponse((result) => result.url().includes("/api/budgets/") && result.request().method() === "PUT");
      await page.getByRole("button", { name: "Save budget", exact: true }).focus();
      await page.keyboard.press("Enter");
      await writeGate.paused;
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: /^(Save budget|Saving…)$/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Previous month", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
      await expect(card(page, transportName).getByRole("button", { name: "Edit limit", exact: true })).toBeDisabled();
      await page.keyboard.press("Enter");
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await expect(page).toHaveURL(/\/budgets$/);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/budgets$/);
      expect(writeCount).toBe(1);
      await screenshot("pending-save");
      await writeGate.release();
      expect((await saved).ok()).toBeTruthy();
      await usage(card(page, groceriesName), "650,00", "84,72", "565,28", "13,03");
      await expect(page.getByLabel("Month", { exact: true })).toBeEnabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(writeCount).toBe(1);
      await openPage(page, "Dashboard");
      await usage(card(page, groceriesName, true), "650,00", "84,72", "565,28", "13,03");
      await openPage(page, "Budgets");

      const loadingGate = await holdBudgetResponse(page, "GET");
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await loadingGate.paused;
      await expect(page.getByRole("status").filter({ hasText: "Loading budgets" })).toBeVisible();
      await expect(card(page, groceriesName)).toHaveCount(0);
      await screenshot("loading");
      await loadingGate.release();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
      await expect(card(page, groceriesName)).toContainText("No budget");
      await context.setOffline(true);
      await page.getByRole("button", { name: "Previous month", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Could not connect" })).toBeVisible();
      await expect(card(page, groceriesName)).toHaveCount(0);
      await expect(page.getByText("No budget", { exact: true })).toHaveCount(0);
      await expect(page.getByText("No budgets for this month.", { exact: true })).toHaveCount(0);
      await screenshot("error");
      await context.setOffline(false);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
      await usage(card(page, groceriesName), "650,00", "84,72", "565,28", "13,03");
      await expect(page.getByRole("alert").filter({ hasText: "Could not connect" })).toHaveCount(0);
      expect(writeCount).toBe(1);
      await screenshot("recovered-ready");

      await context.addCookies([{ name: "budget_session", value: expiredSessionToken, domain: "127.0.0.1", path: "/" }]);
      await page.request.get("/api/auth/csrf");
      await page.getByRole("button", { name: "Next month", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(card(page, groceriesName)).toHaveCount(0);
      await login(page, username);
      await openPage(page, "Budgets");
      await usage(card(page, groceriesName), "650,00", "84,72", "565,28", "13,03");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      for (const path of ["/budgets", "/dashboard"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole("heading", { name: "Sign in to Budget Tracker", exact: true })).toBeVisible();
        await expect(card(page, groceriesName)).toHaveCount(0);
        await expect(page.getByRole("list", { name: "Budget overview", exact: true })).toHaveCount(0);
        await expect(expenses(page)).toHaveCount(0);
      }
    });
  }
});
