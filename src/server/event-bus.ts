import "server-only";

import "@/shared/auth/events";
import { createEventBus, type EventBus } from "@/shared/events/bus";
import { registerAreasEventHandlers } from "@/modules/areas/server";
import { registerCharacterEventHandlers } from "@/modules/character/server";
import { registerSettingsEventHandlers } from "@/modules/settings/server";
import { registerTasksEventHandlers } from "@/modules/tasks/server";

/**
 * Composition root for domain event subscriptions.
 * Each module exposes `register<Module>EventHandlers(bus)`; wire it in here.
 */
export function createAppEventBus(): EventBus {
  const bus = createEventBus();
  registerSettingsEventHandlers(bus);
  registerAreasEventHandlers(bus);
  registerTasksEventHandlers(bus);
  // After areas: seeding attributes links them to the seeded areas.
  registerCharacterEventHandlers(bus);
  return bus;
}

let instance: EventBus | undefined;

export function getEventBus(): EventBus {
  instance ??= createAppEventBus();
  return instance;
}
