/**
 * Lesson video lock check.
 *
 * NOT SCHEDULED. There is no line for this route in vercel.json, on purpose:
 * it runs only when someone calls it with the cron secret, until Lovro
 * decides to switch it on.
 *
 * Why it exists: a Tella video id is the video's address. What keeps a
 * lesson inside the app is two settings on the video itself, access "Embed
 * only" and the list of sites allowed to embed it. Either can be lost without
 * a line of our code changing: a copy of a video is born public with no
 * list, and anyone with the workspace login can edit both. Nothing in the
 * app would look different, and the course would be open to the world.
 *
 * What a run does, for every row of `lesson_videos`:
 *   1. asks Tella for the video's settings (one request per video; the list
 *      endpoint does not carry them),
 *   2. judges them with `judgeLock` against TELLA_EMBED_DOMAINS and against
 *      the catalog: the lesson's length, and whether a watch lesson with
 *      this id exists at all,
 *   3. writes the verdict on the row: `lock_status`, `lock_detail` (the
 *      sentences joined by " | ", null when there are none) and
 *      `lock_checked_at`,
 * and then posts ONE message to the team channel when any row has a problem
 * or the run did not get through every row.
 *
 * It trusts nothing it stored. Every run re-reads every video from Tella, so
 * a second run rewrites the same verdicts.
 *
 * A video Tella could not be asked about becomes `error` for that row and the
 * run carries on. One bad answer must not hide the other lessons.
 *
 * IT ALWAYS ENDS BY SAYING WHAT IT DID, including when it could not finish.
 * Three things make sure of that (2026-10-12, before it was ever scheduled):
 *   - a request to Tella gives up after 10 s (in `tella-api.ts`);
 *   - the run stops asking Tella 270 s after it started, writes and reports
 *     what it has, and says how many videos it did not reach. Vercel kills
 *     the function at 300 s, and a killed run reports nothing: no alert, no
 *     answer, a `cron_runs` row left on "running". The rows are read longest
 *     unchecked first, so what one run did not reach the next one starts
 *     with;
 *   - a verdict is written only to a row that still holds the video Tella
 *     was asked about. A row whose video was swapped while the run was on
 *     keeps its old verdict and is counted as not reached.
 * `cron_runs` has two endings, success and failed. A run that did not reach
 * every video ends as failed, with a message saying how many.
 *
 * What it refuses: a request without the cron secret (401), and a run with
 * TELLA_API_KEY or TELLA_EMBED_DOMAINS missing (500). An empty domain list
 * would judge every video against nothing.
 *
 * The response body, the Discord message and the logs carry lesson ids and
 * never a video id.
 *
 * Limit, stated: this sees a video's settings, not the workspace's plan. If
 * Tella stopped enforcing the lock while still reporting "embedonly", this
 * check could not see it.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { postTeamAlert } from "@/lib/discord";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "@/lib/cron-auth";
import { fetchTellaVideoFacts } from "@/lib/world/tella-api";
import {
  judgeLock,
  watchLessonSeconds,
  type CatalogLesson,
  type CatalogLessonRow,
  type LockStatus,
  type LockVerdict,
} from "@/lib/world/tella-lock";

const ROUTE_NAME = "check-lesson-videos";

// Vercel Pro's max, and the point where Vercel kills the function. The run
// plans to be finished well before it: see RUN_BUDGET_MS.
export const maxDuration = 300;

// Tella's limit, read off its response headers: 100 requests a minute. One
// request STARTS at least 700 ms after the one before it started, which is
// at most 86 a minute. The wait is counted from the start so that a slow
// answer is not followed by a pause nobody needs: the time it took already
// did the spacing.
const TELLA_CALL_GAP_MS = 700;

// The run stops ASKING Tella this long after it started. The 30 s left over
// are for what still has to happen after the last question: the request
// already under way (10 s at most), its write, the Discord post and the
// `cron_runs` row.
//
// How many videos fit. One video costs one request to Tella plus one write
// to its row, and never less than the 700 ms spacing.
//   Fast answers (request and write under 0.7 s together): 0.7 s a video.
//   The course's 145 videos take about 100 s, and about 385 fit.
//   As measured: two requests timed on 2026-10-12 took 0.9 s and 1.5 s.
//   That was from a laptop, not from Vercel, and the write is assumed at
//   0.2 s because this route has never run. About 1.4 s a video: 145 take
//   about 3 min 25 s, and about 190 fit.
//   The worst day: every request runs into its 10 s limit, 10.2 s a video.
//   27 videos are asked, each becomes `error`, and the rest are reported as
//   not reached.
// So the 145 fit as long as Tella answers in about 1.6 s or less on
// average. Slower than that, some are left unreached every run and every
// run says so. The ones left over are the first asked about on the next
// run: see the order the rows are read in.
const RUN_BUDGET_MS = 270_000;

// Discord rejects an embed description over 4096 characters, and a rejected
// post is a lost alert. The day every lesson is flagged at once (a wrong
// TELLA_EMBED_DOMAINS does that) is the day the message is longest.
const DISCORD_DESCRIPTION_BUDGET = 3800;

interface LessonVideoRow {
  lesson_id: string;
  tella_video_id: string;
}

interface LessonProblem {
  lessonId: string;
  status: LockStatus;
  problems: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "3 of 145 videos were NOT reached this run: …", for the team channel. */
function notReachedLine(notAsked: number, changed: number, total: number): string {
  const notReached = notAsked + changed;
  const why = [
    notAsked > 0
      ? `the check stopped asking Tella after ${RUN_BUDGET_MS / 1000} s with ${notAsked} to go`
      : null,
    changed > 0
      ? `${changed} row${changed === 1 ? "" : "s"} changed while it ran`
      : null,
  ]
    .filter(Boolean)
    .join(", and ");
  return `${notReached} of ${total} video${total === 1 ? "" : "s"} ${notReached === 1 ? "was" : "were"} NOT reached this run: ${why}. Nothing was written for ${notReached === 1 ? "it" : "them"}.`;
}

/**
 * What the run has to say about itself first, then one line per lesson, cut
 * at whole lines to fit Discord's limit. The run's own lines are never the
 * ones cut.
 */
function alertDescription(runNotes: string[], problems: LessonProblem[]): string {
  const lines = problems.map((p) => `${p.lessonId}: ${p.problems.join(" ")}`);
  const kept = [...runNotes];
  let used = kept.reduce((n, line) => n + line.length + 1, 0);
  let shown = 0;
  for (const line of lines) {
    if (used + line.length + 1 > DISCORD_DESCRIPTION_BUDGET) break;
    kept.push(line);
    used += line.length + 1;
    shown++;
  }
  const left = lines.length - shown;
  if (left > 0) {
    kept.push(
      `…and ${left} more lesson${left === 1 ? "" : "s"}. Every reason is in lesson_videos.lock_detail.`,
    );
  }
  return kept.join("\n");
}

export async function GET(request: NextRequest) {
  // The 270 s are counted from here, the moment Vercel's own clock started.
  const startedAt = Date.now();

  // Shared cron auth + audit. See src/lib/cron-auth.ts.
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const apiKey = process.env.TELLA_API_KEY?.trim();
  const expectedDomains = (process.env.TELLA_EMBED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!apiKey || expectedDomains.length === 0) {
    // Loud in the log, vague in the answer. A missing key is an operator
    // problem, not something to describe to the caller.
    console.error(
      "[check-lesson-videos] TELLA_API_KEY / TELLA_EMBED_DOMAINS not configured",
    );
    await logCronFinish(runId, "failed", {
      error: "Lock check not configured",
    });
    return NextResponse.json(
      { error: "Lock check not configured" },
      { status: 500 },
    );
  }

  const supabase = createServiceClient();

  try {
    // One row per recorded lesson, about 150 for the whole course, under
    // Supabase's 1000-row cap.
    //
    // Longest unchecked first, never checked before all. A run that stops at
    // 270 s leaves the END of this list unreached. Read in a fixed order,
    // that would be the same lessons every run, and they would never be
    // checked at all. Read in this order, they are the first ones asked
    // about on the next run.
    const { data: videoRows, error: videosErr } = await supabase
      .from("lesson_videos")
      .select("lesson_id, tella_video_id")
      .order("lock_checked_at", { ascending: true, nullsFirst: true })
      .order("lesson_id");
    if (videosErr) {
      console.error(
        "[check-lesson-videos] lesson_videos read failed:",
        videosErr.message,
      );
      await logCronFinish(runId, "failed", { error: videosErr.message });
      return NextResponse.json({ error: videosErr.message }, { status: 500 });
    }
    const videos = (videoRows ?? []) as LessonVideoRow[];

    // Every watch lesson's length, live and staging together: `lesson_videos`
    // holds ids from both until cutover. The live table is read last so it
    // wins a shared id, because it is the one the heartbeat function measures
    // 95% against.
    //
    // A table that cannot be read is remembered. From then on an id this
    // run cannot find is NOT called an unknown lesson: it may sit in the
    // table that failed. The lock rules still run for every video, and the
    // run says once that the catalog was not read in full.
    const catalogTables: CatalogLessonRow[][] = [];
    const unreadTables: string[] = [];
    for (const table of ["lessons_next", "lessons"] as const) {
      const { data, error } = await supabase
        .from(table)
        .select("id, type, duration_seconds");
      if (error) {
        console.error(
          `[check-lesson-videos] ${table} read failed: ${error.message}`,
        );
        unreadTables.push(table);
        continue;
      }
      catalogTables.push((data ?? []) as CatalogLessonRow[]);
    }
    const watchSeconds = watchLessonSeconds(catalogTables);
    const catalogRead = unreadTables.length === 0;

    const counts: Record<LockStatus, number> = {
      locked: 0,
      open: 0,
      missing: 0,
      error: 0,
    };
    const problems: LessonProblem[] = [];
    let writeFailures = 0;
    // The two ways a video goes without a verdict this run.
    let notAsked = 0;
    let changed = 0;
    let lastAskedAt = 0;

    for (let i = 0; i < videos.length; i++) {
      const { lesson_id: lessonId, tella_video_id: videoId } = videos[i];
      if (i > 0) {
        const wait = lastAskedAt + TELLA_CALL_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
      }

      // Checked right before the question, so no request starts after 270 s.
      if (Date.now() - startedAt >= RUN_BUDGET_MS) {
        notAsked = videos.length - i;
        console.error(
          `[check-lesson-videos] stopped asking Tella at ${RUN_BUDGET_MS / 1000} s with ${notAsked} of ${videos.length} videos not reached`,
        );
        break;
      }
      lastAskedAt = Date.now();

      // No line this run logs or stores may carry the video id. The messages
      // below are written by our own code and none names it; this is a
      // second guard for one that comes from underneath.
      const hideId = (text: string) => text.split(videoId).join("[video id]");

      let verdict: LockVerdict;
      try {
        const facts = await fetchTellaVideoFacts(videoId, apiKey);
        const catalogLesson: CatalogLesson = watchSeconds.has(lessonId)
          ? "watch"
          : catalogRead
            ? "none"
            : "unread";
        verdict = judgeLock(
          facts,
          expectedDomains,
          watchSeconds.get(lessonId) ?? null,
          catalogLesson,
        );
      } catch (err) {
        // A timeout lands here too, as an error like any other.
        const reason = hideId(
          err instanceof Error ? err.message : String(err),
        ).slice(0, 200);
        verdict = {
          status: "error",
          problems: [`Tella could not be asked: ${reason}`],
        };
      }

      // Written only if the row still holds the video Tella was asked about.
      // Keyed on the lesson alone, a row whose video was swapped during the
      // run would be stamped with the OLD video's verdict: a freshly locked
      // replacement marked open, or an open one marked locked.
      const { data: written, error: writeErr } = await supabase
        .from("lesson_videos")
        .update({
          lock_status: verdict.status,
          lock_detail:
            verdict.problems.length > 0 ? verdict.problems.join(" | ") : null,
          lock_checked_at: new Date().toISOString(),
        })
        .eq("lesson_id", lessonId)
        .eq("tella_video_id", videoId)
        .select("lesson_id");

      if (!writeErr && (written ?? []).length === 0) {
        // The row changed (or was deleted) during the run. The verdict is
        // about a video the row no longer holds, so it is dropped whole:
        // not written, not counted, not reported. The next run judges the
        // row as it is then.
        changed++;
        console.warn(
          `[check-lesson-videos] the row for ${lessonId} changed during the run, no verdict written`,
        );
        continue;
      }
      if (writeErr) {
        writeFailures++;
        console.error(
          `[check-lesson-videos] verdict for ${lessonId} not written: ${hideId(writeErr.message)}`,
        );
      }

      counts[verdict.status]++;
      if (verdict.problems.length > 0) {
        problems.push({
          lessonId,
          status: verdict.status,
          problems: verdict.problems,
        });
      }
    }

    const checked = counts.locked + counts.open + counts.missing + counts.error;
    const notReached = notAsked + changed;

    // What the run has to say about itself, ahead of the lessons.
    const runNotes: string[] = [];
    if (notReached > 0) {
      runNotes.push(notReachedLine(notAsked, changed, videos.length));
    }
    if (!catalogRead) {
      runNotes.push(
        `The catalog could not be read in full (${unreadTables.join(", ")}), so a video whose lesson is missing from the catalog was not reported this run.`,
      );
    }

    // One message for the whole run, and only when something needs a person:
    // a lesson with a problem, or a run that did not get through every row.
    // `postTeamAlert` swallows its own failures, so its answer is read here:
    // an alert that did not go out is the failure this check exists to
    // prevent, and it is recorded on the run.
    let alertFailure: string | null = null;
    if (problems.length > 0 || runNotes.length > 0) {
      const alert = await postTeamAlert(
        [
          {
            title: "Lesson videos need attention",
            description: alertDescription(runNotes, problems),
            color: 0xe8a86a,
          },
        ],
        "Lesson video lock check",
      );
      if (!alert.ok) {
        alertFailure = `alert not delivered (${alert.reason ?? "unknown"})`;
        console.error(`[check-lesson-videos] ${alertFailure}`);
      }
    }

    // `cron_runs` knows success and failed and nothing between. A run that
    // left anything undone is failed, and the message says what.
    const runErrors = [
      notAsked > 0
        ? `stopped asking Tella at ${RUN_BUDGET_MS / 1000} s: ${notAsked} of ${videos.length} videos not reached`
        : null,
      changed > 0
        ? `${changed} row${changed === 1 ? "" : "s"} changed during the run and got no verdict`
        : null,
      catalogRead
        ? null
        : `catalog not read in full (${unreadTables.join(", ")})`,
      writeFailures > 0
        ? `${writeFailures} verdict${writeFailures === 1 ? "" : "s"} not written`
        : null,
      alertFailure,
    ].filter(Boolean);

    await logCronFinish(runId, runErrors.length > 0 ? "failed" : "success", {
      rowsAffected: checked - writeFailures,
      error: runErrors.length > 0 ? runErrors.join("; ") : undefined,
    });

    // checked + notReached = the rows read at the start of the run.
    return NextResponse.json({
      checked,
      locked: counts.locked,
      open: counts.open,
      missing: counts.missing,
      error: counts.error,
      notReached,
      problems,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCronFinish(runId, "failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
