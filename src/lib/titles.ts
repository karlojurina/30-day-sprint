import type { StudentTitle } from "@/types/database";

export interface TitleDefinition {
  key: StudentTitle;
  label: string;
  minCheckpoints: number;
}

export const TITLES: TitleDefinition[] = [
  { key: "recruit", label: "Recruit", minCheckpoints: 0 },
  { key: "explorer", label: "Explorer", minCheckpoints: 1 },
  { key: "apprentice", label: "Apprentice", minCheckpoints: 2 },
  { key: "ad_creator", label: "Ad Creator", minCheckpoints: 3 },
  { key: "strategist", label: "Strategist", minCheckpoints: 4 },
  { key: "bounty_hunter", label: "Bounty Hunter", minCheckpoints: 5 },
  { key: "ecomtalent_pro", label: "EcomTalent Pro", minCheckpoints: 7 },
];

/**
 * Get the title for a given number of completed checkpoints.
 * Returns the highest title the student qualifies for.
 */
export function getTitleForCheckpoints(completedCount: number): TitleDefinition {
  let result = TITLES[0];
  for (const title of TITLES) {
    if (completedCount >= title.minCheckpoints) {
      result = title;
    }
  }
  return result;
}

/**
 * Get the next title the student can earn, or null if they're at max.
 */
export function getNextTitle(completedCount: number): TitleDefinition | null {
  for (const title of TITLES) {
    if (completedCount < title.minCheckpoints) {
      return title;
    }
  }
  return null;
}

/**
 * Get a display label for a title key.
 */
export function getTitleLabel(key: StudentTitle): string {
  return TITLES.find((t) => t.key === key)?.label ?? key;
}
