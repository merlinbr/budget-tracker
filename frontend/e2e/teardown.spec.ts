import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import globalTeardown from "./global-teardown";

test("teardown preserves a supplied root directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-tracker-teardown-root-"));
  const sentinel = join(root, "keep.txt");
  await writeFile(sentinel, "keep");
  const previousDirectory = process.env["BUDGET_E2E_DATA_DIRECTORY"];
  process.env["BUDGET_E2E_DATA_DIRECTORY"] = root;

  try {
    await globalTeardown();
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");

    const ownedDirectory = await mkdtemp(join(root, "budget-tracker-e2e-"));
    const ownedSentinel = join(ownedDirectory, "remove.txt");
    await writeFile(ownedSentinel, "remove");
    await writeFile(join(ownedDirectory, ".budget-tracker-e2e-owned"), "");
    await globalTeardown();
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
    await expect(readFile(ownedSentinel, "utf8")).rejects.toThrow();
  } finally {
    if (previousDirectory === undefined) {
      delete process.env["BUDGET_E2E_DATA_DIRECTORY"];
    } else {
      process.env["BUDGET_E2E_DATA_DIRECTORY"] = previousDirectory;
    }
    await rm(root, { force: true, recursive: true });
  }
});
