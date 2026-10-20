"use client";

import { useAuth } from "@/contexts/AuthContext";
import { RestrictedPage } from "@/components/admin/ui";
import { LessonFeedbackView } from "@/components/admin/feedback/LessonFeedbackView";

/**
 * /admin/feedback/lessons for the signed-in member: founders and admins see
 * the page (LessonFeedbackView.tsx); the csm role, which the top bar does not
 * offer it to, gets the "not for your role" card, as before. The route
 * behind it refuses the csm role too (403).
 */
export function LessonFeedbackGate() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Lesson feedback" reason="Ask a founder or an admin if you need this page." />;
  }
  return <LessonFeedbackView />;
}
