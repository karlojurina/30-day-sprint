import { NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  signState,
} from "@/lib/pkce";
import { WHOP_AUTHORIZE_URL } from "@/lib/constants";

export async function GET() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const nonce = generateState(); // replay protection, sent to Whop
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/whop/callback`;

  // Encode the PKCE verifier into the signed state parameter — avoids cookies
  // entirely. We round-trip the verifier through Whop safely via HMAC.
  const secret = process.env.PKCE_COOKIE_SECRET!;
  const state = signState(codeVerifier, secret);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.WHOP_CLIENT_ID!,
    redirect_uri: redirectUri,
    // courses:read is what lets student tokens hit /course_lesson_interactions
    // with user_id=self. Without it, Whop rejects with HTTP 400
    //   "You can only access your own course lesson interactions"
    // even though the token clearly identifies the caller. Admin/creator
    // tokens get around this by privilege, which hid the bug.
    scope: "openid profile email courses:read course_analytics:read",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${WHOP_AUTHORIZE_URL}?${params}`;
  return NextResponse.redirect(authUrl);
}
