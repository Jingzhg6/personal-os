import { z } from "zod";

import type { DevelopmentAttribute } from "./attributes";
import type { LevelProgress } from "./levels";
import type { XpSourceType } from "./rules";

export type XpEntryKind = "grant" | "reversal";

/** One immutable line of the XP ledger. */
export interface XpEntry {
  id: string;
  kind: XpEntryKind;
  /** Positive for grants, negative for reversals. */
  amount: number;
  ruleKey: string;
  sourceEventId: string;
  sourceEventType: string;
  sourceType: XpSourceType;
  sourceId: string;
  sourceTitle: string | null;
  /** How this entry's XP was split across development attributes (may be empty). */
  credits: { attributeId: string; amount: number }[];
  /** The grant this entry cancels (reversals only). */
  reversalOf: string | null;
  /** Grants only: a later reversal cancelled it. */
  reversed: boolean;
  createdAt: Date;
}

export interface AttributeValue extends DevelopmentAttribute {
  progress: LevelProgress;
}

export interface CharacterOverview {
  /** Overall XP and level: every completion counts once. */
  progress: LevelProgress;
  /** Part of the overall XP credited to development attributes (archived ones included). */
  developmentXp: number;
  grantCount: number;
  reversalCount: number;
  /** Active development attributes, in the user's order. */
  attributes: AttributeValue[];
  recentGrants: XpEntry[];
  recentReversals: XpEntry[];
}

export const xpHistoryInput = z.object({
  kind: z.enum(["grant", "reversal"]).optional(),
  attributeId: z.uuid().optional(),
  /** Id of the last entry of the previous page. */
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type XpHistoryInput = z.infer<typeof xpHistoryInput>;
