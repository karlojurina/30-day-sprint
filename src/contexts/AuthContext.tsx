"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student, TeamMember } from "@/types/database";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  student: Student | null;
  /** Patch the student row locally without refetching from the API.
   *  Used by StudentContext after actions that mutate students.*
   *  fields. */
  setStudent: (s: Student | null) => void;
  teamMember: TeamMember | null;
  isStudent: boolean;
  isTeam: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const fetchProfile = useCallback(
    async (_userId: string) => {
      // Get the current session token
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;

      // Use API route to fetch profile (bypasses RLS issues)
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${currentSession.access_token}` },
        });

        if (!res.ok) return;

        const data = await res.json();

        if (data.role === "team") {
          setTeamMember(data.profile);
          setStudent(null);
        } else if (data.role === "student") {
          setStudent(data.profile);
          setTeamMember(null);
        } else {
          setTeamMember(null);
          setStudent(null);
        }
      } catch {
        // Silently fail — user will just not be recognized
      }
    },
    [supabase]
  );

  useEffect(() => {
    // Watchdog. `loading` gates a full-screen spinner in StudentGuard and
    // the root page, and getSession() can hang indefinitely when the auth
    // host is unreachable (it never rejects). Same failure that stranded a
    // student on /auth/complete for 30 min, 2026-08-25. Always resolve.
    const watchdog = setTimeout(() => setLoading(false), 15_000);
    // Single terminal path. The watchdog must survive until the WHOLE
    // load is done, not just getSession — fetchProfile calls getSession
    // again internally, so clearing on the outer promise would leave the
    // second half unguarded.
    const finish = () => {
      clearTimeout(watchdog);
      setLoading(false);
    };

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          fetchProfile(s.user.id).finally(finish);
        } else {
          finish();
        }
      })
      .catch(() => {
        // Unreachable auth host / network failure. Fall through as signed
        // out rather than spinning forever — the guard sends them to /login.
        finish();
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id);
      } else {
        setStudent(null);
        setTeamMember(null);
      }
    });

    return () => {
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setStudent(null);
    setTeamMember(null);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        student,
        setStudent,
        teamMember,
        isStudent: !!student,
        isTeam: !!teamMember,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
