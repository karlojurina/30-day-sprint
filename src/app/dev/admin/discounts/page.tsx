"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { ThirtyView } from "@/components/admin/thirty/ThirtyView";
import { fixtureThirtyTransport, parseFixtureState } from "../fixtures";
import type { FixtureCall } from "../fixtures";

/**
 * /dev/admin/discounts: the 30% page (src/components/admin/thirty/ThirtyView.tsx)
 * with made-up data and no login (admin rebuild PRD, work item 3). The bar
 * above it is the real one, for a made-up csm.
 *
 *   ?state=full | empty | loading | error   the list's answer (default full)
 *          partial | novideos   one student's progress, or the course's
 *                               videos, unreadable (fixtures.ts)
 *   ?conflict=1   the decision buttons answer as if another team member
 *                 decided the request first (fixtures.ts says how)
 *   ?reload=fail  the list loads once, then every read of it fails
 *   ?tab=decide | approved | code-added | rejected
 *   ?student=<id>  one student on every tab, as the student page links it
 *                  (p-maya, p-ethan, p-omar ... in fixtures.ts)
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

const DEV_MEMBER = { full_name: "Robin Hale", role: "csm" } as const;

declare global {
  interface Window {
    __adminCalls?: FixtureCall[];
  }
}

function DevThirty() {
  const params = useSearchParams();
  const [transport] = useState(() =>
    fixtureThirtyTransport({
      state: parseFixtureState(params.get("state")),
      conflict: params.get("conflict") === "1",
      reloadFails: params.get("reload") === "fail",
    }),
  );
  useEffect(() => {
    window.__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav member={DEV_MEMBER} pathname="/admin/discounts" onSignOut={() => {}} />
      <ThirtyView transport={transport} />
    </>
  );
}

export default function DevDiscountsPage() {
  return (
    <Suspense fallback={null}>
      <DevThirty />
    </Suspense>
  );
}
