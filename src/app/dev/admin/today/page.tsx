"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { TodayView } from "@/components/admin/today/TodayView";
import { fixtureTodayTransport, parseFixtureState } from "../fixtures";
import type { FixtureCall } from "../fixtures";

/**
 * /dev/admin/today: Today (src/components/admin/today/TodayView.tsx) with
 * made-up data and no login (admin rebuild PRD, work item 4). The bar above
 * it is the real one, for a made-up csm.
 *
 *   ?state=full | empty | loading | error   the list's answer (default full)
 *
 * Every load runs the real buildSupportRows over the made-up database in
 * fixtures.ts, on a clock that starts on Wed 28 Oct (fixtures.ts says why).
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

const DEV_MEMBER = { full_name: "Robin Hale", role: "csm" } as const;

declare global {
  interface Window {
    __adminCalls?: FixtureCall[];
  }
}

function DevToday() {
  const params = useSearchParams();
  const [transport] = useState(() => fixtureTodayTransport({ state: parseFixtureState(params.get("state")) }));
  useEffect(() => {
    window.__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav member={DEV_MEMBER} pathname="/admin/today" onSignOut={() => {}} />
      <TodayView transport={transport} />
    </>
  );
}

export default function DevTodayPage() {
  return (
    <Suspense fallback={null}>
      <DevToday />
    </Suspense>
  );
}
