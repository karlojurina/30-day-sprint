import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LESSONS_TABLE } from "@/lib/catalog-tables";
import { tellaEmbedUrl } from "@/lib/world/tella";

/**
 * Give one lesson's Tella embed address to an active member.
 *
 * This is the ONLY place a video's address leaves the server. With Tella
 * there is no signing step: the id is the address, and whoever holds it can
 * embed the video on any site its domain list allows. So the id is kept in
 * `lesson_videos`, a table with row level security on and no policy, which no
 * browser query can read. The lessons payload (api/student/data) carries a
 * `has_video` boolean and never an id. This route hands out one address, for
 * one lesson, per request.
 *
 * THE MEMBERSHIP CHECK IS THE POINT OF THIS ROUTE.
 * Today `MembershipBlockOverlay` is the entire paywall: a component that
 * returns null when `membership_status === "active"` and covers the screen
 * otherwise. No other student API route checks membership at all — which is
 * fine while the lessons live on whop.com behind Whop's own gate, and is NOT
 * fine the moment this app serves the video itself. A lapsed student with a
 * valid Supabase session could otherwise keep watching the whole course
 * through devtools while paying nothing.
 *
 * So: same predicate as the overlay, enforced server-side, before the id is
 * read.
 *
 * WHAT IT REFUSES: no token or a bad one (401), an account with no student
 * row (404), any membership that is not "active" (403), a lesson the catalog
 * does not have (404), and a lesson that is not a `watch` lesson or has no
 * `lesson_videos` row (404 with `notRecorded`, the normal state of every
 * lesson not recorded yet).
 *
 * The answer is `no-store`. An address sitting in a cache outlives the
 * membership check that released it.
 *
 * No environment variable beyond the Supabase ones. The video id is never
 * logged here.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  let lessonId: unknown;
  try {
    ({ lessonId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (typeof lessonId !== "string" || !lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id, membership_status")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // The exact predicate MembershipBlockOverlay.tsx:32 uses. Anything other
  // than "active" — past_due, canceled, expired, null — gets nothing.
  if (student.membership_status !== "active") {
    return NextResponse.json(
      { error: "Membership inactive" },
      { status: 403 },
    );
  }

  const { data: lesson } = await supabase
    .from(LESSONS_TABLE)
    .select("id, type, duration_seconds")
    .eq("id", lessonId)
    .single();

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  // Not an error state — this is the normal condition for every lesson that
  // hasn't been recorded yet, and the world renders an empty slot.
  const notRecorded = () =>
    NextResponse.json(
      { error: "Lesson has no video", notRecorded: true },
      { status: 404 },
    );

  if (lesson.type !== "watch") return notRecorded();

  // maybeSingle: a lesson with no row here is simply not recorded yet.
  const { data: video, error: videoError } = await supabase
    .from("lesson_videos")
    .select("tella_video_id")
    .eq("lesson_id", lesson.id)
    .maybeSingle();

  if (videoError) {
    // A failed read must not pass for "not recorded". That would show every
    // lesson as an empty slot with nothing logged, the day the table is
    // missing or unreachable.
    console.error(
      `[lesson-video] lesson_videos read failed for ${lesson.id}: ${videoError.message}`,
    );
    return NextResponse.json({ error: "Video lookup failed" }, { status: 500 });
  }
  if (!video) return notRecorded();

  let embedUrl: string;
  try {
    embedUrl = tellaEmbedUrl(video.tella_video_id);
  } catch {
    // The table's check constraint makes this unreachable. Said without the
    // stored value, which may be one typo away from a real id.
    console.error(
      `[lesson-video] the stored video id for ${lesson.id} is malformed`,
    );
    return NextResponse.json({ error: "Video not configured" }, { status: 500 });
  }

  return NextResponse.json(
    {
      embedUrl,
      // The catalog's duration is the trusted one; the player reports its own
      // and the heartbeat RPC prefers this when it is set.
      durationSeconds: lesson.duration_seconds ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
