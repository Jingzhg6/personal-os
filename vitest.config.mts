import path from "node:path";

import react from "@vitejs/plugin-react";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside the React Server Components bundler; it is a no-op in tests.
  "server-only": path.resolve(import.meta.dirname, "src/test/empty-module.ts"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["src/test/global-setup-db.ts"],
          // Tests share one database and truncate it between tests.
          fileParallelism: false,
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
            BETTER_AUTH_URL: "http://localhost:3000",
          },
        },
      },
    ],
  },
});
