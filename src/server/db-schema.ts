/*
 * Every table in the system, aggregated for drizzle-kit (migrations) and Better Auth.
 * Each module owns its tables in `src/modules/<module>/db`; register them here.
 *
 * Relative imports on purpose: drizzle-kit loads this file outside the Next.js resolver.
 */
export * from "../shared/auth/schema";
export * from "../modules/settings/db";
