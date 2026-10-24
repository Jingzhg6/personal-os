import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { tags } from "../db";
import type { CreateTagInput, Tag, UpdateTagInput } from "../domain";

function toTag(row: typeof tags.$inferSelect): Tag {
  return { id: row.id, name: row.name, color: row.color as Tag["color"] };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause ?? error;
  return (cause as { code?: string })?.code === "23505";
}

export async function listTags(db: DbExecutor, userId: string): Promise<Tag[]> {
  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(sql`lower(${tags.name})`));
  return rows.map(toTag);
}

export async function createTag(
  db: DbExecutor,
  userId: string,
  input: CreateTagInput,
): Promise<Tag> {
  try {
    const [row] = await db
      .insert(tags)
      .values({ userId, ...input })
      .returning();
    return toTag(row!);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict", "tag.duplicate_name");
    throw error;
  }
}

export async function updateTag(
  db: DbExecutor,
  userId: string,
  input: UpdateTagInput,
): Promise<Tag> {
  const { id, ...patch } = input;
  try {
    const [row] = await db
      .update(tags)
      .set(patch)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning();
    if (!row) throw new DomainError("not_found", "tag.not_found");
    return toTag(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict", "tag.duplicate_name");
    throw error;
  }
}

/** Deleting a tag removes it from all tasks (FK cascade on task_tags). */
export async function deleteTag(db: DbExecutor, userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning({ id: tags.id });
  if (deleted.length === 0) throw new DomainError("not_found", "tag.not_found");
}

/** Throws unless every tag id belongs to the user. */
export async function assertTagsOwned(
  db: DbExecutor,
  userId: string,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const unique = [...new Set(tagIds)];
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, unique)));
  if (rows.length !== unique.length) throw new DomainError("not_found", "tag.not_found");
}
