import type { EventBus } from "@/shared/events/bus";

import { seedDefaultAreas } from "./repository";

export function registerAreasEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedDefaultAreas(db, event.userId), {
    name: "areas.seedDefaults",
  });
}
