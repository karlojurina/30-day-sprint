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
