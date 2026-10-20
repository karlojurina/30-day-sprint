import { InsightsView } from "@/components/admin/tasks/InsightsView";

/**
 * /admin/tasks/insights: outreach insights (v85.3; admin rebuild 2, D7). The
 * page itself is src/components/admin/tasks/InsightsView.tsx, which reads
 * GET /api/admin/tasks/insights; this server wrapper gives the tab its title.
 */

export const metadata = {
  title: "Outreach insights · Ecom University",
};

export default function OutreachInsightsPage() {
  return <InsightsView />;
}
