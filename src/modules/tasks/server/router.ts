import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  createStatusInput,
  createTagInput,
  createTaskInput,
  deleteStatusInput,
  moveStatusInput,
  setTaskStatusInput,
  taskIdInput,
  updateStatusInput,
  updateTagInput,
  updateTaskInput,
} from "../domain";
import { getTaskDetail, listTopLevelTasks } from "./repository";
import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  setTaskStatus,
  updateTask,
} from "./service";
import { createStatus, deleteStatus, listStatuses, moveStatus, updateStatus } from "./statuses";
import { createTag, deleteTag, listTags, updateTag } from "./tags";

const statusesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listStatuses(ctx.db, ctx.userId)),
  create: protectedProcedure
    .input(createStatusInput)
    .mutation(({ ctx, input }) => createStatus(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateStatusInput)
    .mutation(({ ctx, input }) => updateStatus(ctx.db, ctx.userId, input)),
  move: protectedProcedure
    .input(moveStatusInput)
    .mutation(({ ctx, input }) => moveStatus(ctx.db, ctx.userId, input.id, input.direction)),
  delete: protectedProcedure
    .input(deleteStatusInput)
    .mutation(({ ctx, input }) => ctx.db.transaction((tx) => deleteStatus(tx, ctx.userId, input))),
});

const tagsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listTags(ctx.db, ctx.userId)),
  create: protectedProcedure
    .input(createTagInput)
    .mutation(({ ctx, input }) => createTag(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateTagInput)
    .mutation(({ ctx, input }) => updateTag(ctx.db, ctx.userId, input)),
  delete: protectedProcedure
    .input(taskIdInput)
    .mutation(({ ctx, input }) => deleteTag(ctx.db, ctx.userId, input.id)),
});

export const tasksRouter = router({
  list: protectedProcedure.query(({ ctx }) => listTopLevelTasks(ctx.db, ctx.userId)),
  byId: protectedProcedure
    .input(taskIdInput)
    .query(({ ctx, input }) => getTaskDetail(ctx.db, ctx.userId, input.id)),
  create: protectedProcedure
    .input(createTaskInput)
    .mutation(({ ctx, input }) => createTask(ctx, ctx.userId, input)),
  update: protectedProcedure
    .input(updateTaskInput)
    .mutation(({ ctx, input }) => updateTask(ctx, ctx.userId, input)),
  setStatus: protectedProcedure
    .input(setTaskStatusInput)
    .mutation(({ ctx, input }) => setTaskStatus(ctx, ctx.userId, input)),
  complete: protectedProcedure
    .input(taskIdInput)
    .mutation(({ ctx, input }) => completeTask(ctx, ctx.userId, input.id)),
  reopen: protectedProcedure
    .input(taskIdInput)
    .mutation(({ ctx, input }) => reopenTask(ctx, ctx.userId, input.id)),
  delete: protectedProcedure
    .input(taskIdInput)
    .mutation(({ ctx, input }) => deleteTask(ctx, ctx.userId, input.id)),
  statuses: statusesRouter,
  tags: tagsRouter,
});
