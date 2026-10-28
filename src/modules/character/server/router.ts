import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  attributeIdInput,
  createAttributeInput,
  disciplineHistoryInput,
  taskDisciplineInput,
  moveAttributeInput,
  updateAttributeInput,
  xpHistoryInput,
} from "../domain";
import {
  createAttribute,
  deleteAttribute,
  listAttributes,
  moveAttribute,
  updateAttribute,
} from "./attributes";
import { getDisciplineSummary, getTaskDiscipline } from "./discipline";
import { getOverview, listHistory } from "./repository";

export const characterRouter = router({
  overview: protectedProcedure.query(({ ctx }) => getOverview(ctx.db, ctx.userId)),
  history: protectedProcedure
    .input(xpHistoryInput)
    .query(({ ctx, input }) => listHistory(ctx.db, ctx.userId, input)),
  attributes: router({
    /** Every development attribute, archived included, with its XP. */
    list: protectedProcedure.query(({ ctx }) => listAttributes(ctx.db, ctx.userId)),
    create: protectedProcedure
      .input(createAttributeInput)
      .mutation(({ ctx, input }) => createAttribute(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateAttributeInput)
      .mutation(({ ctx, input }) => updateAttribute(ctx.db, ctx.userId, input)),
    move: protectedProcedure
      .input(moveAttributeInput)
      .mutation(({ ctx, input }) => moveAttribute(ctx.db, ctx.userId, input.id, input.direction)),
    delete: protectedProcedure
      .input(attributeIdInput)
      .mutation(({ ctx, input }) => deleteAttribute(ctx.db, ctx.userId, input.id)),
  }),
  /** 自制力 (M10.5): read-only. Scores are only ever written by the fixed rules. */
  discipline: router({
    summary: protectedProcedure
      .input(disciplineHistoryInput)
      .query(({ ctx, input }) => getDisciplineSummary(ctx.db, ctx.userId, input.limit)),
    forTask: protectedProcedure
      .input(taskDisciplineInput)
      .query(({ ctx, input }) => getTaskDiscipline(ctx.db, ctx.userId, input.taskId)),
  }),
});
