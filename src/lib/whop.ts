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
 * Generate a deterministic password for a Whop user
 * Used to bridge Whop OAuth to Supabase auth
 */
export function generateStudentPassword(whopUserId: string): string {
  return createHmac("sha256", process.env.STUDENT_AUTH_SECRET!)
    .update(whopUserId)
    .digest("hex");
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
