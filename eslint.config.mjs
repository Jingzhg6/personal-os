import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

/*
 * Architectural boundaries (see docs/architecture.md, "Module boundaries").
 *
 *   app    → may import anything below it
 *   shell  → shared, modules' public entry points (domain, ui)
 *   server → shared, modules' public entry points (composition root)
 *   modules/<m> → shared, other modules' public entry points only
 *   shared → nothing above it (type-only imports of the API router are allowed)
 *
 * A module's public entry points are `@/modules/<m>/{domain,server,ui,db}`.
 * Everything else inside a module is private to it.
 */

const restrict = (...patterns) => ["error", { patterns }];

const MODULE_INTERNALS = {
  regex: "^@/modules/[^/]+/(?!(domain|server|ui|db)$).+",
  message:
    "Import a module only through its public entry points: @/modules/<m>/{domain,server,ui,db}.",
};
const forbid = (group, message) => ({ group, message });

const noApp = forbid(["@/app/*"], "Only Next.js routing may live in src/app; nothing imports it.");
const noShell = forbid(
  ["@/shell/*"],
  "The shell composes modules; modules and shared code must not import it.",
);
const noServer = forbid(["@/server/*"], "The server composition root must not be imported here.");
const noServerTypesOk = { ...noServer, allowTypeImports: true };
const noModules = forbid(
  ["@/modules/*", "@/modules/**"],
  "Shared code must not depend on modules.",
);
const noModuleServer = forbid(
  ["@/modules/*/server", "@/modules/*/db"],
  "UI code must not import server-side module code.",
);
const noCrossModuleRelative = {
  regex: "^\\.\\./\\.\\./[^.]",
  message: "Do not reach into another module with relative paths; use its public entry point.",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "drizzle/**",
  ]),

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },

  // --- Module boundaries --------------------------------------------------
  {
    files: ["src/shared/**"],
    rules: { "no-restricted-imports": restrict(noApp, noShell, noServerTypesOk, noModules) },
  },
  {
    files: ["src/modules/**"],
    rules: {
      "no-restricted-imports": restrict(
        noApp,
        noShell,
        noServer,
        MODULE_INTERNALS,
        noCrossModuleRelative,
      ),
    },
  },
  {
    files: ["src/modules/*/domain/**"],
    rules: {
      "no-restricted-imports": restrict(
        noApp,
        noShell,
        noServer,
        MODULE_INTERNALS,
        noCrossModuleRelative,
        forbid(
          ["../server", "../server/*", "../db", "../db/*", "../ui", "../ui/*"],
          "The domain layer is pure: no server, db or UI imports.",
        ),
        forbid(
          ["@/shared/db/*", "@/shared/trpc/*", "react", "next", "next/*"],
          "The domain layer is pure: no framework or database imports.",
        ),
      ),
    },
  },
  {
    files: ["src/modules/*/ui/**"],
    rules: {
      "no-restricted-imports": restrict(
        noApp,
        noShell,
        noServer,
        MODULE_INTERNALS,
        noCrossModuleRelative,
        noModuleServer,
        forbid(
          ["../server", "../server/*", "../db", "../db/*"],
          "UI code must not import server-side module code.",
        ),
      ),
    },
  },
  {
    files: ["src/shell/**"],
    rules: {
      "no-restricted-imports": restrict(noApp, noServerTypesOk, MODULE_INTERNALS, noModuleServer),
    },
  },
  {
    files: ["src/server/**"],
    rules: { "no-restricted-imports": restrict(noApp, noShell, MODULE_INTERNALS) },
  },
  {
    files: ["src/app/**"],
    rules: { "no-restricted-imports": restrict(MODULE_INTERNALS) },
  },

  // --- i18n: no hard-coded UI text -----------------------------------------
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            include: ["^(aria-label|aria-description|title|placeholder|alt|label)$"],
          },
        },
      ],
    },
  },
]);
