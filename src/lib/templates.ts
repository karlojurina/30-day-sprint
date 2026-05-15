/**
 * Server-side template renderer for Astrid's DM templates.
 *
 * Templates live in the `templates` table (seeded from
 * lovro-brief/context/templates.md, edited via /admin/templates).
 *
 * Variables supported:
 *   {firstName}    — first token of students.name
 *   {fullName}     — students.name
 *   {dayNumber}    — computed from students.joined_at
 *   {bookingLink}  — admin_config.astrid_booking_link
 *   {programLink}  — admin_config.program_login_link
 *   {videoLink}    — admin_config.karlo_walkthrough_video_link
 *
 * Behavior: if a template references an unsupported variable, the
 * placeholder is left in place and the unresolved name is reported
 * in the result so callers can log a warning. We never blow up the
 * render — Astrid still sees the body, just with the placeholder.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDayNumber } from "@/types/database";

const KNOWN_VARS = [
  "firstName",
  "fullName",
  "dayNumber",
  "bookingLink",
  "programLink",
  "videoLink",
] as const;

export type TemplateVariableName = (typeof KNOWN_VARS)[number];

export interface TemplateRenderInputs {
  /** Student row — only the fields used for interpolation. */
  student: { name: string | null; joined_at: string };
  /**
   * Resolved admin config map (key → value). Pass `null` to skip
   * config-driven variables; they'll render as `[bookingLink]`-style
   * placeholders.
   */
  config?: Partial<Record<"astrid_booking_link" | "program_login_link" | "karlo_walkthrough_video_link", string | null>>;
}

export interface RenderedTemplate {
  body: string;
  /** Variable names that appeared in the body but couldn't be resolved. */
  unresolved: string[];
}

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Substitute variables in a template body. See file header for the
 * supported variable set.
 */
export function renderTemplate(
  body: string,
  inputs: TemplateRenderInputs,
): RenderedTemplate {
  const { student, config } = inputs;
  const firstName = (student.name?.split(/\s+/)[0] ?? "").trim() || "there";
  const fullName = student.name?.trim() || "there";
  const dayNumber = String(getDayNumber(student.joined_at));
  const bookingLink = config?.astrid_booking_link ?? "";
  const programLink = config?.program_login_link ?? "";
  const videoLink = config?.karlo_walkthrough_video_link ?? "";

  const values: Record<TemplateVariableName, string> = {
    firstName,
    fullName,
    dayNumber,
    bookingLink,
    programLink,
    videoLink,
  };

  const unresolved = new Set<string>();
  const rendered = body.replace(PLACEHOLDER_RE, (full, name: string) => {
    if (name in values) {
      const v = values[name as TemplateVariableName];
      // Empty config values (e.g. videoLink before Karlo records the
      // video) → leave the placeholder so Astrid notices.
      if (v === "") {
        unresolved.add(name);
        return full;
      }
      return v;
    }
    unresolved.add(name);
    return full;
  });

  return { body: rendered, unresolved: Array.from(unresolved) };
}

/**
 * Load the 3 URL config values from admin_config in a single query.
 * Returns the partial map suitable for passing to renderTemplate.
 *
 * Uses the caller's Supabase client — pass a service-role client from
 * server-side code, or the browser anon client for in-app callers
 * (RLS allows team members to read).
 */
export async function loadAdminConfig(
  supabase: SupabaseClient,
): Promise<TemplateRenderInputs["config"]> {
  const { data } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", [
      "astrid_booking_link",
      "program_login_link",
      "karlo_walkthrough_video_link",
    ]);

  const map: TemplateRenderInputs["config"] = {};
  for (const row of data ?? []) {
    map[row.key as keyof typeof map] = row.value ?? "";
  }
  return map;
}

/** Truthy IDs for the bucket prefix glyphs used in the UI. */
export const BUCKET_GLYPH: Record<string, string> = {
  crushing: "★",
  on_track: "✓",
  at_risk: "⚠",
  cancel_path: "✗",
  event: "⚡",
  admin: "⚙",
};

export const BUCKET_LABEL: Record<string, string> = {
  crushing: "Crushing it",
  on_track: "On track",
  at_risk: "At risk",
  cancel_path: "Cancel path",
  event: "Event",
  admin: "Admin",
};

/**
 * Sort priority for the task queue — at-risk + cancel-path bubble to
 * the top above celebrations, per [03-task-queue.md](lovro-brief/03-task-queue.md).
 */
export const BUCKET_PRIORITY: Record<string, number> = {
  cancel_path: 1,
  at_risk: 2,
  admin: 3,
  event: 4,
  crushing: 5,
  on_track: 6,
};
