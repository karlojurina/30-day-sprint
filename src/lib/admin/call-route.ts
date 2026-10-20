"use client";

import { createClient, getSharedSession } from "@/lib/supabase-browser";
import type { Answer } from "@/lib/admin/admin-transport";

/**
 * One call to an admin route with the signed-in team member's bearer token,
 * for the Templates and Team pages (admin rebuild 2, WI-8 and WI-9). The
 * same contract as admin-transport.ts's calls: nothing throws, every answer
 * is `{ ok: true, data }` or `{ ok: false, error }`, where `error` is the
 * route's own sentence or one of the three below.
 *
 * Its own file so the 30% page's transport (admin-transport.ts) stays as the
 * 30% lane left it; the sentences are the same.
 */

const NO_SERVER = "Couldn't reach the server. Check the connection and try again.";
const SIGNED_OUT = "You are signed out. Sign in again to go on.";
const NOT_ALLOWED = "Your team account can't do this.";

export async function callRoute<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Answer<T>> {
  let token: string;
  try {
    const session = await getSharedSession(createClient());
    if (!session) return { ok: false, status: 401, error: SIGNED_OUT };
    token = session.access_token;
  } catch {
    return { ok: false, status: 0, error: NO_SERVER };
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: NO_SERVER };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  if (res.status === 401) return { ok: false, status: 401, error: SIGNED_OUT };
  if (res.status === 403) return { ok: false, status: 403, error: NOT_ALLOWED };
  const said = json && typeof json.error === "string" ? json.error.trim() : "";
  return {
    ok: false,
    status: res.status,
    error: said || `The server answered with an error (${res.status}). Try again.`,
  };
}
