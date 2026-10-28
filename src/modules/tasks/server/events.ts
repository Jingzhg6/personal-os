import type { EventBus } from "@/shared/events/bus";

import { isClosedCategory, type StatusCategory } from "../domain";
import { generateNextInstance } from "./recurrence";
import { seedDefaultStatuses } from "./statuses";

export function registerTasksEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedDefaultStatuses(db, event.userId), {
    name: "tasks.seedDefaultStatuses",
  });
  // ADR 0023: closing an instance of a recurring series creates the next one, in the same
  // transaction (idempotent per instance).
  bus.subscribe(
    "task.status_changed",
    async (event, { db }) => {
      if (!isClosedCategory(event.payload.toCategory as StatusCategory)) return;
      await generateNextInstance({ db, bus }, event.userId, event.payload.taskId);
    },
    { name: "tasks.generateNextInstance" },
  );
}
