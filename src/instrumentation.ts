/**
 * Runs once when the server starts (Next.js instrumentation). Validates the environment up front,
 * so a missing or placeholder secret stops the server with a readable message in its log
 * (`docker compose logs app`) instead of surfacing later as failing requests.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/shared/config/env");
    getEnv();
  }
}
