import "server-only";

import { drainEvents } from "@/modules/automation/server";
import { getDb } from "@/shared/db/client";
import type { TrpcContext } from "@/shared/trpc/init";

import { getAuth } from "../auth";
import { getEventBus } from "../event-bus";

export async function createTrpcContext(opts: {
  headers: Headers;
  resHeaders: Headers | null;
}): Promise<TrpcContext> {
  const session = await getAuth().api.getSession({ headers: opts.headers });
  const db = getDb();
  const bus = getEventBus();
  return {
    db,
    bus,
    userId: session?.user.id ?? null,
    resHeaders: opts.resHeaders,
    afterMutation: async (userId) => {
      await drainEvents({ db, bus }, { userId });
    },
  };
}
