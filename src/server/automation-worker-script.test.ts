import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * M10.1: `pnpm automation:worker` must start. Without a secret it has to stop with a clear
 * message (exit 1) — which proves the script compiles and runs under tsx (M10 shipped it with a
 * top-level await that tsx cannot run).
 */
describe("automation worker script", () => {
  it("starts and refuses to run without AUTOMATION_WORKER_SECRET", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const result = spawnSync("pnpm", ["-s", "automation:worker"], {
      cwd: root,
      env: { ...process.env, AUTOMATION_WORKER_SECRET: "", DOTENV_CONFIG_PATH: "/nonexistent" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.stderr).toContain("AUTOMATION_WORKER_SECRET is not set");
    expect(result.status).toBe(1);
  }, 70_000);
});
