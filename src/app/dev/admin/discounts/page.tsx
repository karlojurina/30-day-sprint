"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { ThirtyView } from "@/components/admin/thirty/ThirtyView";
import { fixtureThirtyTransport, parseFixtureRole, parseFixtureState } from "../fixtures";
import type { FixtureCall } from "../fixtures";

/**
 * /dev/admin/discounts: the 30% page (src/components/admin/thirty/ThirtyView.tsx)
 * with made-up data and no login (admin rebuild PRD, work item 3; admin
 * rebuild 2, D4 and D5). The bar above it is the real one, for a made-up
 * team member.
 *
 *   ?state=full | empty | loading | error   the list's answer (default full)
 *          partial | novideos | nocoupons   one student's progress, the
 *                               course's videos, or the stored coupons,
 *                               unreadable (fixtures.ts)
 *          owncode              the team's own 30% codes already on the
 *                               Approved memberships in Whop (fixtures.ts)
 *          stalecoupon          a code taken off Tara's membership in Whop
 *                               since the cron stored it: Check Whop again
 *                               finds it gone (fixtures.ts)
 *          unpaid               Whop showing no paid course plan and
 *                               payment that went through for Jonah (stored)
 *                               and Maya (only now): Jonah's verdict says so
 *                               with no Approve, and Maya's Approve is
 *                               refused (fixtures.ts; the owner's rule of
 *                               2026-10-26, ?state=nopayment until then)
 *          paused               THIRTY_AUTO_APPLY off: the page says so, and
 *                               every Why line names the team (T-137, R7)
 *          reasons              every other reason a request waits for, and
 *                               the rows whose Approve, Try again or Reject
 *                               answers each line of the PRD's tables
 *   ?role=admin | founder | csm   whose page (default admin): Approve anyway
 *                 is a founder's or an admin's (the owner's review,
 *                 2026-10-21), and so is Reject on a request whose code may
 *                 exist (T-137); the stand-in refuses both to a csm, as the
 *                 routes do
 *   ?approve=coursechanged   a plain Approve answers the old course's 409,
 *                 "The course changed and this check cannot run. Nothing was
 *                 approved." (code "rule"), as a deployment without the
 *                 new course's catalog shape does
 *   ?conflict=1   the decision buttons answer as if another team member
 *                 decided the request first (fixtures.ts says how)
 *   ?reload=fail  the list loads once, then every read of it fails
 *   ?whop=down    Check Whop again gets no answer from Whop
 *   ?student=<id>  one student's rows, as the student page links it
 *                  (p-maya, p-ethan, p-iris ... in fixtures.ts). Since the
 *                  30% applies itself the page is one list: a ?tab= from
 *                  before opens the list
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

declare global {
  interface Window {
    __adminCalls?: FixtureCall[];
  }
}

function DevThirty() {
  const params = useSearchParams();
  const role = parseFixtureRole(params.get("role"));
  const [transport] = useState(() =>
    fixtureThirtyTransport({
      state: parseFixtureState(params.get("state")),
      conflict: params.get("conflict") === "1",
      reloadFails: params.get("reload") === "fail",
      whopDown: params.get("whop") === "down",
      courseChanged: params.get("approve") === "coursechanged",
      role,
    }),
  );
  useEffect(() => {
    window.__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav member={{ full_name: "Robin Hale", role }} pathname="/admin/discounts" onSignOut={() => {}} />
      <ThirtyView transport={transport} canApproveAnyway={role === "founder" || role === "admin"} />
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
