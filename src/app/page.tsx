"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { isStudent, isTeam, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (isTeam) {
      router.replace("/admin");
    } else if (isStudent) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [isStudent, isTeam, loading, router]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center min-h-screen"
    >
      <div
        aria-hidden="true"
        className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
