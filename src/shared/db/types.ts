import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";

type EmptySchema = Record<string, never>;

export type Database = NodePgDatabase<EmptySchema>;

export type Transaction = PgTransaction<
  NodePgQueryResultHKT,
  EmptySchema,
  ExtractTablesWithRelations<EmptySchema>
>;

/**
 * Anything that can run a query: the root connection or an open transaction.
 * Repositories and event handlers accept this so they can join a caller's transaction.
 */
export type DbExecutor = Database | Transaction;
