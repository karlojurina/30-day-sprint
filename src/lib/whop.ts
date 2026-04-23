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
 * Fetch all completed course-lesson interactions for a Whop user.
 *
 * Uses the user's OAuth access token directly and passes
 * user_id=<their stored whop_user_id> as a filter. This is the
 * original implementation that worked for the admin/creator account:
 * admin OAuth tokens have creator privileges that unlock the endpoint.
 *
 * Important caveat: regular student OAuth tokens are REJECTED by this
 * endpoint with HTTP 400 "you can only access your own course lesson
 * interactions" regardless of scopes — we've confirmed this experimentally.
 * For real students, rely on the webhook path (Whop → our
 * /api/webhooks/whop) which writes to student_lesson_completions on
 * course_lesson_interaction.completed events.
 *
 * Previous attempts we learned DON'T work:
 * - Dropping user_id (400)
 * - /me/course_lesson_interactions (404)
 * - Student OAuth token with courses:read scope granted (400)
 * - WHOP_API_KEY admin key — its agent user lacks course_analytics:read
 *   on the course, so this returned 403
 */
export async function fetchCompletedLessons(
  accessToken: string,
  whopUserId: string
): Promise<WhopLessonInteraction[]> {
  const courseId = process.env.WHOP_COURSE_ID;
  if (!courseId) {
    throw new Error(
      "WHOP_COURSE_ID env var not set — needed to query course_lesson_interactions"
    );
  }

  const all: WhopLessonInteraction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      completed: "true",
      course_id: courseId,
      user_id: whopUserId,
      first: "100",
    });
    if (cursor) params.set("after", cursor);

    const res = await fetch(
      `${WHOP_API_BASE}/course_lesson_interactions?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(
        `Whop lesson interactions fetch failed (${res.status}) [user_id=${whopUserId}] [course_id=${courseId}]: ${error}`
      );
    }

    const data = (await res.json()) as WhopLessonInteractionsResponse;
    all.push(...(data.data ?? []));
    if (!data.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
    if (!cursor) break;
  }

  return all;
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
