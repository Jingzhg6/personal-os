import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/*
 * Ordering with fractional indexing: each row stores a string key; moving or inserting an
 * item only rewrites that item's key. Keys compare byte-wise (see `sortKey()` column).
 */

export function keysForNewItems(count: number, after: string | null = null): string[] {
  return generateNKeysBetween(after, null, count);
}

/** Key for a new item placed after the current last item. */
export function keyAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

export type MoveDirection = "up" | "down";

/**
 * New key for the item at `index` moved one step up or down within `keys` (sorted).
 * Returns null when the item is already at that edge.
 */
export function keyForMove(
  keys: readonly string[],
  index: number,
  direction: MoveDirection,
): string | null {
  if (index < 0 || index >= keys.length) throw new RangeError("index out of range");
  if (direction === "up") {
    if (index === 0) return null;
    return generateKeyBetween(keys[index - 2] ?? null, keys[index - 1]!);
  }
  if (index === keys.length - 1) return null;
  return generateKeyBetween(keys[index + 1]!, keys[index + 2] ?? null);
}

/** Key strictly between two neighbours (either may be null at the list edges). */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}
