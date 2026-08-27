"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

export function StudentGuard({ children }: { children: ReactNode }) {
  const { isStudent, isTeam, loading, authError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (isTeam) {
      router.replace("/admin");
    } else if (!isStudent) {
      // A failed auth load and a genuine non-student both arrive here with a
      // null student. Bouncing both to a bare /login made them identical on
      // screen — which is how a broken session looked exactly like being
      // logged out, with nothing to report (2026-08-27).
      if (authError) {
        router.replace(
          `/login?error=profile_load_failed&detail=${encodeURIComponent(
            authError.slice(0, 200)
          )}`
        );
      } else {
        router.replace("/login");
      }
    }
  }, [isStudent, isTeam, loading, authError, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isStudent) return null;

  return <>{children}</>;
}
