import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";

import type { Database } from "../db/types";

export interface TrpcContext {
  db: Database;
  /** Authenticated user, or null for anonymous requests. */
  userId: string | null;
  /** Response headers, so procedures can set cookies. Null for server-side callers. */
  resHeaders: Headers | null;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? z.flattenError(error.cause) : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

/**
 * Requires a signed-in user. Every query inside must be scoped by `ctx.userId`;
 * this is the authorization boundary for all user-owned data.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
