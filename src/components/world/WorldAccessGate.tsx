"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { canSeeWorld, STUDENT_HOME } from "@/lib/world/access";

/**
 * Bounces anyone not on the preview allowlist back to the dashboard.
 *
 * Renders nothing until it knows the answer, so a student who is not on the
 * list never sees a frame of the unfinished world — and, more importantly,
 * never starts downloading 4 MB of glb on a phone before being redirected.
 *
 * See lib/world/access.ts for why this is a UX gate rather than a security
 * one, and for what actually guards the sensitive things.
 */
export function WorldAccessGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { student, loading } = useAuth();
  const allowed = canSeeWorld(student?.id);

  useEffect(() => {
    if (loading) return;
    if (!allowed) router.replace(STUDENT_HOME);
  }, [loading, allowed, router]);

  if (loading || !allowed) return null;
  return <>{children}</>;
}
