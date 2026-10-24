import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";

import type { Database } from "../db/types";
import type { EventBus } from "../events/bus";
import { DomainError, type DomainErrorKind } from "../lib/errors";

export interface TrpcContext {
  db: Database;
  bus: EventBus;
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
        domainCode: error.cause instanceof DomainError ? error.cause.code : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const domainErrorCodes: Record<DomainErrorKind, TRPCError["code"]> = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid: "BAD_REQUEST",
};

/** Turns DomainErrors thrown by services into typed tRPC errors (code + domainCode). */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const cause = result.error.cause;
    throw new TRPCError({ code: domainErrorCodes[cause.kind], message: cause.code, cause });
  }
  return result;
});

export const publicProcedure = t.procedure.use(domainErrors);

/**
 * Requires a signed-in user. Every query inside must be scoped by `ctx.userId`;
 * this is the authorization boundary for all user-owned data.
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
