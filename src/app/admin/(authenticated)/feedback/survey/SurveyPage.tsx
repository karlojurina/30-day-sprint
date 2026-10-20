"use client";

import { useCallback } from "react";
import { RestrictedPage } from "@/components/admin/ui";
import { SurveyView } from "@/components/admin/survey/SurveyView";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import { loadSurveyData } from "@/lib/admin/survey-data";

/**
 * The Survey page's loader: the role, and the real read
 * (src/lib/admin/survey-data.ts) with the team member's client. The csm
 * role gets the restricted page, as on Lesson feedback.
 */
export function SurveyPage() {
  const { teamMember } = useAuth();
  const load = useCallback(() => loadSurveyData(createClient()), []);
  if (!teamMember) return null;
  if (teamMember.role === "csm") {
    return (
      <RestrictedPage
        title="Survey"
        reason="The survey answers are for founders and admins. Ask one of them if you need them."
      />
    );
  }
  return <SurveyView load={load} />;
}
