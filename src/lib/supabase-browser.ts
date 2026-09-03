import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";

/**
 * Lazily-built browser Supabase client.
 *
 * Never throws at import time or during static prerendering — some of
 * our layout / provider trees instantiate a client during React render,
 * and if this throws during `next build` static generation the whole
 * deploy fails. Instead, if the env vars are missing we fall back to a
 * placeholder URL. Any actual network calls made with it will fail at
 * request time (which is correct — SSG never makes requests, and a
 * properly-configured Vercel project will always have real values).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const safeUrl =
    url && /^https?:\/\//i.test(url) ? url : "https://placeholder.supabase.co";
  const safeKey = key || "placeholder-anon-key";

  return createBrowserClient(safeUrl, safeKey, {
    global: { fetch: rateLimitSafeFetch },
  });
}

/** Set when /auth/v1/token has 429'd; suppresses further calls until it lapses. */
let tokenRateLimitedUntil = 0;

/**
 * A 429 on token refresh must NOT sign the student out.
 *
 * auth-js only treats 502/503/504 as retryable (auth-js lib/fetch.js:16). A 429
 * therefore becomes a fatal AuthApiError, and _callRefreshToken responds by
 * calling _removeSession() (GoTrueClient.js:3897-3898) — so ONE rate-limited
 * refresh silently deletes the session and bounces the student to /login.
 * That is the 2026-08-27 lockout, exactly.
 *
 * We hand auth-js a 503 instead: retryable, session preserved. The cooldown
 * matters — without it auth-js would retry straight back into a drained bucket
 * (GoTrueClient.js:3724-3740); with it those retries cost no network at all.
 * Also covers a Cloudflare 429, whose HTML body would otherwise throw an
 * equally-fatal AuthUnknownError (lib/fetch.js:27-32).
 */
async function rateLimitSafeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  // Match the REFRESH grant only. A bare "/auth/v1/token" also matches
  // grant_type=password, so an armed cooldown would reject a correct password
  // for 60s — /admin/login is a client-side nav, so the module cooldown survives
  // it and the error renders as "Invalid email or password". The shield only
  // needs the refresh path: _removeSession() on a fatal error is reached solely
  // from _callRefreshToken (GoTrueClient.js:3897-3898).
  const isTokenEndpoint = url.includes("/auth/v1/token?grant_type=refresh_token");

  const backOff = () =>
    new Response('{"error":"rate_limited"}', {
      status: 503,
      headers: { "content-type": "application/json" },
    });

  if (isTokenEndpoint && Date.now() < tokenRateLimitedUntil) return backOff();

  const res = await fetch(input as RequestInfo, init);

  if (isTokenEndpoint && res.status === 429) {
    // Supabase's /token bucket refills at ~0.5/s from a capacity of 30.
    tokenRateLimitedUntil = Date.now() + 60_000;
    return backOff();
  }
  return res;
}

/**
 * Did this Supabase auth call die because something else took the shared
 * auth lock? Web Locks are per-ORIGIN, so any other page or tab on this
 * app can steal it after `lockAcquireTimeout` (5s). Retryable — unlike a
 * bad token or an unreachable host. See "The auth lock steal" in CONTEXT.md.
 */
export function isLockContention(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name.includes("LockAcquireTimeout") ||
    /stole it|acquire timeout/i.test(message)
  );
}

let sessionInFlight: Promise<Session | null> | null = null;

/**
 * One shared in-flight getSession() read for the whole app.
 *
 * CORRECTION (2026-08-28): this was originally written believing concurrent
 * getSession() calls each fired their own token refresh. They never did.
 * @supabase/ssr caches a single browser client (createBrowserClient.js:8,
 * :11-15), GoTrueClient single-flights refresh via `refreshingDeferred`
 * (GoTrueClient.js:3875-3877), and __loadSession re-reads storage inside the
 * lock so later callers see the session the first one just refreshed
 * (GoTrueClient.js:2307-2337). N concurrent calls have always produced at
 * most ONE POST to /auth/v1/token.
 *
 * Keep this: it still avoids redundant cookie reads and lock acquisitions.
 * But do NOT rely on it to prevent a refresh storm — it cannot, because it
 * only merges CONCURRENT callers, and the real loop was sequential
 * (TOKEN_REFRESHED -> fetchProfile -> getSession -> refresh -> repeat).
 * That loop is fixed in AuthContext, and a 429 is defanged in createClient.
 */
export function getSharedSession(
  client: ReturnType<typeof createClient>
): Promise<Session | null> {
  if (!sessionInFlight) {
    sessionInFlight = withLockRetry(() => client.auth.getSession())
      .then(({ data }) => data.session)
      .finally(() => {
        sessionInFlight = null;
      });
  }
  return sessionInFlight;
}

/** Run a Supabase auth call, retrying only if the lock was stolen. */
export async function withLockRetry<T>(
  fn: () => Promise<T>,
  attempts = 2
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isLockContention(err)) throw err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw last;
}
