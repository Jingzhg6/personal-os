import { protectedProcedure, router } from "@/shared/trpc/init";

import { setAttributeAreaInput, xpHistoryInput } from "../domain";
import { listAttributes, setAttributeArea } from "./attributes";
import { getOverview, listHistory } from "./repository";

export const characterRouter = router({
  overview: protectedProcedure.query(({ ctx }) => getOverview(ctx.db, ctx.userId)),
  history: protectedProcedure
    .input(xpHistoryInput)
    .query(({ ctx, input }) => listHistory(ctx.db, ctx.userId, input)),
  attributes: router({
    list: protectedProcedure.query(({ ctx }) => listAttributes(ctx.db, ctx.userId)),
    setArea: protectedProcedure
      .input(setAttributeAreaInput)
      .mutation(({ ctx, input }) => setAttributeArea(ctx.db, ctx.userId, input)),
  }),
});
