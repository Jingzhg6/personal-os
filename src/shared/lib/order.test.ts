import { describe, expect, it } from "vitest";

import { keyAfter, keyForMove, keysForNewItems } from "./order";

const sortBytewise = (keys: string[]) => [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe("fractional ordering", () => {
  it("generates increasing keys", () => {
    const keys = keysForNewItems(5);
    expect(sortBytewise(keys)).toEqual(keys);
    expect(keyAfter(keys[4]!) > keys[4]!).toBe(true);
    expect(keyAfter(null)).toBeTypeOf("string");
  });

  it("moves an item up and down one position", () => {
    const keys = keysForNewItems(4); // a b c d
    const upKey = keyForMove(keys, 2, "up")!; // c before b
    expect(upKey > keys[0]! && upKey < keys[1]!).toBe(true);
    const downKey = keyForMove(keys, 1, "down")!; // b after c
    expect(downKey > keys[2]! && downKey < keys[3]!).toBe(true);
    const lastDown = keyForMove(keys, 2, "down")!; // c after d
    expect(lastDown > keys[3]!).toBe(true);
  });

  it("returns null at the edges", () => {
    const keys = keysForNewItems(2);
    expect(keyForMove(keys, 0, "up")).toBeNull();
    expect(keyForMove(keys, 1, "down")).toBeNull();
  });
});
