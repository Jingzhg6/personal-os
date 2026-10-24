import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getEnv } from "../config/env";
import type { Database } from "./types";

const globalForDb = globalThis as unknown as { __personalOsPool?: Pool };

function getPool(): Pool {
  // Reuse the pool across hot reloads in development.
  globalForDb.__personalOsPool ??= new Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
  return globalForDb.__personalOsPool;
}

let instance: Database | undefined;

export function getDb(): Database {
  instance ??= drizzle({ client: getPool() });
  return instance;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__personalOsPool?.end();
  globalForDb.__personalOsPool = undefined;
  instance = undefined;
}
