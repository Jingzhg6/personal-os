import { z } from "zod";

import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  createMilestoneInput,
  createProjectInput,
  milestoneIdInput,
  projectStatuses,
  updateMilestoneInput,
  updateProjectInput,
} from "../domain";
import {
  createMilestone,
  createProject,
  deleteMilestone,
  deleteProject,
  getProjectDetail,
  listProjects,
  setMilestoneCompleted,
  updateMilestone,
  updateProject,
} from "./service";

const today = z.iso.date();

const milestonesRouter = router({
  create: protectedProcedure
    .input(createMilestoneInput)
    .mutation(({ ctx, input }) => createMilestone(ctx.db, ctx.userId, input)),
  update: protectedProcedure
    .input(updateMilestoneInput)
    .mutation(({ ctx, input }) => updateMilestone(ctx.db, ctx.userId, input)),
  setCompleted: protectedProcedure
    .input(milestoneIdInput.extend({ completed: z.boolean() }))
    .mutation(({ ctx, input }) => setMilestoneCompleted(ctx, ctx.userId, input)),
  delete: protectedProcedure
    .input(milestoneIdInput)
    .mutation(({ ctx, input }) => deleteMilestone(ctx.db, ctx.userId, input.id)),
});

export const projectsRouter = router({
  list: protectedProcedure
    .input(z.object({ today, statuses: z.array(z.enum(projectStatuses)).max(5).optional() }))
    .query(({ ctx, input }) => listProjects(ctx.db, ctx.userId, input)),
  byId: protectedProcedure
    .input(z.object({ id: z.uuid(), today }))
    .query(({ ctx, input }) => getProjectDetail(ctx.db, ctx.userId, input)),
  create: protectedProcedure
    .input(createProjectInput)
    .mutation(({ ctx, input }) => createProject(ctx, ctx.userId, input)),
  update: protectedProcedure
    .input(updateProjectInput)
    .mutation(({ ctx, input }) => updateProject(ctx, ctx.userId, input)),
  delete: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => deleteProject(ctx, ctx.userId, input.id)),
  milestones: milestonesRouter,
});
