import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  createGoalInput,
  createGoalTaskInput,
  goalIdInput,
  goalProjectInput,
  goalTaskInput,
  setFocusInput,
  setGoalStatusInput,
  setTaskGoalsInput,
  taskIdInput,
  updateGoalInput,
  updateVisionInput,
} from "../domain";
import {
  createGoal,
  createGoalTask,
  deleteGoal,
  goalsForTask,
  linkProject,
  linkTask,
  listGoals,
  setGoalStatus,
  setTaskGoals,
  unlinkProject,
  unlinkTask,
  updateGoal,
} from "./goals";
import { setFocus, updateVision } from "./profile";
import { getAttributeDetail, getDevelopmentOverview, getGoalDetail } from "./read-model";

export const developmentRouter = router({
  overview: protectedProcedure.query(({ ctx }) => getDevelopmentOverview(ctx.db, ctx.userId)),
  updateVision: protectedProcedure
    .input(updateVisionInput)
    .mutation(({ ctx, input }) => updateVision(ctx.db, ctx.userId, input.vision)),
  setFocus: protectedProcedure
    .input(setFocusInput)
    .mutation(({ ctx, input }) => setFocus(ctx.db, ctx.userId, input.attributeIds)),
  attribute: protectedProcedure
    .input(goalIdInput)
    .query(({ ctx, input }) => getAttributeDetail(ctx.db, ctx.userId, input.id)),
  goals: router({
    /** Non-archived goals (pickers). */
    list: protectedProcedure.query(({ ctx }) =>
      listGoals(ctx.db, ctx.userId, { statuses: ["active", "paused", "completed"] }),
    ),
    detail: protectedProcedure
      .input(goalIdInput)
      .query(({ ctx, input }) => getGoalDetail(ctx.db, ctx.userId, input.id)),
    create: protectedProcedure
      .input(createGoalInput)
      .mutation(({ ctx, input }) => createGoal(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateGoalInput)
      .mutation(({ ctx, input }) => updateGoal(ctx.db, ctx.userId, input)),
    setStatus: protectedProcedure
      .input(setGoalStatusInput)
      .mutation(({ ctx, input }) => setGoalStatus(ctx.db, ctx.userId, input.id, input.status)),
    delete: protectedProcedure
      .input(goalIdInput)
      .mutation(({ ctx, input }) => deleteGoal(ctx.db, ctx.userId, input.id)),
    linkTask: protectedProcedure
      .input(goalTaskInput)
      .mutation(({ ctx, input }) => linkTask(ctx.db, ctx.userId, input.goalId, input.taskId)),
    unlinkTask: protectedProcedure
      .input(goalTaskInput)
      .mutation(({ ctx, input }) => unlinkTask(ctx.db, ctx.userId, input.goalId, input.taskId)),
    createTask: protectedProcedure
      .input(createGoalTaskInput)
      .mutation(({ ctx, input }) => createGoalTask(ctx, ctx.userId, input)),
    linkProject: protectedProcedure
      .input(goalProjectInput)
      .mutation(({ ctx, input }) => linkProject(ctx.db, ctx.userId, input.goalId, input.projectId)),
    unlinkProject: protectedProcedure
      .input(goalProjectInput)
      .mutation(({ ctx, input }) =>
        unlinkProject(ctx.db, ctx.userId, input.goalId, input.projectId),
      ),
    forTask: protectedProcedure
      .input(taskIdInput)
      .query(({ ctx, input }) => goalsForTask(ctx.db, ctx.userId, input.taskId)),
    setForTask: protectedProcedure
      .input(setTaskGoalsInput)
      .mutation(({ ctx, input }) => setTaskGoals(ctx.db, ctx.userId, input.taskId, input.goalIds)),
  }),
});
