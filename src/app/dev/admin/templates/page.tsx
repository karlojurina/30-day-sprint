"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { TemplatesView } from "@/components/admin/templates/TemplatesView";
import { fixtureTemplatesTransport, parseTemplatesState } from "../templates-fixtures";
import type { TemplatesFixtureCall } from "../templates-fixtures";

/**
 * /dev/admin/templates: the Templates page (src/components/admin/templates/
 * TemplatesView.tsx) with made-up data and no login (admin rebuild 2,
 * WI-8). The bar above it is the real one.
 *
 *   ?state=full | fixed | empty | loading | error | nosettings | nocourse
 *          (templates-fixtures.ts says what each holds; default full)
 *   ?role=founder | admin | csm   who is looking (default founder); a csm
 *                                 reads everything and changes nothing
 *   ?drift=1   someone else saves Welcome (Day 1) before the next read
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

const ROLES = ["founder", "admin", "csm"] as const;
const NAMES = { founder: "Robin Hale", admin: "Jamie Rowe", csm: "Sam Lee" } as const;

function DevTemplates() {
  const params = useSearchParams();
  const role = ROLES.find((r) => r === params.get("role")) ?? "founder";
  const [transport] = useState(() =>
    fixtureTemplatesTransport(parseTemplatesState(params.get("state")), { drift: params.get("drift") === "1" }),
  );
  useEffect(() => {
    // Not declared on Window here: the 30% dev page declares it with its own call type.
    (window as unknown as { __adminCalls?: TemplatesFixtureCall[] }).__adminCalls = transport.calls;
  }, [transport]);
  return (
    <>
      <AdminTopNav member={{ full_name: NAMES[role], role }} pathname="/admin/templates" onSignOut={() => {}} />
      <TemplatesView transport={transport} role={role} />
    </>
  );
}

export default function DevTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <DevTemplates />
    </Suspense>
  );
}
