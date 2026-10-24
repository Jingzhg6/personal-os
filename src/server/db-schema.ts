/*
 * Every table in the system, aggregated for drizzle-kit (migrations) and Better Auth.
 * Each module owns its tables in `src/modules/<module>/db`; register them here.
 */
export * from "@/shared/auth/schema";
export * from "@/modules/settings/db";
export * from "@/modules/areas/db";
export * from "@/modules/tasks/db";
