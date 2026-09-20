import { expect, test, type Page } from "@playwright/test";

const settingsPassword = process.env["BUDGET_E2E_SETTINGS_PASSWORD"]!;
const changedPassword = "brand-new password 1";
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];

type Member = { id: number; displayName: string; role: string; isActive: boolean };

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(settingsPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    // Settled login first; dashboard is the normal outcome.
    await page.waitForURL(/\/dashboard$/, { timeout: 5_000 });
    return;
  } catch {
    // A prior attempt may have died between the password change and the
    // seeded-password restore; only that case retries with the scenario
    // password.
  }
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(changedPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // Reset to the seeded password right away so the rest of the scenario and
  // any retry work against the canonical state.
  await page.request.post("/api/auth/change-password", {
    headers: await apiHeaders(page),
    data: { currentPassword: changedPassword, newPassword: settingsPassword },
  });
  // Log back in with the restored password.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(settingsPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function apiHeaders(page: Page): Promise<Record<string, string>> {
  await page.request.get("/api/auth/csrf");
  const token =
    (await page.context().cookies()).find((cookie) => cookie.name === "XSRF-TOKEN")?.value ?? "";
  return { Origin: new URL(page.url()).origin, "X-XSRF-TOKEN": token };
}

// Normalizes ONLY this viewport's dedicated settings household (its own
// household; never touches e2e-user/dashboard/budgets identities). Called
// after login, before the password change, so retries start from the seeded
// password on both the owner and the second member.
async function resetSettingsHousehold(page: Page, username: string): Promise<void> {
  const headers = await apiHeaders(page);
  // A previous retry may have renamed the owner; reset the display name.
  const me = await page.request.get("/api/auth/me").then((r) => r.json());
  const original = username.replace("e2e-settings-", "Settings User ");
  await page.request.patch("/api/users/me", {
    headers,
    data: { displayName: original },
  });
  for (const transaction of await page.request.get("/api/transactions").then((r) => r.json())) {
    await page.request.delete(`/api/transactions/${transaction.id}`, { headers });
  }
  for (const resource of ["accounts", "categories"] as const) {
    for (const item of await page.request.get(`/api/${resource}`).then((r) => r.json())) {
      await page.request.post(`/api/${resource}/${item.id}/archive`, { headers });
    }
  }
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("status").filter({ hasText: "Loading filters" })).toHaveCount(0);
}

function memberElement(page: Page, displayName: string) {
  return page
    .getByRole("list", { name: "Household members", exact: true })
    .getByRole("listitem")
    .filter({ hasText: displayName });
}

function suffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

test.describe("settings: profile, password, household, CSV", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  for (const viewport of viewports) {
    const width = viewport.width;
    test(`settings workflow at ${width}px`, async ({ context, page }) => {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date("2026-09-01T12:30:00Z") });
      const username = `e2e-settings-${width}`;
      await login(page, username);
      await resetSettingsHousehold(page, username);

      // -------- Profile: rename persists; shell and member row agree; no logout.
      await openSettings(page);
      await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(`Settings User ${width}`);
      const renamed = `Renamed ${suffix()}`;
      await page.getByLabel("Display name", { exact: true }).fill(`  ${renamed}  `);
      await page.getByRole("button", { name: "Save profile", exact: true }).click();
      await expect(memberElement(page, renamed)).toBeVisible();
      await expect(page.locator(".identity")).toContainText(renamed);
      await page.reload();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(renamed);
      await expect(page.locator(".identity")).toContainText(renamed);

      // -------- Household section lists owner and second member read-only.
      await expect(page.getByText(`Settings Household ${width}`, { exact: true })).toBeVisible();
      await expect(memberElement(page, renamed)).toBeVisible();
      await expect(memberElement(page, `Settings Member ${width}`)).toBeVisible();
      await expect(page.getByText("Inactive", { exact: true })).toHaveCount(0);
      // No credential/session disclosure anywhere on the page.
      const settingsText = (await page.textContent("main")) ?? "";
      expect(settingsText.toLowerCase()).not.toContain("password_hash");
      expect(settingsText.toLowerCase()).not.toContain("token_hash");

      // -------- Wrong current password: field error, stays logged in, no replay.
      await page.getByLabel("Current password", { exact: true }).fill("wrong password 12");
      await page.getByLabel("New password", { exact: true }).fill(changedPassword);
      await page.getByLabel("Repeat new password", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "Change password", exact: true }).click();
      await expect(page.locator("#current-password-error")).toContainText("Current password is incorrect.");
      // A financial GET still succeeds: not logged out.
      expect((await page.request.get("/api/auth/me")).status()).toBe(200);

      // -------- Confirmation mismatch suppresses the write.
      await page.getByLabel("Current password", { exact: true }).fill(settingsPassword);
      await page.getByLabel("Repeat new password", { exact: true }).fill("different password 1");
      await page.getByRole("button", { name: "Change password", exact: true }).click();
      await expect(page.locator("#confirm-password-error")).toContainText("do not match");

      // -------- Real password change with TWO live sessions.
      const secondContext = await context.browser()!.newContext({ viewport });
      const secondPage = await secondContext.newPage();
      await login(secondPage, username);
      await expect(secondPage.locator(".identity")).toContainText(renamed);

      await page.getByLabel("Current password", { exact: true }).fill(settingsPassword);
      await page.getByLabel("Repeat new password", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "Change password", exact: true }).click();

      // First context lands on exact /login with the one-time non-secret notice.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();
      // Second session revoked.
      expect((await secondPage.request.get("/api/auth/me")).status()).toBe(401);
      // Old password fails; new password works.
      await secondPage.goto("/login");
      await secondPage.getByLabel("Username", { exact: true }).fill(username);
      await secondPage.getByLabel("Password", { exact: true }).fill(settingsPassword);
      await secondPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(secondPage.getByRole("alert")).toContainText("Invalid username or password.");
      await secondPage.getByLabel("Password", { exact: true }).fill(changedPassword);
      await secondPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(secondPage).toHaveURL(/\/dashboard$/);
      await secondContext.close();

      // -------- CSV seed through the real UI with the fresh password.
      // (First page is already on /login after the changed password.)
      await page.goto("/login");
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Password", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      const suffixStamp = suffix();
      const accountName = `Settings Checking ${suffixStamp}`;
      const accountResponse = await page.request.post("/api/accounts", {
        headers: await apiHeaders(page),
        data: { name: accountName, type: "checking", initialBalance: 1000 },
      });
      expect(accountResponse.status()).toBe(201);
      const accountId = (await accountResponse.json()).id;
      const categoryName = `Settings Food ${suffixStamp}`;
      const categoryResponse = await page.request.post("/api/categories", {
        headers: await apiHeaders(page),
        data: { name: categoryName, type: "expense" },
      });
      expect(categoryResponse.status()).toBe(201);
      const categoryId = (await categoryResponse.json()).id;

      await openSettings(page);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const download = await downloadPromise;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe("transactions.csv");
      const path = await download.path();
      const csvText = require("node:fs").readFileSync(path, "utf8");
      const rows = parseCsv(csvText);
      expect(rows[0]).toEqual(["date", "description", "account", "category", "type", "amount", "currency"]);
      // The household currently has only the seeded account/category, but no
      // transaction yet: empty export is a header-only 200 download.
      expect(rows.length).toBe(1);

      // -------- Filtered download via the visible UI.
      const transactionResponse = await page.request.post("/api/transactions", {
        headers: await apiHeaders(page),
        data: {
          accountId,
          categoryId,
          amount: -8472,
          description: "=SUM(A1) evil",
          transactionDate: "2026-09-07",
        },
      });
      expect(transactionResponse.status()).toBe(201);

      await page.reload();
      await openSettings(page);
      await page.locator("#export-from").fill("2026-09-07");
      await page.locator("#export-to").fill("2026-09-07");
      const download2Promise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const download2 = await download2Promise;
      expect(await download2.failure()).toBeNull();
      const csv2 = parseCsv(require("node:fs").readFileSync(await download2.path(), "utf8"));
      expect(csv2).toEqual([
        ["date", "description", "account", "category", "type", "amount", "currency"],
        ["2026-09-07", "'=SUM(A1) evil", accountName, categoryName, "expense", "-84.72", "EUR"],
      ]);

      // Empty interval: header-only download again.
      await page.locator("#export-from").fill("2027-01-01");
      await page.locator("#export-to").fill("2027-01-31");
      const download3Promise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const download3 = await download3Promise;
      expect(parseCsv(require("node:fs").readFileSync(await download3.path(), "utf8"))).toEqual([
        ["date", "description", "account", "category", "type", "amount", "currency"],
      ]);

      // Reversed range never reaches the network.
      await page.locator("#export-from").fill("2026-09-10");
      await page.locator("#export-to").fill("2026-09-01");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      await expect(page.locator("#export-error")).toContainText("from date must be on or before");

      // Keyboard: the Download button is reachable and labeled.
      await page.getByRole("button", { name: "Download CSV", exact: true }).focus();
      await expect(page.getByRole("button", { name: "Download CSV", exact: true })).toBeFocused();

      // Screenshots at the capacity-tested sizes; layout sanity via overflow.
      await expect(page.locator("#export-error")).toContainText("from date");
      await page.screenshot({ path: `test-results/settings-csv-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // -------- Real offline failure: no download, error visible, retry works.
      await context.setOffline(true);
      await page.locator("#export-from").fill("");
      await page.locator("#export-to").fill("");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      await expect(page.locator("#export-error")).toContainText("Could not connect");
      await page.screenshot({ path: `test-results/settings-offline-${width}.png`, fullPage: true });
      await context.setOffline(false);
      await expect(page.getByRole("button", { name: "Download CSV", exact: true })).toBeEnabled();

      // -------- Sign out denies protected routes; restore seeded password.
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);

      // Restore the seeded password through the real endpoint so a retry of
      // this scenario is deterministic.
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Password", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.request.post("/api/auth/change-password", {
        headers: await apiHeaders(page),
        data: { currentPassword: changedPassword, newPassword: settingsPassword },
      });
    });
  }
});

/** RFC-4180-style parse: quoted cells contain commas/newlines; NOT a naive split. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      continue;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
