import { createHmac } from "crypto";
import {
  WHOP_TOKEN_URL,
  WHOP_USERINFO_URL,
  WHOP_API_BASE,
} from "./constants";
import type {
  WhopTokenResponse,
  WhopUserInfo,
  WhopPromoCodeRequest,
  WhopPromoCodeResponse,
  WhopLessonInteraction,
  WhopLessonInteractionsResponse,
} from "@/types/whop";

/**
 * Exchange authorization code for tokens using PKCE
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<WhopTokenResponse> {
  const res = await fetch(WHOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.WHOP_CLIENT_ID!,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Whop token exchange failed: ${error}`);
  }

  return res.json();
}

/**
 * Fetch user profile from Whop using access token
 */
export async function fetchWhopUserInfo(
  accessToken: string
): Promise<WhopUserInfo> {
  const res = await fetch(WHOP_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Whop userinfo failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Check if user has an active membership for our product
 */
export async function checkActiveMembership(
  accessToken: string
): Promise<boolean> {
  const productId = process.env.WHOP_PRODUCT_ID!;
  const res = await fetch(`${WHOP_API_BASE}/me/has_access/${productId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return false;

  const data = await res.json();
  return data.has_access === true;
}

/**
 * Fetch the user's Whop membership(s) for our product. We want the
 * membership's created_at / joined_at so the discount countdown can
 * be based on their ACTUAL Whop join date, not their first login here.
 *
 * Returns the earliest membership's joined_at as an ISO string, or null
 * if the API call fails. Silent failure — the caller should fall back
 * to the current timestamp.
 */
export async function fetchWhopMembershipJoinDate(
  accessToken: string
): Promise<string | null> {
  try {
    const productId = process.env.WHOP_PRODUCT_ID;
    const params = new URLSearchParams({ first: "10" });
    if (productId) params.set("product_id", productId);

    const res = await fetch(
      `${WHOP_API_BASE}/me/memberships?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;

    const json = await res.json();
    const list: Array<{
      created_at?: string | number;
      joined_at?: string | number;
      product_id?: string;
    }> = json?.data ?? [];
    if (list.length === 0) return null;

    // Prefer memberships matching our product, else earliest
    const matching = productId
      ? list.filter((m) => m.product_id === productId)
      : list;
    const pool = matching.length > 0 ? matching : list;

    // Find earliest joined_at / created_at
    const times = pool
      .map((m) => {
        const raw = m.joined_at ?? m.created_at;
        if (raw == null) return null;
        // Whop sometimes returns UNIX seconds as a number
        if (typeof raw === "number") return new Date(raw * 1000).toISOString();
        return raw;
      })
      .filter((t): t is string => typeof t === "string");
    if (times.length === 0) return null;
    times.sort();
    return times[0];
  } catch (err) {
    console.error("fetchWhopMembershipJoinDate failed:", err);
    return null;
  }
}

/**
 * Look up a Whop member's Discord user ID via the admin API.
 *
 * Hits /api/v2/members/{whopUserId} with WHOP_API_KEY (needs the
 * "Read Members" scope). Returns the Discord snowflake string from
 * social_accounts where service === "discord", or null if Discord
 * isn't connected / lookup fails.
 *
 * Used by the auth callback to populate students.discord_user_id at
 * signup time, and by the backfill route for existing students.
 */
export async function fetchWhopDiscordId(
  whopUserId: string
): Promise<string | null> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.whop.com/api/v2/members/${whopUserId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      social_accounts?: Array<{ service?: string; id?: string }>;
    };
    const discord = data.social_accounts?.find(
      (a) => a.service === "discord"
    );
    return discord?.id ?? null;
  } catch (err) {
    console.error("fetchWhopDiscordId failed:", err);
    return null;
  }
}

/**
 * Generate a deterministic password for a Whop user
 * Used to bridge Whop OAuth to Supabase auth
 */
export function generateStudentPassword(whopUserId: string): string {
  return createHmac("sha256", process.env.STUDENT_AUTH_SECRET!)
    .update(whopUserId)
    .digest("hex");
}

/**
 * Refresh a Whop access token using a stored refresh_token. Used by the
 * watch-sync endpoint to re-poll lesson progress without forcing the student
 * to log back in.
 */
export async function refreshWhopTokens(
  refreshToken: string
): Promise<WhopTokenResponse> {
  const res = await fetch(WHOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.WHOP_CLIENT_ID!,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Whop token refresh failed: ${error}`);
  }

  return res.json();
}

/**
 * Fetch all completed course-lesson interactions for a Whop user — using
 * the app's admin API key (`WHOP_API_KEY`).
 *
 * The 30 Day Sprint app's agent user has the
 * course_analytics:read / course_lesson_interaction:read / courses:read
 * scopes granted (Whop dashboard → app → Permissions). With those
 * scopes, the admin key bypasses the "you can only access your own
 * course lesson interactions" 400 error that student OAuth tokens hit.
 *
 * This is the path used for backfilling historical completions — Whop
 * webhooks only fire for events going forward, so anything a student
 * watched before our webhook was wired up would otherwise be invisible.
 *
 * Things we previously learned DON'T work and which this replaces:
 * - Student OAuth token + user_id filter → 400 ("only your own…")
 * - /me/course_lesson_interactions → 404
 * - Dropping user_id → 400
 */
export async function fetchCompletedLessonsAsAdmin(
  whopUserId: string
): Promise<{
  interactions: WhopLessonInteraction[];
  rawCount: number;
  completedCount: number;
}> {
  const apiKey = process.env.WHOP_API_KEY;
  const courseId = process.env.WHOP_COURSE_ID;
  if (!apiKey) {
    throw new Error(
      "WHOP_API_KEY env var not set — needed to query course_lesson_interactions as admin"
    );
  }
  if (!courseId) {
    throw new Error(
      "WHOP_COURSE_ID env var not set — needed to query course_lesson_interactions"
    );
  }

  // Fetch ALL interactions for this user+course (no `completed` filter on
  // the request — Whop's filter has been observed to silently drop rows).
  // We filter client-side after.
  const allRaw: WhopLessonInteraction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      course_id: courseId,
      user_id: whopUserId,
      first: "100",
    });
    if (cursor) params.set("after", cursor);

    const res = await fetch(
      `${WHOP_API_BASE}/course_lesson_interactions?${params}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(
        `Whop lesson interactions fetch failed (${res.status}) [user_id=${whopUserId}] [course_id=${courseId}]: ${error}`
      );
    }

    const data = (await res.json()) as WhopLessonInteractionsResponse;
    allRaw.push(...(data.data ?? []));
    if (!data.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
    if (!cursor) break;
  }

  const completed = allRaw.filter((i) => i.completed === true);
  return {
    interactions: completed,
    rawCount: allRaw.length,
    completedCount: completed.length,
  };
}

/**
 * Create a promo code on Whop
 */
export async function createWhopPromoCode(
  params: Omit<WhopPromoCodeRequest, "company_id">
): Promise<WhopPromoCodeResponse> {
  const res = await fetch(`${WHOP_API_BASE}/promo_codes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHOP_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...params,
      company_id: process.env.WHOP_COMPANY_ID!,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Whop promo code creation failed: ${error}`);
  }

  return res.json();
}
