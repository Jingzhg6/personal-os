import { z } from "zod";

import { colorIds, type ColorId } from "@/shared/lib/colors";

/**
 * Areas are user data: categories for tasks and (later) projects. They are not navigation:
 * renaming, adding or deleting an area never changes the app's sections.
 */

export const areaIconIds = [
  "circle",
  "heart",
  "graduation-cap",
  "dumbbell",
  "briefcase",
  "trending-up",
  "clipboard",
  "home",
  "users",
  "wallet",
  "plane",
  "code",
  "music",
  "palette",
  "leaf",
  "book",
] as const;

export type AreaIconId = (typeof areaIconIds)[number];

/** Seeded for every new user. `systemKey` labels are translated; a user rename sets `name`. */
export const defaultAreas = [
  { systemKey: "personal", icon: "heart", color: "pink" },
  { systemKey: "learning", icon: "graduation-cap", color: "blue" },
  { systemKey: "health", icon: "dumbbell", color: "green" },
  { systemKey: "work", icon: "briefcase", color: "indigo" },
  { systemKey: "business", icon: "trending-up", color: "amber" },
  { systemKey: "admin", icon: "clipboard", color: "gray" },
] as const satisfies readonly { systemKey: string; icon: AreaIconId; color: ColorId }[];

export type AreaSystemKey = (typeof defaultAreas)[number]["systemKey"];

export interface Area {
  id: string;
  /** Set for seeded areas; the UI shows the translated default unless `name` is set. */
  systemKey: AreaSystemKey | null;
  name: string | null;
  color: ColorId;
  icon: AreaIconId;
  sortKey: string;
}

const areaName = z.string().trim().min(1).max(60);

export const createAreaInput = z.object({
  name: areaName,
  color: z.enum(colorIds),
  icon: z.enum(areaIconIds),
});

export const updateAreaInput = z.object({
  id: z.uuid(),
  /** null resets a seeded area to its translated default name. */
  name: areaName.nullable().optional(),
  color: z.enum(colorIds).optional(),
  icon: z.enum(areaIconIds).optional(),
});

export const moveAreaInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
export const areaIdInput = z.object({ id: z.uuid() });

export type CreateAreaInput = z.infer<typeof createAreaInput>;
export type UpdateAreaInput = z.infer<typeof updateAreaInput>;
