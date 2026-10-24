import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Database } from "@/shared/db/types";

/** A dedicated connection to the test database (DATABASE_URL is the test DB in the db project). */
export function createTestDb(): { db: Database; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return { db: drizzle({ client: pool }), close: () => pool.end() };
}

/** Empties every application table. Migrations metadata lives in the `drizzle` schema and is kept. */
export async function resetDb(db: Database): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length > 0) {
    await db.execute(sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`));
  }
}
