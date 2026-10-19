/**
 * The 30% page's answer (GET /api/admin/thirty), built from loadThirtyData's
 * reads by the student app's own rule. Pure: no database, no clock of its
 * own; the route hands it the moment and the course switch's date.
 *
 * A pending request is judged the way POST /api/discounts/approve judges it
 * on the new course: approvalVerdict, then explainOldCourseRequest for a
 * request made before the switch, then the ads check (admin rebuild PRD, C9).
 * The page shows its own fixed sentence for each answer (VERDICT_TEXT): the
 * route's error texts name a button the page no longer has.
 *
 * Every other row, and Can still earn, reads discountState as the student
 * app computes it: the request routes' call (decideDiscountRequest), with
 * every video done up to now and every request of the student.
 *
 * The numbers on a pending row are the ones Approve judged: the videos
 * loaded after the request (after the switch, for one made before it) are
 * not asked for, only videos done by the deadline count, and once the
 * deadline has passed the count says so (`countedByDeadline`).
 */

import {
  DISCOUNT_ELIGIBLE_FROM,
  DISCOUNT_SHARED_DEADLINE,
  discountEndsAt,
  discountState,
  discountWindow,
  requiredLessons,
} from "@/lib/world/discount";
import type { DiscountLesson, DiscountState, DiscountWindow } from "@/lib/world/discount";
import {
  approvalVerdict,
  explainOldCourseRequest,
  factsFromReads,
  toDiscountLessons,
  videoDoneIds,
} from "@/lib/world/discount-server";
import type { ApprovalRefusal, ApprovalVerdict, DiscountFacts, DiscountReads, VideoRow } from "@/lib/world/discount-server";
import { planLabel } from "./plans";
import type { PlanLabel } from "./plans";
import { dayLabel, dayTimeLabel } from "./croatia-dates";
import type { ThirtyAnswer, ThirtyCompletion, ThirtyContact, ThirtyData, ThirtyLesson, ThirtyStudent } from "./thirty-data";

/** A team member as a row names them. `name` is null when the id is no longer a team member. */
export interface TeamRef {
  id: string;
  name: string | null;
}

export interface StudentBrief {
  id: string;
  name: string | null;
  email: string | null;
  discord: { userId: string | null; username: string | null };
  plan: PlanLabel;
  /** membership_status: active, past_due, canceled or expired. */
  status: string;
  csmExempt: boolean;
  adsVerified: boolean;
  /** A Whop backfill ran since the switch (student_whop_sync.last_sync_at at or after curriculum_reset_at). */
  whopPulled: boolean;
}

/**
 * Where a student stands. The three counts are null when the student's
 * progress could not be read (the verdict says so); the first payment and the
 * deadline come from the student's row and are always there.
 */
export interface Facts {
  firstPaidAt: string | null;
  /** "shared": the end of Fri 23 Oct, Croatia time. "own": 14 days from the first payment. Null when the offer is closed to them. */
  window: DiscountWindow | null;
  deadline: string | null;
  deadlinePassed: boolean;
  videosDone: number | null;
  videosTotal: number | null;
  /** Only videos done by the deadline are counted, and the deadline has passed: show the count as "done by the deadline". */
  countedByDeadline: boolean;
  /** The length of the videos still to watch, in seconds. */
  secondsLeft: number | null;
}

/**
 * Why a request may not be approved. ApprovalRefusal's reasons are the
 * rule's; "ads": the rule says yes and the ads are not verified;
 * "read-failed": the student's progress could not be read; "unknown": the
 * rule gave no reason (it cannot, today).
 */
export type VerdictReason = ApprovalRefusal | "ads" | "read-failed" | "unknown";

export interface Verdict {
  /** Approve would approve it now. */
  ok: boolean;
  /** Null when ok. */
  reason: VerdictReason | null;
  /** One of VERDICT_TEXT's sentences. */
  text: string;
  /** Asked on the old course, before the switch, and refused over its videos (explainOldCourseRequest). */
  oldCourse: boolean;
}

/** An action item the student handed in, or watched and has not handed in yet. */
export interface Submission {
  lessonId: string;
  title: string;
  handedIn: boolean;
  link: string | null;
}

export interface LastContact {
  at: string;
  by: TeamRef | null;
  scenarioId: string;
  outcome: "replied" | "no_reply" | null;
}

export interface ThirtyRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "applied";
  askedAt: string;
  reviewedAt: string | null;
  reviewedBy: TeamRef | null;
  appliedAt: string | null;
  appliedBy: TeamRef | null;
  promoCode: string | null;
  rejectionReason: string | null;
  student: StudentBrief;
  facts: Facts;
  /** Pending rows only. */
  verdict: Verdict | null;
  /** Pending rows only; null there too when the completions could not be read. */
  submissions: Submission[] | null;
  /** The survey answers, in the questions' order. A number for a scale question. */
  answers: Array<{ questionId: string; answer: string | number | null }>;
}

export interface ThirtyEarnRow {
  student: StudentBrief;
  facts: Facts;
  state: "locked" | "ready";
  lastContact: LastContact | null;
}

export interface ThirtyView {
  generatedAt: string;
  sharedDeadline: string;
  /** The videos the offer asks for today, or null when the catalog or the videos could not be read. */
  requiredCount: number | null;
  questions: Array<{ id: string; orderNum: number; text: string }>;
  /** Every listed request, newest first: the page splits them into its tabs by status. */
  requests: ThirtyRequestRow[];
  /** Who can still earn it, by deadline, then fewest videos left. */
  canStillEarn: ThirtyEarnRow[];
  /** Members who could be on Can still earn but whose progress could not be read: they are left out of it, and the page says how many. */
  unchecked: number;
}

const ELIGIBLE_DAY = dayLabel(DISCOUNT_ELIGIBLE_FROM);

/** The sentences the page shows for a verdict. Plain words, no em dash: the team reads them as they are. */
export const VERDICT_TEXT = {
  yes: "Every video up to the checkpoint was done in time.",
  ads: "Every video up to the checkpoint was done in time. The ads are not verified yet.",
  lockedOpen: "Not every video up to the checkpoint is done yet.",
  lockedClosed: "Not every video up to the checkpoint was done by the deadline.",
  beforeLaunch: `The first payment was before ${ELIGIBLE_DAY}, so this student cannot earn the 30%.`,
  noPayment: "There is no first payment on file for this student, so the rule cannot judge this request.",
  noGate: "The course has no checkpoint lesson with a video, so nobody can earn the 30% right now.",
  oldCourse: "Asked on the old course, before the switch.",
  oldCourseNoGate:
    "Asked on the old course, before the switch, when no video up to the checkpoint was loaded yet. Judge it by hand.",
  lateRequest: "This request was made after the student's deadline, later than the app's Apply allows.",
  anotherRequest: "This student already had a request decided, and the app takes no new one after that.",
  readFailed: "Couldn't read this student's progress, so there is no verdict. Reload the page to try again.",
  unknown: "The rule could not judge this request. Judge it by hand.",
} as const;

/**
 * The verdict once the "Ads verified" tick changes on the page: the rule's
 * answer stays, and the ads check, which the approve route runs last, is
 * done again, as toVerdict does it. The page calls this after the tick is
 * saved, so Approve opens (or closes) without reading every student again.
 */
export function verdictWithAds(verdict: Verdict, adsVerified: boolean): Verdict {
  if (verdict.ok && !adsVerified) return { ok: false, reason: "ads", text: VERDICT_TEXT.ads, oldCourse: false };
  if (!verdict.ok && verdict.reason === "ads" && adsVerified) {
    return { ok: true, reason: null, text: VERDICT_TEXT.yes, oldCourse: false };
  }
  return verdict;
}

/** "about 2 h": the length of the videos still to watch, to the nearest hour and never under 1. Null when there is none. */
export function aboutHours(seconds: number | null | undefined): string | null {
  if (seconds == null || !(seconds > 0)) return null;
  return `about ${Math.max(1, Math.round(seconds / 3600))} h`;
}

/** "1 video left", "4 videos left". */
export function videosLeftText(left: number): string {
  return `${left} ${left === 1 ? "video" : "videos"} left`;
}

/** The two 30% reasons a student can need a message for (admin rebuild PRD, C4). */
export type ThirtyReasonKind = "thirty_closing" | "thirty_ready";

/**
 * C4's words for the two 30% reasons, which Today shows and a mark records
 * (behavior_summary): "30% closes Fri 23 Oct, 23:59: 4 videos left (about
 * 1 h)" and "Can apply for the 30% now, until Fri 23 Oct, 23:59". One place,
 * so Today and the 30% page record the same sentence.
 */
export function thirtyReasonText(kind: ThirtyReasonKind, facts: Facts): string {
  const until = facts.deadline ? dayTimeLabel(facts.deadline) : "";
  if (kind === "thirty_ready") {
    return until ? `Can apply for the 30% now, until ${until}` : "Can apply for the 30% now";
  }
  const left = (facts.videosTotal ?? 0) - (facts.videosDone ?? 0);
  const hours = aboutHours(facts.secondsLeft);
  const rest = `${videosLeftText(left)}${hours ? ` (${hours})` : ""}`;
  return until ? `30% closes ${until}: ${rest}` : `30% still open: ${rest}`;
}

/**
 * Can this member be on Can still earn: a first payment from 1 October (the
 * rule's own window), active or past due, not exempt. Whether they are on it
 * is then the rule's state alone: locked or ready.
 */
export function canStillEarnCandidate(s: Pick<ThirtyStudent, "first_paid_at" | "membership_status" | "csm_exempt">): boolean {
  if (s.csm_exempt === true) return false;
  if (s.membership_status !== "active" && s.membership_status !== "past_due") return false;
  return !("closed" in discountWindow(s.first_paid_at));
}

/** A Whop backfill ran since the switch. Before the switch any backfill counts. */
export function whopPulled(lastSyncAt: string | null | undefined, resetAt: string | null): boolean {
  if (!lastSyncAt) return false;
  const t = Date.parse(lastSyncAt);
  if (!Number.isFinite(t)) return false;
  if (resetAt == null) return true;
  return t >= Date.parse(resetAt);
}

/** The first payment and the deadline, with no counts: the progress could not be read. */
function factsWithoutProgress(firstPaidAt: string | null, now: Date): Facts {
  const w = discountWindow(firstPaidAt);
  const deadline = "closed" in w ? null : w.endsAt.toISOString();
  return {
    firstPaidAt,
    window: "closed" in w ? null : w.window,
    deadline,
    deadlinePassed: deadline != null && now.getTime() > Date.parse(deadline),
    videosDone: null,
    videosTotal: null,
    countedByDeadline: false,
    secondsLeft: null,
  };
}

/** The counts over the lessons the offer asks for (`lessons`, as discount.ts reads them) and the videos `done`. */
function countFacts(
  firstPaidAt: string | null,
  lessons: readonly DiscountLesson[],
  done: ReadonlySet<string>,
  now: Date,
  countedByDeadline: boolean,
): Facts {
  const required = requiredLessons(lessons);
  const left = required.filter((l) => !done.has(l.id));
  return {
    ...factsWithoutProgress(firstPaidAt, now),
    videosDone: required.length - left.length,
    videosTotal: required.length,
    countedByDeadline,
    secondsLeft: left.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0),
  };
}

/**
 * The 30% as the student app computes it: the request routes' discountState
 * call (decideDiscountRequest), every video done up to now, every request of
 * the student. Null when a read failed.
 */
export function studentAppView(reads: DiscountReads, now: Date): { state: DiscountState; facts: Facts } | null {
  const f = factsFromReads(reads);
  if (!f.ok) return null;
  const { firstPaidAt, lessons, completions, requests } = f.facts;
  const done = videoDoneIds(completions);
  return {
    state: discountState({ now, firstPaidAt, lessons, videoDoneIds: done, requests }),
    facts: countFacts(firstPaidAt, lessons, done, now, false),
  };
}

/**
 * What approvalVerdict judged a request by, rebuilt from the same reads: the
 * lessons with the videos loaded after the request (or after the switch, for
 * a request made before it) left out, and the videos done by the deadline.
 * These lines repeat approvalVerdict's own (discount-server.ts); the test
 * fails if the two ever part, because the verdict must say yes exactly when
 * this count is full.
 */
function judgedFacts(f: DiscountFacts, videos: readonly VideoRow[], now: Date, askedAt: string, resetAt: string | null): Facts {
  const asked = Date.parse(askedAt);
  const reset = resetAt == null ? NaN : Date.parse(resetAt);
  const videosAsOf = Number.isFinite(asked) && Number.isFinite(reset) && reset > asked ? reset : asked;
  const loadedLater = new Set(
    Number.isFinite(videosAsOf)
      ? videos.filter((v) => v.created_at != null && Date.parse(v.created_at) > videosAsOf).map((v) => v.lesson_id)
      : [],
  );
  const lessons = f.lessons.map((l) => (loadedLater.has(l.id) ? { ...l, has_video: false } : l));
  const endsAt = discountEndsAt(f.firstPaidAt);
  const done = videoDoneIds(f.completions, endsAt ?? undefined);
  return countFacts(f.firstPaidAt, lessons, done, now, endsAt != null && now.getTime() > endsAt.getTime());
}

function refusalText(reason: VerdictReason, oldCourse: boolean, deadlinePassed: boolean): string {
  let text: string;
  switch (reason) {
    case "locked":
      text = deadlinePassed ? VERDICT_TEXT.lockedClosed : VERDICT_TEXT.lockedOpen;
      break;
    case "no-gate":
      if (oldCourse) return VERDICT_TEXT.oldCourseNoGate;
      text = VERDICT_TEXT.noGate;
      break;
    case "before-launch":
      text = VERDICT_TEXT.beforeLaunch;
      break;
    case "no-payment":
      text = VERDICT_TEXT.noPayment;
      break;
    case "late-request":
      text = VERDICT_TEXT.lateRequest;
      break;
    case "another-request":
      text = VERDICT_TEXT.anotherRequest;
      break;
    case "ads":
      text = VERDICT_TEXT.ads;
      break;
    case "read-failed":
      text = VERDICT_TEXT.readFailed;
      break;
    default:
      text = VERDICT_TEXT.unknown;
  }
  return oldCourse ? `${VERDICT_TEXT.oldCourse} ${text}` : text;
}

/** The approve route's answer as the page shows it, the ads check last, as the route has it. */
function toVerdict(raw: ApprovalVerdict, explained: ApprovalVerdict, adsVerified: boolean, deadlinePassed: boolean): Verdict {
  if (explained.ok) {
    return adsVerified
      ? { ok: true, reason: null, text: VERDICT_TEXT.yes, oldCourse: false }
      : { ok: false, reason: "ads", text: VERDICT_TEXT.ads, oldCourse: false };
  }
  if (explained.status === 500) {
    return { ok: false, reason: "read-failed", text: VERDICT_TEXT.readFailed, oldCourse: false };
  }
  const oldCourse = !raw.ok && explained.error !== raw.error;
  const reason: VerdictReason = explained.reason ?? "unknown";
  return { ok: false, reason, text: refusalText(reason, oldCourse, deadlinePassed), oldCourse };
}

/**
 * A pending request as Approve would judge it now (C9): approvalVerdict, then
 * explainOldCourseRequest for a refusal of one made before the switch, then
 * the ads check. The facts are the ones the verdict judged.
 */
export function judgeRequest(
  reads: DiscountReads,
  now: Date,
  request: { id: string; created_at: string },
  resetAt: string | null,
  adsVerified: boolean,
): { verdict: Verdict; facts: Facts } {
  const raw = approvalVerdict(reads, now, request.created_at, request.id, resetAt);
  const explained = !raw.ok && raw.status === 400 ? explainOldCourseRequest(raw, request.created_at, resetAt) : raw;
  const f = factsFromReads(reads);
  const facts = f.ok
    ? judgedFacts(f.facts, reads.videos.data!, now, request.created_at, resetAt)
    : factsWithoutProgress(reads.student.data?.first_paid_at ?? null, now);
  return { verdict: toVerdict(raw, explained, adsVerified, facts.deadlinePassed), facts };
}

/** The action items with a completion row, in course order, handed in or not (as the old page listed them). */
function submissionsFor(catalog: readonly ThirtyLesson[], rows: readonly ThirtyCompletion[]): Submission[] {
  const byLesson = new Map(rows.map((r) => [r.lesson_id, r] as const));
  const out: Submission[] = [];
  for (const l of catalog) {
    if (l.requires_action !== true && l.type !== "action") continue;
    const c = byLesson.get(l.id);
    if (!c) continue;
    out.push({
      lessonId: l.id,
      title: l.title ?? l.id,
      handedIn: l.requires_action === true ? c.action_completed_at != null : c.completed_at != null,
      link: c.discord_message_link ?? null,
    });
  }
  return out;
}

/** The answer as DiscountFeedbackResponses shows it: the scale or the choice for those questions, else the text, else none. */
function answerOf(a: ThirtyAnswer, questionType: string | undefined): string | number | null {
  if (questionType === "scale" && a.answer_scale != null) return a.answer_scale;
  if (questionType === "multi_choice" && a.answer_choice) return a.answer_choice;
  if (a.answer_text && a.answer_text.trim().length > 0) return a.answer_text;
  return null;
}

/** The newest completed task, or null. */
function lastContactOf(rows: readonly ThirtyContact[] | undefined, team: ReadonlyMap<string, string>): LastContact | null {
  let best: ThirtyContact | null = null;
  let bestAt = -Infinity;
  for (const r of rows ?? []) {
    const t = r.completed_at ? Date.parse(r.completed_at) : NaN;
    if (Number.isFinite(t) && t > bestAt) {
      best = r;
      bestAt = t;
    }
  }
  if (!best || !best.completed_at) return null;
  return {
    at: best.completed_at,
    by: best.completed_by ? { id: best.completed_by, name: team.get(best.completed_by) ?? null } : null,
    scenarioId: best.scenario_id,
    outcome: best.outcome === "replied" || best.outcome === "no_reply" ? best.outcome : null,
  };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildThirtyView(data: ThirtyData, now: Date, resetAt: string | null): ThirtyView {
  const students = new Map(data.students.map((s) => [s.id, s] as const));
  const questionsById = new Map(data.questions.map((q) => [q.id, q] as const));
  const ref = (id: string | null): TeamRef | null => (id ? { id, name: data.team.get(id) ?? null } : null);
  const brief = (s: ThirtyStudent): StudentBrief => ({
    id: s.id,
    name: s.name ?? null,
    email: s.email ?? null,
    discord: { userId: s.discord_user_id ?? null, username: s.discord_username ?? null },
    plan: planLabel(s.whop_plan_id),
    status: s.membership_status,
    csmExempt: s.csm_exempt === true,
    adsVerified: s.ad_submissions_verified === true,
    whopPulled: whopPulled(data.lastSyncAt.get(s.id), resetAt),
  });

  const requests = [...data.requests]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || -byId(a, b))
    .map((r): ThirtyRequestRow => {
      // loadThirtyData reads every student holding a listed request, or fails.
      const s = students.get(r.student_id)!;
      const reads = data.reads.get(s.id)!;
      let facts: Facts;
      let verdict: Verdict | null = null;
      let submissions: Submission[] | null = null;
      if (r.status === "pending") {
        const judged = judgeRequest(reads, now, r, resetAt, s.ad_submissions_verified === true);
        facts = judged.facts;
        verdict = judged.verdict;
        const done = data.completions.get(s.id);
        submissions = done && data.catalog.data ? submissionsFor(data.catalog.data, done) : null;
      } else {
        facts = studentAppView(reads, now)?.facts ?? factsWithoutProgress(s.first_paid_at ?? null, now);
      }
      const order = (a: ThirtyAnswer) => questionsById.get(a.question_id)?.order_num ?? Number.MAX_SAFE_INTEGER;
      const answers = [...(data.answers.get(r.id) ?? [])]
        .sort((a, b) => order(a) - order(b) || byId(a, b))
        .map((a) => ({ questionId: a.question_id, answer: answerOf(a, questionsById.get(a.question_id)?.question_type) }));
      return {
        id: r.id,
        status: r.status,
        askedAt: r.created_at,
        reviewedAt: r.reviewed_at ?? null,
        reviewedBy: ref(r.reviewed_by ?? null),
        appliedAt: r.applied_at ?? null,
        appliedBy: ref(r.applied_by ?? null),
        promoCode: r.promo_code ?? null,
        rejectionReason: r.rejection_reason ?? null,
        student: brief(s),
        facts,
        verdict,
        submissions,
        answers,
      };
    });

  const canStillEarn: ThirtyEarnRow[] = [];
  let unchecked = 0;
  for (const s of data.students) {
    if (!canStillEarnCandidate(s)) continue;
    const app = studentAppView(data.reads.get(s.id)!, now);
    if (!app) {
      unchecked++;
      continue;
    }
    if (app.state.kind !== "locked" && app.state.kind !== "ready") continue;
    canStillEarn.push({
      student: brief(s),
      facts: app.facts,
      state: app.state.kind,
      lastContact: lastContactOf(data.contacts.get(s.id), data.team),
    });
  }
  const left = (r: ThirtyEarnRow) => (r.facts.videosTotal ?? 0) - (r.facts.videosDone ?? 0);
  canStillEarn.sort(
    (a, b) =>
      Date.parse(a.facts.deadline!) - Date.parse(b.facts.deadline!) ||
      left(a) - left(b) ||
      (a.student.name ?? "").localeCompare(b.student.name ?? "") ||
      byId(a.student, b.student),
  );

  return {
    generatedAt: now.toISOString(),
    sharedDeadline: DISCOUNT_SHARED_DEADLINE,
    requiredCount:
      data.catalog.data && data.videos.data
        ? requiredLessons(toDiscountLessons(data.catalog.data, new Set(data.videos.data.map((v) => v.lesson_id)))).length
        : null,
    questions: data.questions.map((q) => ({ id: q.id, orderNum: q.order_num, text: q.question_text })),
    requests,
    canStillEarn,
    unchecked,
  };
}
