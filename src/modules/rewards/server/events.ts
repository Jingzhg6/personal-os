import type { EventBus } from "@/shared/events/bus";

import { seedLevelRewards } from "./level-rewards";

export function registerRewardsEventHandlers(bus: EventBus): void {
  bus.subscribe("user.registered", (event, { db }) => seedLevelRewards(db, event.userId), {
    name: "rewards.seedLevelRewards",
  });
}
