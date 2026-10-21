"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { InsightsView } from "@/components/admin/insights/InsightsView";
import { fixtureInsightsTransport, fixturePace, parseInsightsState } from "../insights-fixtures";

/**
 * /dev/admin/insights: the Insights page (src/components/admin/insights/
 * InsightsView.tsx) with made-up numbers and no login (admin rebuild 2,
 * WI-9). The bar above it is the real one, for a made-up founder.
 *
 *   ?state=full | empty | loading | error | partial | noreset   (default full)
 *   ?course=new | old   activity or pace in the first card (default new)
 */

function DevInsights() {
  const params = useSearchParams();
  const [transport] = useState(() => fixtureInsightsTransport(parseInsightsState(params.get("state"))));
  const [pace] = useState(() => fixturePace(params.get("course")));
  return (
    <>
      <AdminTopNav member={{ full_name: "Robin Hale", role: "founder" }} pathname="/admin/insights/progress" onSignOut={() => {}} />
      <InsightsView transport={transport} pace={pace} />
    </>
  );
}

export default function DevInsightsPage() {
  return (
    <Suspense fallback={null}>
      <DevInsights />
    </Suspense>
  );
}
