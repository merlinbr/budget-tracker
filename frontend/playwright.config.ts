import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(__dirname, "..");
const backendRoot = join(projectRoot, "backend");
const E2E_DIRECTORY_PREFIX = "budget-tracker-e2e-";
const E2E_OWNERSHIP_MARKER = ".budget-tracker-e2e-owned";
const configuredDataDirectory = process.env["BUDGET_E2E_DATA_DIRECTORY"] ?? tmpdir();
const e2eDataDirectory = mkdtempSync(join(configuredDataDirectory, E2E_DIRECTORY_PREFIX));
writeFileSync(join(e2eDataDirectory, E2E_OWNERSHIP_MARKER), "");
const databaseUrl =
  process.env["BUDGET_E2E_DATABASE_URL"] ??
  `sqlite:///${join(e2eDataDirectory, "budget.db").replaceAll("\\", "/")}`;
const python = process.env["PYTHON"] ?? "python";
const quote = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;
const e2eUsername = process.env["BUDGET_E2E_USERNAME"] ?? "e2e-user";
const e2ePassword =
  process.env["BUDGET_E2E_PASSWORD"] ?? randomBytes(24).toString("base64url");
const sessionSecret =
  process.env["BUDGET_E2E_SESSION_SECRET"] ?? randomBytes(32).toString("base64url");
const e2eExpiredSessionToken =
  process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"] ??
  randomBytes(32).toString("base64url");

process.env["BUDGET_E2E_DATA_DIRECTORY"] = e2eDataDirectory;
process.env["BUDGET_E2E_DATABASE_URL"] = databaseUrl;
process.env["BUDGET_E2E_USERNAME"] = e2eUsername;
process.env["BUDGET_E2E_PASSWORD"] = e2ePassword;
process.env["BUDGET_E2E_SESSION_SECRET"] = sessionSecret;
process.env["BUDGET_E2E_EXPIRED_SESSION_TOKEN"] = e2eExpiredSessionToken;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4200",
    trace: "on-first-retry",
  },
  globalTeardown: "./e2e/global-teardown.ts",
  webServer: [
    {
      command: `${quote(python)} -m alembic upgrade head && ${quote(python)} -m scripts.seed_e2e && ${quote(python)} -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --no-proxy-headers`,
      cwd: backendRoot,
      env: {
        APP_ENV: "test",
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: sessionSecret,
        SESSION_MAX_AGE_DAYS: "30",
        ALLOWED_ORIGINS: "http://127.0.0.1:4200,http://localhost:4200",
        TRUSTED_HOSTS: "127.0.0.1,localhost",
        SECURE_COOKIES: "false",
        E2E_USERNAME: e2eUsername,
        E2E_PASSWORD: e2ePassword,
        E2E_EXPIRED_SESSION_TOKEN: e2eExpiredSessionToken,
      },
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm start -- --host 127.0.0.1 --port 4200",
      cwd: __dirname,
      url: "http://127.0.0.1:4200",
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
    },
  ],
});
