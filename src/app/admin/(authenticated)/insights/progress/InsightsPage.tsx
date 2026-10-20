"use client";

import { InsightsView } from "@/components/admin/insights/InsightsView";
import { insightsTransport } from "@/lib/admin/insights-transport";
import { useJourneyPaceCounts } from "@/lib/useJourneyPaceCounts";

/**
 * The Insights page's loader: the shared pace count (the same hook the
 * Journey page reads) and the page's own reads (src/lib/admin/
 * insights-transport.ts).
 */
export function InsightsPage() {
  const pace = useJourneyPaceCounts();
  return <InsightsView transport={insightsTransport} pace={pace} />;
}
