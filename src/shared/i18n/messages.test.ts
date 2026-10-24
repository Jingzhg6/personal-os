import { readFileSync } from "node:fs";
import path from "node:path";

import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";

import { defaultLocale, locales, namespaces } from "./config";
import { loadMessages, mergeMessages, sourceMessages } from "./messages";

type Tree = { [key: string]: string | Tree };

function readCatalogue(locale: string): Tree {
  return Object.fromEntries(
    namespaces.map((ns) => [
      ns,
      JSON.parse(readFileSync(path.join("messages", locale, `${ns}.json`), "utf8")) as Tree,
    ]),
  );
}

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(fullKey, value);
    else for (const [k, v] of flatten(value, fullKey)) result.set(k, v);
  }
  return result;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([a-zA-Z0-9_]+)/g)].map((match) => match[1]!).sort();
}

const source = flatten(readCatalogue(defaultLocale));

describe("translation catalogues", () => {
  it.each(locales)("%s: every message is valid ICU syntax", (locale) => {
    for (const [key, message] of flatten(readCatalogue(locale))) {
      expect(() => new IntlMessageFormat(message, locale), `${locale}:${key}`).not.toThrow();
    }
  });

  it.each(locales.filter((l) => l !== defaultLocale))(
    "%s: has no keys that are missing from zh-CN, and keeps the same placeholders",
    (locale) => {
      for (const [key, message] of flatten(readCatalogue(locale))) {
        expect(source.has(key), `${locale} has unknown key "${key}"`).toBe(true);
        expect(placeholders(message), `${locale}:${key}`).toEqual(placeholders(source.get(key)!));
      }
    },
  );
});

describe("loadMessages", () => {
  it("returns the zh-CN source catalogue for the default locale", async () => {
    expect(await loadMessages("zh-CN")).toBe(sourceMessages);
  });

  it("loads a translated locale", async () => {
    const messages = await loadMessages("en");
    expect(messages.nav.items.dashboard).toBe("Dashboard");
  });
});

describe("mergeMessages", () => {
  it("falls back to the source for missing keys and ignores unknown keys", () => {
    const base = { a: "甲", nested: { b: "乙", c: "丙" } };
    const merged = mergeMessages(base, { nested: { b: "B" }, extra: "x" });
    expect(merged).toEqual({ a: "甲", nested: { b: "B", c: "丙" } });
  });
});
