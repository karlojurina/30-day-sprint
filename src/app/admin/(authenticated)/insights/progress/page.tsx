import { InsightsPage } from "./InsightsPage";

/**
 * /admin/insights/progress: the course's trends and the students' pace
 * (admin rebuild 2, WI-9: the brand kit's dark look). The page is
 * src/components/admin/insights/InsightsView.tsx, handed the real reads by
 * InsightsPage.tsx; this server wrapper gives the tab its title, which the
 * client layout above it cannot.
 */

export const metadata = {
  title: "Insights · Ecom University",
};

export default function ProgressInsightsPage() {
  return <InsightsPage />;
}
