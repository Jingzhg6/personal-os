import { settingsRouter } from "@/modules/settings/server";
import { router } from "@/shared/trpc/init";

/** The application API. Each module contributes one sub-router. */
export const appRouter = router({
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
