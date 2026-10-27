/*
 * The one place XP becomes a level. Going from level n to n + 1 costs `n × step` XP, so level 2
 * needs 100 XP in total, level 3 needs 300, level 4 needs 600, … (step 100). Attributes use the
 * same curve with a smaller step, because each receives only part of the XP.
 */

export const CHARACTER_LEVEL_STEP = 100;
export const ATTRIBUTE_LEVEL_STEP = 50;

export interface LevelProgress {
  level: number;
  /** Total XP (never below zero). */
  xp: number;
  /** XP earned since the current level started. */
  xpIntoLevel: number;
  /** XP the current level needs in total to reach the next one. */
  xpForNext: number;
  /** 0–1 progress towards the next level. */
  ratio: number;
}

/** Total XP needed to reach `level` from zero. */
export function xpForLevel(level: number, step = CHARACTER_LEVEL_STEP): number {
  return (step * level * (level - 1)) / 2;
}

export function levelProgress(totalXp: number, step = CHARACTER_LEVEL_STEP): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  while (xp >= xpForLevel(level + 1, step)) level++;
  const start = xpForLevel(level, step);
  const xpForNext = level * step;
  const xpIntoLevel = xp - start;
  return { level, xp, xpIntoLevel, xpForNext, ratio: xpIntoLevel / xpForNext };
}

/** Level with the fraction towards the next one (radar chart radius). */
export function fractionalLevel(totalXp: number, step = ATTRIBUTE_LEVEL_STEP): number {
  const progress = levelProgress(totalXp, step);
  return progress.level + progress.ratio;
}
