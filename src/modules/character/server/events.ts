import type { EventBus } from "@/shared/events/bus";

import { xpEventTypes } from "../domain";
import { seedDevelopmentAttributes } from "./attributes";
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
}
