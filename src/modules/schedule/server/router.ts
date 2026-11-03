import { protectedProcedure, router } from "@/shared/trpc/init";

import { blockIdInput, createBlockInput, listBlocksInput, updateBlockInput } from "../domain";
import { createBlock, deleteBlock, listBlocks, updateBlock } from "./blocks";

/** Schedule Planner (V2). Every procedure is scoped to the signed-in user. */
export const scheduleRouter = router({
  list: protectedProcedure
    .input(listBlocksInput)
    .query(({ ctx, input }) => listBlocks(ctx.db, ctx.userId, input)),
  create: protectedProcedure
    .input(createBlockInput)
    .mutation(({ ctx, input }) => createBlock(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateBlockInput)
    .mutation(({ ctx, input }) => updateBlock(ctx.db, ctx.userId, input)),
  delete: protectedProcedure
    .input(blockIdInput)
    .mutation(({ ctx, input }) => deleteBlock(ctx.db, ctx.userId, input.id)),
});
