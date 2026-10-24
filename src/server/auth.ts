import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { accounts, sessions, users, verifications } from "@/shared/auth/schema";
import { getEnv } from "@/shared/config/env";
import { getDb } from "@/shared/db/client";
import type { Database } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { newId } from "@/shared/lib/id";

import { getEventBus } from "./event-bus";

interface AuthDependencies {
  db: Database;
  bus: EventBus;
  secret: string;
  baseURL: string;
  allowSignUp: boolean;
}

export function createAuth({ db, bus, secret, baseURL, allowSignUp }: AuthDependencies) {
  return betterAuth({
    secret,
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      autoSignIn: true,
      disableSignUp: !allowSignUp,
    },
    advanced: {
      database: { generateId: () => newId() },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await bus.publish(
              {
                type: "user.registered",
                userId: user.id,
                payload: { email: user.email, name: user.name },
              },
              { db },
            );
          },
        },
      },
    },
    // Must be last: lets server actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

export function getAuth(): Auth {
  if (!instance) {
    const env = getEnv();
    instance = createAuth({
      db: getDb(),
      bus: getEventBus(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      allowSignUp: env.AUTH_ALLOW_SIGNUP,
    });
  }
  return instance;
}
