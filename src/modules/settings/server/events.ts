import type { EventBus } from "@/shared/events/bus";

import { ensureUserSettings } from "./repository";

export function registerSettingsEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => ensureUserSettings(db, event.userId), {
    name: "settings.provisionDefaults",
  });
}
