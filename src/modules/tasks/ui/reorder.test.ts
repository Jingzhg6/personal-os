import { describe, expect, it } from "vitest";

import type { Task } from "../domain";
import { __test } from "./use-task-data";

const list = (...ids: string[]) => ids.map((id) => ({ id }) as Task);
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("optimistic reorder", () => {
  it("places the task after its new predecessor", () => {
    expect(ids(__test.reorder(list("a", "b", "c", "d"), "d", "a", "b"))).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("moves to the top when only a successor is given, and to the end with no neighbours", () => {
    expect(ids(__test.reorder(list("a", "b", "c"), "c", null, "a"))).toEqual(["c", "a", "b"]);
    expect(ids(__test.reorder(list("a", "b", "c"), "a", null, null))).toEqual(["b", "c", "a"]);
  });

  it("leaves lists that do not contain the task untouched", () => {
    const tasks = list("a", "b");
    expect(__test.reorder(tasks, "x", "a", null)).toBe(tasks);
  });
});
