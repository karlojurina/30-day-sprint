/**
 * Shared cron auth + audit helper.
 *
 * Replaces the duplicated `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``
 * pattern in 6 cron routes with a whitespace-trimmed, structured-result
 * verifier — and adds a `cron_runs` audit row on every invocation so we
 * can tell "did Vercel fire?" SEPARABLE from "did the work succeed?".
 *
 * Why structured results: previously every cron returned a generic 401
 * "Unauthorized" on auth failure. We couldn't tell from the response
 * (or Vercel's invocation log) WHY — wrong secret, missing header,
 * or no secret configured at all. The CRON_SECRET-drift incident
 * earlier this week proved this matters: silent 401s leave no
 * diagnostic trail. Now every auth failure also writes a `cron_runs`
 * row with the failure reason AND logs a `[CRON_AUTH_FAIL]` marker
 * to console.error so Vercel's log filter surfaces it.
 *
 * The `cron_runs` table is created in the v82 migration shipping
 * alongside this file.
 */

import { createServiceClient } from "@/lib/supabase-server";

export interface CronAuthResult {
  ok: boolean;
  reason:
    | "ok"
    | "no_secret_configured"
    | "missing_header"
    | "mismatch";
}

/**
 * Verify a cron request's Authorization header against
 * process.env.CRON_SECRET. Whitespace-trimmed on both sides so a
 * stray newline / leading space from an env-var edit doesn't silently
 * 401 the entire cron platform (the symptom we hit earlier this week).
 */
export function verifyCronAuth(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: false, reason: "no_secret_configured" };
  }
  const header = request.headers.get("authorization")?.trim();
  if (!header) {
    return { ok: false, reason: "missing_header" };
  }
  if (header !== `Bearer ${secret}`) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, reason: "ok" };
}

/**
 * Standard 401 response for cron auth failures. Logs a known marker
 * string to console.error so Vercel's log filter can surface auth
 * failures even when the DB audit write also fails.
 */
export function cronUnauthorizedResponse(reason: string): Response {
  console.error(`[CRON_AUTH_FAIL] reason=${reason}`);
  return new Response(
    JSON.stringify({ error: "Unauthorized", reason }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Write a `cron_runs` row at the START of a cron invocation.
 * Returns the row id so the caller can update it on finish.
 * Best-effort — never throws. If the audit write fails, the cron
 * still proceeds (we'd rather lose the audit trail than crash
 * actual business logic).
 */
export async function logCronStart(
  routeName: string,
  authStatus: string,
): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("cron_runs")
      .insert({
        route_name: routeName,
        auth_status: authStatus,
        status: authStatus === "ok" ? "running" : "auth_failed",
      })
      .select("id")
      .single();
    if (error) {
      console.error(
        `cron-audit: logCronStart failed for ${routeName}: ${error.message}`,
      );
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error("cron-audit: logCronStart threw:", err);
    return null;
  }
}

/**
 * Update the `cron_runs` row at the END of a cron invocation with
 * the final status, optional error message, and optional rows-affected
 * count. Best-effort — never throws.
 */
export async function logCronFinish(
  runId: string | null,
  status: "success" | "failed",
  details: { error?: string; rowsAffected?: number } = {},
): Promise<void> {
  if (!runId) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        error_message: details.error ?? null,
        rows_affected: details.rowsAffected ?? null,
      })
      .eq("id", runId);
    if (error) {
      console.error(
        `cron-audit: logCronFinish failed for run ${runId}: ${error.message}`,
      );
    }
  } catch (err) {
    console.error("cron-audit: logCronFinish threw:", err);
  }
}
