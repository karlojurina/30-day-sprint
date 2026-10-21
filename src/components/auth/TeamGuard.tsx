"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import tokens from "@/components/admin/admin-tokens.module.css";

/**
 * The admin's sign-in check: while the session is read, a loading screen;
 * no team member, off to /admin/login; else the page.
 *
 * The loading screen is the frame's own dark ground (the token class,
 * Gunpowder #18181A) with an empty 60px bar where the top bar comes, inside
 * .admin-shell (which turns off the student side's paper grain), so the
 * window never flashes the light look between the sign-in and the page
 * (admin rebuild 2, the review's fix round). The bar is AdminTopNav's height.
 * No spinner: the session read is quick, and the kit shows shapes, not
 * spinners, while a page loads.
 */
export function TeamGuard({ children }: { children: ReactNode }) {
  const { isTeam, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!isTeam) {
      router.replace("/admin/login");
    }
  }, [isTeam, loading, router]);

  if (loading) {
    return (
      <div className="admin-shell">
        <div className={tokens.tokens} style={{ minHeight: "100vh" }} data-team-guard="loading">
          <div aria-hidden="true" style={{ height: 60, borderBottom: "1px solid var(--color-border)" }} />
          <p role="status" className="sr-only">
            Loading
          </p>
        </div>
      </div>
    );
  }

  if (!isTeam) return null;

  return <>{children}</>;
}
