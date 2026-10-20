import { DevInsights } from "../../DevPeople";
import { readPeopleParams, type SearchParams } from "../../people-params";

/**
 * /dev/admin/tasks/insights: outreach insights
 * (src/components/admin/tasks/InsightsView.tsx) with the route's answer
 * made up, and no login (admin rebuild 2, D7).
 *
 *   ?state=full | empty | loading | error   (default full)
 *   ?reset=none   the tasks reset has not run: "All time" instead of "Since the reset"
 */
export default async function DevInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const o = await readPeopleParams(searchParams);
  return <DevInsights state={o.state} reset={o.reset} role={o.role} />;
}
