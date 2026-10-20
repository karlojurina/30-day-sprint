// What the cron tests stand in, hand-written like stub-server.ts.
// engagement-alerts.test.mjs and cron-failed-reads.test.mjs point the
// crons' copies here for next/server only. Everything else a cron imports is
// the real source, copied: src/lib/supabase-server.ts builds a real
// supabase-js client, and that client and src/lib/discord.ts reach the
// network through fetch, which installNetwork() answers:
//
//   https://db.test/rest/v1/...  a stand-in PostgREST over rows in plain
//     arrays, answering the requests these crons send the way PostgREST
//     answers them: a select with filters (eq, neq, gt, gte, lt, lte, in,
//     is, and not. before any of them), order, limit and offset (.range()),
//     and one embedded to-one table (template:templates(bucket) reads
//     tasks.template_id); insert and update, with the rows back under
//     Prefer: return=representation; the object Accept header of .single()
//     (406 unless exactly one row). tasks has the partial unique index
//     idx_tasks_unique_open (student_id, scenario_id where status is open),
//     refused with 23505 as the crons expect. Every request is logged with
//     its method, table and request line.
//     A request line longer than `maxRequestLine` is refused with 414 before
//     it reaches PostgREST, as a gateway does (nginx's default is 8 KB).
//     `failWhen` answers chosen requests with a failure of the test's
//     choosing instead.
//   https://discord.test/...  a stand-in Discord webhook that applies
//     Discord's documented limits (an embed's description at most 4096
//     characters, title 256, footer 2048, at most 10 embeds and 6000
//     characters of embed text in one message, content 2000), refusing a
//     message past them with 400 and Discord's "Invalid Form Body", and a
//     rate limit of `limit` posts per `windowMs`, answered 429 with
//     Retry-After. A post it takes gets 204, as a webhook post does.

type Row = Record<string, unknown>;
type Answer = { status: number; body: string };

const now = () => new Date().toISOString();
let seq = 0;
const newId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;

// ── next/server ──────────────────────────────────────────────────────────────
export class NextRequest extends Request {}
export const NextResponse = {
  json(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
  },
};

// ── the stand-in PostgREST ───────────────────────────────────────────────────
export interface Logged {
  method: string;
  table: string;
  /** Path and query, as the client sent them. */
  target: string;
  /** "GET /rest/v1/... HTTP/1.1": what a gateway measures. */
  requestLine: number;
  body: unknown;
  status: number;
}

/** Query parameters that are not filters. */
const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

/** Column defaults the crons rely on (schema.sql, v27, v82). */
const DEFAULTS: Record<string, () => Row> = {
  cron_runs: () => ({ started_at: now(), finished_at: null, error_message: null, rows_affected: null }),
  disengagement_alerts: () => ({ is_dismissed: false, dismissed_at: null, created_at: now() }),
  tasks: () => ({ status: "open", created_at: now(), dismissed_at: null, notes: null }),
};
/** Tables keyed by something other than id. */
const NO_ID = new Set(["student_milestones", "admin_config"]);

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function compare(x: unknown, arg: string): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return x - Number(arg);
  const s = String(x);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && /^\d{4}-\d{2}-\d{2}/.test(arg)) return Date.parse(s) - Date.parse(arg);
  return s < arg ? -1 : s > arg ? 1 : 0;
}

function filterFor(col: string, raw: string): (r: Row) => boolean {
  let v = raw;
  const negate = v.startsWith("not.");
  if (negate) v = v.slice(4);
  const dot = v.indexOf(".");
  const op = v.slice(0, dot);
  const arg = v.slice(dot + 1);
  let test: (x: unknown) => boolean;
  if (op === "eq") test = (x) => x !== null && x !== undefined && String(x) === arg;
  else if (op === "neq") test = (x) => x !== null && x !== undefined && String(x) !== arg;
  else if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    test = (x) => {
      const c = compare(x, arg);
      if (c === null) return false;
      return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
    };
  } else if (op === "in") {
    const list = splitTop(arg.replace(/^\(/, "").replace(/\)$/, "")).map((x) => x.replace(/^"(.*)"$/, "$1"));
    test = (x) => x !== null && x !== undefined && list.includes(String(x));
  } else if (op === "is") {
    test = (x) => (arg === "null" ? x === null || x === undefined : arg === "true" ? x === true : x === false);
  } else {
    throw new Error(`the stand-in PostgREST knows no operator ${op} (in ${col}=${raw})`);
  }
  // As in SQL, NOT of a comparison with null is not true either.
  if (!negate) return (r) => test(r[col]);
  return op === "is" ? (r) => !test(r[col]) : (r) => r[col] !== null && r[col] !== undefined && !test(r[col]);
}

export class StandInDb {
  tables: Record<string, Row[]> = {};
  log: Logged[] = [];
  /** The longest request line the gateway in front of PostgREST takes. */
  maxRequestLine = 8192;
  /** Answer a request with this failure instead (null: answer it normally). */
  failWhen: ((r: { method: string; table: string; url: URL }) => Answer | null) | null = null;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }
  /** Every request but the run's own audit row (cron_runs) that writes. */
  writes(): Logged[] {
    return this.log.filter((q) => q.method !== "GET" && q.method !== "HEAD" && q.table !== "cron_runs");
  }
  reads(table?: string): Logged[] {
    return this.log.filter((q) => q.method === "GET" && (!table || q.table === table));
  }

  private project(rows: Row[], select: string): Row[] {
    const items = splitTop(select).map((s) => s.trim()).filter(Boolean);
    return rows.map((r) => {
      const out: Row = {};
      for (const item of items) {
        if (item === "*") {
          Object.assign(out, r);
          continue;
        }
        const embed = item.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
        if (embed) {
          const [, alias, other, cols] = embed;
          const key = alias ?? other.replace(/s$/, "");
          const fk = r[`${key}_id`];
          const hit = fk == null ? undefined : this.rows(other).find((o) => o.id === fk);
          out[key] = hit ? this.project([hit], cols)[0] : null;
          continue;
        }
        const [name, col] = item.includes(":") ? item.split(":") : [item, item];
        out[name] = col in r ? r[col] : null;
      }
      return out;
    });
  }

  private violation(table: string, row: Row, others: Row[]): Answer | null {
    if (table !== "tasks" || row.status !== "open") return null;
    const clash = others.some((o) => o.status === "open" && o.student_id === row.student_id && o.scenario_id === row.scenario_id);
    return clash
      ? { status: 409, body: JSON.stringify({ code: "23505", details: null, hint: null, message: 'duplicate key value violates unique constraint "idx_tasks_unique_open"' }) }
      : null;
  }

  handle(url: URL, init: RequestInit): Response {
    const method = (init.method ?? "GET").toUpperCase();
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    const headers = new Headers(init.headers);
    const requestLine = `${method} ${url.pathname}${url.search} HTTP/1.1`.length;
    const body = typeof init.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    const entry: Logged = { method, table, target: `${url.pathname}${url.search}`, requestLine, body, status: 0 };
    this.log.push(entry);
    const answer = (status: number, payload: unknown, extra: Record<string, string> = {}) => {
      entry.status = status;
      const text = payload === undefined ? null : typeof payload === "string" ? payload : JSON.stringify(payload);
      return new Response(status === 204 ? null : text, { status, headers: { "content-type": "application/json", ...extra } });
    };

    if (requestLine > this.maxRequestLine) {
      return answer(414, "<html><head><title>414 Request-URI Too Large</title></head><body>414 Request-URI Too Large</body></html>", { "content-type": "text/html" });
    }
    const forced = this.failWhen?.({ method, table, url });
    if (forced) return answer(forced.status, forced.body);

    const preds: Array<(r: Row) => boolean> = [];
    for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) preds.push(filterFor(k, v));
    const matching = () => this.rows(table).filter((r) => preds.every((p) => p(r)));
    const wantsObject = (headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json");
    const representation = (headers.get("prefer") ?? "").includes("return=representation");
    const select = url.searchParams.get("select") ?? "*";
    const shaped = (status: number, rows: Row[]) => {
      const data = this.project(rows, select);
      if (!wantsObject) return answer(status, data);
      if (data.length !== 1) {
        return answer(406, { code: "PGRST116", details: `The result contains ${data.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
      }
      return answer(status, data[0]);
    };

    if (method === "GET") {
      let rows = matching();
      const order = url.searchParams.get("order");
      if (order) {
        const keys = order.split(",").map((o) => {
          const [col, dir] = o.split(".");
          return { col, desc: dir === "desc" };
        });
        rows = [...rows].sort((a, b) => {
          for (const { col, desc } of keys) {
            const x = a[col], y = b[col];
            if (x === y) continue;
            // Postgres puts nulls last ascending, first descending.
            if (x === null || x === undefined) return desc ? -1 : 1;
            if (y === null || y === undefined) return desc ? 1 : -1;
            const c = typeof x === "number" && typeof y === "number" ? (x < y ? -1 : 1) : String(x) < String(y) ? -1 : 1;
            return desc ? -c : c;
          }
          return 0;
        });
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.get("limit");
      rows = rows.slice(offset, limit === null ? undefined : offset + Number(limit));
      return shaped(200, rows);
    }

    if (method === "POST") {
      const list = (Array.isArray(body) ? body : [body]) as Row[];
      const added: Row[] = [];
      for (const v of list) {
        const row: Row = { ...(DEFAULTS[table]?.() ?? {}), ...v };
        if (!NO_ID.has(table) && !("id" in row)) row.id = newId();
        const bad = this.violation(table, row, [...this.rows(table), ...added]);
        if (bad) return answer(bad.status, bad.body);
        added.push(row);
      }
      this.rows(table).push(...added);
      return representation ? shaped(201, added) : answer(201, undefined);
    }

    if (method === "PATCH") {
      const rows = matching();
      for (const r of rows) {
        const next = { ...r, ...(body as Row) };
        const bad = this.violation(table, next, this.rows(table).filter((o) => o !== r));
        if (bad) return answer(bad.status, bad.body);
      }
      for (const r of rows) Object.assign(r, body as Row);
      return representation ? shaped(200, rows) : answer(204, undefined);
    }

    throw new Error(`the stand-in PostgREST takes no ${method}`);
  }
}

// ── the stand-in Discord webhook ─────────────────────────────────────────────
type Embed = {
  title?: string;
  description?: string;
  footer?: { text?: string };
  author?: { name?: string };
  fields?: Array<{ name?: string; value?: string }>;
};
export interface Post {
  status: number;
  payload: { content?: string; embeds?: Embed[] };
}

/** What Discord would refuse in a message, in its own words. */
export function discordProblems(payload: { content?: string; embeds?: Embed[] }): string[] {
  const problems: string[] = [];
  const len = (s: string | undefined) => (s ?? "").length;
  if (len(payload.content) > 2000) problems.push("content: Must be 2000 or fewer in length.");
  const embeds = payload.embeds ?? [];
  if (embeds.length > 10) problems.push("embeds: Must be 10 or fewer in length.");
  let total = 0;
  embeds.forEach((e, i) => {
    if (len(e.title) > 256) problems.push(`embeds.${i}.title: Must be 256 or fewer in length.`);
    if (len(e.description) > 4096) problems.push(`embeds.${i}.description: Must be 4096 or fewer in length.`);
    if (len(e.footer?.text) > 2048) problems.push(`embeds.${i}.footer.text: Must be 2048 or fewer in length.`);
    if (len(e.author?.name) > 256) problems.push(`embeds.${i}.author.name: Must be 256 or fewer in length.`);
    if ((e.fields ?? []).length > 25) problems.push(`embeds.${i}.fields: Must be 25 or fewer in length.`);
    total += len(e.title) + len(e.description) + len(e.footer?.text) + len(e.author?.name);
    for (const f of e.fields ?? []) total += len(f.name) + len(f.value);
  });
  if (total > 6000) problems.push("embeds: Embed size exceeds maximum size of 6000");
  return problems;
}

export class StandInDiscord {
  /** Every post, in order, with Discord's answer. */
  posts: Post[] = [];
  /** Discord's rate limit, as `limit` posts per `windowMs`; Retry-After in seconds. */
  limit = 5;
  windowMs = 2000;
  retryAfter = "2";
  /** Answer the nth post (1-based) with this failure instead (null: answer it normally). */
  failWhen: ((n: number) => Answer | null) | null = null;
  private accepted: number[] = [];

  /** The messages Discord took. */
  delivered() {
    return this.posts.filter((p) => p.status < 300).map((p) => p.payload);
  }

  handle(text: string): Response {
    const payload = JSON.parse(text);
    const post: Post = { status: 0, payload };
    this.posts.push(post);
    const t = Date.now();
    this.accepted = this.accepted.filter((x) => t - x < this.windowMs);
    if (this.accepted.length >= this.limit) {
      post.status = 429;
      return new Response(JSON.stringify({ message: "You are being rate limited.", retry_after: Number(this.retryAfter), global: false }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": this.retryAfter },
      });
    }
    this.accepted.push(t);
    const forced = this.failWhen?.(this.posts.length);
    if (forced) {
      post.status = forced.status;
      return new Response(forced.body, { status: forced.status });
    }
    const problems = discordProblems(payload);
    if (problems.length > 0) {
      post.status = 400;
      return new Response(JSON.stringify({ message: "Invalid Form Body", code: 50035, errors: problems }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    post.status = 204;
    return new Response(null, { status: 204 });
  }
}

/** From now on fetch reaches these two, and nothing else. */
export function installNetwork(n: { db: () => StandInDb; discord: () => StandInDiscord }) {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "db.test") return n.db().handle(url, init);
    if (url.host === "discord.test") return n.discord().handle(String(init.body ?? ""));
    throw new Error(`the stand-in network has no ${url.host}`);
  }) as typeof fetch;
}
