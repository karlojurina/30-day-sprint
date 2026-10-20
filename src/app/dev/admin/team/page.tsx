"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { TeamView } from "@/components/admin/team/TeamView";
import { DEV_FOUNDER_ID, fixtureTeamTransport, parseTeamState } from "../team-fixtures";

/**
 * /dev/admin/team: the Team page (src/components/admin/team/TeamView.tsx)
 * with made-up people and no login (admin rebuild 2, WI-9). The bar above
 * it is the real one.
 *
 *   ?state=full | empty | loading | error   (default full)
 *   ?role=founder | admin   who is looking (default founder); an admin
 *                           sees one line and nothing is read
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

function DevTeam() {
  const params = useSearchParams();
  const role = params.get("role") === "admin" ? "admin" : "founder";
  const [transport] = useState(() => fixtureTeamTransport(parseTeamState(params.get("state"))));
  useEffect(() => {
    // Not declared on Window here: the 30% dev page declares it with its own call type.
    (window as unknown as { __adminCalls?: unknown[] }).__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav
        member={{ full_name: role === "founder" ? "Robin Hale" : "Jamie Rowe", role }}
        pathname="/admin/team"
        onSignOut={() => {}}
      />
      <TeamView transport={transport} me={{ id: role === "founder" ? DEV_FOUNDER_ID : "tm-jamie", role }} />
    </>
  );
}

export default function DevTeamPage() {
  return (
    <Suspense fallback={null}>
      <DevTeam />
    </Suspense>
  );
}
