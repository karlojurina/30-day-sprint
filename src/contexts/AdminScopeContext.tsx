"use client";

/**
 * Admin scope toggle — global state for "which cohort of students am I
 * looking at right now?"
 *
 *   - "cohort" (default): launch cohort only, joined >= ADMIN_STUDENT_JOIN_CUTOFF
 *   - "all": every student in the DB, including pre-launch / legacy
 *
 * Persisted in localStorage so the choice survives navigation +
 * page reloads. Dashboard, students list, and insights all subscribe
 * to this context and re-query when it changes. Pages that don't
 * care about scope (tasks, lessons, settings) simply ignore it.
 *
 * v75.13 — added when we realized the dashboard sparkline counts
 * included legacy customers (Michael, etc.) while /admin/students
 * hid them via ADMIN_STUDENT_JOIN_CUTOFF, producing two different
 * "active students" numbers that didn't reconcile.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SCOPE,
  parseScope,
  type Scope,
} from "@/lib/admin/metrics-definitions";

const STORAGE_KEY = "admin.scope";

interface AdminScopeContextValue {
  scope: Scope;
  setScope: (scope: Scope) => void;
}

const AdminScopeContext = createContext<AdminScopeContextValue | null>(null);

export function AdminScopeProvider({ children }: { children: ReactNode }) {
  // Start with DEFAULT_SCOPE for SSR safety; hydrate from localStorage
  // after mount. The 1-frame mismatch is invisible because every
  // admin page that reads scope is itself a "use client" component
  // doing its initial fetch inside useEffect.
  const [scope, setScopeState] = useState<Scope>(DEFAULT_SCOPE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setScopeState(parseScope(saved));
  }, []);

  const setScope = useCallback((next: Scope) => {
    setScopeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return (
    <AdminScopeContext.Provider value={{ scope, setScope }}>
      {children}
    </AdminScopeContext.Provider>
  );
}

export function useAdminScope(): AdminScopeContextValue {
  const ctx = useContext(AdminScopeContext);
  if (!ctx) {
    throw new Error("useAdminScope must be used inside <AdminScopeProvider>");
  }
  return ctx;
}
