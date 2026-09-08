import { expect, test } from "@playwright/test";

const e2eUsername = process.env["BUDGET_E2E_USERNAME"]!;
const e2ePassword = process.env["BUDGET_E2E_PASSWORD"]!;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

test.describe("accounts and categories", () => {
  for (const viewport of viewports) {
    test(`manages accounts and categories at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/login");
      await page.getByLabel("Username", { exact: true }).fill(e2eUsername);
      await page.getByLabel("Password", { exact: true }).fill(e2ePassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const suffix = crypto.randomUUID().slice(0, 8);
      const accountName = `Card ${suffix}`;
      const updatedAccountName = `Updated Card ${suffix}`;
      const expenseName = `Groceries ${suffix}`;
      const renamedExpenseName = `Food ${suffix}`;
      const incomeName = `Salary ${suffix}`;

      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await expect(page).toHaveURL(/\/accounts$/);
      await page.getByRole("button", { name: "Add account", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill(accountName);
      await page.getByLabel("Type", { exact: true }).selectOption("credit_card");
      await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("-84,72");
      await page.getByRole("button", { name: "Save account", exact: true }).click();

      const accountCard = (name: string) =>
        page.getByRole("listitem").filter({
          has: page.getByRole("heading", { name, exact: true }),
        });
      await expect(accountCard(accountName)).toBeVisible();
      await expect(accountCard(accountName)).toContainText(/-84,72\s*€/);
      await expect(accountCard(accountName)).toContainText("Credit card");
      await page.reload();
      await expect(accountCard(accountName)).toBeVisible();
      await expect(accountCard(accountName)).toContainText(/-84,72\s*€/);

      await page.getByRole("button", { name: `Edit account ${accountName}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: "Edit account", exact: true })).toBeVisible();
      await page.getByLabel("Name", { exact: true }).fill(updatedAccountName);
      await page.getByLabel("Type", { exact: true }).selectOption("checking");
      await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("-90.00");
      await expect(page.getByText("Changing the initial balance changes the account's starting money.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save account", exact: true }).click();
      await expect(page.getByText("Please acknowledge the balance change.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Edit account", exact: true })).toBeVisible();
      await page.getByLabel("I understand this balance change", { exact: true }).check();
      await page.getByRole("button", { name: "Save account", exact: true }).click();
      await expect(accountCard(updatedAccountName)).toBeVisible();
      await expect(accountCard(updatedAccountName)).toContainText(/-90,00\s*€/);
      await expect(accountCard(updatedAccountName)).toContainText("Checking");
      await expect(accountCard(accountName)).toHaveCount(0);

      await page.getByRole("button", { name: "Add account", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill("");
      await page.getByLabel("Initial balance (EUR)", { exact: true }).fill("1.234");
      await page.getByLabel("Initial balance (EUR)", { exact: true }).press("Enter");
      await expect(page.getByText("This field is required.", { exact: true })).toBeVisible();
      await expect(page.getByText("Enter a valid amount with up to two decimals.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByRole("button", { name: `Archive account ${updatedAccountName}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: `Archive ${updatedAccountName}?`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(accountCard(updatedAccountName)).toBeVisible();
      await page.getByRole("button", { name: `Archive account ${updatedAccountName}`, exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
      await expect(accountCard(updatedAccountName)).toHaveCount(0);
      await page.getByLabel("Show archived accounts", { exact: true }).check();
      await expect(accountCard(updatedAccountName)).toBeVisible();
      await expect(accountCard(updatedAccountName)).toContainText("Archived (read-only)");
      await expect(page.getByRole("button", { name: `Edit account ${updatedAccountName}`, exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByLabel("Show archived accounts", { exact: true })).not.toBeChecked();
      await expect(accountCard(updatedAccountName)).toHaveCount(0);
      await page.getByLabel("Show archived accounts", { exact: true }).check();
      await expect(accountCard(updatedAccountName)).toContainText("Archived (read-only)");

      await page.getByRole("link", { name: "Categories", exact: true }).click();
      await expect(page).toHaveURL(/\/categories$/);
      const categoryCard = (name: string) =>
        page.getByRole("listitem").filter({
          has: page.getByText(name, { exact: true }),
        });

      await page.getByRole("button", { name: "Add category", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill(expenseName);
      await page.getByLabel("Type", { exact: true }).selectOption("expense");
      await page.getByLabel("Name", { exact: true }).press("Enter");
      await expect(categoryCard(expenseName)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Expense Categories", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Add category", exact: true }).click();
      await page.getByLabel("Name", { exact: true }).fill(incomeName);
      await page.getByLabel("Type", { exact: true }).selectOption("income");
      await page.getByRole("button", { name: "Save category", exact: true }).click();
      await expect(categoryCard(incomeName)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Income Categories", exact: true })).toBeVisible();

      await page.getByRole("button", { name: `Edit category ${expenseName}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: "Edit category", exact: true })).toBeVisible();
      await expect(page.getByLabel("Type", { exact: true })).toHaveCount(0);
      await page.getByLabel("Name", { exact: true }).fill(renamedExpenseName);
      await page.getByRole("button", { name: "Save category", exact: true }).click();
      await expect(categoryCard(renamedExpenseName)).toBeVisible();
      await expect(categoryCard(expenseName)).toHaveCount(0);

      await page.getByRole("button", { name: `Archive category ${renamedExpenseName}`, exact: true }).click();
      await expect(page.getByRole("heading", { name: `Archive ${renamedExpenseName}?`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(categoryCard(renamedExpenseName)).toBeVisible();
      await page.getByRole("button", { name: `Archive category ${renamedExpenseName}`, exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive", exact: true }).click();
      await expect(categoryCard(renamedExpenseName)).toHaveCount(0);
      await page.getByLabel("Show archived categories", { exact: true }).check();
      await expect(categoryCard(renamedExpenseName)).toBeVisible();
      await expect(categoryCard(renamedExpenseName)).toContainText("Archived (read-only)");
      await expect(page.getByRole("button", { name: `Edit category ${renamedExpenseName}`, exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByLabel("Show archived categories", { exact: true })).not.toBeChecked();
      await expect(categoryCard(renamedExpenseName)).toHaveCount(0);
      await page.getByLabel("Show archived categories", { exact: true }).check();
      await expect(categoryCard(renamedExpenseName)).toContainText("Archived (read-only)");

      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/accounts");
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/categories");
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});
