/**
 * GET  /api/admin/templates — list templates (team read).
 * POST /api/admin/templates — create a NEW custom template
 *                              (founder + admin only, auto-generates
 *                               a scenario_id of the form "C-xxxxxx")
 *
 * Built-in templates (the 20 seeded by v27) are not created here —
 * they're seeded by the migration and only get edited via PUT
 * /api/admin/templates/:id.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import type { TriggerConfig, TemplateBucket } from "@/types/database";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const url = new URL(request.url);
  const week = url.searchParams.get("week");
  const bucket = url.searchParams.get("bucket");
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let q = auth.supabase
    .from("templates")
    .select("*")
    .order("is_custom", { ascending: true })
    .order("week", { ascending: true })
    .order("scenario_id", { ascending: true });

  if (week) q = q.eq("week", week);
  if (bucket) q = q.eq("bucket", bucket);
  if (!includeInactive) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}

interface CreateTemplateBody {
  title?: unknown;
  bucket?: unknown;
  intent?: unknown;
  trigger_description?: unknown;
  body?: unknown;
  trigger_config?: unknown;
}

const ALLOWED_BUCKETS: TemplateBucket[] = [
  "crushing",
  "on_track",
  "at_risk",
  "cancel_path",
  "event",
];

function generateScenarioId(): string {
  // 6 random hex chars → "C-abc123". 16-char column has plenty of room.
  const hex = Math.random().toString(16).slice(2, 8).padEnd(6, "0");
  return `C-${hex}`;
}

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const raw = (await request.json().catch(() => null)) as CreateTemplateBody | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const intent = typeof raw.intent === "string" ? raw.intent.trim() : "";
  const trigger_description =
    typeof raw.trigger_description === "string"
      ? raw.trigger_description.trim()
      : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  const bucket = raw.bucket as TemplateBucket;
  const trigger_config = raw.trigger_config as TriggerConfig | null;

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json(
      { error: "Pick a valid bucket (crushing / on track / at risk / cancel path / event)" },
      { status: 400 },
    );
  }
  if (!body) {
    return NextResponse.json(
      { error: "DM body is required" },
      { status: 400 },
    );
  }
  if (
    !trigger_config ||
    typeof trigger_config !== "object" ||
    !Array.isArray((trigger_config as TriggerConfig).all) ||
    (trigger_config as TriggerConfig).all.length === 0
  ) {
    return NextResponse.json(
      { error: "At least one trigger condition is required" },
      { status: 400 },
    );
  }

  // Retry a few times in the (vanishing) chance of a scenario_id collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const scenarioId = generateScenarioId();
    const { data, error } = await auth.supabase
      .from("templates")
      .insert({
        scenario_id: scenarioId,
        bucket,
        week: "X",
        title,
        trigger_description,
        intent: intent || null,
        body,
        variables: [],
        is_active: true,
        is_admin_only: false,
        is_custom: true,
        trigger_config,
      })
      .select()
      .single();
    if (!error && data) {
      return NextResponse.json({ template: data });
    }
    if (error && (error as { code?: string }).code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // 23505 = duplicate scenario_id — retry with a new id.
  }
  return NextResponse.json(
    { error: "Couldn't generate a unique scenario id — try again." },
    { status: 500 },
  );
}
