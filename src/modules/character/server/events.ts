import type { EventBus } from "@/shared/events/bus";

import { xpEventTypes } from "../domain";
import { seedAttributes } from "./attributes";
import { applyXpEvent } from "./xp";

/**
 * The character module only listens: completions and their reversals arrive as domain events
 * from any module, inside the publisher's transaction.
 */
export function registerCharacterEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedAttributes(db, event.userId), {
    name: "character.seedAttributes",
  });
  for (const type of xpEventTypes) {
    bus.subscribe(type, (event, { db }) => applyXpEvent(db, event), { name: "character.xp" });
  }
}
