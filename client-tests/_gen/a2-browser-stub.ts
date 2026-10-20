// Stands in for src/lib/supabase-browser.ts in the copies of
// templates-transport.ts and call-route.ts that build.mjs makes (admin
// rebuild 2, WI-8). Hand-written, like stub-admin.ts: createClient is a
// client on the database set with setBrowser (stub-server.ts's FakeDb), and
// getSharedSession answers the session set with it (no token: signed out).
// templates-page.test.mjs and admin-pages.test.mjs set it.
import { fakeClient } from "./stub-server.ts";

let db: unknown = null;
let session: { access_token: string; user: { id: string } } | null = null;

export function setBrowser(next: { db: unknown; token: string | null }) {
  db = next.db;
  session = next.token ? { access_token: next.token, user: { id: "browser-user" } } : null;
}

export function createClient() {
  return fakeClient(db as never);
}

export async function getSharedSession() {
  return session;
}
