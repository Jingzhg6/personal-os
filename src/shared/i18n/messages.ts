import areas from "../../../messages/zh-CN/areas.json";
import auth from "../../../messages/zh-CN/auth.json";
import common from "../../../messages/zh-CN/common.json";
import editor from "../../../messages/zh-CN/editor.json";
import errors from "../../../messages/zh-CN/errors.json";
import nav from "../../../messages/zh-CN/nav.json";
import settings from "../../../messages/zh-CN/settings.json";
import shell from "../../../messages/zh-CN/shell.json";
import tasks from "../../../messages/zh-CN/tasks.json";
import { defaultLocale, namespaces, type Locale } from "./config";

/** zh-CN messages: the source of truth and the shape every locale must follow. */
export const sourceMessages = { common, nav, shell, auth, settings, errors, editor, areas, tasks };

export type Messages = typeof sourceMessages;

type MessageTree = { [key: string]: string | MessageTree };

/**
 * Deep-merges `override` onto `base`. Used so that a missing key in an
 * unfinished translation falls back to zh-CN instead of breaking the UI.
 */
export function mergeMessages<T extends MessageTree>(base: T, override: MessageTree): T {
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    if (typeof value === "object" && typeof baseValue === "object") {
      result[key] = mergeMessages(baseValue, value);
    } else if (typeof value === "string" && typeof baseValue === "string") {
      result[key] = value;
    }
    // Keys that do not exist in the source locale are ignored.
  }
  return result as T;
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === defaultLocale) return sourceMessages;

  const translated = await Promise.all(
    namespaces.map(
      async (ns) => [ns, (await import(`../../../messages/${locale}/${ns}.json`)).default] as const,
    ),
  );
  return mergeMessages(
    sourceMessages as unknown as MessageTree,
    Object.fromEntries(translated),
  ) as unknown as Messages;
}
