"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

export function StudentGuard({ children }: { children: ReactNode }) {
  const { isStudent, isTeam, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (isTeam) {
      router.replace("/admin");
    } else if (!isStudent) {
      router.replace("/login");
    }
  }, [isStudent, isTeam, loading, router]);

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
