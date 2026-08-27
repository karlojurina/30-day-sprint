import { createBrowserClient } from "@supabase/ssr";

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

  return createBrowserClient(safeUrl, safeKey);
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
