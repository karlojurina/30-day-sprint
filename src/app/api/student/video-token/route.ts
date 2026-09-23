import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LESSONS_TABLE } from "@/lib/catalog-tables";
import { EMBED_TTL_SECONDS, signBunnyEmbed } from "@/lib/world/bunny-sign";

/**
 * Mint a short-lived, signed Bunny embed URL for one lesson.
 *
 * This is the ONLY place a playable video URL is created. The token key never
 * leaves the server, and the URL is minted per request rather than stored, so
 * revoking access is a matter of not minting the next one.
 *
 * THE MEMBERSHIP CHECK IS THE POINT OF THIS ROUTE.
 * Today `MembershipBlockOverlay` is the entire paywall: a component that
 * returns null when `membership_status === "active"` and covers the screen
 * otherwise. No student API route checks membership at all — which is fine
 * while the lessons live on whop.com behind Whop's own gate, and is NOT fine
 * the moment this app serves the video itself. A lapsed student with a valid
 * Supabase session could otherwise keep watching the whole course through
 * devtools while paying nothing.
 *
 * So: same predicate as the overlay, enforced server-side, before signing.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
  const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY?.trim();
  if (!libraryId || !tokenKey) {
    // Loud, and deliberately vague to the client. A missing key is an
    // operator problem, not something to describe to the browser.
    console.error(
      "[video-token] BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_TOKEN_KEY not configured",
    );
    return NextResponse.json({ error: "Video not configured" }, { status: 500 });
  }

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
    .select("id, type, bunny_video_id, duration_seconds")
    .eq("id", lessonId)
    .single();

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  if (lesson.type !== "watch" || !lesson.bunny_video_id) {
    // Not an error state — this is the normal condition for every lesson
    // that hasn't been recorded yet, and the world renders an empty slot.
    return NextResponse.json(
      { error: "Lesson has no video", notRecorded: true },
      { status: 404 },
    );
  }

  const { embedUrl, expires } = signBunnyEmbed(
    libraryId,
    lesson.bunny_video_id,
    tokenKey,
    EMBED_TTL_SECONDS,
  );

  return NextResponse.json({
    embedUrl,
    expires,
    // The catalog's duration is the trusted one; the player reports its own
    // and the heartbeat RPC prefers this when it is set.
    durationSeconds: lesson.duration_seconds ?? null,
  });
}
