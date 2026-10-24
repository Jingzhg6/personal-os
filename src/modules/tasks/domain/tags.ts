import { z } from "zod";

import { colorIds, type ColorId } from "@/shared/lib/colors";

export interface Tag {
  id: string;
  name: string;
  color: ColorId;
}

/** Tag names are single tokens so they work with Quick Add (`#name`). */
export const tagName = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\s#＃@＠!！]+$/, { message: "Tag names cannot contain spaces or # @ !" });

export const createTagInput = z.object({ name: tagName, color: z.enum(colorIds).default("gray") });
export const updateTagInput = z.object({
  id: z.uuid(),
  name: tagName.optional(),
  color: z.enum(colorIds).optional(),
});

export type CreateTagInput = z.infer<typeof createTagInput>;
export type UpdateTagInput = z.infer<typeof updateTagInput>;
