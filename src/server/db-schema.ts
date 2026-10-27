/*
 * Every table in the system, aggregated for drizzle-kit (migrations) and Better Auth.
 * Each module owns its tables in `src/modules/<module>/db`; register them here.
 */
export * from "@/shared/auth/schema";
export * from "@/modules/settings/db";
export * from "@/modules/areas/db";
export * from "@/modules/projects/db";
export * from "@/modules/tasks/db";
export * from "@/modules/character/db";
export * from "@/modules/rewards/db";
export * from "@/modules/development/db";
