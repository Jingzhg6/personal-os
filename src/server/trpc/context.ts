import "server-only";

import { getDb } from "@/shared/db/client";
import type { TrpcContext } from "@/shared/trpc/init";

import { getAuth } from "../auth";
import { getEventBus } from "../event-bus";

export async function createTrpcContext(opts: {
  headers: Headers;
  resHeaders: Headers | null;
}): Promise<TrpcContext> {
  const session = await getAuth().api.getSession({ headers: opts.headers });
  return {
    db: getDb(),
    bus: getEventBus(),
    userId: session?.user.id ?? null,
    resHeaders: opts.resHeaders,
  };
}
