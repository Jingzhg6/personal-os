import { z } from "zod";

import type { DevelopmentAttribute } from "./attributes";
import type { XpTotals } from "./economy";
import type { LevelProgress } from "./levels";
import type { StageProgress } from "./stages";
import type { XpSourceType } from "./rules";

export type XpEntryKind = "grant" | "reversal";

/** One immutable line of the XP ledger. */
export interface XpEntry {
  id: string;
  kind: XpEntryKind;
  /** Active XP: positive for grants, negative for reversals. */
  amount: number;
  /** Level XP produced by this entry's growth (0 when it has none). */
  levelXp: number;
  ruleKey: string;
  sourceEventId: string;
  sourceEventType: string;
  sourceType: XpSourceType;
  sourceId: string;
  sourceTitle: string | null;
  /** Growth XP: how this entry's XP was split across development attributes (may be empty). */
  credits: { attributeId: string; amount: number; levelXp: number }[];
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
  totals: XpTotals;
  /** Character level from lifetime Level XP. */
  level: LevelProgress;
  stage: StageProgress;
  grantCount: number;
  reversalCount: number;
  /** Active, non-legacy development attributes, in the user's order. */
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
