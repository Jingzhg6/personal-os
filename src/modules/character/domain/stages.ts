import { getLevelFromLevelXp, xpForLevel } from "./levels";

/*
 * Growth stages: named bands of character levels. Titles are translated by key
 * (character.stages.<key>); the bands live only here.
 */
export const growthStages = [
  { key: "starter", startLevel: 1, endLevel: 5 },
  { key: "explorer", startLevel: 6, endLevel: 10 },
  { key: "practitioner", startLevel: 11, endLevel: 20 },
  { key: "refiner", startLevel: 21, endLevel: 30 },
  { key: "shaper", startLevel: 31, endLevel: 40 },
  { key: "outstanding", startLevel: 41, endLevel: 50 },
  { key: "master", startLevel: 51, endLevel: 60 },
  { key: "legend", startLevel: 61, endLevel: null },
] as const satisfies readonly { key: string; startLevel: number; endLevel: number | null }[];

export type GrowthStage = (typeof growthStages)[number];
export type GrowthStageKey = GrowthStage["key"];

export function getStage(level: number): GrowthStage {
  return growthStages.findLast((stage) => level >= stage.startLevel) ?? growthStages[0];
}

export function getNextStage(level: number): GrowthStage | null {
  return growthStages.find((stage) => stage.startLevel > level) ?? null;
}

export interface StageProgress {
  stage: GrowthStage;
  nextStage: GrowthStage | null;
  /** Lifetime Level XP still needed to enter the next stage (null at the last stage). */
  xpToNextStage: number | null;
}

export function getStageProgress(lifetimeLevelXp: number): StageProgress {
  const level = getLevelFromLevelXp(lifetimeLevelXp);
  const nextStage = getNextStage(level);
  return {
    stage: getStage(level),
    nextStage,
    xpToNextStage: nextStage
      ? Math.max(0, xpForLevel(nextStage.startLevel) - Math.max(0, Math.floor(lifetimeLevelXp)))
      : null,
  };
}
