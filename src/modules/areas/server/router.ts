import { protectedProcedure, router } from "@/shared/trpc/init";

import { areaIdInput, createAreaInput, moveAreaInput, updateAreaInput } from "../domain";
import { createArea, deleteArea, listAreas, moveArea, updateArea } from "./repository";

export const areasRouter = router({
  list: protectedProcedure.query(({ ctx }) => listAreas(ctx.db, ctx.userId)),
  create: protectedProcedure
    .input(createAreaInput)
    .mutation(({ ctx, input }) => createArea(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateAreaInput)
    .mutation(({ ctx, input }) => updateArea(ctx.db, ctx.userId, input)),
  move: protectedProcedure
    .input(moveAreaInput)
    .mutation(({ ctx, input }) => moveArea(ctx.db, ctx.userId, input.id, input.direction)),
  delete: protectedProcedure
    .input(areaIdInput)
    .mutation(({ ctx, input }) => deleteArea(ctx.db, ctx.userId, input.id)),
});
