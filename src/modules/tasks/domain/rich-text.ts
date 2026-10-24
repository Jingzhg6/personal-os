import { z } from "zod";

/** Upper bound for a stored rich-text document (serialised JSON). */
export const MAX_RICH_TEXT_BYTES = 100_000;

/**
 * A Tiptap / ProseMirror JSON document. Stored as jsonb and rendered only through the
 * editor schema (never as raw HTML), so unknown node types are dropped instead of executed.
 */
export interface RichTextDoc {
  type: "doc";
  content?: unknown[];
  [key: string]: unknown;
}

export const richTextDoc = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .loose()
  .refine((doc) => JSON.stringify(doc).length <= MAX_RICH_TEXT_BYTES, {
    message: "Description is too long",
  });

/** True when the document has no visible text (e.g. an empty paragraph). */
export function isRichTextEmpty(doc: RichTextDoc | null | undefined): boolean {
  if (!doc?.content?.length) return true;
  const hasText = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const record = node as { type?: string; text?: string; content?: unknown[] };
    if (record.type === "text" && record.text?.trim()) return true;
    if (record.type && !["paragraph", "text", "hardBreak"].includes(record.type)) return true;
    return (record.content ?? []).some(hasText);
  };
  return !doc.content.some(hasText);
}
