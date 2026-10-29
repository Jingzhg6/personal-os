import { sql } from "drizzle-orm";

import { getDb } from "@/shared/db/client";

/**
 * Liveness and readiness for container health checks (Docker Compose, ADR 0026): the server
 * answers and the database accepts a query. Public, cheap, and it reveals nothing about users.
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("health check failed", (error as Error).name);
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
