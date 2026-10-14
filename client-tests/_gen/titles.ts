
export interface TitleDefinition {
  key: string;
  label: string;
  minRegions: number; // completed regions required, out of the old course's 4
}

// V3: 5 titles, unlocked by completing regions (0-4). On a course of N
// regions (areas) a title needs minRegions × N / 4 of them, so the same
// ladder reads 0/2/4/6/8 of the new course's 8 areas (cutover, C3).
export const TITLES: TitleDefinition[] = [
  { key: "recruit",    label: "Recruit",        minRegions: 0 },
  { key: "explorer",   label: "Explorer",       minRegions: 1 },
  { key: "ad_creator", label: "Ad Creator",     minRegions: 2 },
  { key: "strategist", label: "Strategist",     minRegions: 3 },
  { key: "et_pro",     label: "EcomTalent Pro", minRegions: 4 },
];

/**
 * Regions (areas) a title needs on a course of `totalRegions`. A count
 * that is not a positive number (the areas have not loaded yet) leaves
 * only the first title reachable: a ladder scaled to 0 areas would hand
 * out EcomTalent Pro for nothing done.
 */
function regionsNeeded(title: TitleDefinition, totalRegions: number): number {
  if (!(totalRegions > 0) || !Number.isFinite(totalRegions)) {
    return title.minRegions === 0 ? 0 : Infinity;
  }
  return (title.minRegions * totalRegions) / 4;
}

export function getTitleForRegions(
  completedCount: number,
  totalRegions = 4,
): TitleDefinition {
  let result = TITLES[0];
  for (const title of TITLES) {
    if (completedCount >= regionsNeeded(title, totalRegions)) {
      result = title;
    }
  }
  return result;
}

export function getNextTitle(
  completedCount: number,
  totalRegions = 4,
): TitleDefinition | null {
  for (const title of TITLES) {
    if (completedCount < regionsNeeded(title, totalRegions)) {
      return title;
    }
  }
  return null;
}

export function getTitleLabel(key: string): string {
  return TITLES.find((t) => t.key === key)?.label ?? key;
}
