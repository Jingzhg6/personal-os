import { protectedProcedure, router } from "@/shared/trpc/init";

import { dashboardGrowthInput } from "../domain";
import { getDashboard, getDashboardGrowth } from "./read-model";

/** Read-only: the dashboard has queries and no mutations. */
export const dashboardRouter = router({
  overview: protectedProcedure.query(({ ctx }) => getDashboard(ctx.db, ctx.userId)),
  growth: protectedProcedure
    .input(dashboardGrowthInput)
    .query(({ ctx, input }) => getDashboardGrowth(ctx.db, ctx.userId, input.period)),
});
