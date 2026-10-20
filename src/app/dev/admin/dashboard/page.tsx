import { DevDashboard } from "./DevDashboard";
import type { DevRole } from "./DevDashboard";
import { DASH_FIXTURE_REFRESH, DASH_FIXTURE_STATES } from "./fixtures";

/**
 * /dev/admin/dashboard: the Dashboard (src/components/admin/dashboard/DashboardView.tsx)
 * with made-up reads and no login (admin rebuild 2, WI-2). The bar above it is
 * the real one, for a made-up member. Development only (the dev layout).
 *
 *   ?state=full | renewed | empty | loading | error | partial   (default full;
 *          fixtures.ts says what each one holds)
 *   ?role=founder | admin | csm   whose page (default founder): a csm has no
 *                                 Refresh, as the refresh route refuses one
 *   ?refresh=ok | fail | partial  what Refresh answers (default ok)
 *
 * The calls the page made are on window.__dashCalls, for world-tests.
 */

const ROLES: DevRole[] = ["founder", "admin", "csm"];

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

export default async function DevDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <DevDashboard
      state={pick(params.state, DASH_FIXTURE_STATES, "full")}
      role={pick(params.role, ROLES, "founder")}
      refresh={pick(params.refresh, DASH_FIXTURE_REFRESH, "ok")}
    />
  );
}
