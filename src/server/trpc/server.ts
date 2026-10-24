import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { createCallerFactory } from "@/shared/trpc/init";

import { createTrpcContext } from "./context";
import { appRouter } from "./root";

const createCaller = createCallerFactory(appRouter);

/** tRPC caller for Server Components: same procedures, no HTTP round trip. */
export const getServerApi = cache(async () =>
  createCaller(await createTrpcContext({ headers: await headers(), resHeaders: null })),
);
