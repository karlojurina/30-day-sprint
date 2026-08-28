"use client";

/**
 * A hard cap on how often something may run, regardless of what calls it.
 *
 * Why this exists: on 2026-08-27 a student's browser called /api/auth/me and
 * /api/student/data roughly once per second for 72 seconds straight (~800
 * Supabase queries from one tab). The refresh storm that came with it drained
 * Supabase's token bucket, the 429 made auth-js delete his session, and he was
 * bounced to /login. Five fixes chased the TRIGGER and none of them was
 * confirmed.
 *
 * This does not care what the trigger is. Whatever calls it — a token event, a
 * focus event, a render loop, something nobody has thought of — the call rate
 * is capped. A loop becomes one call per interval instead of seventy.
 *
 * Gates are MODULE-level by design, never a ref or state: if the loop is driven
 * by remounts, a per-instance gate resets each time and never holds.
 */

/** How often a gate is allowed to phone home about what it blocked. */
const REPORT_INTERVAL_MS = 30_000;

export interface CallGate {
  /** true = run it. false = too soon, skip this call. */
  allow(trigger: string): boolean;
}

export function createCallGate(name: string, minIntervalMs: number): CallGate {
  let lastRunAt = 0;
  let blockedSinceReport = 0;
  let lastReportAt = 0;
  let lastTrigger = "";

  function maybeReport(now: number) {
    if (now - lastReportAt < REPORT_INTERVAL_MS) return;
    lastReportAt = now;
    const blocked = blockedSinceReport;
    blockedSinceReport = 0;
    // Blocked calls are the interesting signal — a healthy page blocks none.
    // One line per 30s, never per blocked call, so telemetry can't become the
    // next runaway loop.
    void reportClientEvent({
      gate: name,
      blocked,
      windowMs: REPORT_INTERVAL_MS,
      lastTrigger,
      path: typeof location !== "undefined" ? location.pathname : "",
    });
  }

  return {
    allow(trigger: string): boolean {
      const now = Date.now();
      if (now - lastRunAt < minIntervalMs) {
        blockedSinceReport++;
        lastTrigger = trigger;
        maybeReport(now);
        return false;
      }
      lastRunAt = now;
      return true;
    },
  };
}

/**
 * Fire-and-forget telemetry. Client-side breakage is invisible in Vercel logs,
 * which is why this bug took a week and six rounds of student screenshots to
 * even see. Never throws, never blocks, never retries.
 */
export async function reportClientEvent(
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch("/api/client-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Telemetry must never affect the page.
  }
}
