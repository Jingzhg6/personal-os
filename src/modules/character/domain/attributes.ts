import { z } from "zod";

import type { AreaSystemKey } from "@/modules/areas/domain";
import type { ColorId } from "@/shared/lib/colors";

/**
 * Attributes are the character's ability dimensions (学习, 工作, 健身, …). They are their own
 * records, separate from the XP ledger: an XP entry may be credited to one attribute (through the
 * area of what was completed), and an attribute's value is the sum of the entries credited to
 * it. The radar chart only visualises these values.
 */
export const attributeKeys = ["learning", "work", "fitness", "business", "admin", "life"] as const;
export type AttributeKey = (typeof attributeKeys)[number];

/** Seeded for every user. Labels are translated by key; `name` is reserved for user renames. */
export const defaultAttributes = [
  { systemKey: "learning", color: "blue" },
  { systemKey: "work", color: "indigo" },
  { systemKey: "fitness", color: "green" },
  { systemKey: "business", color: "amber" },
  { systemKey: "admin", color: "gray" },
  { systemKey: "life", color: "pink" },
] as const satisfies readonly { systemKey: AttributeKey; color: ColorId }[];

/** Which attribute a seeded area credits by default (users can change the mapping). */
export const defaultAttributeForArea: Record<AreaSystemKey, AttributeKey> = {
  learning: "learning",
  work: "work",
  health: "fitness",
  business: "business",
  admin: "admin",
  personal: "life",
};

export interface Attribute {
  id: string;
  systemKey: AttributeKey;
  name: string | null;
  color: ColorId;
  /** Areas whose completed items credit this attribute. */
  areaIds: string[];
}

export const setAttributeAreaInput = z.object({
  areaId: z.uuid(),
  /** null: the area credits overall XP only. */
  attributeId: z.uuid().nullable(),
});
export type SetAttributeAreaInput = z.infer<typeof setAttributeAreaInput>;
