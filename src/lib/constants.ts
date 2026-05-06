export const WHOP_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize";
export const WHOP_TOKEN_URL = "https://api.whop.com/oauth/token";
export const WHOP_USERINFO_URL = "https://api.whop.com/oauth/userinfo";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";

// Approximate lesson count used as a fallback denominator when the
// actual lessons array isn't available (e.g. in admin views where
// we only fetch student records). Kept in sync with the live DB
// after each content migration:
//   v4 seeded 63, v6 deleted 4 (l034, l040, l043, l044) → 59,
//   v13 deleted 2 (l006, l012) → 57.
// Always prefer using the live `lessons.length` over this constant
// when you have it. Always clamp displayed percentages at 100%.
export const TOTAL_LESSONS = 57;
export const TOTAL_DAYS = 30;
export const TOTAL_REGIONS = 4;

/**
 * Clamp a raw 0–N completion / total to a 0–100 integer percentage.
 * Defends against denominator drift (constant out of sync with DB)
 * + division-by-zero. Always use this for any % shown to a user.
 */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (completed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// The discount unlocks on the final lesson of Region 2 (l046, day 15)
export const DISCOUNT_GATE_LESSON_ID = "l046";

// Time window for the 30% discount: complete all of R1 + R2 within
// this many days of joining Whop. Measured server-side at claim time.
export const DISCOUNT_WINDOW_DAYS = 14;

// Hard cutoff for admin list views — only show students who joined
// on or after this date. Pre-cutoff records are pre-May-2026 test
// accounts and old free-community joiners we don't want in the team's
// daily working surface.
export const ADMIN_STUDENT_JOIN_CUTOFF = "2026-05-01T00:00:00.000Z";

// The "editing breakdowns" group: 9 R2 lessons that collapse into a
// single map node. The student opens the group and chooses Watch or
// Skip per part. Both Watch + Skip count toward path progression so
// they can keep moving. Grouped lessons are sorted by day/sort_order.
export const LESSON_GROUPS: Record<
  string,
  { id: string; title: string; description: string; lessonIds: string[] }
> = {
  editing_breakdowns: {
    id: "editing_breakdowns",
    title: "Editing Breakdowns",
    description:
      "Optional but extremely important — a couple of hours total. If you want to keep momentum, you can skip parts and come back later. This is where the craft lives.",
    lessonIds: [
      "l032",
      "l033",
      "l035",
      "l036",
      "l037",
      "l038",
      "l039",
      "l041",
      "l042",
    ],
  },
};

/** Convenience: map a lesson id → its group id, or null if ungrouped. */
export function lessonGroupOf(lessonId: string): string | null {
  for (const g of Object.values(LESSON_GROUPS)) {
    if (g.lessonIds.includes(lessonId)) return g.id;
  }
  return null;
}

export const LESSON_TYPE_LABELS: Record<string, string> = {
  setup: "Setup",
  watch: "Watch",
  action: "Action",
};
