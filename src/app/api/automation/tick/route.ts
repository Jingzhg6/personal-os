import { timingSafeEqual } from "node:crypto";

import { workerTick } from "@/modules/automation/server";
import { getEventBus } from "@/server/event-bus";
import { getEnv } from "@/shared/config/env";
import { getDb } from "@/shared/db/client";

/**
 * The automation worker endpoint (ADR 0020). An external scheduler (cron, systemd timer, or
 * `pnpm automation:worker`) calls it every minute with `Authorization: Bearer <secret>`. Without
 * AUTOMATION_WORKER_SECRET it is disabled and schedules do not run automatically.
 */
export async function POST(request: Request) {
  const secret = getEnv().AUTOMATION_WORKER_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await workerTick({ db: getDb(), bus: getEventBus() });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    // No heartbeat is written: the health view then reports the scheduler as not running.
    console.error("automation.tick failed", (error as Error).name);
    return Response.json({ error: "tick_failed" }, { status: 500 });
  }
}
