import { createTask, updateTask } from "@/modules/tasks/server";
import type { RichTextDoc } from "@/modules/tasks/domain";
import type { DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";

import { automationNotifications } from "../db";
import { renderTemplate, type Action, type Facts } from "../domain";

/*
 * The allowlisted actions. Each maps to the owning module's service, so its validation,
 * ownership checks, events and transactions apply unchanged. Automation never writes tasks, XP,
 * rewards or finance data itself; only its own notifications.
 */

export interface ActionContext {
  db: DbExecutor;
  /** Carries the automation chain (see capture.busWithOrigin). */
  bus: EventBus;
  userId: string;
  ruleId: string;
  facts: Facts;
  /** The trigger's local date in the rule's time zone ("YYYY-MM-DD"). */
  localDate: string;
}

export interface ActionEffect {
  entityType: "task" | "notification";
  entityId: string;
}

function textDoc(text: string | null): RichTextDoc | null {
  if (!text) return null;
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  } as RichTextDoc;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Where a follow-up belongs: the triggering task's or project's project and area. */
function followUpPlace(facts: Facts) {
  if (facts.kind === "task") return { projectId: facts.projectId, areaId: facts.areaId };
  if (facts.kind === "project") return { projectId: facts.projectId, areaId: facts.areaId };
  throw new DomainError("invalid", "automation.action_not_applicable");
}

export async function runAction(ctx: ActionContext, action: Action): Promise<ActionEffect> {
  const deps = { db: ctx.db, bus: ctx.bus };
  const render = (template: string) => renderTemplate(template, ctx.facts, ctx.localDate);
  const due = (days: number | null) => (days === null ? null : addDays(ctx.localDate, days));

  switch (action.type) {
    case "create_task": {
      // Always the default (unstarted) status: automation never creates completed tasks.
      const task = await createTask(deps, ctx.userId, {
        title: render(action.title),
        description: textDoc(action.description && render(action.description)),
        areaId: action.areaId,
        projectId: action.projectId,
        priority: action.priority,
        dueDate: due(action.dueInDays),
      });
      return { entityType: "task", entityId: task.id };
    }
    case "create_follow_up_task": {
      const place = followUpPlace(ctx.facts);
      const task = await createTask(deps, ctx.userId, {
        title: render(action.title),
        description: textDoc(action.description && render(action.description)),
        ...place,
        priority: action.priority,
        dueDate: due(action.dueInDays),
      });
      return { entityType: "task", entityId: task.id };
    }
    case "set_task_priority": {
      if (ctx.facts.kind !== "task") {
        throw new DomainError("invalid", "automation.action_not_applicable");
      }
      const task = await updateTask(deps, ctx.userId, {
        id: ctx.facts.taskId,
        patch: { priority: action.priority },
      });
      return { entityType: "task", entityId: task.id };
    }
    case "notify": {
      const [row] = await ctx.db
        .insert(automationNotifications)
        .values({
          userId: ctx.userId,
          ruleId: ctx.ruleId,
          title: render(action.title).slice(0, 200),
          body: action.body ? render(action.body).slice(0, 1000) : null,
        })
        .returning({ id: automationNotifications.id });
      return { entityType: "notification", entityId: row!.id };
    }
  }
}
