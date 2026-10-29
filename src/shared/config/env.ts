import "server-only";

import { z } from "zod";

/** The example files' placeholders start with this; running with one would be insecure. */
const notPlaceholder = (name: string) =>
  z.string().refine((value) => !value.startsWith("change-me"), {
    message: `${name} still has the example value; generate one with: openssl rand -hex 32`,
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: notPlaceholder("BETTER_AUTH_SECRET").pipe(
    z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  ),
  BETTER_AUTH_URL: z.url(),
  AUTH_ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /**
   * Shared secret of the automation worker (M10). When unset, the tick endpoint is disabled and
   * scheduled rules are not run automatically (the UI says so).
   */
  AUTOMATION_WORKER_SECRET: z.preprocess(
    // Docker Compose passes an unset variable as "": treat it as not configured.
    (value) => (value === "" ? undefined : value),
    notPlaceholder("AUTOMATION_WORKER_SECRET").pipe(z.string().min(32)).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated server environment. Parsed lazily so that importing a module
 * never fails at build time; the first real access throws a readable error.
 */
export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    }
    cached = result.data;
  }
  return cached;
}
