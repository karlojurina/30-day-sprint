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
 *   2. judges them with `judgeLock` against TELLA_EMBED_DOMAINS and the
 *      catalog's length for that lesson,
 *   3. writes the verdict on the row: `lock_status`, `lock_detail` (the
 *      sentences joined by " | ", null when there are none) and
 *      `lock_checked_at`,
 * and then posts ONE message to the team channel when any row has a problem.
 *
 * It trusts nothing it stored. Every run re-reads every video from Tella, so
 * a second run rewrites the same verdicts.
 *
 * A video Tella could not be asked about becomes `error` for that row and the
 * run carries on. One bad answer must not hide the other lessons.
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
  type LockStatus,
  type LockVerdict,
} from "@/lib/world/tella-lock";

const ROUTE_NAME = "check-lesson-videos";

// Vercel Pro's max. About 145 videos at 700 ms apart plus the requests
// themselves is roughly 2 to 3 minutes. Past about 250 videos one run no
// longer fits: Vercel would cut it off with the last lessons unchecked and
// no alert sent, and the run's `cron_runs` row would stay "running".
export const maxDuration = 300;

// Tella's limit, read off its response headers: 100 requests a minute.
// 700 ms apart is at most 86.
const TELLA_CALL_GAP_MS = 700;

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

/** One line per lesson, cut at whole lines to fit Discord's limit. */
function alertDescription(problems: LessonProblem[]): string {
  const lines = problems.map((p) => `${p.lessonId}: ${p.problems.join(" ")}`);
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > DISCORD_DESCRIPTION_BUDGET) break;
    kept.push(line);
    used += line.length + 1;
  }
  const left = lines.length - kept.length;
  if (left > 0) {
    kept.push(
      `…and ${left} more lesson${left === 1 ? "" : "s"}. Every reason is in lesson_videos.lock_detail.`,
    );
  }
  return kept.join("\n");
}

export async function GET(request: NextRequest) {
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
    const { data: videoRows, error: videosErr } = await supabase
      .from("lesson_videos")
      .select("lesson_id, tella_video_id")
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

    // The catalog's length for every lesson, live and staging in one map.
    // `lesson_videos` holds ids from both until cutover. The live table is
    // written last so it wins a shared id: it is the one the heartbeat
    // function measures 95% against. A failed read leaves the map short,
    // which skips the length comparison and nothing else.
    const catalogSeconds = new Map<string, number | null>();
    for (const table of ["lessons_next", "lessons"] as const) {
      const { data, error } = await supabase
        .from(table)
        .select("id, duration_seconds");
      if (error) {
        console.error(
          `[check-lesson-videos] ${table} read failed, lengths from it are not compared: ${error.message}`,
        );
        continue;
      }
      for (const l of data ?? []) {
        catalogSeconds.set(
          l.id as string,
          (l.duration_seconds as number | null) ?? null,
        );
      }
    }

    const counts: Record<LockStatus, number> = {
      locked: 0,
      open: 0,
      missing: 0,
      error: 0,
    };
    const problems: LessonProblem[] = [];
    let writeFailures = 0;

    for (let i = 0; i < videos.length; i++) {
      const { lesson_id: lessonId, tella_video_id: videoId } = videos[i];
      if (i > 0) await sleep(TELLA_CALL_GAP_MS);

      let verdict: LockVerdict;
      try {
        const facts = await fetchTellaVideoFacts(videoId, apiKey);
        verdict = judgeLock(
          facts,
          expectedDomains,
          catalogSeconds.get(lessonId) ?? null,
        );
      } catch (err) {
        // `tella-api.ts` never puts the id in a message. The replace is for
        // an error from underneath it (the network layer) that might.
        const reason = (err instanceof Error ? err.message : String(err))
          .split(videoId)
          .join("[video id]")
          .slice(0, 200);
        verdict = {
          status: "error",
          problems: [`Tella could not be asked: ${reason}`],
        };
      }

      counts[verdict.status]++;
      if (verdict.problems.length > 0) {
        problems.push({
          lessonId,
          status: verdict.status,
          problems: verdict.problems,
        });
      }

      const { error: writeErr } = await supabase
        .from("lesson_videos")
        .update({
          lock_status: verdict.status,
          lock_detail:
            verdict.problems.length > 0 ? verdict.problems.join(" | ") : null,
          lock_checked_at: new Date().toISOString(),
        })
        .eq("lesson_id", lessonId);
      if (writeErr) {
        writeFailures++;
        console.error(
          `[check-lesson-videos] verdict for ${lessonId} not written: ${writeErr.message}`,
        );
      }
    }

    // One message for the whole run, and only when something needs a person.
    // `postTeamAlert` swallows its own failures, so its answer is read here:
    // an alert that did not go out is the failure this check exists to
    // prevent, and it is recorded on the run.
    let alertFailure: string | null = null;
    if (problems.length > 0) {
      const alert = await postTeamAlert(
        [
          {
            title: "Lesson videos need attention",
            description: alertDescription(problems),
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

    const runErrors = [
      writeFailures > 0
        ? `${writeFailures} verdict${writeFailures === 1 ? "" : "s"} not written`
        : null,
      alertFailure,
    ].filter(Boolean);

    await logCronFinish(runId, runErrors.length > 0 ? "failed" : "success", {
      rowsAffected: videos.length - writeFailures,
      error: runErrors.length > 0 ? runErrors.join("; ") : undefined,
    });

    return NextResponse.json({
      checked: videos.length,
      locked: counts.locked,
      open: counts.open,
      missing: counts.missing,
      error: counts.error,
      problems,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCronFinish(runId, "failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
