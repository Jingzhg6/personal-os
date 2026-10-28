import { z } from "zod";

import { colorIds, type ColorId } from "@/shared/lib/colors";

/*
 * Development attributes: what the user is growing into (法语, 阅读, 有氧, Python, …). They are
 * user data — created, renamed, archived and reordered freely — and have nothing to do with
 * areas, which organise life (学习, 工作, 行政事务 …). A task names the attributes it helps grow
 * (its development contributions); its area plays no part in that.
 */

/** Seeded examples for new accounts; only labels are keyed, nothing depends on these keys. */
export const defaultDevelopmentAttributes = [
  { systemKey: "french", icon: "🇫🇷", color: "blue" },
  { systemKey: "english", icon: "🇬🇧", color: "indigo" },
  { systemKey: "reading", icon: "📚", color: "amber" },
  { systemKey: "strength", icon: "🏋️", color: "red" },
  { systemKey: "cardio", icon: "🚴", color: "green" },
] as const satisfies readonly { systemKey: string; icon: string; color: ColorId }[];

/**
 * System keys with a translated label: the seeds above, and the six M6 area-derived attributes
 * kept (archived) for history as `legacy.<key>`.
 */
export const attributeLabelKeys = [
  ...defaultDevelopmentAttributes.map((a) => a.systemKey),
  /** M10.5: the fixed 自制力 attribute (scored by fixed rules, never renamed). */
  "discipline",
  "legacy.learning",
  "legacy.work",
  "legacy.fitness",
  "legacy.business",
  "legacy.admin",
  "legacy.life",
] as const;
export type AttributeLabelKey = (typeof attributeLabelKeys)[number];

export interface DevelopmentAttribute {
  id: string;
  systemKey: AttributeLabelKey | null;
  name: string | null;
  icon: string | null;
  color: ColorId;
  onRadar: boolean;
  archivedAt: Date | null;
  sortKey: string;
  /** Growth XP credited so far (archived attributes keep theirs). Always 0 for 自制力. */
  xp: number;
  /** 自制力 only: its score (sum of the discipline ledger, may be negative). Null otherwise. */
  points: number | null;
}

/** The fixed, system-managed 自制力 attribute (M10.5). */
export const isDisciplineAttribute = (attribute: { systemKey: string | null }) =>
  attribute.systemKey === "discipline";

/**
 * Attributes that may receive Growth XP (task contributions, goals, focus): every attribute
 * except 自制力, whose value comes only from its fixed rules.
 */
export const isGrowthTarget = (attribute: { systemKey: string | null }) =>
  !isDisciplineAttribute(attribute);

/**
 * The value an attribute's level and radar point are drawn from: Growth XP, or for 自制力 its
 * score, floored at 0 for the level scale (the stored score itself may be negative).
 */
export const attributeScore = (attribute: {
  systemKey: string | null;
  xp: number;
  points: number | null;
}) => (isDisciplineAttribute(attribute) ? Math.max(0, attribute.points ?? 0) : attribute.xp);

export const isLegacyAttribute = (attribute: { systemKey: string | null }) =>
  attribute.systemKey?.startsWith("legacy.") ?? false;

/** Shown on the character page and dashboard: not archived and not M6 legacy history. */
export const isActiveAttribute = (attribute: {
  systemKey: string | null;
  archivedAt: Date | null;
}) => !attribute.archivedAt && !isLegacyAttribute(attribute);

const attributeName = z.string().trim().min(1).max(40);
const attributeIcon = z.string().trim().min(1).max(8).nullable();

export const createAttributeInput = z.object({
  name: attributeName,
  icon: attributeIcon.optional(),
  color: z.enum(colorIds).optional(),
});

export const updateAttributeInput = z.object({
  id: z.uuid(),
  patch: z
    .object({
      /** null resets a seeded attribute to its translated default name. */
      name: attributeName.nullable(),
      icon: attributeIcon,
      color: z.enum(colorIds),
      onRadar: z.boolean(),
      archived: z.boolean(),
    })
    .partial(),
});

export const moveAttributeInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
export const attributeIdInput = z.object({ id: z.uuid() });

export type CreateAttributeInput = z.infer<typeof createAttributeInput>;
export type UpdateAttributeInput = z.infer<typeof updateAttributeInput>;

/** How much a task helps an attribute, relative to its other contributions. */
export const contributionWeights = [1, 2, 3] as const;
export type ContributionWeight = (typeof contributionWeights)[number];

export interface Contribution {
  attributeId: string;
  weight: number;
}

/**
 * Splits `total` XP across contributions in proportion to their weights (largest remainder, ties
 * in list order), so the parts always add up to exactly `total`. Zero parts are dropped.
 */
export function splitByWeight(
  total: number,
  contributions: readonly Contribution[],
): { attributeId: string; amount: number }[] {
  const weightSum = contributions.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0 || weightSum <= 0) return [];
  const exact = contributions.map((c) => (total * c.weight) / weightSum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    parts[index]! += 1;
    left -= 1;
  }
  return contributions
    .map((c, i) => ({ attributeId: c.attributeId, amount: parts[i]! }))
    .filter((part) => part.amount > 0);
}
