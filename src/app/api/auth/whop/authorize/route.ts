import { NextResponse } from "next/server";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "@/lib/pkce";
import { WHOP_AUTHORIZE_URL, PKCE_COOKIE_NAME, PKCE_COOKIE_MAX_AGE } from "@/lib/constants";

export async function GET() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const nonce = generateState(); // Random string for replay protection
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/whop/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.WHOP_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${WHOP_AUTHORIZE_URL}?${params}`;

  // Store PKCE verifier and state in a cookie
  const cookieValue = JSON.stringify({ codeVerifier, state });
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(PKCE_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PKCE_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}
