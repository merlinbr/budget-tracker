import { expect, test, type APIResponse, type Page, type Request, type Route } from "@playwright/test";

const password = process.env["BUDGET_E2E_SETTINGS_PASSWORD"]!;
const expired = process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"]!;
const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

async function signIn(page: Page, username: string): Promise<void> {
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function navigate(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// The request fixture used by callers is isolated from the browser cookie jar.
// Only delivery errors for this exact, confirmed client-aborted request are allowed.
async function holdResponse(
  page: Page,
  pattern: string,
  matches: (request: Request) => boolean,
  fetchResponse: (route: Route) => Promise<APIResponse>,
  status: number,
  allowAbortedDelivery = false,
) {
  const captured = gate();
  const release = gate();
  const finished = gate();
  let started = false;
  let done = false;
  let count = 0;
  let error: unknown;
  const aborted = new Set<Request>();
  const onFailed = (request: Request) => {
    if (/net::ERR_ABORTED/.test(request.failure()?.errorText ?? "")) aborted.add(request);
  };
  page.on("requestfailed", onFailed);
  const handler = async (route: Route) => {
    if (!matches(route.request())) return route.continue();
    started = true;
    count++;
    try {
      expect(count).toBe(1);
      const response = await fetchResponse(route);
      expect(response.status()).toBe(status);
      captured.open();
      await release.wait;
      try {
        await route.fulfill({ response });
      } catch (deliveryError) {
        const cancelledTransport = /Invalid InterceptionId|(?:request|interception).*?(?:cancel|abort)/i
          .test(String(deliveryError));
        if (!allowAbortedDelivery || !aborted.has(route.request()) || !cancelledTransport) throw deliveryError;
      }
    } catch (routeError) {
      error = routeError;
    } finally {
      captured.open();
      done = true;
      finished.open();
    }
  };
  await page.route(pattern, handler);
  const check = () => { if (error) throw error; };
  return {
    release: release.open,
    count: () => count,
    async captured() { await captured.wait; check(); },
    async finished() { await finished.wait; check(); },
    async dispose() {
      release.open();
      try {
        if (started) await expect.poll(() => done).toBe(true);
        check();
      } finally {
        await page.unroute(pattern, handler);
        page.off("requestfailed", onFailed);
      }
    },
  };
}

async function protectedReady(page: Page, name: "Accounts" | "Categories"): Promise<void> {
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/${name.toLowerCase()}` &&
    response.request().method() === "GET",
  );
  await navigate(page, name);
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: `Loading ${name.toLowerCase()}` })).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
}

for (const viewport of viewports) {
  const username = `e2e-settings-${viewport.width}`;

  test(`pending profile survives expiry and re-login at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await signIn(page, username);
    const household = await holdResponse(page, "**/api/household", () => true,
      (route) => request.get(route.request().url(), {
        headers: { ...route.request().headers(), cookie: `budget_session=${expired}` },
      }), 401);
    const write = await holdResponse(page, "**/api/users/me",
      (request) => request.method() === "PATCH", (route) => route.fetch(), 200);
    let originalName: string | undefined;
    let changed = false;
    try {
      await navigate(page, "Settings");
      originalName = await page.locator("#settings-display-name").inputValue();
      await household.captured();
      await page.locator("#settings-display-name").fill(`Lifecycle ${viewport.width}`);
      changed = true;
      await page.getByRole("button", { name: "Save profile", exact: true }).click();
      await write.captured();
      await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
      await expect(page.locator("#profile-form")).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("status").filter({ hasText: "The current operation must finish" })).toBeVisible();
      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      expect(write.count()).toBe(1);

      household.release();
      await household.finished();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator("#profile-form")).toHaveCount(0);
      await household.dispose();
      await signIn(page, username);
      await protectedReady(page, "Accounts");
      await protectedReady(page, "Categories");
      await signOut(page);
      await signIn(page, username);
      write.release();
      await write.finished();
      await page.evaluate(() => document.readyState);
      await expect(page).toHaveURL(/\/dashboard$/);
      await protectedReady(page, "Accounts");
      await protectedReady(page, "Categories");
      await signOut(page);
    } finally {
      // Release both gates even if one cleanup fails; always restore via the UI.
      household.release();
      write.release();
      try {
        await household.dispose();
      } finally {
        try {
          await write.dispose();
        } finally {
          if (changed && originalName !== undefined) {
            if (!/\/login$/.test(page.url())) await signOut(page);
            await signIn(page, username);
            await navigate(page, "Settings");
            await expect(page.getByRole("list", { name: "Household members", exact: true })).toBeVisible();
            await expect(page.getByRole("status").filter({ hasText: "Loading filters" })).toHaveCount(0);
            await page.locator("#settings-display-name").fill(originalName);
            await expect(page.locator("#settings-display-name")).toHaveValue(originalName);
            const restored = page.waitForResponse((response) =>
              new URL(response.url()).pathname === "/api/users/me" && response.request().method() === "PATCH");
            await page.getByRole("button", { name: "Save profile", exact: true }).click();
            const response = await restored;
            expect(response.request().postDataJSON()).toEqual({ displayName: originalName });
            expect(response.status()).toBe(200);
            expect(await response.json()).toMatchObject({ displayName: originalName });
            await expect(page.locator("#profile-status")).toHaveText("Profile saved.");
            await expect(page.locator(".identity")).toContainText(originalName);
            await signOut(page);
          }
        }
      }
    }
  });

  for (const target of ["Accounts", "Categories", "Transactions"] as const) {
    test(`abandoned ${target.toLowerCase()} read after re-login at ${viewport.width}px`, async ({ page, request }) => {
      await page.setViewportSize(viewport);
      await page.goto("/login");
      await signIn(page, username);
      const resource = target === "Categories" ? "categories" : "accounts";
      const held = await holdResponse(page, `**/api/${resource}*`, (request) => {
        const url = new URL(request.url());
        return request.method() === "GET" && url.pathname === `/api/${resource}` &&
          (url.searchParams.get("includeArchived") === "true") === (target === "Transactions");
      }, (route) => request.get(route.request().url(), {
        headers: { ...route.request().headers(), cookie: `budget_session=${expired}` },
      }), 401, true);
      try {
        const normalLookups = target === "Transactions"
          ? Promise.all(["/api/categories", "/api/transactions"].map((path) =>
              page.waitForResponse((response) => new URL(response.url()).pathname === path &&
                response.request().method() === "GET")))
          : undefined;
        await navigate(page, target);
        await held.captured();
        if (normalLookups) {
          for (const response of await normalLookups) expect(response.status()).toBe(200);
        }
        await navigate(page, "Dashboard");
        await signOut(page);
        await signIn(page, username);
        held.release();
        await held.finished();
        await page.evaluate(() => document.readyState);
        await expect(page).toHaveURL(/\/dashboard$/);
        await held.dispose();
        // Browser evidence is continued usability, not proof of interceptor delivery.
        await protectedReady(page, target === "Categories" ? "Accounts" : "Categories");
        await signOut(page);
      } finally {
        await held.dispose();
      }
    });
  }

  test(`live protected 401 still redirects at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await signIn(page, username);
    const held = await holdResponse(page, "**/api/accounts?*", (request) => request.method() === "GET",
      (route) => request.get(route.request().url(), {
        headers: { ...route.request().headers(), cookie: `budget_session=${expired}` },
      }), 401);
    try {
      await navigate(page, "Accounts");
      await held.captured();
      held.release();
      await held.finished();
      await expect(page).toHaveURL(/\/login$/);
      await held.dispose();
      await signIn(page, username);
      await protectedReady(page, "Accounts");
      await signOut(page);
    } finally {
      await held.dispose();
    }
  });
}
