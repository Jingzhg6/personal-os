import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createTrpcContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: ({ req, resHeaders }) => createTrpcContext({ headers: req.headers, resHeaders }),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => console.error(`tRPC error on ${path ?? "<no-path>"}:`, error)
        : undefined,
  });
}

export { handler as GET, handler as POST };
