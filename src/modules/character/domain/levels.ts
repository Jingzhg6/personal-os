/*
 * The one place Level XP becomes a level. Going from level n to n + 1 costs
 * round(100 × 1.08^(n − 1)) Level XP: 100, 108, 117, 126, 136, … — each level a little harder.
 *
 * The character's level is derived from LIFETIME Level XP only. Spending Level XP in the reward
 * store never lowers it. Development attributes use the same curve for their own levels.
 */

export const LEVEL_CURVE = { base: 100, growth: 1.08 } as const;

/** XP needed to go from `level` to `level + 1`. */
export function getXpRequiredForNextLevel(level: number): number {
  return Math.round(LEVEL_CURVE.base * LEVEL_CURVE.growth ** (Math.max(1, level) - 1));
}

const cumulative: number[] = [0, 0]; // cumulative[level] = total XP needed to reach `level`

/** Total Level XP needed to reach `level` from zero (level 1 needs 0). */
export function xpForLevel(level: number): number {
  for (let l = cumulative.length; l <= level; l++) {
    cumulative[l] = cumulative[l - 1]! + getXpRequiredForNextLevel(l - 1);
  }
  return cumulative[Math.max(1, level)]!;
}

export function getLevelFromLevelXp(levelXp: number): number {
  const xp = Math.max(0, Math.floor(levelXp));
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  /** Lifetime XP the level is computed from (never below zero). */
  xp: number;
  /** XP earned since the current level started. */
  xpIntoLevel: number;
  /** XP the current level needs in total to reach the next one. */
  xpForNext: number;
  /** 0–1 progress towards the next level. */
  ratio: number;
}

export function getLevelProgress(levelXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(levelXp));
  const level = getLevelFromLevelXp(xp);
  const xpIntoLevel = xp - xpForLevel(level);
  const xpForNext = getXpRequiredForNextLevel(level);
  return { level, xp, xpIntoLevel, xpForNext, ratio: xpIntoLevel / xpForNext };
}

export function getXpToNextLevel(levelXp: number): number {
  const progress = getLevelProgress(levelXp);
  return progress.xpForNext - progress.xpIntoLevel;
}

/** Level with the fraction towards the next one (radar chart radius). */
export function fractionalLevel(xp: number): number {
  const progress = getLevelProgress(xp);
  return progress.level + progress.ratio;
}
