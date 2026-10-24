import type { EventBus } from "@/shared/events/bus";

import { seedDefaultStatuses } from "./statuses";

export function registerTasksEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedDefaultStatuses(db, event.userId), {
    name: "tasks.seedDefaultStatuses",
  });
}
