import { expect, test, type Page } from "@playwright/test";

const e2eUsername = process.env["BUDGET_E2E_USERNAME"]!;
const e2ePassword = process.env["BUDGET_E2E_PASSWORD"]!;
const e2eExpiredSessionToken = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

async function loginForTransactions(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(e2eUsername);
  await page.getByLabel("Password", { exact: true }).fill(e2ePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
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

function transactionRows(page: Page) {
  return page.getByRole("list", { name: "Transaction history", exact: true }).getByRole("listitem");
}

async function addTransaction(
  page: Page,
  accountName: string,
  categoryName: string,
  amount: string,
  description: string,
  date = "2026-09-07",
  keyboardAmount = false,
): Promise<void> {
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add transaction", exact: true })).toBeVisible();
  await page.locator("#transaction-type").selectOption("expense");
  const amountInput = page.getByLabel("Amount (EUR)", { exact: true });
  if (keyboardAmount) {
    await amountInput.focus();
    await page.keyboard.type(amount);
  } else {
    await amountInput.fill(amount);
  }
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

test.describe("real transactions", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  for (const viewport of viewports) {
    test(`completes the transaction lifecycle at ${viewport.width}px`, async ({ context, page }) => {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-09-06T12:30:00Z") });
      await loginForTransactions(page);

      const suffix = crypto.randomUUID().slice(0, 8);
      const accountName = `Checking ${suffix}`;
      const salaryName = `Salary ${suffix}`;
      const groceriesName = `Groceries ${suffix}`;
      const netflixName = `Netflix ${suffix}`;
      const salaryDescription = `Salary ${suffix}`;
      const groceriesDescription = `Groceries ${suffix} <script>alert(1)</script>`;
      const netflixDescription = `Netflix ${suffix}`;

      const account = await saveAccount(page, accountName);
      const salary = await saveCategory(page, salaryName, "income");
      const groceries = await saveCategory(page, groceriesName, "expense");
      const netflix = await saveCategory(page, netflixName, "expense");

      await page.getByRole("link", { name: "Transactions", exact: true }).click();
      await expect(page).toHaveURL(/\/transactions$/);
      await page.getByLabel("Month", { exact: true }).fill("2026-09");
      const initialListResponsePromise = page.waitForResponse(
        (response) => response.url().includes("/api/transactions") && response.request().method() === "GET",
      );
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      expect((await initialListResponsePromise).ok()).toBeTruthy();
      await expect(page.getByText("Loading transactions…", { exact: true })).toHaveCount(0);
      await expect(
        page.getByText("No transactions match these filters.", { exact: true }).or(transactionRows(page).first()),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-09-07");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      // Keyboard entry and accessible validation preserve the value and focus before clearing.
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      const invalidAmount = page.getByLabel("Amount (EUR)", { exact: true });
      const transactionDate = page.getByLabel("Date", { exact: true });
      const transactionAccount = page.locator("#transaction-account");
      const transactionCategory = page.locator("#transaction-category");
      await invalidAmount.focus();
      await page.keyboard.type("0");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Amount must be greater than zero.", { exact: true })).toBeVisible();
      await expect(invalidAmount).toHaveValue("0");
      await expect(invalidAmount).toBeFocused();
      await expect(invalidAmount).toHaveAttribute("aria-invalid", "true");
      await invalidAmount.press("ControlOrMeta+A");
      await invalidAmount.press("Backspace");
      await page.keyboard.type("84.72");
      await expect(transactionDate).toHaveValue("2026-09-07");
      await transactionAccount.focus();
      await transactionAccount.press("Home");
      await page.keyboard.type(accountName);
      await transactionAccount.press("Enter");
      await expect(transactionAccount.locator("option:checked")).toHaveText(accountName);
      await transactionCategory.focus();
      await transactionCategory.press("Home");
      await page.keyboard.type(groceriesName);
      await transactionCategory.press("Enter");
      await expect(transactionCategory.locator("option:checked")).toHaveText(groceriesName);
      const description = page.locator("#transaction-description");
      await description.focus();
      await page.keyboard.type(groceriesDescription);
      const saveTransaction = page.getByRole("button", { name: "Save transaction", exact: true });
      const listResponsePromise = page.waitForResponse(
        (response) => response.url().includes("/api/transactions") && response.request().method() === "GET",
      );
      await saveTransaction.focus();
      await page.keyboard.press("Enter");
      const groceriesAfterSave = transactionRows(page).filter({ hasText: groceriesDescription });
      await expect(groceriesAfterSave).toContainText("2026-09-07");
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toBeVisible();
      expect((await listResponsePromise).ok()).toBeTruthy();

      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await page.locator("#transaction-type").selectOption("income");
      await page.locator("#transaction-amount").fill("3500.00");
      await page.locator("#transaction-date").fill("2026-09-07");
      await page.locator("#transaction-account").selectOption({ label: accountName });
      await page.locator("#transaction-category").selectOption({ label: salaryName });
      await page.locator("#transaction-description").fill(salaryDescription);
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      const salaryAfterSave = transactionRows(page).filter({ hasText: salaryDescription });
      await expect(salaryAfterSave.locator(".amount")).toHaveText("3.500,00\u00a0€");
      await expect(salaryAfterSave).toContainText("2026-09-07");
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toBeVisible();

      await addTransaction(page, accountName, netflixName, "17.99", netflixDescription, "2026-08-30");
      // The September-filtered list is ready before asserting the August row is hidden.
      await expect(page.getByText("Loading transactions…", { exact: true })).toHaveCount(0);
      await expect(transactionRows(page).filter({ hasText: groceriesDescription })).toBeVisible();
      await expect(transactionRows(page).filter({ hasText: netflixDescription })).toHaveCount(0);

      await expect(page.getByText(groceriesDescription, { exact: true })).toBeVisible();
      await expect(page.locator(".description script")).toHaveCount(0);

      // Explicitly exercise every combined filter and verify one real row remains.
      await page.getByLabel("Month", { exact: true }).fill("2026-09");
      await page.locator("#filter-account").selectOption({ label: accountName });
      await page.locator("#filter-category").selectOption({ label: groceriesName });
      await page.getByLabel("Type", { exact: true }).selectOption("expense");
      await page.getByLabel("Search description", { exact: true }).fill(`Groceries ${suffix}`);
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await expect(transactionRows(page)).toHaveCount(1);
      await expect(transactionRows(page).first()).toContainText(groceriesDescription);
      await expect(transactionRows(page).first()).toContainText("-84,72 €");

      // Clear, then adjust filters to the income row for the same account.
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.locator("#filter-account").selectOption({ label: accountName });
      await page.getByLabel("Type", { exact: true }).selectOption("income");
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await expect(transactionRows(page)).toHaveCount(1);
      await expect(transactionRows(page).first()).toContainText(salaryDescription);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.locator("#filter-account").selectOption({ label: accountName });
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();

      // Archive the category, then correct its historical transaction; PUT may retain its archived reference.
      await page.getByRole("link", { name: "Categories", exact: true }).click();
      await expect(page).toHaveURL(/\/categories$/);
      await page.getByRole("button", { name: `Archive category ${groceriesName}`, exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
      await expect(page.getByText(groceriesName, { exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Transactions", exact: true }).click();
      await expect(page).toHaveURL(/\/transactions$/);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.getByText("Loading transactions…", { exact: true })).toHaveCount(0);
      const allAccountRows = transactionRows(page);
      await expect(allAccountRows.filter({ hasText: netflixDescription })).toBeVisible();
      await expect(allAccountRows.filter({ hasText: netflixDescription })).toContainText("-17,99 €");
      await expect(allAccountRows.filter({ hasText: netflixDescription })).toContainText("2026-08-30");
      await page.locator("#filter-account").selectOption({ label: accountName });
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      const groceriesRow = transactionRows(page).filter({ hasText: groceriesDescription });
      await groceriesRow.getByRole("button", { name: `Edit transaction ${groceriesDescription}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: "Edit transaction", exact: true })).toBeVisible();
      await expect(page.locator("#transaction-category option:checked")).toContainText(`${groceriesName} (Archived — retained)`);
      await page.locator("#transaction-amount").fill("90.00");
      await page.locator("#transaction-date").fill("2026-08-31");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Transaction updated." })).toBeVisible();
      await expect(transactionRows(page).filter({ hasText: groceriesDescription })).toContainText("-90,00 €");
      await expect(transactionRows(page).filter({ hasText: groceriesDescription })).toContainText("2026-08-31");

      const netflixRow = transactionRows(page).filter({ hasText: netflixDescription });
      await netflixRow.getByRole("button", { name: `Delete transaction ${netflixDescription}`, exact: true }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(netflixRow).toBeVisible();
      await netflixRow.getByRole("button", { name: `Delete transaction ${netflixDescription}`, exact: true }).click();
      await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
      await expect(transactionRows(page).filter({ hasText: netflixDescription })).toHaveCount(0);

      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await expect(page).toHaveURL(/\/accounts$/);
      const accountCard = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: accountName, exact: true }) });
      await expect(accountCard).toContainText("4.410,00 €");
      const balanceResponse = await page.request.get(`${page.url().replace(/\/accounts$/, "")}/api/accounts/${account.id}`);
      expect(balanceResponse.ok()).toBeTruthy();
      expect((await balanceResponse.json()).balance).toBe(441000);

      await page.getByRole("link", { name: "Transactions", exact: true }).click();
      await expect(page).toHaveURL(/\/transactions$/);
      await page.reload();
      await expect(page).toHaveURL(/\/transactions$/);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.locator("#filter-account").selectOption({ label: accountName });
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      const persistedSalary = transactionRows(page).filter({ hasText: salaryDescription });
      const persistedGroceries = transactionRows(page).filter({ hasText: groceriesDescription });
      await expect(persistedSalary).toBeVisible();
      await expect(persistedSalary).toContainText("2026-09-07");
      await expect(persistedGroceries).toBeVisible();
      await expect(persistedGroceries).toContainText("2026-08-31");
      await expect(transactionRows(page).filter({ hasText: netflixDescription })).toHaveCount(0);
      await page.getByLabel("Search description", { exact: true }).fill("no matching transaction");
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();
      const offlineDescription = `Offline failed save ${suffix}`;
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await page.locator("#transaction-type").selectOption("expense");
      await page.locator("#transaction-amount").fill("23.45");
      await page.locator("#transaction-date").fill("2026-09-07");
      await page.locator("#transaction-account").selectOption({ label: accountName });
      await page.locator("#transaction-category").selectOption({ label: netflixName });
      await page.locator("#transaction-description").fill(offlineDescription);
      await context.setOffline(true);
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Could not connect. Check your connection and try again.");
      await expect(page.getByRole("heading", { name: "Add transaction", exact: true })).toBeVisible();
      await expect(page.locator("#transaction-amount")).toHaveValue("23.45");
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toHaveCount(0);
      await context.setOffline(false);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      const csrfDescription = `CSRF failed save ${suffix}`;
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await page.locator("#transaction-type").selectOption("expense");
      await page.locator("#transaction-amount").fill("34.56");
      await page.locator("#transaction-date").fill("2026-09-07");
      await page.locator("#transaction-account").selectOption({ label: accountName });
      await page.locator("#transaction-category").selectOption({ label: netflixName });
      await page.locator("#transaction-description").fill(csrfDescription);
      await context.addCookies([{
        name: "XSRF-TOKEN",
        value: "invalid-xsrf-token",
        domain: "127.0.0.1",
        path: "/",
      }]);
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText("The request was not verified. Check your session and try again.");
      await expect(page.getByRole("heading", { name: "Add transaction", exact: true })).toBeVisible();
      await expect(page.locator("#transaction-amount")).toHaveValue("34.56");
      await expect(page.getByRole("status").filter({ hasText: "Transaction saved." })).toHaveCount(0);
      const csrfRefresh = await page.request.get(`${new URL(page.url()).origin}/api/auth/csrf`);
      expect(csrfRefresh.ok()).toBeTruthy();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByLabel("Search description", { exact: true }).fill(`failed save ${suffix}`);
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await expect(page.getByText("No transactions match these filters.", { exact: true })).toBeVisible();

      // A real expired session (cookie replacement, not an auth bypass) redirects an attempted save to login.
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.getByRole("button", { name: "Add transaction", exact: true }).click();
      await page.locator("#transaction-amount").fill("1.00");
      await page.locator("#transaction-date").fill("2026-09-07");
      await page.locator("#transaction-type").selectOption("income");
      await page.locator("#transaction-account").selectOption({ label: accountName });
      await page.locator("#transaction-category").selectOption({ label: salaryName });
      await context.addCookies([{
        name: "budget_session",
        value: e2eExpiredSessionToken,
        domain: "127.0.0.1",
        path: "/",
      }]);
      await page.request.get(`${new URL(page.url()).origin}/api/auth/csrf`);
      await page.getByRole("button", { name: "Save transaction", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);

      await loginForTransactions(page);
      await page.goto("/transactions");
      await expect(page).toHaveURL(/\/transactions$/);
      await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Sign in to Budget Tracker" })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Sign in to Budget Tracker" })).toBeVisible();
      await page.goto("/transactions");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText(accountName, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toHaveCount(0);
    });
  }
});
