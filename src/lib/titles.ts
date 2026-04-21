import type { StudentTitle } from "@/types/database";

export interface TitleDefinition {
  key: StudentTitle;
  label: string;
  minRegions: number; // number of completed regions required
}

// V3: 5 titles, unlocked by completing regions (0-4)
export const TITLES: TitleDefinition[] = [
  { key: "recruit",    label: "Recruit",        minRegions: 0 },
  { key: "explorer",   label: "Explorer",       minRegions: 1 },
  { key: "ad_creator", label: "Ad Creator",     minRegions: 2 },
  { key: "strategist", label: "Strategist",     minRegions: 3 },
  { key: "et_pro",     label: "EcomTalent Pro", minRegions: 4 },
];

export function getTitleForRegions(completedCount: number): TitleDefinition {
  let result = TITLES[0];
  for (const title of TITLES) {
    if (completedCount >= title.minRegions) {
      result = title;
    }
  }
  return result;
}

export function getNextTitle(completedCount: number): TitleDefinition | null {
  for (const title of TITLES) {
    if (completedCount < title.minRegions) {
      return title;
    }
  }
  return null;
}

export function getTitleLabel(key: StudentTitle): string {
  return TITLES.find((t) => t.key === key)?.label ?? key;
}
