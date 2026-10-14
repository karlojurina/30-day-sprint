// Lifted verbatim from 410e011:src/app/api/cron/check-csm-tasks/route.ts
export function pickExistingAlertScenario(
  alertType: string,
  day: number,
): string | null {
  if (alertType === "no_lessons_3d") {
    if (day <= 5)  return "nolessons.day3";
    if (day <= 10) return "nolessons.day7";
    if (day <= 17) return "nolessons.day14";
    return null;
  }
  if (alertType === "no_tasks_7d" || alertType === "no_login_5d") {
    if (day <= 9)  return "pace.day7";
    if (day <= 17) return "pace.day14";
    if (day <= 24) return "pace.day21";
    return null;
  }
  return null;
}
