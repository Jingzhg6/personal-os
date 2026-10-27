/*
 * Minimal automation worker (ADR 0020): calls the app's tick endpoint every minute. Run it next
 * to the app (`pnpm automation:worker`), or call the endpoint from cron / a systemd timer instead.
 *
 *   APP_URL=http://localhost:3000 AUTOMATION_WORKER_SECRET=… pnpm automation:worker
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/automation/tick`;
const secret = process.env.AUTOMATION_WORKER_SECRET;
const intervalMs = Number(process.env.AUTOMATION_TICK_MS ?? 60_000);

if (!secret) {
  console.error("AUTOMATION_WORKER_SECRET is not set; the worker cannot authenticate.");
  process.exit(1);
}

async function tick() {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await response.json();
    console.log(new Date().toISOString(), response.status, JSON.stringify(body));
  } catch (error) {
    console.error(new Date().toISOString(), "tick failed:", (error as Error).message);
  }
}

// No top-level await: tsx runs this file as CommonJS (M10.1 fix).
void tick();
setInterval(tick, intervalMs);
