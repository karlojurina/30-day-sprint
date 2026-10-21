"use client";

/**
 * /admin/cutover — the course switch evening's status page (cutover PRD,
 * WI-10, C15).
 *
 * Says in plain lines what the RUNNING build and the database hold, and
 * what is wrong if anything is. The build's values (home, catalog shape,
 * catalog table, Whop course) are build-time or server-only, so no other
 * page can show them; /api/admin/cutover-status reads them from inside the
 * deployment that answers. Look again after every redeploy.
 *
 * Founder + admin only, like the route behind it.
 *
 * This file reads the status; src/components/admin/cutover/CutoverView.tsx
 * shows it, in the dark look of the other admin pages since admin rebuild
 * 2's render review fix round (the page is listed in REBUILT_PAGES), with
 * the words it had. The dev page /dev/admin/cutover shows the same view
 * with made-up answers.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import { RestrictedPage } from "@/components/admin/ui";
import { CutoverView, type CutoverStatus } from "@/components/admin/cutover/CutoverView";

export default function CutoverStatusPage() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    // Its own reason: RestrictedPage's default sentence has an em dash, which no admin page shows.
    return <RestrictedPage title="Course switch" reason="Ask a founder or an admin if you need this page." />;
  }
  return <CutoverStatusBody />;
}

function CutoverStatusBody() {
  const [status, setStatus] = useState<CutoverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in. Reload the page and sign in again.");
      const res = await fetch("/api/admin/cutover-status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `The status could not be read (HTTP ${res.status}).`);
      }
      setStatus(body as CutoverStatus);
    } catch (e) {
      // Never keep an older answer on screen under a failed check.
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return <CutoverView status={status} error={error} loading={loading} checkedAt={checkedAt} onCheck={() => void load()} />;
}
