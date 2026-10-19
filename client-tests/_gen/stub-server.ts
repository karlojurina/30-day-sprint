// What the server copies import, standing in for the real thing. build.mjs
// points their import lines here: Next's response and after(), the
// service-role Supabase client, Whop (the completions read, the login's
// calls and the approve route's promo code), the team's login, the steps that
// run after a lesson (and the CSM's hook for a discount request), and which
// catalog is live. Hand-written, like
// stub-supabase.ts and stub-call-gate.ts; the routes and libraries under test
// are the real source.
//
// THE STREAK is the one step that is not only recorded: updateStudentStreak,
// tickStudentStreak and markStudentActive are recorded ("streak", "streak",
// "active"), then run for real (the copy of update-streak.ts) on the client
// the route passes in, so a test can read the student_streaks row and
// students.last_active_at they wrote (streak.test.mjs).
//
// THE DATABASE. Rows live in plain arrays, one per table. The client answers
// the calls those routes make the way PostgREST answers them, where a route
// depends on the answer:
//   - .single() on no row, or on several, is an error with no data;
//     .maybeSingle() on no row is no error and null.
//   - a select hands back only the columns it names, and a column a declared
//     table does not have is an error (42703), so a route asking for a column
//     that is not there fails here as it would there.
//   - insert refuses a second row for a unique key (23505) and a lesson that is
//     not in `lessons` (23503), and then writes nothing. `discount_requests`
//     has v106's partial index, refused under its real name and message.
//   - upsert with ignoreDuplicates leaves an existing row alone and returns,
//     with .select(), only the rows it added (INSERT ... ON CONFLICT DO NOTHING
//     RETURNING). Without it the named columns of the existing row are
//     overwritten (merge-duplicates), and the row is returned.
//   - a column left out of an insert takes the table's default
//     (student_lesson_completions.completed_at defaults to now()).
//   - a select hands back at most MAX_ROWS (1000) rows, PostgREST's max-rows
//     on Supabase, whatever .limit() or .range() asks for. .range(from, to)
//     is the page from row `from` to row `to`, after the order. .order() can
//     be called more than once: each call adds a column, as supabase-js does,
//     and a null sorts last going up and first going down, as in Postgres.
// `fail['table.op']` makes every such call fail with that error, and
// `failWhen(call)` fails the calls it returns an error for (one batch of a
// bulk read, say: the call's filters are in `call.filters`). With `shuffle`
// set to a number, every select's rows are shuffled (seeded by that number
// and the call's place in the log, so a run repeats) before the order is
// applied: rows the order does not tell apart come back in no fixed order,
// as Postgres may hand them, and pages read without an order on a unique key
// repeat some rows and skip others, as they can there. Every call is
// logged in `log`, in order. `.rpc(fn, args)` runs the test's own stand-in for
// that database function from `functions[fn]` (none: PostgREST's "not found"),
// handing it the arguments the calling client was made with (createClient's
// address, key and options, also logged as the call's `options`), so a
// stand-in can tell the service role's client from one carrying a student's
// token, as the database does.
// `auth` answers a password sign-in from `authUsers` (email -> id and
// password) and adds to it on admin.createUser, as the login callback needs.

import * as realStreak from "./update-streak.ts";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
/** A unique index with a WHERE: only rows it matches are compared. */
type PartialUnique = { name: string; key: string[]; where: (r: Row) => boolean };

const now = () => new Date().toISOString();
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const none = () => null;

/** PostgREST's max-rows on Supabase: no select answers more rows than this. */
export const MAX_ROWS = 1000;

/** The tables whose columns are known, with each column's default. */
const DEFS: Record<string, { columns: Record<string, () => unknown>; unique?: string[][]; partialUnique?: PartialUnique[] }> = {
  students: {
    columns: {
      id: newId, whop_user_id: none, supabase_user_id: none, email: none, name: none,
      joined_at: now, first_paid_at: none, membership_status: () => "active", cancel_scheduled_at: none,
      last_active_at: now, ad_submissions_verified: () => false,
      discord_user_id: none, discord_username: none, whop_plan_id: none, csm_exempt: () => false,
    },
    unique: [["whop_user_id"]],
  },
  team_members: {
    columns: { id: newId, email: none, full_name: none, role: () => "csm", created_at: now },
    unique: [["id"]],
  },
  discount_feedback_questions: {
    columns: {
      id: newId, order_num: () => 0, question_text: none, question_type: () => "open_text", options: none,
      scale_min: none, scale_max: none, is_required: () => false, is_active: () => true, created_at: now,
    },
  },
  discount_feedback_responses: {
    columns: {
      id: newId, discount_request_id: none, question_id: none, answer_scale: none, answer_choice: none,
      answer_text: none, created_at: now,
    },
  },
  student_streaks: {
    columns: {
      student_id: none, current_streak: () => 0, longest_streak: () => 0, last_streak_date: none, updated_at: now,
    },
    unique: [["student_id"]],
  },
  lessons: {
    columns: {
      id: none, region_id: none, type: () => "watch", title: none, day: none, sort_order: () => 0,
      requires_action: () => false, counts_toward_progress: () => true, whop_lesson_id: none,
      is_gate: () => false, duration_seconds: none,
    },
    unique: [["id"]],
  },
  student_lesson_completions: {
    columns: {
      id: newId, student_id: none, lesson_id: none, completed_at: now,
      action_completed_at: none, skipped_at: none, discord_message_link: none,
    },
    unique: [["student_id", "lesson_id"]],
  },
  student_whop_sync: {
    columns: {
      student_id: none, last_sync_at: none, last_sync_error: none, last_sync_error_at: none,
      last_sync_fetched: none, last_sync_matched: none, last_sync_unmatched: none, updated_at: none,
    },
    unique: [["student_id"]],
  },
  templates: {
    columns: { id: newId, scenario_id: none, is_active: () => true },
    unique: [["scenario_id"]],
  },
  tasks: {
    columns: {
      id: newId, student_id: none, scenario_id: none, template_id: none, status: () => "open",
      behavior_summary: none, created_at: now, completed_at: none, completed_by: none, dismissed_at: none, notes: none,
      outcome: none,
    },
  },
  disengagement_alerts: {
    columns: { id: newId, student_id: none, alert_type: none, is_dismissed: () => false },
  },
  discount_requests: {
    columns: {
      id: newId, student_id: none, status: () => "pending", promo_code: none, whop_promo_id: none,
      reviewed_by: none, reviewed_at: none, rejection_reason: none, gate_lesson_id: none, created_at: now,
      applied_at: none, applied_by: none,
    },
    // v106: at most one pending request per student.
    partialUnique: [{ name: "discount_requests_one_pending_per_student", key: ["student_id"], where: (r) => r.status === "pending" }],
  },
};
DEFS.lessons_next = DEFS.lessons;

function withDefaults(table: string, row: Row): Row {
  const def = DEFS[table];
  if (!def) return { ...row };
  const out: Row = {};
  for (const [col, make] of Object.entries(def.columns)) out[col] = col in row ? row[col] : make();
  for (const [col, v] of Object.entries(row)) if (!(col in out)) out[col] = v;
  return out;
}

export interface Logged {
  /** The table, or for an rpc the function's name. */
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete" | "rpc";
  filters: string[];
  values?: unknown;
  options?: unknown;
  returning?: string | null;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  fail: Record<string, DbError> = {};
  /** Fails a call when it returns an error, after `fail` is asked (the header says when to use it). */
  failWhen: ((call: Logged) => DbError | null) | null = null;
  /** A seed: when set, every select's rows are shuffled before its order is applied (the header says why). */
  shuffle: number | null = null;
  log: Logged[] = [];
  /** Access token -> auth user id, for auth.getUser. */
  users: Record<string, string> = {};
  /** Email -> auth user, for auth.signInWithPassword and auth.admin.createUser. */
  authUsers: Record<string, { id: string; password: string }> = {};
  /** Stand-ins for database functions, by name, for `.rpc()`: handed the arguments, a client on this database, and what the calling client was made with. */
  functions: Record<string, (args: Record<string, unknown>, db: ReturnType<typeof fakeClient>, madeWith: unknown[]) => Promise<{ data: unknown; error: DbError | null }>> = {};
  constructor(seed: Record<string, Row[]> = {}, users: Record<string, string> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => withDefaults(t, r));
    this.users = { ...users };
  }
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }
  /** The calls made on one table (and one op), in order. */
  calls(table: string, op?: Logged["op"]): Logged[] {
    return this.log.filter((q) => q.table === table && (!op || q.op === op));
  }
}

function project(table: string, rows: Row[], cols: string): { data: Row[] | null; error: DbError | null } {
  if (cols.trim() === "*") return { data: rows.map((r) => ({ ...r })), error: null };
  const names = cols.split(",").map((c) => c.trim()).filter(Boolean);
  const def = DEFS[table];
  if (def) {
    const missing = names.find((c) => !(c in def.columns));
    if (missing) return { data: null, error: { code: "42703", message: `column ${table}.${missing} does not exist` } };
  }
  return { data: rows.map((r) => Object.fromEntries(names.map((c) => [c, r[c] ?? null]))), error: null };
}

/** The rows in a shuffled order, the same for the same seed (mulberry32, then Fisher-Yates). */
function shuffled(rows: Row[], seed: number): Row[] {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Postgres's order by these columns: a null sorts last going up and first going down. */
function byColumns(orders: Array<[string, boolean]>) {
  return (x: Row, y: Row): number => {
    for (const [c, asc] of orders) {
      const a = x[c] as string | number | null | undefined;
      const b = y[c] as string | number | null | undefined;
      if (a === b || (a == null && b == null)) continue;
      if (a == null) return asc ? 1 : -1;
      if (b == null) return asc ? -1 : 1;
      if (a < b) return asc ? -1 : 1;
      if (a > b) return asc ? 1 : -1;
    }
    return 0;
  };
}

function builder(db: FakeDb, table: string) {
  const q: Logged = { table, op: "select", filters: [], returning: null };
  const preds: Array<(r: Row) => boolean> = [];
  let cols = "*";
  let single: "one" | "maybe" | null = null;
  const orders: Array<[string, boolean]> = [];
  let page: [number, number] | null = null;
  let lim: number | null = null;
  let values: Row | Row[] | null = null;
  let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  let ran = false;

  const filter = (desc: string, fn: (r: Row) => boolean) => {
    q.filters.push(desc);
    preds.push(fn);
    return b;
  };
  const matching = () => db.rows(table).filter((r) => preds.every((p) => p(r)));

  const b = {
    select(c = "*") {
      if (q.op === "select") cols = c;
      else q.returning = c;
      return b;
    },
    eq: (c: string, v: unknown) => filter(`${c}=${String(v)}`, (r) => r[c] === v),
    neq: (c: string, v: unknown) => filter(`${c}!=${String(v)}`, (r) => r[c] !== v),
    in: (c: string, vs: unknown[]) => filter(`${c} in (${vs.map(String).join(",")})`, (r) => vs.includes(r[c])),
    is: (c: string, v: unknown) => filter(`${c} is ${String(v)}`, (r) => (r[c] ?? null) === v),
    gte: (c: string, v: unknown) => filter(`${c}>=${String(v)}`, (r) => r[c] != null && (r[c] as string) >= (v as string)),
    order(c: string, o: { ascending?: boolean } = {}) {
      orders.push([c, o.ascending !== false]);
      return b;
    },
    limit(n: number) {
      lim = n;
      return b;
    },
    range(from: number, to: number) {
      page = [from, to];
      return b;
    },
    insert(v: Row | Row[]) {
      q.op = "insert";
      values = v;
      return b;
    },
    upsert(v: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
      q.op = "upsert";
      values = v;
      opts = o;
      q.options = o;
      return b;
    },
    update(v: Row) {
      q.op = "update";
      values = v;
      return b;
    },
    delete() {
      q.op = "delete";
      return b;
    },
    single() {
      single = "one";
      return exec();
    },
    maybeSingle() {
      single = "maybe";
      return exec();
    },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return exec().then(res, rej);
    },
  };

  function exec(): Promise<{ data: unknown; error: DbError | null }> {
    if (ran) throw new Error(`a query on ${table} ran twice`);
    ran = true;
    q.values = values === null ? undefined : structuredClone(values);
    db.log.push(q);
    return Promise.resolve(shape(run()));
  }

  function shape(r: { data: Row[] | null; error: DbError | null }): { data: unknown; error: DbError | null } {
    if (r.error) return { data: null, error: r.error };
    if (r.data === null) return { data: null, error: null };
    if (single === "one") {
      return r.data.length === 1
        ? { data: r.data[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    }
    if (single === "maybe") {
      if (r.data.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
      return { data: r.data[0] ?? null, error: null };
    }
    return { data: r.data, error: null };
  }

  function written(rows: Row[]): { data: Row[] | null; error: DbError | null } {
    return q.returning == null ? { data: null, error: null } : project(table, rows, q.returning);
  }

  function violation(row: Row, others: Row[]): DbError | null {
    for (const key of DEFS[table]?.unique ?? []) {
      // As in Postgres, a key holding a null never clashes.
      if (key.some((k) => row[k] == null)) continue;
      if (others.some((o) => key.every((k) => o[k] === row[k]))) {
        return { code: "23505", message: `duplicate key value violates unique constraint on ${table} (${key.join(", ")})` };
      }
    }
    for (const idx of DEFS[table]?.partialUnique ?? []) {
      if (!idx.where(row) || idx.key.some((k) => row[k] == null)) continue;
      if (others.some((o) => idx.where(o) && idx.key.every((k) => o[k] === row[k]))) {
        // Postgres's own words, as PostgREST passes them on.
        return { code: "23505", message: `duplicate key value violates unique constraint "${idx.name}"` };
      }
    }
    if (table === "student_lesson_completions" && !db.rows("lessons").some((l) => l.id === row.lesson_id)) {
      return { code: "23503", message: `insert or update on table "student_lesson_completions" violates foreign key constraint (lesson_id ${String(row.lesson_id)})` };
    }
    return null;
  }

  function run(): { data: Row[] | null; error: DbError | null } {
    const fail = db.fail[`${table}.${q.op}`] ?? db.failWhen?.(q);
    if (fail) return { data: null, error: fail };
    const list = values === null ? [] : Array.isArray(values) ? values : [values];

    if (q.op === "select") {
      let rows = matching();
      if (db.shuffle !== null) rows = shuffled(rows, db.shuffle + db.log.length);
      if (orders.length) rows = [...rows].sort(byColumns(orders));
      if (page) rows = rows.slice(page[0], page[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      return project(table, rows.slice(0, MAX_ROWS), cols);
    }

    if (q.op === "insert") {
      const added: Row[] = [];
      for (const v of list) {
        const row = withDefaults(table, v);
        const bad = violation(row, [...db.rows(table), ...added]);
        if (bad) return { data: null, error: bad };
        added.push(row);
      }
      db.rows(table).push(...added);
      return written(added);
    }

    if (q.op === "upsert") {
      const key = (opts.onConflict ?? "id").split(",").map((k) => k.trim());
      const added: Row[] = [];
      const merged: Row[] = [];
      for (const v of list) {
        const existing = [...db.rows(table), ...added].find((r) => key.every((k) => r[k] === v[k]));
        if (existing) {
          if (opts.ignoreDuplicates) continue;
          Object.assign(existing, v);
          merged.push(existing);
          continue;
        }
        const row = withDefaults(table, v);
        if (table === "student_lesson_completions" && !db.rows("lessons").some((l) => l.id === row.lesson_id)) {
          return { data: null, error: { code: "23503", message: "violates foreign key constraint (lesson_id)" } };
        }
        added.push(row);
      }
      db.rows(table).push(...added);
      return written([...added, ...merged]);
    }

    if (q.op === "update") {
      const rows = matching();
      for (const r of rows) Object.assign(r, values as Row);
      return written(rows);
    }

    // delete
    const rows = matching();
    db.tables[table] = db.rows(table).filter((r) => !rows.includes(r));
    return written(rows);
  }

  return b;
}

/** A client on `db`, shaped like supabase-js's for the calls the routes make. `madeWith` is what createClient was handed. */
export function fakeClient(db: FakeDb, madeWith: unknown[] = []) {
  return {
    auth: {
      async getUser(token: string) {
        const id = db.users[token];
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const u = db.authUsers[email];
        if (!u || u.password !== password) {
          return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        }
        return {
          data: { user: { id: u.id }, session: { access_token: `access-${u.id}`, refresh_token: `refresh-${u.id}` } },
          error: null,
        };
      },
      admin: {
        async createUser({ email, password }: { email: string; password: string }) {
          const id = newId();
          db.authUsers[email] = { id, password };
          return { data: { user: { id } }, error: null };
        },
      },
    },
    from(table: string) {
      return builder(db, table);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      db.log.push({ table: fn, op: "rpc", filters: [], values: structuredClone(args), options: madeWith });
      const run = db.functions[fn];
      if (!run) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
      return run(args, fakeClient(db), madeWith);
    },
  };
}

// ── The service-role client the routes make ──────────────────────────────────
let current: FakeDb | null = null;
/** The database every client made from now on reads and writes. */
export function useDb(db: FakeDb) {
  current = db;
}
export function createClient(...args: unknown[]) {
  if (!current) throw new Error("no database: call useDb() first");
  return fakeClient(current, args);
}
export const createServiceClient = createClient;

// ── next/server ──────────────────────────────────────────────────────────────
export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
}
export const NextResponse = {
  json(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json" },
    });
  },
  /** A 307 to `url`, with the cookies the route sets kept in `cookies.jar`. */
  redirect(url: string | URL) {
    const jar: Record<string, string> = {};
    return Object.assign(new Response(null, { status: 307, headers: { location: String(url) } }), {
      cookies: { jar, set: (name: string, value: string) => { jar[name] = value; } },
    });
  },
};
/**
 * The work routes hand to after(), in order, so a test can wait for what runs
 * past the response (Next keeps the function alive for it, on Vercel through
 * waitUntil). `setAfterMissing(true)` makes after() throw as Next's does
 * where the platform has no waitUntil.
 */
export const afterTasks: Promise<unknown>[] = [];
let afterMissing = false;
export function setAfterMissing(v: boolean) {
  afterMissing = v;
}
export function after(task: Promise<unknown> | (() => unknown)) {
  if (afterMissing) {
    throw new Error("`after()` will not work correctly, because `waitUntil` is not available in the current environment.");
  }
  afterTasks.push(typeof task === "function" ? Promise.resolve().then(task) : task);
}

// ── The steps that run after a lesson, recorded in order ─────────────────────
export const steps: Array<{ step: string; studentId: string; lessonId?: string }> = [];
// The streak's three are recorded, then run for real (the header says why).
type StreakClient = Parameters<typeof realStreak.updateStudentStreak>[0];
export async function updateStudentStreak(s: unknown, studentId: string) {
  steps.push({ step: "streak", studentId });
  await realStreak.updateStudentStreak(s as StreakClient, studentId);
}
export async function tickStudentStreak(s: unknown, studentId: string) {
  steps.push({ step: "streak", studentId });
  await realStreak.tickStudentStreak(s as StreakClient, studentId);
}
export async function markStudentActive(s: unknown, studentId: string) {
  steps.push({ step: "active", studentId });
  await realStreak.markStudentActive(s as StreakClient, studentId);
}
export async function evaluateAchievements(_s: unknown, studentId: string) {
  steps.push({ step: "achievements", studentId });
  return [];
}
export async function onLessonCompleted(_s: unknown, studentId: string) {
  steps.push({ step: "came-back", studentId });
}
export async function checkR2CompoundsShipped(_s: unknown, studentId: string, lessonId: string) {
  steps.push({ step: "r2", studentId, lessonId });
}
export async function reEvaluateStudentOpenTasks(_s: unknown, studentId: string) {
  steps.push({ step: "tasks", studentId });
}
export async function onDiscountRequested(_s: unknown, studentId: string) {
  steps.push({ step: "discount-requested", studentId });
}

// ── Whop ─────────────────────────────────────────────────────────────────────
type WhopAnswer = { interactions: Array<{ lesson?: { id?: string }; completed?: boolean }>; rawCount: number; completedCount: number };
let whopAnswer: (whopUserId: string) => Promise<WhopAnswer> = async () => ({ interactions: [], rawCount: 0, completedCount: 0 });
/** What fetchCompletedLessonsAsAdmin answers from now on. */
export function setWhop(fn: (whopUserId: string) => Promise<WhopAnswer>) {
  whopAnswer = fn;
}
export async function fetchCompletedLessonsAsAdmin(whopUserId: string) {
  return whopAnswer(whopUserId);
}
/** The promo codes the approve route asked Whop for, in order. */
export const promoCodes: Array<Record<string, unknown>> = [];
export async function createWhopPromoCode(params: Record<string, unknown>) {
  promoCodes.push(structuredClone(params));
  return { id: `promo_${promoCodes.length}` };
}
export async function fetchActiveMembershipForUser(_whopUserId: string) {
  return null;
}
export function mapStatus(_m: unknown) {
  return "active";
}
export function toIso(value: number | string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

// The login's calls (auth/whop/callback). The code exchange and the user read
// answer for `whopUser`; the student password is a function of the Whop id, as
// the real one is.
let whopUser = { sub: "user_1", email: "student@example.com", name: "A Student", picture: null as string | null, username: "student" };
/** Who Whop says is logging in from now on. */
export function setWhopUser(u: typeof whopUser) {
  whopUser = u;
}
export async function exchangeCodeForTokens(_code: string, _verifier: string, _redirectUri: string) {
  return { access_token: "whop-access", refresh_token: "whop-refresh" };
}
export async function fetchWhopUserInfo(_accessToken: string) {
  return { ...whopUser };
}
export async function checkActiveMembershipDiagnostic(_accessToken: string) {
  return { hasAccess: false, configured: true, fetchStatus: 200, fetchError: null, memberships: [] };
}
export async function fetchWhopMembershipJoinDate(_accessToken: string) {
  return null;
}
export async function fetchWhopDiscordId(_whopUserId: string) {
  return null;
}
export function generateStudentPassword(whopUserId: string) {
  return `password-for-${whopUserId}`;
}

// ── src/lib/admin-auth (POST /api/discounts/approve) ─────────────────────────
// Every request is a founder's, and the route gets the service-role client,
// as the real requireTeam hands it.
export async function requireTeam(_request: Request, _roles?: string[]) {
  return { supabase: createClient(), teamMember: { id: "team-1", role: "founder" } };
}
export function isAuthFailure(result: { error?: unknown }) {
  return result.error !== undefined;
}

// ── src/lib/catalog-tables ───────────────────────────────────────────────────
// Live bindings: a copy that imports these reads the value set last.
export let CATALOG_IS_V2 = false;
export let LESSONS_TABLE = "lessons";
export let REGIONS_TABLE = "regions";
export let CATALOG_TABLE_SUFFIX = "";
export function setCatalog(o: { v2: boolean; lessonsTable?: string }) {
  CATALOG_IS_V2 = o.v2;
  LESSONS_TABLE = o.lessonsTable ?? "lessons";
  CATALOG_TABLE_SUFFIX = LESSONS_TABLE.slice("lessons".length);
  REGIONS_TABLE = `regions${CATALOG_TABLE_SUFFIX}`;
}
