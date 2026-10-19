import { NextRequest, NextResponse, after } from "./stub-server.ts";
import { createServiceClient } from "./stub-server.ts";
import {
  exchangeCodeForTokens,
  fetchWhopUserInfo,
  checkActiveMembershipDiagnostic,
  fetchWhopMembershipJoinDate,
  fetchWhopDiscordId,
  generateStudentPassword,
} from "./stub-server.ts";
import {
  fetchActiveMembershipForUser,
  mapStatus,
  toIso,
} from "./stub-server.ts";
import { unsignState } from "./pkce.ts";
import { whopLoginMayProceed } from "./student-app-gate.ts";
import { syncWatchProgress } from "./watch-sync.ts";
import { evaluateAchievements } from "./stub-server.ts";
import { updateStudentStreak } from "./stub-server.ts";
import { createClient } from "./stub-server.ts";

/**
 * login-3 (2026-10-20): the one sign-in error that means this Whop user has
 * no account yet. auth-js reports it with the code invalid_credentials
 * (status 400); an auth server too old for codes sends only the message. A
 * rate limit (429 in a login rush), a 5xx or a network failure is not a
 * missing account: creating one then failed as "already registered" and the
 * student read "Authentication failed".
 */
function isNoAccountYet(error: { code?: string; message?: string }): boolean {
  if (error.code) return error.code === "invalid_credentials";
  return /invalid login credentials/i.test(error.message ?? "");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (error) {
    return NextResponse.redirect(`${appUrl}/login?error=${error}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_params`);
  }

  const secret = process.env.PKCE_COOKIE_SECRET!;
  const unsigned = unsignState(state, secret);
  if (!unsigned) {
    return NextResponse.redirect(`${appUrl}/login?error=state_invalid`);
  }
  const codeVerifier = unsigned.codeVerifier;

  try {
    const redirectUri = `${appUrl}/api/auth/whop/callback`;

    const tokens = await exchangeCodeForTokens(
      code,
      codeVerifier,
      redirectUri
    );

    const userInfo = await fetchWhopUserInfo(tokens.access_token);

    if (!(await whopLoginMayProceed(createServiceClient(), userInfo.sub))) {
      console.warn(`[whop-callback] student app closed, refused ${userInfo.sub}`);
      return NextResponse.redirect(`${appUrl}/login?error=app_closed`);
    }

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

      let whopHasAccess = false;
      let whopSummary = "(skipped, db said active)";
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
                  )},product=${m.product_id ?? "none"},plan=${m.plan_id ?? "none"})`
              )
              .join(" | ")
          : `no memberships (fetch ${diagnostic.fetchStatus}${
              diagnostic.fetchError ? `, ${diagnostic.fetchError}` : ""
            })`;
      }

      let selfHealed = false;
      if (!dbHasActive) {
        const adminRow = await fetchActiveMembershipForUser(userInfo.sub);
        if (adminRow) {
          const healAnchor =
            toIso(adminRow.created_at) ?? new Date().toISOString();
          const { data: existingHealRow } = await supabaseAdmin
            .from("students")
            .select("first_paid_at, joined_at, name")
            .eq("whop_user_id", userInfo.sub)
            .maybeSingle();

          const healPayload: Record<string, unknown> = {
            whop_user_id: userInfo.sub,
            whop_membership_id: adminRow.id,
            email: adminRow.email ?? userInfo.email ?? null,
            name: userInfo.name ?? existingHealRow?.name ?? null,
            membership_status: mapStatus(adminRow),
            canceled_at: null,
            whop_plan_id: adminRow.plan ?? null,
          };
          if (!existingHealRow?.joined_at) {
            healPayload.joined_at = healAnchor;
          }
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

    const authClient = createServiceClient();
    const email = `${userInfo.sub}@whop.ecomtalent.com`;
    const password = generateStudentPassword(userInfo.sub);

    let userId: string;
    let signIn = await authClient.auth.signInWithPassword({ email, password });
    if (signIn.error && !isNoAccountYet(signIn.error)) {
      console.warn(
        `[whop-callback] sign-in for ${userInfo.sub} failed (${signIn.error.message}), trying once more`,
      );
      await new Promise((r) => setTimeout(r, 500));
      signIn = await authClient.auth.signInWithPassword({ email, password });
    }
    const { data: signInData, error: signInError } = signIn;

    if (signInError && !isNoAccountYet(signInError)) {
      console.error("Supabase sign-in failed twice, not a missing account:", signInError);
      return NextResponse.redirect(
        `${appUrl}/login?error=login_busy&detail=${encodeURIComponent(
          `server: ${signInError.message}`.slice(0, 200)
        )}`
      );
    }

    if (signInError) {
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
        return NextResponse.redirect(
          `${appUrl}/login?error=auth_failed&detail=${encodeURIComponent(
            `server: ${signUpError.message}`.slice(0, 200)
          )}`
        );
      }

      userId = signUpData.user.id;
    } else {
      userId = signInData.user.id;
    }

    const supabase = createServiceClient();

    const { data: existing } = await supabase
      .from("students")
      .select("id, joined_at")
      .eq("whop_user_id", userInfo.sub)
      .single();

    const discordUserId = await fetchWhopDiscordId(userInfo.sub);

    const now = new Date().toISOString();
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
      const whopJoinDate = await fetchWhopMembershipJoinDate(
        tokens.access_token
      );
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

    if (upsertedStudent?.id) {
      const syncPromise = syncWatchProgress({
        studentId: upsertedStudent.id,
        whopUserId: userInfo.sub,
      }).then(async (syncResult) => {
        try {
          if (syncResult.syncedCount > 0) {
            await updateStudentStreak(supabase, upsertedStudent.id);
          }
          await evaluateAchievements(supabase, upsertedStudent.id);
        } catch (err) {
          console.error("[callback] evaluateAchievements failed:", err);
        }
        return syncResult;
      });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2500)
      );
      await Promise.race([
        syncPromise.catch((err) => {
          console.error("Initial sync failed:", err);
          return null;
        }),
        timeoutPromise,
      ]);
      try {
        after(syncPromise.catch(() => null));
      } catch (err) {
        console.error("[callback] after() unavailable, the sync may not finish:", err);
      }
    }

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: sessionData, error: sessionError } =
      await anonClient.auth.signInWithPassword({ email, password });

    if (sessionError || !sessionData.session) {
      console.error("Session creation failed:", sessionError);
      const detail = `server: ${sessionError?.message ?? "no session returned"}`;
      return NextResponse.redirect(
        `${appUrl}/login?error=session_failed&detail=${encodeURIComponent(
          detail.slice(0, 200)
        )}`
      );
    }

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
