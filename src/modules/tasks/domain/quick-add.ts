/**
 * Quick Add syntax, language-neutral and IME-friendly (full-width variants accepted):
 *
 *   #标签   tag (existing tag by name, otherwise created)
 *   @领域   area (matched against the area's displayed name)
 *   !1–!4  priority (low … highest)
 *
 * Unrecognised tokens stay in the title.
 */
export interface QuickAddContext {
  areas: { id: string; label: string }[];
  tags: { id: string; name: string }[];
}

export interface QuickAddResult {
  title: string;
  priority: number | null;
  areaId: string | null;
  tagIds: string[];
  /** Tag names that do not exist yet. */
  newTagNames: string[];
}

const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase();

export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddResult {
  const result: QuickAddResult = {
    title: "",
    priority: null,
    areaId: null,
    tagIds: [],
    newTagNames: [],
  };
  const words: string[] = [];

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const normalised = token.normalize("NFKC"); // ＃ → #, ＠ → @, ！ → !
    const marker = normalised[0];
    const value = normalised.slice(1);

    if (marker === "#" && value) {
      const tag = context.tags.find((t) => fold(t.name) === fold(value));
      if (tag) {
        if (!result.tagIds.includes(tag.id)) result.tagIds.push(tag.id);
      } else if (!result.newTagNames.some((name) => fold(name) === fold(value))) {
        result.newTagNames.push(value);
      }
      continue;
    }

    if (marker === "@" && value) {
      const area = context.areas.find((a) => fold(a.label) === fold(value));
      if (area) {
        result.areaId = area.id;
        continue;
      }
    }

    if (marker === "!" && /^[1-4]$/.test(value)) {
      result.priority = Number(value);
      continue;
    }

    words.push(token);
  }

  result.title = words.join(" ");
  return result;
}
