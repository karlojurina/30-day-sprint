"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { LessonFeedbackView } from "@/components/admin/feedback/LessonFeedbackView";
import { fixtureLessonFeedbackTransport, parseLessonFixtureState } from "../lesson-fixtures";
import type { LessonFixtureCall } from "../lesson-fixtures";

/**
 * /dev/admin/feedback/lessons: Lesson feedback
 * (src/components/admin/feedback/LessonFeedbackView.tsx) with made-up data
 * and no login (admin rebuild 2, WI-7). The bar above it is the real one,
 * for a made-up admin (the csm role does not see this page).
 *
 *   ?state=full | empty | loading | error | unplaced | stray   (lesson-fixtures.ts)
 *   ?reload=fail   the page loads once, then every read of it fails
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

const DEV_MEMBER = { full_name: "Jamie Rowe", role: "admin" } as const;

/** The 30% dev page types window.__adminCalls for its own calls; this page puts its own there. */
type CallsWindow = { __adminCalls?: LessonFixtureCall[] };

function DevLessonFeedback() {
  const params = useSearchParams();
  const [transport] = useState(() =>
    fixtureLessonFeedbackTransport({
      state: parseLessonFixtureState(params.get("state")),
      reloadFails: params.get("reload") === "fail",
    }),
  );
  useEffect(() => {
    (window as unknown as CallsWindow).__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav member={DEV_MEMBER} pathname="/admin/feedback/lessons" onSignOut={() => {}} />
      <LessonFeedbackView transport={transport} />
    </>
  );
}

export default function DevLessonFeedbackPage() {
  return (
    <Suspense fallback={null}>
      <DevLessonFeedback />
    </Suspense>
  );
}
