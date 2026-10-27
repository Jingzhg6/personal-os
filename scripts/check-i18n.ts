/**
 * Catalogue check for the zh-CN-only UI: every namespace file exists and parses, and no message
 * is empty. (Unused / missing keys are caught by TypeScript through next-intl's typed messages.)
 *
 * Usage: pnpm i18n:check
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { defaultLocale, namespaces } from "../src/shared/i18n/config";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? [[fullKey, value] as [string, string]]
      : flatten(value, fullKey);
  });
}

let failed = false;
let total = 0;
for (const ns of namespaces) {
  const file = path.join("messages", defaultLocale, `${ns}.json`);
  const entries = flatten(JSON.parse(readFileSync(file, "utf8")) as Tree, ns);
  total += entries.length;
  for (const [key, value] of entries) {
    if (!value.trim()) {
      console.log(`EMPTY  ${key}`);
      failed = true;
    }
  }
}
console.log(`${defaultLocale}: ${total} keys in ${namespaces.length} namespaces`);
if (failed) process.exit(1);
