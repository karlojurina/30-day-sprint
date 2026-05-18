/**
 * POST /api/student/dismiss-playbook-welcome
 *
 * Fires the first time a student dismisses the welcome overlay that
 * appears on their first visit to Map 2. Sets
 * students.playbook_welcome_seen_at = now() so the overlay never
 * appears again. Idempotent.
 *
 * No payload required — student is identified from the bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
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
    .select("id, playbook_welcome_seen_at")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (student.playbook_welcome_seen_at) {
    return NextResponse.json({
      ok: true,
      already_seen: true,
      playbook_welcome_seen_at: student.playbook_welcome_seen_at,
    });
  }

  const seenAt = new Date().toISOString();
  await supabase
    .from("students")
    .update({ playbook_welcome_seen_at: seenAt })
    .eq("id", student.id);

  return NextResponse.json({
    ok: true,
    already_seen: false,
    playbook_welcome_seen_at: seenAt,
  });
}
