import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against a production build, using the TEST database.
 * Usage: pnpm test:e2e   (builds the app first)
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    // Milestone visual checks (pnpm screenshots): real UI captured into docs/screenshots/.
    // Not part of `pnpm test:e2e`.
    {
      name: "screenshots",
      testMatch: /.*\.shots\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-1234",
      AUTH_ALLOW_SIGNUP: "true",
    },
  },
});
