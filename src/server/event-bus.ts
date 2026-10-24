import "server-only";

import "@/shared/auth/events";
import { createEventBus, type EventBus } from "@/shared/events/bus";
import { registerSettingsEventHandlers } from "@/modules/settings/server";

/**
 * Composition root for domain event subscriptions.
 * Each module exposes `register<Module>EventHandlers(bus)`; wire it in here.
 */
export function createAppEventBus(): EventBus {
  const bus = createEventBus();
  registerSettingsEventHandlers(bus);
  return bus;
}

let instance: EventBus | undefined;

export function getEventBus(): EventBus {
  instance ??= createAppEventBus();
  return instance;
}
