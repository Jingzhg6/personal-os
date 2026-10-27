import { areasRouter } from "@/modules/areas/server";
import { characterRouter } from "@/modules/character/server";
import { projectsRouter } from "@/modules/projects/server";
import { rewardsRouter } from "@/modules/rewards/server";
import { settingsRouter } from "@/modules/settings/server";
import { tasksRouter } from "@/modules/tasks/server";
import { router } from "@/shared/trpc/init";

/** The application API. Each module contributes one sub-router. */
export const appRouter = router({
  settings: settingsRouter,
  areas: areasRouter,
  tasks: tasksRouter,
  projects: projectsRouter,
  character: characterRouter,
  rewards: rewardsRouter,
});

export type AppRouter = typeof appRouter;
