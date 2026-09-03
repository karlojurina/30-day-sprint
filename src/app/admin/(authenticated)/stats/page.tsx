import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isStatsOwner } from "@/lib/admin-auth";
import { StatsClient } from "./StatsClient";

/**
 * /admin/stats — revenue, founder-only.
 *
 * Rebuilds the per-product money tracking Whop removed from their
 * dashboard UI (gross, net, MRR, ARR, members, and any of the other
 * 64 Whop metrics), split by product, which their UI no longer offers.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SERVER COMPONENT AND WHY IT AWAITS cookies()
 *
 * All 17 other pages under (authenticated) are "use client" and are
 * STATICALLY PRERENDERED — their only gate is TeamGuard, which runs in
 * the browser and checks `isTeam` with no role awareness. That is fine
 * for a task queue. It is not fine for revenue.
 *
 * Awaiting cookies() is a request-time API, which forces this route to
 * render dynamically. Verified by build: this page emits as `ƒ` while
 * every sibling stays `○ Static`, and no .html artifact is produced.
 * Being a server component alone is NOT enough — (authenticated)/lessons
 * is a server component and it still prerenders, because it never
 * touches a request-time API.
 *
 * The gate keys on the auth user id via isStatsOwner(), NOT on
 * team_members.role. Role is mutable: any founder can grant
 * role='founder' through PATCH /api/admin/team-members/[id], which
 * would silently widen access to revenue with no error and no signal.
 * Keying on getUser() alone also means there is no team_members lookup
 * to fail open on — a null row here cannot accidentally pass the check,
 * because there is no row being consulted.
 *
 * This page renders NO revenue itself. Every number arrives from
 * GET /api/admin/stats, which is independently gated by
 * requireStatsOwner(). So even if this shell were ever served to the
 * wrong person, it would render empty.
 * ─────────────────────────────────────────────────────────────────────
 */
export default async function StatsPage() {
  const cookieStore = await cookies();

  const ssrSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op. We never refresh the session here; an expired session
          // means getUser() returns null and we redirect.
        },
      },
    },
  );

  const {
    data: { user },
  } = await ssrSupabase.auth.getUser();

  if (!user) redirect("/admin/login");

  // Logged in but not the revenue owner (e.g. a CSM). Send them back to
  // the admin home rather than /admin/login — they ARE authenticated,
  // they just have no business here. Deliberately not a 403 page: there
  // is no reason for them to learn this route exists.
  if (!isStatsOwner(user.id)) redirect("/admin");

  return <StatsClient />;
}
