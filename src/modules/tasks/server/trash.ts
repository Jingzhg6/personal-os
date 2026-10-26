import { sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";

import type { TrashedTask } from "../domain";

/**
 * The Trash lists the root of each deletion: deleted tasks whose parent was not deleted in the
 * same operation (deletions of a subtree share one `deleted_at`).
 */
export async function listTrash(db: DbExecutor, userId: string): Promise<TrashedTask[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    parent_title: string | null;
    deleted_at: string | Date;
    batch_size: number;
  }>(sql`
    select t.id, t.title, p.title as parent_title, t.deleted_at,
      (select count(*)::int from tasks x where x.user_id = t.user_id and x.deleted_at = t.deleted_at) as batch_size
    from tasks t
    left join tasks p on p.id = t.parent_task_id
    where t.user_id = ${userId}
      and t.deleted_at is not null
      and (p.id is null or p.deleted_at is distinct from t.deleted_at)
    order by t.deleted_at desc, t.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    parentTitle: row.parent_title,
    deletedAt: new Date(row.deleted_at),
    subtaskCount: Math.max(0, row.batch_size - 1),
  }));
}
