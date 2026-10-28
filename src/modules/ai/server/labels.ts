import "server-only";

import { sourceMessages } from "@/shared/i18n/messages";

/*
 * Display names of seeded entities (whose `name` is null and whose label lives in the zh-CN
 * catalogue), so a provider sees the same words the user sees.
 */

function lookup(tree: unknown, path: string): string | null {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

export function attributeName(a: { name: string | null; systemKey: string | null }): string {
  if (a.name) return a.name;
  if (!a.systemKey) return "";
  return lookup(sourceMessages.character.attributes.keys, a.systemKey) ?? a.systemKey;
}

export function areaName(a: { name: string | null; systemKey: string | null }): string {
  if (a.name) return a.name;
  if (!a.systemKey) return "";
  return lookup(sourceMessages.areas.defaults, a.systemKey) ?? a.systemKey;
}

export function statusName(s: { name: string | null; systemKey: string | null }): string {
  if (s.name) return s.name;
  if (!s.systemKey) return "";
  return lookup(sourceMessages.tasks.status, s.systemKey) ?? s.systemKey;
}
