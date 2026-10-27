import { readFileSync } from "node:fs";
import path from "node:path";

import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";

import { defaultLocale, locales, namespaces } from "./config";
import { sourceMessages } from "./messages";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(fullKey, value);
    else for (const [k, v] of flatten(value, fullKey)) result.set(k, v);
  }
  return result;
}

describe("zh-CN catalogue", () => {
  it("is the only locale", () => {
    expect(locales).toEqual(["zh-CN"]);
  });

  it.each(namespaces)("%s: every message is non-empty, valid ICU syntax", (ns) => {
    const tree = JSON.parse(
      readFileSync(path.join("messages", defaultLocale, `${ns}.json`), "utf8"),
    ) as Tree;
    for (const [key, message] of flatten(tree)) {
      expect(message.trim(), `${ns}.${key}`).not.toBe("");
      expect(() => new IntlMessageFormat(message, defaultLocale), `${ns}.${key}`).not.toThrow();
    }
    expect(sourceMessages[ns]).toEqual(tree);
  });
});
