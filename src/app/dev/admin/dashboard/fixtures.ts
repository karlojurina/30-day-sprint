/**
 * Made-up reads for /dev/admin/dashboard (admin rebuild 2, WI-2). Development
 * only: the dev layout calls notFound() anywhere else.
 *
 * MADE-UP DATA ONLY. This repository is public: the students below are ids
 * and dates, generated from a fixed seed, with no name, email or account.
 *
 * The fixture answers the reads the page makes, in their shapes
 * (DashboardReads), and the page runs the real buildDashboard over them
 * (src/lib/admin/dashboard-metrics.ts). The snapshot rows are worked out from
 * the same made-up students the way rebuild_daily_snapshots counts them, so
 * the lines and the numbers fit together as they do on the live page.
 *
 *   ?state=full      Tue 20 Oct, the day after the switch: Month 2 waits for
 *                    the first renewals, Avg progress has 2 days of line; 3
 *                    requests need a hand, 27 codes are on memberships
 *          renewed   Tue 24 Nov: Month 2 has its rate, the tasks reset ran;
 *                    5 need a hand, 212 codes on memberships
 *          empty     nobody yet: every tile at its empty words ("Nothing
 *                    waiting", "None yet" for the 30%)
 *          loading   the reads never answer: the skeletons
 *          error     every read fails
 *          partial   the open tasks and the daily snapshots fail, the rest loads
 *   ?refresh=ok | fail | partial   what Refresh answers (default ok): the
 *                    route's 200, its 403, or a 200 whose Whop sync failed
 */

import type { DashboardSource } from "@/components/admin/dashboard/DashboardView";
import type {
  BountyStamp,
  CancelingRow,
  DashRead,
  DashStudent,
  DashboardReads,
  SnapshotRow,
} from "@/lib/admin/dashboard-metrics";

export type DashFixtureState = "full" | "renewed" | "empty" | "loading" | "error" | "partial";
export const DASH_FIXTURE_STATES: DashFixtureState[] = ["full", "renewed", "empty", "loading", "error", "partial"];
export type DashFixtureRefresh = "ok" | "fail" | "partial";
export const DASH_FIXTURE_REFRESH: DashFixtureRefresh[] = ["ok", "fail", "partial"];

/** Tue 20 Oct 2026, 10:30 in Croatia: the day after the switch. */
const NOW_FULL = "2026-10-20T08:30:00.000Z";
/** Tue 24 Nov 2026, 10:00 in Croatia: the first Month 2 rates are in. */
const NOW_RENEWED = "2026-11-24T09:00:00.000Z";
/** The course switch, as admin_config holds it. */
const RESET_AT = "2026-10-19T14:33:33.972Z";
/** The tasks reset (v109), as v109 writes it: ISO in UTC (tasks-reset.ts refuses any other text). */
const TASKS_RESET_AT = "2026-10-21T05:00:00.123Z";

const MONTHLY = "plan_4ZrwR4PmBsVsx";
const DAY = 86_400_000;

/** A small seeded random number source, so every load shows the same page. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const dateOf = (ms: number) => iso(ms).slice(0, 10);

/**
 * The students: paid from 25 May on, about 4 a day before the launch and 22 a
 * day from it. A student whose first renewal has resolved by `now` kept paying
 * 3 times in 5 (some cancelled later, after it); one who did not lost access at
 * the end of the month they paid for. A few booked a cancel and still have access.
 */
function makeStudents(nowMs: number): { students: DashStudent[]; stamps: BountyStamp[] } {
  const r = seeded(20261009);
  const students: DashStudent[] = [];
  const stamps: BountyStamp[] = [];
  const launch = Date.parse("2026-10-08T22:00:00.000Z");
  let t = Date.parse("2026-05-25T07:00:00.000Z");
  let n = 0;
  while (t < nowMs - 3_600_000) {
    const perDay = t < launch ? 4 : 22;
    t += (DAY / perDay) * (0.4 + r() * 1.2);
    if (t >= nowMs - 3_600_000) break;
    n += 1;
    const id = `fx-${String(n).padStart(4, "0")}`;
    const paid = t;
    let status = "active";
    let canceledAt: number | null = null;
    let cancelBooked: number | null = null;
    if (paid + 37 * DAY <= nowMs) {
      if (r() < 0.6) {
        if (r() < 0.12 && paid + 61 * DAY < nowMs) {
          status = "canceled";
          canceledAt = paid + 61 * DAY;
        } else if (r() < 0.05) status = "past_due";
      } else {
        status = "canceled";
        canceledAt = paid + 30 * DAY;
      }
    } else if (paid + 30 * DAY <= nowMs && r() < 0.4) {
      status = "canceled";
      canceledAt = paid + 30 * DAY;
    } else {
      const roll = r();
      if (roll < 0.07) {
        const booked = paid + (2 + r() * 20) * DAY;
        if (booked < nowMs) cancelBooked = booked;
      } else if (roll < 0.11) status = "past_due";
    }
    students.push({
      id,
      membership_status: status,
      whop_plan_id: MONTHLY,
      first_paid_at: iso(paid),
      canceled_at: canceledAt === null ? null : iso(canceledAt),
      cancel_scheduled_at: cancelBooked === null ? null : iso(cancelBooked),
    });
    if (r() < 0.16) {
      const stamped = paid + (3 + r() * 24) * DAY;
      if (stamped < nowMs) stamps.push({ student_id: id, bounty_access_claimed_at: iso(stamped) });
    }
  }
  // Stamps of students outside the population (a free seat, a refund): never counted.
  stamps.push(
    { student_id: "fx-outside-1", bounty_access_claimed_at: iso(nowMs - 2 * DAY) },
    { student_id: "fx-outside-2", bounty_access_claimed_at: iso(nowMs - 5 * DAY) },
  );
  return { students, stamps };
}

/** The 14 UTC dates up to `nowMs`. */
function last14(nowMs: number): string[] {
  const today = Math.floor(nowMs / DAY) * DAY;
  return Array.from({ length: 14 }, (_, i) => dateOf(today - (13 - i) * DAY));
}

/**
 * The snapshot rows, counted from the students the way rebuild_daily_snapshots
 * does: active is first paid by the day and access not ended by it, churned is
 * access ended that day. Avg progress is made up: the old course's 36% until
 * the switch, then the new course from near 0.
 */
function makeSnapshots(students: DashStudent[], nowMs: number): { snapshots: SnapshotRow[]; canceling: CancelingRow[] } {
  const switchDate = RESET_AT.slice(0, 10);
  const snapshots: SnapshotRow[] = [];
  const canceling: CancelingRow[] = [];
  const days = last14(nowMs);
  days.forEach((d, i) => {
    const active = students.filter(
      (s) => s.first_paid_at!.slice(0, 10) <= d && (s.canceled_at === null || s.canceled_at.slice(0, 10) > d),
    ).length;
    const churnedToday = students.filter((s) => s.canceled_at !== null && s.canceled_at.slice(0, 10) === d).length;
    const sinceSwitch = Math.round((Date.parse(d) - Date.parse(switchDate)) / DAY);
    const avg = d < switchDate ? 36.4 + ((i * 7) % 5) / 20 : 2.66 + sinceSwitch * 0.05 + Math.max(0, sinceSwitch - 1) * 0.31;
    const isToday = i === days.length - 1;
    snapshots.push({
      snapshot_date: d,
      // The nightly run at 00:30 UTC rewrites yesterday and today.
      created_at: isToday ? `${d}T00:30:12.000Z` : iso(Date.parse(d) + DAY + 30 * 60_000 + 12_000),
      active_count: active,
      churned_count: churnedToday,
      avg_progress: Number(avg.toFixed(2)),
      active_count_cohort: active,
      churned_count_cohort: churnedToday,
      avg_progress_cohort: Number(avg.toFixed(2)),
    });
    const cancelingNow = students.filter(
      (s) =>
        s.cancel_scheduled_at !== null &&
        s.cancel_scheduled_at.slice(0, 10) <= d &&
        (s.canceled_at === null || s.canceled_at.slice(0, 10) > d),
    ).length;
    canceling.push({ snapshot_date: d, canceling_count_cohort: cancelingNow });
  });
  return { snapshots, canceling };
}

const ok = <T,>(data: T): DashRead<T> => ({ ok: true, data });
const no = (error: string): DashRead<never> => ({ ok: false, error });
const TIMEOUT = "canceling statement due to statement timeout";

function readsFor(state: DashFixtureState, nowMs: number): DashboardReads {
  if (state === "error") {
    return {
      students: no(TIMEOUT),
      bounty: no("permission denied for table student_milestones"),
      tasksResetAt: no("admin_config: permission denied for table admin_config"),
      resetAt: no("admin_config: permission denied for table admin_config"),
      openTasks: no("admin_config: permission denied for table admin_config"),
      needsHand: no("discount_request_events (write_failed): permission denied for table discount_request_events"),
      thirtyApplied: no("permission denied for table discount_requests"),
      snapshots: no(TIMEOUT),
      canceling: no("permission denied for table canceling_snapshots"),
    };
  }
  if (state === "empty") {
    return {
      students: ok([]),
      bounty: ok([]),
      tasksResetAt: ok(null),
      resetAt: ok(RESET_AT),
      openTasks: ok(0),
      needsHand: ok(0),
      thirtyApplied: ok(0),
      snapshots: ok([]),
      canceling: ok([]),
    };
  }
  const { students, stamps } = makeStudents(nowMs);
  const { snapshots, canceling } = makeSnapshots(students, nowMs);
  const renewed = state === "renewed";
  return {
    students: ok(students),
    bounty: ok(stamps),
    tasksResetAt: ok(renewed ? TASKS_RESET_AT : null),
    resetAt: ok(RESET_AT),
    openTasks: state === "partial" ? no("permission denied for table tasks") : ok(renewed ? 12 : 95),
    needsHand: ok(renewed ? 5 : 3),
    thirtyApplied: ok(renewed ? 212 : 27),
    snapshots: state === "partial" ? no(TIMEOUT) : ok(snapshots),
    canceling: ok(canceling),
  };
}

/** The body POST /api/admin/refresh-everything answers when every step went through. */
const REFRESHED = {
  ok: true,
  sync: { fetched: 1031, inserted: 3, updated: 118 },
  rebuild: { ok: true },
  engagement: { alerts: 2 },
  csm_tasks: { tasks_created: 4 },
  na_tasks: { ok: true },
};

/** One call the page made, for world-tests (window.__dashCalls on the dev page). */
export interface DashFixtureCall {
  name: "load" | "refresh";
  at: string;
}

/**
 * The Dashboard's source, answered from the made-up reads a moment later, as
 * a real read would be, so the loading state shows. `now` is the page's
 * clock, pinned to the fixture's day.
 */
export function fixtureDashboard(opts: { state: DashFixtureState; refresh: DashFixtureRefresh }): {
  source: DashboardSource;
  now: () => number;
  calls: DashFixtureCall[];
} {
  const nowMs = Date.parse(opts.state === "renewed" ? NOW_RENEWED : NOW_FULL);
  const calls: DashFixtureCall[] = [];
  const later = <T,>(value: T, ms = 300) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  return {
    now: () => nowMs,
    calls,
    source: {
      load(at) {
        calls.push({ name: "load", at: iso(at) });
        if (opts.state === "loading") return new Promise<DashboardReads>(() => {});
        return later(readsFor(opts.state, at));
      },
      refresh() {
        calls.push({ name: "refresh", at: iso(nowMs) });
        if (opts.refresh === "fail") return later({ status: 403, body: { error: "Founder or admin role required" } }, 600);
        if (opts.refresh === "partial") {
          return later({ status: 200, body: { ...REFRESHED, sync: { error: "HTTP 502" } } }, 600);
        }
        return later({ status: 200, body: REFRESHED }, 600);
      },
    },
  };
}
