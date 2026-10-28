import { sweepOverdueDiscipline } from "@/modules/character/server";
import { getEnv } from "@/shared/config/env";
import { protectedProcedure, router } from "@/shared/trpc/init";

import {
  createRuleInput,
  historyInput,
  idInput,
  setEnabledInput,
  updateRuleInput,
} from "../domain";
import { drainEvents, retryExecution, tickSchedules } from "./engine";
import { getHealth, listExecutions, listNotifications, markNotificationsRead } from "./read-model";
import {
  createRule,
  deleteRule,
  getRule,
  listRules,
  setRuleArchived,
  setRuleEnabled,
  updateRule,
} from "./rules";
import { z } from "zod";

/** Automation. Every procedure is scoped to the signed-in user. */
export const automationRouter = router({
  rules: router({
    list: protectedProcedure.query(({ ctx }) => listRules(ctx.db, ctx.userId)),
    byId: protectedProcedure
      .input(idInput)
      .query(({ ctx, input }) => getRule(ctx.db, ctx.userId, input.id)),
    create: protectedProcedure
      .input(createRuleInput)
      .mutation(({ ctx, input }) => createRule(ctx.db, ctx.userId, input)),
    update: protectedProcedure
      .input(updateRuleInput)
      .mutation(({ ctx, input }) => updateRule(ctx.db, ctx.userId, input.id, input.config)),
    setEnabled: protectedProcedure
      .input(setEnabledInput)
      .mutation(({ ctx, input }) => setRuleEnabled(ctx.db, ctx.userId, input.id, input.enabled)),
    setArchived: protectedProcedure
      .input(z.object({ id: z.uuid(), archived: z.boolean() }))
      .mutation(({ ctx, input }) => setRuleArchived(ctx.db, ctx.userId, input.id, input.archived)),
    delete: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => deleteRule(ctx.db, ctx.userId, input.id)),
  }),
  executions: router({
    list: protectedProcedure
      .input(historyInput)
      .query(({ ctx, input }) => listExecutions(ctx.db, ctx.userId, input.id, input.limit)),
    retry: protectedProcedure
      .input(idInput)
      .mutation(({ ctx, input }) => retryExecution(ctx, ctx.userId, input.id)),
  }),
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => listNotifications(ctx.db, ctx.userId)),
    markRead: protectedProcedure
      .input(z.object({ id: z.uuid().nullable() }))
      .mutation(({ ctx, input }) => markNotificationsRead(ctx.db, ctx.userId, input.id)),
  }),
  health: protectedProcedure.query(({ ctx }) =>
    getHealth(ctx.db, ctx.userId, {
      schedulerConfigured: Boolean(getEnv().AUTOMATION_WORKER_SECRET),
    }),
  ),
  /**
   * The manual processing path: runs this user's due schedules and pending events now. It does
   * not count as the scheduler being operational (no heartbeat).
   */
  runDue: protectedProcedure.mutation(async ({ ctx }) => {
    const schedules = await tickSchedules(ctx, { userId: ctx.userId });
    const events = await drainEvents(ctx, { userId: ctx.userId });
    const discipline = await sweepOverdueDiscipline(ctx.db, { userId: ctx.userId });
    return { ...schedules, events: events.processed, disciplineOverdue: discipline.penalised };
  }),
});
