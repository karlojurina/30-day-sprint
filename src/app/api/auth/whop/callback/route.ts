import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  exchangeCodeForTokens,
  fetchWhopUserInfo,
  checkActiveMembership,
  fetchWhopMembershipJoinDate,
  fetchWhopDiscordId,
  generateStudentPassword,
} from "@/lib/whop";
import { unsignState } from "@/lib/pkce";
import { syncWatchProgress } from "@/app/api/student/_lib/watch-sync";
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

  // Verify signed state and extract the PKCE verifier. No cookie required —
  // the verifier rides inside the HMAC-signed state parameter.
  const secret = process.env.PKCE_COOKIE_SECRET!;
  const unsigned = unsignState(state, secret);
  if (!unsigned) {
    return NextResponse.redirect(`${appUrl}/login?error=state_invalid`);
  }
  const codeVerifier = unsigned.codeVerifier;

  try {
    const redirectUri = `${appUrl}/api/auth/whop/callback`;

    // 1. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      code,
      codeVerifier,
      redirectUri
    );

    // 2. Fetch user info
    const userInfo = await fetchWhopUserInfo(tokens.access_token);

    // 3. Verify active membership (bypass for whitelisted test users).
    //    Two whitelists, both optional, both comma-separated:
    //      WHOP_BYPASS_USER_IDS — match on whop user id (e.g. user_XYZ…)
    //      WHOP_BYPASS_EMAILS   — match on the email Whop returns
    //    Either match skips the active-membership check entirely, so a
    //    test account without a paid membership can still log in.
    const bypassUsers = process.env.WHOP_BYPASS_USER_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
    const bypassEmails = process.env.WHOP_BYPASS_EMAILS?.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) ?? [];
    const isBypassed =
      bypassUsers.includes(userInfo.sub) ||
      (userInfo.email && bypassEmails.includes(userInfo.email.toLowerCase()));

    if (!isBypassed) {
      const hasAccess = await checkActiveMembership(tokens.access_token);
      if (!hasAccess) {
        return NextResponse.redirect(
          `${appUrl}/login?error=no_membership&detail=${encodeURIComponent(`Your Whop user ID: ${userInfo.sub} · email: ${userInfo.email ?? "(unknown)"}`)}`
        );
      }
    }

    // 4. Create or sign in Supabase user
    // We use a DEDICATED client for auth operations because
    // signInWithPassword mutates the client's auth state to the user's
    // JWT, which would then apply RLS to subsequent DB queries and hit
    // the self-referencing team_members policy → infinite recursion.
    const authClient = createServiceClient();
    // Always use a Whop-specific synthetic email for the Supabase Auth
    // account, keyed by whop_user_id. This prevents collisions when a
    // Whop account shares an email with an existing Supabase user
    // (e.g. the team admin) — each Whop user gets a distinct auth row.
    // The student's real email is still stored separately on the
    // students table for display.
    const email = `${userInfo.sub}@whop.ecomtalent.com`;
    const password = generateStudentPassword(userInfo.sub);

    // Try to sign in first (returning user)
    let userId: string;
    const { data: signInData, error: signInError } =
      await authClient.auth.signInWithPassword({ email, password });

    if (signInError) {
      // New user — create account (admin API doesn't affect auth state)
      const { data: signUpData, error: signUpError } =
        await authClient.auth.admin.createUser({
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

    // 5. Upsert student record using a FRESH service-role client so the
    //    query runs with service-role permissions (bypasses RLS).
    const supabase = createServiceClient();

    // Check if student already exists before upserting, so we can set
    // joined_at correctly for new students (from their Whop membership)
    // without overwriting it on returning students.
    const { data: existing } = await supabase
      .from("students")
      .select("id, joined_at")
      .eq("whop_user_id", userInfo.sub)
      .single();

    // Best-effort Discord ID lookup — null if user hasn't connected
    // Discord on Whop, or if the API call fails. Doesn't block signup.
    const discordUserId = await fetchWhopDiscordId(userInfo.sub);

    const baseFields = {
      whop_user_id: userInfo.sub,
      supabase_user_id: userId,
      email: userInfo.email,
      name: userInfo.name,
      avatar_url: userInfo.picture,
      discord_username: userInfo.username,
      discord_user_id: discordUserId,
      last_active_at: new Date().toISOString(),
      whop_access_token: tokens.access_token ?? null,
      whop_refresh_token: tokens.refresh_token ?? null,
    };

    let upsertFields: Record<string, unknown> = baseFields;

    if (!existing) {
      // New student — fetch actual Whop membership join date so the
      // 14-day discount window is counted from when they joined Whop,
      // not from their first login here.
      const whopJoinDate = await fetchWhopMembershipJoinDate(
        tokens.access_token
      );
      upsertFields = {
        ...baseFields,
        joined_at: whopJoinDate ?? new Date().toISOString(),
      };
    }

    const { data: upsertedStudent, error: upsertError } = await supabase
      .from("students")
      .upsert(upsertFields, { onConflict: "whop_user_id" })
      .select("id")
      .single();

    if (upsertError) {
      console.error("Student upsert failed:", upsertError);
    }

    // 5b. Initial watch-progress sync with a short timeout. We don't want
    //     to block the redirect forever, but we do want to capture Whop
    //     errors into whop_last_sync_error so they're visible in the UI.
    if (upsertedStudent?.id) {
      const syncPromise = syncWatchProgress({
        studentId: upsertedStudent.id,
        whopUserId: userInfo.sub,
      });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2500)
      );
      // Whichever finishes first — sync result or timeout. Errors are
      // already persisted to DB inside syncWatchProgress's catch.
      await Promise.race([
        syncPromise.catch((err) => {
          console.error("Initial sync failed:", err);
          return null;
        }),
        timeoutPromise,
      ]);
    }

    // 6. Create a session for the browser
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: sessionData, error: sessionError } =
      await anonClient.auth.signInWithPassword({ email, password });

    if (sessionError || !sessionData.session) {
      console.error("Session creation failed:", sessionError);
      return NextResponse.redirect(`${appUrl}/login?error=session_failed`);
    }

    // 7. Pass session to client-side handler via temporary cookie
    const response = NextResponse.redirect(`${appUrl}/auth/complete`);

    response.cookies.set(
      "pending_session",
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      }),
      {
        httpOnly: false, // Client JS needs to read this
        secure: true,
        sameSite: "lax",
        maxAge: 60, // Expires in 1 minute
        path: "/",
      }
    );

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("OAuth callback error:", message);
    return NextResponse.redirect(
      `${appUrl}/login?error=callback_failed&detail=${encodeURIComponent(message)}`
    );
  }
}
