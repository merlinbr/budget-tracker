import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const E2E_DIRECTORY_PREFIX = "budget-tracker-e2e-";
const E2E_OWNERSHIP_MARKER = ".budget-tracker-e2e-owned";

const isOwnedDirectory = (directory: string): boolean =>
  basename(directory).startsWith(E2E_DIRECTORY_PREFIX) &&
  existsSync(join(directory, E2E_OWNERSHIP_MARKER));

export default async function globalTeardown(): Promise<void> {
  const configuredDirectory = process.env["BUDGET_E2E_DATA_DIRECTORY"] ?? tmpdir();
  let directories: string[];
  if (isOwnedDirectory(configuredDirectory)) {
    directories = [configuredDirectory];
  } else {
    let entries;
    try {
      entries = await readdir(configuredDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    directories = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(E2E_DIRECTORY_PREFIX) &&
          isOwnedDirectory(join(configuredDirectory, entry.name)),
      )
      .map((entry) => join(configuredDirectory, entry.name));
  }

  for (const directory of directories) {
    try {
      await rm(directory, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 250,
      });
    } catch {
      // The detached retry below handles files locked by the web server.
    }

    const cleanup =
      process.platform === "win32"
        ? spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "$path = $env:BUDGET_E2E_CLEANUP_PATH; for ($i = 0; $i -lt 30; $i++) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $path)) { exit 0 }; Start-Sleep -Seconds 1 }",
            ],
            {
              detached: true,
              env: {
                ...process.env,
                BUDGET_E2E_CLEANUP_PATH: directory,
              },
              stdio: "ignore",
              windowsHide: true,
            },
          )
        : spawn(
            "sh",
            [
              "-c",
              'for attempt in $(seq 1 30); do rm -rf -- "$1" 2>/dev/null && exit 0; sleep 1; done',
              "cleanup",
              directory,
            ],
            { detached: true, stdio: "ignore", windowsHide: true },
          );
    cleanup.unref();
  }
}
