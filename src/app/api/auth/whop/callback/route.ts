import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  exchangeCodeForTokens,
  fetchWhopUserInfo,
  checkActiveMembership,
  generateStudentPassword,
} from "@/lib/whop";
import { PKCE_COOKIE_NAME } from "@/lib/constants";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  // Handle OAuth errors
  if (error) {
    return NextResponse.redirect(`${appUrl}/login?error=${error}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_params`);
  }

  // Read and verify PKCE cookie
  const pkceCookie = request.cookies.get(PKCE_COOKIE_NAME);
  if (!pkceCookie) {
    return NextResponse.redirect(`${appUrl}/login?error=session_expired`);
  }

  let pkceData: { codeVerifier: string; state: string };
  try {
    pkceData = JSON.parse(pkceCookie.value);
  } catch {
    return NextResponse.redirect(`${appUrl}/login?error=invalid_session`);
  }

  // CSRF check
  if (state !== pkceData.state) {
    return NextResponse.redirect(`${appUrl}/login?error=state_mismatch`);
  }

  try {
    const redirectUri = `${appUrl}/api/auth/whop/callback`;

    // 1. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      code,
      pkceData.codeVerifier,
      redirectUri
    );

    // 2. Fetch user info
    const userInfo = await fetchWhopUserInfo(tokens.access_token);

    // 3. Verify active membership
    const hasAccess = await checkActiveMembership(tokens.access_token);
    if (!hasAccess) {
      return NextResponse.redirect(`${appUrl}/login?error=no_membership`);
    }

    // 4. Create or sign in Supabase user
    const supabase = createServiceClient();
    const email = userInfo.email || `${userInfo.sub}@whop.ecomtalent.com`;
    const password = generateStudentPassword(userInfo.sub);

    // Try to sign in first (returning user)
    let userId: string;
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // New user — create account
      const { data: signUpData, error: signUpError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            whop_user_id: userInfo.sub,
            name: userInfo.name,
            avatar_url: userInfo.picture,
          },
        });

      if (signUpError) {
        console.error("Supabase user creation failed:", signUpError);
        return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
      }

      userId = signUpData.user.id;
    } else {
      userId = signInData.user.id;
    }

    // 5. Upsert student record
    const { error: upsertError } = await supabase.from("students").upsert(
      {
        whop_user_id: userInfo.sub,
        supabase_user_id: userId,
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture,
        discord_username: userInfo.username,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: "whop_user_id" }
    );

    if (upsertError) {
      console.error("Student upsert failed:", upsertError);
    }

    // 6. Create a client-side session by signing in with the anon client
    // We need to set auth cookies for the browser
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: sessionData, error: sessionError } =
      await anonClient.auth.signInWithPassword({ email, password });

    if (sessionError || !sessionData.session) {
      console.error("Session creation failed:", sessionError);
      return NextResponse.redirect(`${appUrl}/login?error=session_failed`);
    }

    // 7. Set session cookies and redirect
    const response = NextResponse.redirect(`${appUrl}/dashboard`);

    // Clear PKCE cookie
    response.cookies.delete(PKCE_COOKIE_NAME);

    // Set Supabase session cookies
    response.cookies.set("sb-access-token", sessionData.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 3600,
      path: "/",
    });

    response.cookies.set(
      "sb-refresh-token",
      sessionData.session.refresh_token,
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      }
    );

    return response;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(`${appUrl}/login?error=callback_failed`);
  }
}
