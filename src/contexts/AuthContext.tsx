"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { createClient, getSharedSession } from "@/lib/supabase-browser";
import { createCallGate } from "@/lib/call-gate";
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
  /** Why the auth load failed, or null if it completed cleanly. A null
   *  student with a null authError means genuinely signed out; a null
   *  student WITH an authError means we couldn't tell. Guards must not
   *  treat those the same. */
  authError: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Nothing legitimate needs the profile more than once every 10s. Module-level
 *  so it survives remounts — see the note in lib/call-gate.ts. */
const PROFILE_MIN_INTERVAL_MS = 10_000;
const profileGate = createCallGate("fetchProfile", PROFILE_MIN_INTERVAL_MS);

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  /** Last identity we loaded a profile for. Guards against refetching on
   *  token events, which is what produced the refresh loop. */
  const lastUserIdRef = useRef<string | null>(null);

  const supabase = createClient();

  // /auth/complete owns the session handoff: it calls setSession(), which
  // holds the shared auth lock across a network round-trip. If we bootstrap
  // there too, our getSession() waits lockAcquireTimeout (5s) and then
  // STEALS the lock, and setSession dies with "Lock ... was released because
  // another request stole it". React runs child effects before parent ones,
  // so we are always the thief and setSession is always the victim — any
  // login whose round-trip exceeds 5s failed outright (2026-08-27).
  // Nothing on that route reads auth state; it hard-redirects on completion,
  // which remounts this provider clean. So sit it out.
  const isSessionHandoff = usePathname() === "/auth/complete";

  /**
   * Returns null on success, or the reason the profile could not be loaded.
   *
   * Every exit here used to be silent — an unguarded getSession(), two bare
   * returns, and a swallowing catch. StudentGuard reads a null student as
   * "not a student" and bounces to /login with no message, so a FAILED load
   * was indistinguishable from a genuine non-student. That is how a broken
   * session looked identical to a logged-out one (2026-08-27).
   */
  const fetchProfile = useCallback(async (
    trigger: string,
    opts: { gated?: boolean } = {},
  ): Promise<string | null> => {
    // Hard cap, whatever called us. Skipping is safe: the state we would have
    // written is at most PROFILE_MIN_INTERVAL_MS old. Not an error — return
    // null so the caller does not surface a failure the student can't act on.
    //
    // The BOOTSTRAP call is never gated. It runs once per page load by
    // construction and cannot loop, and gating it opens a race: if SIGNED_IN
    // fires before getSharedSession resolves, the event handler closes the
    // gate, bootstrap's call is blocked, returns null, and finish(null) ends
    // the load with student still null — which StudentGuard reads as "not a
    // student" and bounces to /login. Slow connections make that ordering
    // more likely, i.e. exactly the students already struggling (2026-08-28).
    if (opts.gated !== false && !profileGate.allow(trigger)) return null;

    // Get the current session token via the shared single-flight read, so a
    // page load makes ONE refresh attempt rather than one per caller.
    let currentSession: Session | null;
    try {
      currentSession = await getSharedSession(supabase);
    } catch (err) {
      return `getSession: ${describe(err)}`;
    }
    // Distinguish these two — the first message used to cover both and read
    // as if a session existed when usually none did.
    if (!currentSession) {
      return "session was cleared mid-load (expired token, refresh failed)";
    }
    if (!currentSession.access_token) return "session carried no access token";

    // Use API route to fetch profile (bypasses RLS issues)
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });

      if (!res.ok) return `/api/auth/me returned ${res.status}`;

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
        // Authenticated, but no team_members or students row matches. A real
        // data problem worth naming, not a quiet bounce to the login screen.
        return "signed in but no profile is linked to this account";
      }
      return null;
    } catch (err) {
      return `/api/auth/me: ${describe(err)}`;
    }
  }, [supabase]);

  useEffect(() => {
    // Stay off the auth lock while the handoff route holds it. See the
    // isSessionHandoff note above.
    if (isSessionHandoff) return;

    // Watchdog. `loading` gates a full-screen spinner in StudentGuard and
    // the root page, and getSession() can hang indefinitely when the auth
    // host is unreachable (it never rejects). Same failure that stranded a
    // student on /auth/complete for 30 min, 2026-08-25. Always resolve.
    // Single terminal path. The watchdog must survive until the WHOLE
    // load is done, not just getSession — fetchProfile calls getSession
    // again internally, so clearing on the outer promise would leave the
    // second half unguarded.
    function finish(reason?: string | null) {
      clearTimeout(watchdog);
      setAuthError(reason ?? null);
      setLoading(false);
    }
    const watchdog = setTimeout(
      () => finish("auth load timed out after 15s"),
      15_000
    );

    // Get initial session
    getSharedSession(supabase)
      .then((s) => {
        setSession(s);
        setUser(s?.user ?? null);
        lastUserIdRef.current = s?.user?.id ?? null;
        if (s?.user) {
          fetchProfile("bootstrap", { gated: false }).then(
            finish,
            (err) => finish(describe(err)),
          );
        } else {
          // Genuinely signed out. Not an error — no reason attached.
          finish();
        }
      })
      .catch((err) => {
        // Could not read the session at all. This is NOT the same as being
        // signed out, and the guard must not treat it that way.
        finish(`getSession: ${describe(err)}`);
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);

      // Re-fetch on IDENTITY changes only, never on token events.
      //
      // TOKEN_REFRESHED fires after EVERY successful refresh
      // (auth-js GoTrueClient.js:3888) and is replayed into every other tab
      // over the BroadcastChannel (GoTrueClient.js:193-196). Calling
      // fetchProfile here re-enters getSession, which refreshes AGAIN if the
      // stored session still reads as expired (GoTrueClient.js:2333-2335) —
      // an unbounded, RTT-paced refresh loop that drains Supabase's 30-token
      // burst bucket. The resulting 429 is non-retryable (lib/fetch.js:16),
      // so auth-js calls _removeSession() and the student is silently signed
      // out. That is the 2026-08-27 lockout. The identity has not changed on
      // a token event, so there is nothing to refetch.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;

      const nextUserId = s?.user?.id ?? null;
      if (nextUserId && nextUserId === lastUserIdRef.current) return;
      lastUserIdRef.current = nextUserId;

      if (s?.user) {
        void fetchProfile(event).then((reason) => setAuthError(reason ?? null));
      } else {
        setStudent(null);
        setTeamMember(null);
        setAuthError(null);
      }
    });

    return () => {
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile, isSessionHandoff]);

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
        authError,
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
