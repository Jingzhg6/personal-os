import type { EventBus } from "@/shared/events/bus";

import { xpEventTypes } from "../domain";
import { seedDevelopmentAttributes } from "./attributes";
import { reconcileTaskDiscipline } from "./discipline";
import { applyXpEvent } from "./xp";

/**
 * The character module only listens: completions and their reversals arrive as domain events
 * from any module, inside the publisher's transaction.
 */
export function registerCharacterEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedDevelopmentAttributes(db, event.userId), {
    name: "character.seedDevelopmentAttributes",
  });
  for (const type of xpEventTypes) {
    bus.subscribe(type, (event, { db }) => applyXpEvent(db, event), { name: "character.xp" });
  }
  // 自制力 (M10.5): any status change (and a task created already completed) re-scores the task,
  // in the same transaction. Automation-caused changes are scored by the same fixed rules.
  const discipline = (
    event: { id: string; userId: string; payload: { taskId: string } },
    db: Parameters<typeof reconcileTaskDiscipline>[0],
  ) =>
    reconcileTaskDiscipline(db, {
      userId: event.userId,
      taskId: event.payload.taskId,
      sourceKey: event.id,
    }).then(() => undefined);
  bus.subscribe("task.status_changed", (event, { db }) => discipline(event, db), {
    name: "character.discipline",
  });
  bus.subscribe("task.completed", (event, { db }) => discipline(event, db), {
    name: "character.discipline",
  });
}
