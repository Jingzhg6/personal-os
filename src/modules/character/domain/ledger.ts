import { z } from "zod";

import type { Attribute } from "./attributes";
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
  attributeId: string | null;
  /** The grant this entry cancels (reversals only). */
  reversalOf: string | null;
  /** Grants only: a later reversal cancelled it. */
  reversed: boolean;
  createdAt: Date;
}

export interface AttributeValue extends Attribute {
  xp: number;
  progress: LevelProgress;
}

export interface CharacterOverview {
  progress: LevelProgress;
  grantCount: number;
  reversalCount: number;
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
