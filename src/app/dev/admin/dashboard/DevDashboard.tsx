"use client";

import { useEffect, useState } from "react";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { DashboardView } from "@/components/admin/dashboard/DashboardView";
import { fixtureDashboard } from "./fixtures";
import type { DashFixtureCall, DashFixtureRefresh, DashFixtureState } from "./fixtures";

declare global {
  interface Window {
    __dashCalls?: DashFixtureCall[];
  }
}

export type DevRole = "founder" | "admin" | "csm";

/** Made-up team members, one per role. */
const MEMBERS: Record<DevRole, { full_name: string; role: DevRole }> = {
  founder: { full_name: "Jamie Rowe", role: "founder" },
  admin: { full_name: "Robin Hale", role: "admin" },
  csm: { full_name: "Alex Moreno", role: "csm" },
};

/** The real bar and the real Dashboard over the made-up reads. */
export function DevDashboard({
  state,
  role,
  refresh,
}: {
  state: DashFixtureState;
  role: DevRole;
  refresh: DashFixtureRefresh;
}) {
  const [fixture] = useState(() => fixtureDashboard({ state, refresh }));
  useEffect(() => {
    window.__dashCalls = fixture.calls;
  }, [fixture]);
  return (
    <>
      <AdminTopNav member={MEMBERS[role]} pathname="/admin" onSignOut={() => {}} />
      <DashboardView source={fixture.source} canRefresh={role !== "csm"} now={fixture.now} />
    </>
  );
}
