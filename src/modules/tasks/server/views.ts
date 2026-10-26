import { and, eq } from "drizzle-orm";

import { listAreas } from "@/modules/areas/server";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { taskViews } from "../db";
import { defaultViewAreas, type ScopedViewKey, type TaskViewScope } from "../domain";

/** The areas a navigation view shows: the user's choice, or the matching seeded area. */
export async function getTaskViewScope(
  db: DbExecutor,
  userId: string,
  key: ScopedViewKey,
): Promise<TaskViewScope> {
  const [areas, [row]] = await Promise.all([
    listAreas(db, userId),
    db
      .select()
      .from(taskViews)
      .where(and(eq(taskViews.userId, userId), eq(taskViews.viewKey, key))),
  ]);
  if (row) {
    const existing = new Set(areas.map((area) => area.id));
    // Areas deleted since the scope was saved simply drop out.
    return { key, areaIds: row.areaIds.filter((id) => existing.has(id)), customized: true };
  }
  const defaults = new Set<string>(defaultViewAreas[key]);
  return {
    key,
    areaIds: areas
      .filter((area) => area.systemKey && defaults.has(area.systemKey))
      .map((a) => a.id),
    customized: false,
  };
}

export async function updateTaskViewScope(
  db: DbExecutor,
  userId: string,
  input: { key: ScopedViewKey; areaIds: string[] },
): Promise<TaskViewScope> {
  const owned = new Set((await listAreas(db, userId)).map((area) => area.id));
  const areaIds = [...new Set(input.areaIds)];
  if (areaIds.some((id) => !owned.has(id))) throw new DomainError("not_found", "area.not_found");
  await db
    .insert(taskViews)
    .values({ userId, viewKey: input.key, areaIds })
    .onConflictDoUpdate({ target: [taskViews.userId, taskViews.viewKey], set: { areaIds } });
  return { key: input.key, areaIds, customized: true };
}
