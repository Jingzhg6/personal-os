/**
 * Translation coverage report.
 *
 * - Fails if a non-source locale contains keys that do not exist in zh-CN (stale or typo).
 * - Reports (without failing) keys still missing from en / fr; they fall back to zh-CN at runtime.
 *
 * Usage: pnpm i18n:check            (summary per namespace)
 *        pnpm i18n:check --verbose  (lists every missing key)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { defaultLocale, locales, namespaces } from "../src/shared/i18n/config";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [fullKey] : flatten(value, fullKey);
  });
}

function keysOf(locale: string): Set<string> {
  return new Set(
    namespaces.flatMap((ns) => {
      const file = path.join("messages", locale, `${ns}.json`);
      try {
        return flatten(JSON.parse(readFileSync(file, "utf8")) as Tree, ns);
      } catch {
        return [];
      }
    }),
  );
}

const verbose = process.argv.includes("--verbose");
const source = keysOf(defaultLocale);
let failed = false;

console.log(`${defaultLocale}: ${source.size} keys (source)`);

for (const locale of locales.filter((l) => l !== defaultLocale)) {
  const keys = keysOf(locale);
  const unknown = [...keys].filter((key) => !source.has(key));
  const missing = [...source].filter((key) => !keys.has(key));
  const coverage = Math.round(((source.size - missing.length) / source.size) * 100);

  console.log(
    `${locale}: ${coverage}% translated, ${missing.length} missing, ${unknown.length} unknown`,
  );
  if (verbose) {
    for (const key of missing) console.log(`  missing  ${key}`);
  } else if (missing.length > 0) {
    const byNamespace = Map.groupBy(missing, (key) => key.split(".")[0]!);
    const summary = [...byNamespace].map(([ns, keys]) => `${ns} ${keys.length}`).join(", ");
    console.log(`  missing by namespace: ${summary}`);
  }
  for (const key of unknown) console.log(`  UNKNOWN  ${key}`);
  if (unknown.length > 0) failed = true;
}

if (failed) {
  console.error("\nUnknown keys found: every key must exist in the zh-CN source catalogue first.");
  process.exit(1);
}
