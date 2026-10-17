// What the server copies import, standing in for the real thing. build.mjs
// points their import lines here: Next's response, the service-role Supabase
// client, Whop's completions read, the steps that run after a lesson (and the
// CSM's hook for a discount request), and which catalog is live. Hand-written,
// like stub-supabase.ts and stub-call-gate.ts; the routes and libraries under
// test are the real source.
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
// `fail['table.op']` makes every such call fail with that error. Every call is
// logged in `log`, in order. `.rpc(fn, args)` runs the test's own stand-in for
// that database function from `functions[fn]` (none: PostgREST's "not found").

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
/** A unique index with a WHERE: only rows it matches are compared. */
type PartialUnique = { name: string; key: string[]; where: (r: Row) => boolean };

const now = () => new Date().toISOString();
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const none = () => null;

/** The tables whose columns are known, with each column's default. */
const DEFS: Record<string, { columns: Record<string, () => unknown>; unique?: string[][]; partialUnique?: PartialUnique[] }> = {
  students: {
    columns: {
      id: newId, whop_user_id: none, supabase_user_id: none, email: none, name: none,
      joined_at: now, first_paid_at: none, membership_status: () => "active", cancel_scheduled_at: none,
    },
    unique: [["whop_user_id"]],
  },
  lessons: {
    columns: {
      id: none, region_id: none, type: () => "watch", day: none, sort_order: () => 0,
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
      behavior_summary: none, created_at: now, dismissed_at: none, notes: none,
    },
  },
  disengagement_alerts: {
    columns: { id: newId, student_id: none, alert_type: none, is_dismissed: () => false },
  },
  discount_requests: {
    columns: {
      id: newId, student_id: none, status: () => "pending", promo_code: none, whop_promo_id: none,
      reviewed_by: none, reviewed_at: none, rejection_reason: none, gate_lesson_id: none, created_at: now,
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
  log: Logged[] = [];
  /** Access token -> auth user id, for auth.getUser. */
  users: Record<string, string> = {};
  /** Stand-ins for database functions, by name, for `.rpc()`: handed the arguments and a client on this database. */
  functions: Record<string, (args: Record<string, unknown>, db: ReturnType<typeof fakeClient>) => Promise<{ data: unknown; error: DbError | null }>> = {};
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

function builder(db: FakeDb, table: string) {
  const q: Logged = { table, op: "select", filters: [], returning: null };
  const preds: Array<(r: Row) => boolean> = [];
  let cols = "*";
  let single: "one" | "maybe" | null = null;
  let order: [string, boolean] | null = null;
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
      order = [c, o.ascending !== false];
      return b;
    },
    limit(n: number) {
      lim = n;
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
    const fail = db.fail[`${table}.${q.op}`];
    if (fail) return { data: null, error: fail };
    const list = values === null ? [] : Array.isArray(values) ? values : [values];

    if (q.op === "select") {
      let rows = matching();
      if (order) {
        const [c, asc] = order;
        rows = [...rows].sort((x, y) => ((x[c] as string) < (y[c] as string) ? -1 : (x[c] as string) > (y[c] as string) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (lim !== null) rows = rows.slice(0, lim);
      return project(table, rows, cols);
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

/** A client on `db`, shaped like supabase-js's for the calls the routes make. */
export function fakeClient(db: FakeDb) {
  return {
    auth: {
      async getUser(token: string) {
        const id = db.users[token];
        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
    from(table: string) {
      return builder(db, table);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      db.log.push({ table: fn, op: "rpc", filters: [], values: structuredClone(args) });
      const run = db.functions[fn];
      if (!run) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
      return run(args, fakeClient(db));
    },
  };
}

// ── The service-role client the routes make ──────────────────────────────────
let current: FakeDb | null = null;
/** The database every client made from now on reads and writes. */
export function useDb(db: FakeDb) {
  current = db;
}
export function createClient(..._args: unknown[]) {
  if (!current) throw new Error("no database: call useDb() first");
  return fakeClient(current);
}
export const createServiceClient = createClient;

// ── next/server ──────────────────────────────────────────────────────────────
export class NextRequest extends Request {}
export const NextResponse = {
  json(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json" },
    });
  },
};

// ── The steps that run after a lesson, recorded in order ─────────────────────
export const steps: Array<{ step: string; studentId: string; lessonId?: string }> = [];
export async function updateStudentStreak(_s: unknown, studentId: string) {
  steps.push({ step: "streak", studentId });
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
export async function afterCompletionWrite(_s: unknown, studentId: string) {
  steps.push({ step: "after-lesson", studentId });
  return { newAchievements: [] as string[] };
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
export async function fetchActiveMembershipForUser(_whopUserId: string) {
  return null;
}
export function mapStatus(_m: unknown) {
  return "active";
}

// ── src/lib/catalog-tables ───────────────────────────────────────────────────
// Live bindings: a copy that imports these reads the value set last.
export let CATALOG_IS_V2 = false;
export let LESSONS_TABLE = "lessons";
// The data route also names the suffix and the areas' table (T-078's route test).
export let CATALOG_TABLE_SUFFIX = "";
export let REGIONS_TABLE = "regions";
export function setCatalog(o: { v2: boolean; lessonsTable?: string }) {
  CATALOG_IS_V2 = o.v2;
  LESSONS_TABLE = o.lessonsTable ?? "lessons";
  CATALOG_TABLE_SUFFIX = LESSONS_TABLE === "lessons_next" ? "_next" : "";
  REGIONS_TABLE = `regions${CATALOG_TABLE_SUFFIX}`;
}
