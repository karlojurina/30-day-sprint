"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { SurveyView } from "@/components/admin/survey/SurveyView";
import { fixtureSurveyLoad, parseSurveyState } from "../survey-fixtures";

/**
 * /dev/admin/survey: the Survey page (src/components/admin/survey/
 * SurveyView.tsx) with made-up data and no login (admin rebuild 2, WI-9).
 * The bar above it is the real one, for a made-up founder.
 *
 *   ?state=full | empty | loading | error   (default full)
 */

function DevSurvey() {
  const params = useSearchParams();
  const [load] = useState(() => fixtureSurveyLoad(parseSurveyState(params.get("state"))));
  return (
    <>
      <AdminTopNav member={{ full_name: "Robin Hale", role: "founder" }} pathname="/admin/feedback/survey" onSignOut={() => {}} />
      <SurveyView load={load} />
    </>
  );
}

export default function DevSurveyPage() {
  return (
    <Suspense fallback={null}>
      <DevSurvey />
    </Suspense>
  );
}
