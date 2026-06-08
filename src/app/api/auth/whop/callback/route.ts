import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  exchangeCodeForTokens,
  fetchWhopUserInfo,
  checkActiveMembershipDiagnostic,
  fetchWhopMembershipJoinDate,
  fetchWhopDiscordId,
  generateStudentPassword,
} from "@/lib/whop";
import {
  fetchActiveMembershipForUser,
  mapStatus,
  toIso,
} from "@/lib/whop-members";
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
      // DB-first check. The Whop membership webhook upserts a row with
      // membership_status whenever a subscription activates / cancels,
      // so our table is the freshest source of truth — and it's
      // independent of Whop's API endpoint quirks.
      const supabaseAdmin = createServiceClient();
      const { data: existingStudent } = await supabaseAdmin
        .from("students")
        .select("membership_status")
        .eq("whop_user_id", userInfo.sub)
        .maybeSingle();

      const dbHasActive =
        existingStudent?.membership_status === "active" ||
        existingStudent?.membership_status === "past_due";

      let dbStatus = existingStudent?.membership_status ?? "(no row)";

      // Only hit Whop's API if the DB doesn't already say active. This
      // handles the rare race where a brand-new student tries to log
      // in before their webhook has fired.
      let whopHasAccess = false;
      let whopSummary = "(skipped — db said active)";
      if (!dbHasActive) {
        const diagnostic = await checkActiveMembershipDiagnostic(
          tokens.access_token
        );
        whopHasAccess = diagnostic.hasAccess;
        console.error("membership check (Whop fallback)", {
          user: userInfo.sub,
          email: userInfo.email,
          dbStatus,
          configured: diagnostic.configured,
          fetchStatus: diagnostic.fetchStatus,
          fetchError: diagnostic.fetchError,
          memberships: diagnostic.memberships,
        });
        whopSummary = diagnostic.memberships.length
          ? diagnostic.memberships
              .map(
                (m) =>
                  `${m.id ?? "?"}(status=${m.status ?? "?"},valid=${String(
                    m.valid
                  )},product=${m.product_id ?? "—"},plan=${m.plan_id ?? "—"})`
              )
              .join(" | ")
          : `no memberships (fetch ${diagnostic.fetchStatus}${
              diagnostic.fetchError ? `, ${diagnostic.fetchError}` : ""
            })`;
      }

      // v75.10 — self-heal fallback. The user-scoped /me/memberships
      // call above returns 404 for legacy customers (Whop API
      // quirk; reliably reproduced for michael.buratynskyi@gmail.com
      // who's been paying since Dec 2025). Before blocking, try the
      // admin-side v2 API (same path our daily sync-whop cron uses).
      // If we find an active membership server-to-server, upsert
      // the student row inline and let them in. That fixes every
      // legacy customer on first login - no backfill script needed.
      let selfHealed = false;
      if (!dbHasActive && !whopHasAccess) {
        const adminRow = await fetchActiveMembershipForUser(userInfo.sub);
        if (adminRow) {
          // v75.30: also stamp first_paid_at on this INSERT path.
          // The v75.10 self-heal branch is the FIRST insert site;
          // without first_paid_at here, the later v75.26 stamp at
          // line ~283 is skipped (because `existing` is truthy
          // after self-heal runs). Net regression: every legacy
          // self-healed customer was left with first_paid_at=NULL
          // until nightly sync — they'd then be hard-blocked from
          // claiming the discount with the "contact support"
          // message.
          //
          // Pre-fetch existing.first_paid_at so we ONLY set it on
          // a real INSERT, not on UPDATE. Otherwise we'd overwrite
          // a returning customer's true original signup date with
          // the current renewal date and re-open their discount
          // window — exactly the leak v75.20 was meant to prevent.
          const healAnchor =
            toIso(adminRow.created_at) ?? new Date().toISOString();
          const { data: existingHealRow } = await supabaseAdmin
            .from("students")
            .select("first_paid_at")
            .eq("whop_user_id", userInfo.sub)
            .maybeSingle();

          const healPayload: Record<string, unknown> = {
            whop_user_id: userInfo.sub,
            whop_membership_id: adminRow.id,
            email: adminRow.email ?? userInfo.email ?? null,
            // Whop's v2 row has no `username` field. Fall back
            // to the OAuth userInfo.name.
            name: userInfo.name ?? null,
            membership_status: mapStatus(adminRow),
            joined_at: healAnchor,
            // v79: stamp plan_id from the admin row so the new
            // user is correctly classified as paying / free from
            // first login. Without this they'd default to NULL
            // (non-paying) until the next nightly sync.
            whop_plan_id: adminRow.plan ?? null,
          };
          if (!existingHealRow?.first_paid_at) {
            healPayload.first_paid_at = healAnchor;
          }

          const { error: healError } = await supabaseAdmin
            .from("students")
            .upsert(healPayload, { onConflict: "whop_user_id" });
          if (healError) {
            console.error(
              `[whop-callback] self-heal upsert failed for ${userInfo.sub}: ${healError.message}`,
            );
          } else {
            selfHealed = true;
            console.info(
              `[whop-callback] self-healed student row for ${userInfo.sub} (${userInfo.email}) from admin API`,
            );
            // Update dbStatus for the block message in case the
            // upsert succeeded but mapStatus reported non-active
            // (shouldn't happen since we only upsert on active /
            // past_due, but log accurately just in case).
            dbStatus = mapStatus(adminRow);
          }
        }
      }

      if (!dbHasActive && !whopHasAccess && !selfHealed) {
        const detail = `user=${userInfo.sub} email=${userInfo.email ?? "(unknown)"} db_status=${dbStatus} whop=[${whopSummary}]`;
        return NextResponse.redirect(
          `${appUrl}/login?error=no_membership&detail=${encodeURIComponent(detail)}`
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

    const now = new Date().toISOString();
    // v46 — students table is identity-only. Whop tokens go to
    // student_whop_sync; first_sprint_login_at goes to student_milestones.
    // See CLAUDE.md → "Table-level bounded contexts".
    const baseFields = {
      whop_user_id: userInfo.sub,
      supabase_user_id: userId,
      email: userInfo.email,
      name: userInfo.name,
      avatar_url: userInfo.picture,
      discord_username: userInfo.username,
      discord_user_id: discordUserId,
      last_active_at: now,
    };

    let upsertFields: Record<string, unknown> = baseFields;

    if (!existing) {
      // New student — fetch actual Whop membership join date so the
      // 14-day discount window is counted from when they joined Whop,
      // not from their first login here.
      const whopJoinDate = await fetchWhopMembershipJoinDate(
        tokens.access_token
      );
      // v75.26: also set first_paid_at on INSERT. Before this fix,
      // first_paid_at stayed NULL until the nightly Whop sync ran,
      // so a customer who paid + logged in today was invisible to
      // every cohort-scoped admin surface for up to 24h AND could
      // bypass the discount eligibility gate via the joined_at
      // fallback. Setting it here closes both gaps.
      //
      // Only set on INSERT (the !existing branch) — never on UPDATE,
      // so a returning customer's original first_paid_at is preserved.
      // The Whop sync runner separately enforces this invariant.
      const anchorIso = whopJoinDate ?? new Date().toISOString();
      upsertFields = {
        ...baseFields,
        joined_at: anchorIso,
        first_paid_at: anchorIso,
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

    // v46 — write Whop tokens to student_whop_sync (was on students).
    if (upsertedStudent) {
      await supabase
        .from("student_whop_sync")
        .upsert(
          {
            student_id: upsertedStudent.id,
            access_token: tokens.access_token ?? null,
            refresh_token: tokens.refresh_token ?? null,
            updated_at: now,
          },
          { onConflict: "student_id" }
        );

      // v46 — first_sprint_login_at: stamp once on first successful
      // callback, never overwrite. Powers the has_logged_into_app
      // template trigger. Lives on student_milestones (was on students).
      const { data: existingMilestones } = await supabase
        .from("student_milestones")
        .select("first_sprint_login_at")
        .eq("student_id", upsertedStudent.id)
        .maybeSingle();
      await supabase
        .from("student_milestones")
        .upsert(
          {
            student_id: upsertedStudent.id,
            first_sprint_login_at:
              existingMilestones?.first_sprint_login_at ?? now,
            updated_at: now,
          },
          { onConflict: "student_id" }
        );
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
