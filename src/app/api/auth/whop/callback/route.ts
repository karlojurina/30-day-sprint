import { NextRequest, NextResponse, after } from "next/server";
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
import { fetchFirstPaymentForUser } from "@/lib/first-payment";
import { unsignState } from "@/lib/pkce";
import { whopLoginMayProceed } from "@/lib/student-app-gate";
import { syncWatchProgress } from "@/app/api/student/_lib/watch-sync";
import { evaluateAchievements } from "@/lib/achievements";
import { updateStudentStreak } from "@/app/api/student/_lib/update-streak";
import { createClient } from "@supabase/supabase-js";

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

/**
 * The longest a login waits for the student's first payment, as long as it
 * waits for its Whop lesson sync (step 5b).
 */
const FIRST_PAYMENT_WAIT_MS = 2500;

/**
 * The student's first real payment (src/lib/first-payment.ts, the first-paid
 * fix, 2026-10-20), or null when Whop has none, the read failed, or it took
 * longer than FIRST_PAYMENT_WAIT_MS. Never throws, and never holds the login
 * longer than that wait.
 */
async function readFirstPaymentForLogin(whopUserId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIRST_PAYMENT_WAIT_MS);
  });
  const read = fetchFirstPaymentForUser(whopUserId, {
    deadlineAtMs: Date.now() + FIRST_PAYMENT_WAIT_MS,
  })
    .then((r) => {
      if (r.error) {
        console.warn(`[whop-callback] first payment not read for ${whopUserId}: ${r.error}`);
      }
      return r.firstPaidIso;
    })
    .catch((err: unknown) => {
      console.warn(
        `[whop-callback] first payment not read for ${whopUserId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
  try {
    return await Promise.race([read, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

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

    // 2b. The closed doors (T-078, lib/student-app-gate.ts). While the student
    //     app is closed, only the Whop ids in STUDENT_APP_OPEN_FOR (and a
    //     team member's Whop account, if one exists) get past this line.
    //     Nothing below runs for anyone else: no student row, no tokens, no
    //     sync, no session. Open, it reads nothing and lets everyone through.
    if (!(await whopLoginMayProceed(createServiceClient(), userInfo.sub))) {
      // The refused Whop id goes to the logs, so a test account turned away
      // by a typo in STUDENT_APP_OPEN_FOR (or a browser signed in to another
      // Whop account) can be told apart: the page itself looks the same.
      console.warn(`[whop-callback] student app closed, refused ${userInfo.sub}`);
      return NextResponse.redirect(`${appUrl}/login?error=app_closed`);
    }

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

      // v75.10 — self-heal fallback. The user-scoped /me/memberships
      // call above returns 404 for legacy customers (Whop API
      // quirk; reliably reproduced for a customer
      // who's been paying since Dec 2025). Before blocking, try the
      // admin-side v2 API (same path our daily sync-whop cron uses).
      // If we find an active membership server-to-server, upsert
      // the student row inline and let them in. That fixes every
      // legacy customer on first login - no backfill script needed.
      //
      // v85.6 — the gate used to be `!dbHasActive && !whopHasAccess`,
      // which skipped the repair in the ONE case where it matters most:
      // Whop says the student is entitled but our row says otherwise.
      // Those students sailed through login (whopHasAccess passes the
      // check below) and were then hard-blocked INSIDE the dashboard by
      // MembershipBlockOverlay, which reads students.membership_status
      // and never asks Whop. Logging out and back in couldn't fix it.
      // A student hit exactly this on 2026-07-29 and re-logged in at
      // 10:49 UTC to no effect. Now any DB/Whop divergence self-corrects
      // on the next login, for every student. Genuinely lapsed students
      // are unaffected: fetchActiveMembershipForUser returns null for
      // them, nothing is written, and the block below still fires.
      let selfHealed = false;
      if (!dbHasActive) {
        const adminRow = await fetchActiveMembershipForUser(userInfo.sub);
        if (adminRow) {
          // first_paid_at is not written here (the first-paid fix,
          // 2026-10-20). It used to take healAnchor, this membership's
          // created_at, which a free plan on the product has too. The
          // student's first real payment fills an empty one in step 5,
          // later in this same login, for this row as for a new one.
          //
          // Pre-fetch joined_at so we ONLY set it on a real INSERT, not
          // on UPDATE (the v85.6 note below).
          const healAnchor =
            toIso(adminRow.created_at) ?? new Date().toISOString();
          const { data: existingHealRow } = await supabaseAdmin
            .from("students")
            .select("joined_at, name")
            .eq("whop_user_id", userInfo.sub)
            .maybeSingle();

          const healPayload: Record<string, unknown> = {
            whop_user_id: userInfo.sub,
            whop_membership_id: adminRow.id,
            email: adminRow.email ?? userInfo.email ?? null,
            // Whop's v2 row has no `username` field. Fall back
            // to the OAuth userInfo.name.
            name: userInfo.name ?? existingHealRow?.name ?? null,
            membership_status: mapStatus(adminRow),
            // v85.6: restoring access, so the churn stamp must go with
            // it. Left set, the row reads active-but-canceled — the
            // snapshot cron counts it as churned and the sync's
            // transition logic preserves it indefinitely (same bucket,
            // date present → don't touch).
            canceled_at: null,
            // v79: stamp plan_id from the admin row so the new
            // user is correctly classified as paying / free from
            // first login. Without this they'd default to NULL
            // (non-paying) until the next nightly sync.
            whop_plan_id: adminRow.plan ?? null,
          };
          // v85.6: joined_at is INSERT-only (an empty one is filled).
          // Now that this branch also repairs EXISTING rows (see the
          // gate note above), writing healAnchor unconditionally would
          // shove a long-time student's joined_at forward to whichever
          // membership currently grants access — moving their sprint day
          // counter and journey column. The surviving membership is
          // frequently NOT the original one; that's the whole reason
          // this branch runs.
          if (!existingHealRow?.joined_at) {
            healPayload.joined_at = healAnchor;
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

    // Try to sign in first (returning user). login-3: only "invalid login
    // credentials" means a new user (isNoAccountYet). Any other error, a
    // rate limit in a login rush, a 5xx or the network, is tried once more
    // after half a second, then sent back to the login page as login_busy.
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

    // 5. Upsert student record using a FRESH service-role client so the
    //    query runs with service-role permissions (bypasses RLS).
    const supabase = createServiceClient();

    // Check if student already exists before upserting, so we can set
    // joined_at correctly for new students (from their Whop membership)
    // without overwriting it on returning students.
    const { data: existing } = await supabase
      .from("students")
      .select("id, joined_at, first_paid_at")
      .eq("whop_user_id", userInfo.sub)
      .single();

    // The first payment (the first-paid fix, 2026-10-20), read only when
    // the row holds none: a new student, a row the webhook or the
    // self-heal made without one, a free member. Started here so it runs
    // beside the lookups below; written after the upsert, and only while
    // the column is still empty, so a stored date never moves.
    const firstPaymentRead = existing?.first_paid_at
      ? null
      : readFirstPaymentForLogin(userInfo.sub);

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
      // New student — fetch the Whop membership join date for joined_at,
      // so their day count starts when they joined Whop, not at their
      // first login here. first_paid_at is not that date: Whop's
      // joined_at is the first join to the company, a free membership's
      // for a member who bought later. It is the first real payment,
      // filled below (firstPaymentRead).
      const whopJoinDate = await fetchWhopMembershipJoinDate(
        tokens.access_token
      );
      const anchorIso = whopJoinDate ?? new Date().toISOString();
      upsertFields = {
        ...baseFields,
        joined_at: anchorIso,
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

    // 5a. The first payment read above, written only into an empty
    //     first_paid_at. A failed read, no payment or a read slower than
    //     FIRST_PAYMENT_WAIT_MS leaves it empty for the 2-hour sync (or
    //     the next login) to fill; the login goes on either way.
    if (upsertedStudent && firstPaymentRead) {
      const firstPaidIso = await firstPaymentRead;
      if (firstPaidIso) {
        const { error: firstPaidError } = await supabase
          .from("students")
          .update({ first_paid_at: firstPaidIso })
          .eq("id", upsertedStudent.id)
          .is("first_paid_at", null);
        if (firstPaidError) {
          console.error(
            `[whop-callback] first_paid_at fill failed for ${userInfo.sub}: ${firstPaidError.message}`,
          );
        }
      }
    }

    // 5b. Initial watch-progress sync with a short timeout. We don't want
    //     to block the redirect forever, but we do want to capture Whop
    //     errors into whop_last_sync_error so they're visible in the UI.
    if (upsertedStudent?.id) {
      // v89.2 — evaluate achievements once the sync has landed.
      //
      // syncWatchProgress mirrors the student's completed Whop lessons into
      // student_lesson_completions, and this is the ONLY place that happens
      // for a student who never toggles anything themselves. Achievements
      // were previously evaluated only on toggle-lesson, mark-action-shipped,
      // submit-quiz and the manual refresh — so a student whose entire
      // progress arrived through this sync earned nothing. Measured
      // 2026-09-18: 182 students in the launch cohort held a real completion
      // with no First Steps badge, a quarter of everyone who had completed
      // anything.
      //
      // Chained onto the sync rather than run beside it, so it always sees
      // the rows the sync just wrote. The redirect still waits 2.5s at most
      // (the race below); a sync that runs longer finishes after the
      // redirect, kept alive by after().
      const syncPromise = syncWatchProgress({
        studentId: upsertedStudent.id,
        whopUserId: userInfo.sub,
      }).then(async (syncResult) => {
        try {
          // Streak FIRST, then achievements — the same order the other three
          // write paths use (toggle-lesson:56, mark-action-shipped:133,
          // refresh-watch-sync:54). Without it the streak is whatever it was
          // before this sync, so streak_7 / unbroken get judged
          // against a stale value and silently under-award.
          // Only when the sync added something, as refresh-watch-sync does: a
          // login alone is no lesson work (backend_readiness.md, item 3).
          if (syncResult.syncedCount > 0) {
            await updateStudentStreak(supabase, upsertedStudent.id);
          }
          await evaluateAchievements(supabase, upsertedStudent.id);
        } catch (err) {
          // Never let an achievement failure break a login.
          console.error("[callback] evaluateAchievements failed:", err);
        }
        return syncResult;
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
      // When the timer wins, nothing else keeps this function alive after
      // the redirect, and it can be stopped between the rows the sync adds
      // and their streak day; a later sync finds those rows there and counts
      // no day for them (T-079). after() keeps it alive until the rows, the
      // streak day and the badges are written (on Vercel through waitUntil).
      // after() throws where the platform has no waitUntil, and a login
      // must never fail on that, so it then goes on as before.
      try {
        after(syncPromise.catch(() => null));
      } catch (err) {
        console.error("[callback] after() unavailable, the sync may not finish:", err);
      }
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
      // Tagged `server:` so a screenshot distinguishes this from the
      // identical code emitted client-side by /auth/complete. Without
      // the tag both sides look the same in a support ticket.
      const detail = `server: ${sessionError?.message ?? "no session returned"}`;
      return NextResponse.redirect(
        `${appUrl}/login?error=session_failed&detail=${encodeURIComponent(
          detail.slice(0, 200)
        )}`
      );
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
