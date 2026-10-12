/**
 * The lesson video lock check, run against stand-ins.
 * (_admin/prds/tella-player/tella_player_prd.md, decisions D14 and D18.)
 *
 *   node world-tests/lock-check-sim.mjs
 *
 * Run it from the app root (30-day-sprint). It takes under a second. The
 * code under test is TypeScript, so on a Node that does not strip types by
 * default (older than 22.18) the script starts itself again as
 *
 *   node --experimental-strip-types world-tests/lock-check-sim.mjs
 *
 * which is also the command to type by hand. Needs Node 22.6 or newer and
 * nothing that is not already installed.
 *
 * WHY IT EXISTS. `GET /api/cron/check-lesson-videos` has never run for real:
 * it is not scheduled, and a real run needs production's database, Tella's
 * key and the team's Discord channel. This is the repeatable proof of the
 * route's own logic until it does run.
 *
 * WHAT IS REAL. These five files are loaded as they are, byte for byte, and
 * nothing in them is rewritten:
 *   src/app/api/cron/check-lesson-videos/route.ts   the route
 *   src/lib/world/tella-lock.ts                      judgeLock, the catalog rules
 *   src/lib/world/tella-api.ts                       the request to Tella, its 10 s limit
 *   src/lib/cron-auth.ts                             the cron secret, the cron_runs rows
 *   src/lib/discord.ts                               postTeamAlert
 *
 * WHAT IS A STAND-IN. Everything those files reach outside themselves:
 *   - `fetch`. A request to api.tella.com is answered from the scenario, a
 *     post to the pretend Discord webhook is recorded, and ANY other address
 *     is counted as an attempt to reach the network and fails the run.
 *   - the Supabase client (`@/lib/supabase-server`): a few tables held in
 *     memory, with only the query methods the route and the audit helper use.
 *   - `NextResponse.json` (`next/server`): the platform's own `Response`.
 *   - the clock: `Date.now`, `setTimeout` and `AbortSignal.timeout` run on a
 *     pretend clock that only the stand-ins move, so 270 s take no time.
 * A small loader hook hands the route these stand-ins in place of the two
 * modules; any `@/` import it has no rule for stops the run with a message
 * saying which one.
 *
 * NO NETWORK, AT ALL. Besides `fetch`, the ways out underneath it (a TCP
 * connection, a DNS lookup, a UDP socket) are replaced by guards that record
 * the attempt and throw. The first two checks trip the guards on purpose to
 * show they are live; the last one requires that nothing else tripped them.
 * It never reads `.env.local`: every key, secret, host and id here is made up.
 *
 * WHAT IT PROVES, about the route's own logic:
 *   - the refusals: no secret or a wrong one (401), a missing key or domain
 *     list (500), a table of videos that cannot be read (500);
 *   - one row of every kind: its verdict, the sentences, what is written on
 *     the row and with which filter;
 *   - a row whose video is swapped or deleted while the run is on;
 *   - the 270 s budget: no request starts after it, what was found is still
 *     written and reported, `notReached` says how many were left, and the
 *     next run starts with them;
 *   - the pace: requests start at least 700 ms apart, at most 86 a minute;
 *   - the alert: when it is sent, what it says, and the cut at whole lines
 *     that keeps it under Discord's limit;
 *   - a catalog table that cannot be read, a write that fails, an alert that
 *     does not go out, and what `cron_runs` says after each;
 *   - that no video id and no key appears in any answer, alert, `cron_runs`
 *     row or log line.
 *
 * WHAT IT DOES NOT PROVE:
 *   - anything about real Supabase: whether supabase-js sends these queries
 *     the way the stand-in reads them, what PostgREST does with the order and
 *     the two filters, row level security, how long a write takes;
 *   - anything about real Tella: its answers are scripted here. The live
 *     check of two real videos is world-tests/tella-lock-live.mjs;
 *   - anything about real Discord: whether the webhook is set, and whether
 *     Discord accepts the message;
 *   - anything about Vercel's clock: the 300 s limit, and how long Tella and
 *     the database really take from there. The timings below are inputs, and
 *     the real limit on a request is a real timer this never waits for.
 */
import net from 'node:net'
import dns from 'node:dns'
import dgram from 'node:dgram'
import { register } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (!process.features.typescript && !process.execArgv.includes('--experimental-strip-types')) {
  const again = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  )
  process.exit(again.status ?? 1)
}

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** One group of checks. If it throws, that is one failed check and the run goes on to the totals. */
async function scenario(title, checks) {
  console.log(`\n=== ${title} ===`)
  try {
    await checks()
  } catch (err) {
    ok(false, `"${title}" stopped before its last check`, err instanceof Error ? err.message : String(err))
  }
}
function finish() {
  console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  process.exit(0)
}

// ───────────────────────── every value here is made up ─────────────────────────

const FAKE_KEY = 'tella-key-sim-0000'
const FAKE_SECRET = 'cron-secret-sim-0000'
const FAKE_WEBHOOK = 'https://discord.invalid/api/webhooks/sim/sim'
const EXPECTED_HOSTS = ['app.example.test', 'preview-branch.example.test']
/** Well formed and obviously not a real id. */
const fakeVideoId = (n) => `vid_fake${String(n).padStart(12, '0')}`
const GOOD = {
  linkScope: 'embedonly',
  allowedEmbedDomains: [...EXPECTED_HOSTS],
  downloadsEnabled: false,
  rawDownloadsEnabled: false,
  durationSeconds: 67.262,
}

// ───────────────────────── the pretend clock ─────────────────────────

/** Milliseconds since the pretend start. Only the stand-ins move it. */
const clock = { t: 0 }
const CLOCK_ZERO = 1_800_000_000_000
Date.now = () => CLOCK_ZERO + clock.t
// The route's pause between two requests: the clock jumps, nothing waits.
globalThis.setTimeout = (fn, ms = 0) => { clock.t += ms; queueMicrotask(fn); return 0 }
// The limit `tella-api.ts` puts on a request. The real one is a real timer;
// this one is cut by the Tella stand-in when a scenario says "no answer".
const limits = new WeakMap()
AbortSignal.timeout = (ms) => {
  const controller = new AbortController()
  limits.set(controller.signal, { controller, ms })
  return controller.signal
}

// ───────────────────────── nothing leaves this process ─────────────────────────

const networkAttempts = []
function refuse(how) {
  networkAttempts.push(how)
  throw new Error(`lock-check-sim: ${how}. Nothing in this simulation may reach the network.`)
}
net.Socket.prototype.connect = function () { refuse('something tried to open a TCP connection') }
dns.lookup = () => { refuse('something tried a DNS lookup') }
dns.promises.lookup = async () => { refuse('something tried a DNS lookup') }
dgram.createSocket = () => { refuse('something tried to open a UDP socket') }

// ───────────────────────── the world one run sees ─────────────────────────

/** Set by run(). The stand-ins below read and write it. */
let W = null
/** Everything the route said, across every run, searched for ids at the end. */
const everythingSaid = []
const secretsUsed = new Set([FAKE_KEY, FAKE_SECRET])
const invariants = { requests: 0, tooClose: 0, noLimit: 0, wrongLimit: 0, wrongAuth: 0, wrongMethod: 0 }

async function fakeFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url ?? input)
  if (url.startsWith('https://api.tella.com/v1/videos/')) return tella(url, init)
  if (url === FAKE_WEBHOOK) return discord(init)
  refuse('a request was made to an address the simulation does not know')
}
globalThis.fetch = fakeFetch

/** Tella's API. The scenario's `tella(videoId, world)` says what it answers. */
async function tella(url, init) {
  const videoId = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
  const limit = limits.get(init.signal)
  W.asked.push({
    lessonId: W.videos.find((r) => r.tella_video_id === videoId)?.lesson_id ?? null,
    at: clock.t,
    limitMs: limit?.ms ?? null,
    auth: init.headers?.Authorization ?? null,
    method: init.method ?? 'GET',
  })
  const answer = W.tella(videoId, W)

  const giveUp = () => {
    if (!limit) {
      // Without a limit a real request would hang. Here it costs an hour.
      clock.t += 3_600_000
      throw new Error('this request had no time limit and never came back')
    }
    clock.t += limit.ms
    limit.controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    return init.signal.reason
  }
  if (answer === 'no answer') throw giveUp()
  if (answer === 'headers, then nothing') {
    return { status: 200, json: async () => { throw giveUp() } }
  }

  clock.t += W.costs.tellaMs
  if (answer === 'unreachable') {
    // The way Node's fetch fails, with a message that names the address.
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error(`read ECONNRESET while fetching ${url} with ${init.headers?.Authorization}`), { code: 'ECONNRESET' }),
    })
  }
  if (answer === null) return { status: 404, json: async () => ({ error: 'not found' }) }
  if (answer.http) return { status: answer.http, json: async () => ({}) }
  if ('body' in answer) return { status: 200, json: async () => answer.body }
  const { durationSeconds, ...settings } = answer
  return { status: 200, json: async () => ({ video: { id: videoId, durationSeconds, settings } }) }
}

/** The team's webhook. */
async function discord(init) {
  W.alerts.push(JSON.parse(init.body))
  return W.discord === 'refuses'
    ? { ok: false, status: 500, text: async () => 'pretend Discord error' }
    : { ok: true, status: 204, text: async () => '' }
}

/**
 * `createServiceClient()`: the query methods the route and `cron-auth.ts`
 * use, over the tables in W. A method or a table that is not here throws,
 * so a new query in the route cannot pass unnoticed.
 */
function createServiceClient() {
  return {
    from(table) {
      const q = { table, op: 'select', columns: null, returning: null, filters: {}, order: [], patch: null, row: null }
      const builder = {
        select(columns) { if (q.op === 'select') q.columns = columns; else q.returning = columns; return builder },
        insert(row) { q.op = 'insert'; q.row = row; return builder },
        update(patch) { q.op = 'update'; q.patch = patch; return builder },
        eq(column, value) { q.filters[column] = value; return builder },
        order(column, options = {}) { q.order.push({ column, ...options }); return builder },
        single() { return builder },
        then(resolve, reject) { return Promise.resolve().then(() => execute(q)).then(resolve, reject) },
      }
      return builder
    },
  }
}
const pick = (row, columns) => Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]]))
const matches = (row, filters) => Object.entries(filters).every(([k, v]) => row[k] === v)

function execute(q) {
  if (q.table === 'cron_runs') {
    if (q.op === 'insert') {
      const row = { id: `run-${W.cronRuns.length + 1}`, ...q.row }
      W.cronRuns.push(row)
      return { data: { id: row.id }, error: null }
    }
    if (q.op === 'update') {
      for (const row of W.cronRuns.filter((r) => matches(r, q.filters))) Object.assign(row, q.patch)
      return { data: null, error: null }
    }
  }
  if (q.op === 'select' && ['lesson_videos', 'lessons', 'lessons_next'].includes(q.table)) {
    W.reads.push({ table: q.table, columns: q.columns, order: q.order })
    if (W.unreadable.includes(q.table)) {
      return { data: null, error: { message: `pretend failure reading ${q.table}` } }
    }
    const rows = [...W[q.table === 'lesson_videos' ? 'videos' : q.table]]
    // Sorted the way the query asked, one order() after the other.
    rows.sort((a, b) => {
      for (const o of q.order) {
        const x = a[o.column], y = b[o.column]
        if (x === y) continue
        if (x == null) return o.nullsFirst ? -1 : 1
        if (y == null) return o.nullsFirst ? 1 : -1
        return (x < y ? -1 : 1) * (o.ascending === false ? -1 : 1)
      }
      return 0
    })
    return { data: rows.map((r) => pick(r, q.columns)), error: null }
  }
  if (q.op === 'update' && q.table === 'lesson_videos') {
    clock.t += W.costs.writeMs
    W.writes.push({ filters: { ...q.filters }, patch: q.patch, returning: q.returning })
    if (W.unwritable.includes(q.filters.lesson_id)) {
      // A database error that repeats the value it was filtered on.
      return { data: null, error: { message: `pretend write failure for ${q.filters.tella_video_id}` } }
    }
    const hit = W.videos.filter((r) => matches(r, q.filters))
    for (const row of hit) Object.assign(row, q.patch)
    return { data: q.returning ? hit.map((r) => pick(r, q.returning)) : null, error: null }
  }
  throw new Error(`lock-check-sim: no stand-in for ${q.op} on ${q.table}`)
}

// ───────────────────────── load the real files ─────────────────────────

globalThis.__lockCheckSim = {
  NextRequest: class NextRequest {},
  NextResponse: { json: (body, init) => Response.json(body, init) },
  createServiceClient,
}
const STAND_INS_URL = 'data:text/javascript,' + encodeURIComponent(
  'export const { NextRequest, NextResponse, createServiceClient } = globalThis.__lockCheckSim;',
)
const real = (path) => new URL(`../src/${path}`, import.meta.url).href
const RULES = {
  // specifier the real code imports -> what it gets
  'next/server': STAND_INS_URL,
  '@/lib/supabase-server': STAND_INS_URL,
  '@/lib/cron-auth': real('lib/cron-auth.ts'),
  '@/lib/discord': real('lib/discord.ts'),
  '@/lib/world/tella-api': real('lib/world/tella-api.ts'),
  '@/lib/world/tella-lock': real('lib/world/tella-lock.ts'),
}
register('data:text/javascript,' + encodeURIComponent(`
  const RULES = ${JSON.stringify(RULES)};
  export async function resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(RULES, specifier)) return { url: RULES[specifier], shortCircuit: true };
    if (specifier.startsWith('@/')) {
      throw new Error('lock-check-sim: ' + (context.parentURL ?? 'a file') + ' imports "' + specifier + '", which the simulation has no rule for. Add it to RULES in world-tests/lock-check-sim.mjs: the real file if it reaches nothing outside itself, a stand-in if it does.');
    }
    return nextResolve(specifier, context);
  }
`))

await scenario('the guards (tripped on purpose)', async () => {
  let refused = false
  try { await fetch('https://example.invalid/anything') } catch { refused = true }
  ok(refused && networkAttempts.length === 1, 'a request to an unknown address is refused and counted')
  refused = false
  try { net.connect({ host: '192.0.2.1', port: 9 }) } catch { refused = true }
  ok(refused && networkAttempts.length === 2, 'a TCP connection is refused before it starts, and counted')
  networkAttempts.length = 0
})

let GET
try {
  ({ GET } = await import(real('app/api/cron/check-lesson-videos/route.ts')))
} catch (err) {
  console.log('\n=== loading the real files ===')
  ok(false, 'the route and the files it imports load', err instanceof Error ? err.message : String(err))
  finish()
}

// ───────────────────────── one run of the route ─────────────────────────

/** Lesson ids s000, s001… each with its own made-up video, and a 67 s watch lesson in the staging catalog. */
const lessonId = (i) => `s${String(i).padStart(3, '0')}`
const manyVideos = (n) => Array.from({ length: n }, (_, i) => ({ lesson_id: lessonId(i), tella_video_id: fakeVideoId(i) }))
const manyLessons = (n) => Array.from({ length: n }, (_, i) => ({ id: lessonId(i), type: 'watch', duration_seconds: 67 }))

async function run(world) {
  clock.t = 0
  W = {
    videos: world.videos.map((v) => ({ lock_status: 'unchecked', lock_detail: null, lock_checked_at: null, ...v })),
    lessons: world.lessons ?? [],
    lessons_next: world.lessons_next ?? [],
    tella: world.tella ?? (() => GOOD),
    costs: { tellaMs: 0, writeMs: 0, ...world.costs },
    unreadable: world.unreadable ?? [],
    unwritable: world.unwritable ?? [],
    discord: world.discord ?? 'accepts',
    cronRuns: [], reads: [], writes: [], asked: [], alerts: [], logs: [],
  }
  for (const v of W.videos) secretsUsed.add(v.tella_video_id)

  const env = { CRON_SECRET: FAKE_SECRET, TELLA_API_KEY: FAKE_KEY, TELLA_EMBED_DOMAINS: EXPECTED_HOSTS.join(','), DISCORD_TEAM_WEBHOOK_URL: FAKE_WEBHOOK, ...world.env }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  // The route's own log lines are kept, to be searched for an id.
  const realError = console.error, realWarn = console.warn
  console.error = console.warn = (...args) => { W.logs.push(args.map(String).join(' ')) }
  let res
  try {
    const authorization = 'authorization' in world ? world.authorization : `Bearer ${FAKE_SECRET}`
    res = await GET(new Request('https://sim.invalid/api/cron/check-lesson-videos', {
      headers: authorization === null ? {} : { authorization },
    }))
  } finally {
    console.error = realError
    console.warn = realWarn
  }
  const body = await res.json()

  invariants.requests += W.asked.length
  for (const [i, a] of W.asked.entries()) {
    if (i > 0 && a.at - W.asked[i - 1].at < 700) invariants.tooClose++
    if (a.limitMs === null) invariants.noLimit++
    else if (a.limitMs !== 10_000) invariants.wrongLimit++
    if (a.auth !== `Bearer ${FAKE_KEY}`) invariants.wrongAuth++
    if (a.method !== 'GET') invariants.wrongMethod++
  }
  everythingSaid.push(JSON.stringify(body), JSON.stringify(W.alerts), JSON.stringify(W.cronRuns), ...W.logs)

  const cron = W.cronRuns[0] ?? {}
  const description = W.alerts[0]?.embeds?.[0]?.description ?? ''
  return { status: res.status, body, w: W, cron, description, lines: description ? description.split('\n') : [] }
}

// ───────────────────────── the sentences, as the team reads them ─────────────────────────

const S = {
  gone: 'Tella no longer has this video.',
  scope: (s) => `Access is "${s}"; it must be Embed only.`,
  noList: 'No domain list: any site can embed it.',
  extra: (d) => `"${d}" is on its domain list and should not be.`,
  downloads: 'Downloads are switched on.',
  length: (a, b) => `The video is ${a} s long and the catalog says ${b} s, so the 95% rule is measuring the wrong length.`,
  noLength: 'The catalog has no length for this lesson, so it can never be counted.',
  noLesson: 'No watch lesson has this id.',
  notAsked: (why) => `Tella could not be asked: ${why}`,
}

// ───────────────────────── the scenarios ─────────────────────────

await scenario('1. one row of every kind', async () => {
  const kinds = [
    ['l001', 'live lesson, clean', () => GOOD],
    ['s001', 'clean', () => GOOD],
    ['s002', 'localhost on its list', () => ({ ...GOOD, allowedEmbedDomains: [...EXPECTED_HOSTS, 'localhost'] })],
    ['s003', 'watch lesson with no length', () => GOOD],
    ['s004', 'id in neither catalog table', () => GOOD],
    ['s005', 'a setup lesson', () => GOOD],
    ['s006', 'Tella 404', () => null],
    ['s007', 'Tella never answers', () => 'no answer'],
    ['s008', 'Tella sends headers, then nothing', () => 'headers, then nothing'],
    ['s009', 'Tella answers 503', () => ({ http: 503 })],
    ['s010', 'Tella answers without settings', () => ({ body: { video: { durationSeconds: 67 } } })],
    ['s011', 'Tella cannot be reached', () => 'unreachable'],
    ['s012', 'a copy as Tella makes it, downloads on, wrong length', () => ({ ...GOOD, linkScope: 'public', allowedEmbedDomains: [], downloadsEnabled: true })],
    ['s013', 'in both catalogs with different lengths', () => GOOD],
  ]
  const answers = Object.fromEntries(kinds.map(([, , answer], i) => [fakeVideoId(i), answer]))
  const { status, body, w, cron, lines } = await run({
    videos: kinds.map(([id], i) => ({ lesson_id: id, tella_video_id: fakeVideoId(i) })),
    lessons_next: [
      ...['s001', 's002', 's006', 's007', 's008', 's009', 's010', 's011'].map((id) => ({ id, type: 'watch', duration_seconds: 67 })),
      { id: 's003', type: 'watch', duration_seconds: null },
      { id: 's005', type: 'setup', duration_seconds: 67 },
      { id: 's012', type: 'watch', duration_seconds: 753 },
      { id: 's013', type: 'watch', duration_seconds: 67 },
    ],
    lessons: [
      { id: 'l001', type: 'watch', duration_seconds: 67 },
      { id: 's013', type: 'watch', duration_seconds: 300 },
    ],
    tella: (videoId) => answers[videoId](),
  })
  const p = Object.fromEntries(body.problems.map((x) => [x.lessonId, x]))
  const row = Object.fromEntries(w.videos.map((r) => [r.lesson_id, r]))
  const is = (id, st, sentences, label) => ok(p[id]?.status === st && same(p[id].problems, sentences), `${id}: ${label}`,
    p[id]?.status === st && same(p[id]?.problems, sentences) ? `${st}, ${sentences.length} sentence(s)` : `got ${JSON.stringify(p[id])}`)

  ok(status === 200, 'answers 200')
  ok(same(Object.keys(body), ['checked', 'locked', 'open', 'missing', 'error', 'notReached', 'problems']), 'the answer has these keys and no other', Object.keys(body).join(', '))
  ok(body.checked === 14 && body.locked === 6 && body.open === 2 && body.missing === 1 && body.error === 5 && body.notReached === 0, 'the counts',
     `checked ${body.checked}, locked ${body.locked}, open ${body.open}, missing ${body.missing}, error ${body.error}, notReached ${body.notReached}`)
  ok(!p.l001 && !p.s001 && body.problems.length === 12, 'the two clean lessons are not reported, the other 12 are')
  is('s002', 'open', [S.extra('localhost')], 'localhost on the list -> open')
  is('s003', 'locked', [S.noLength], 'a watch lesson with no length -> still locked, and said')
  is('s004', 'locked', [S.noLesson], 'an id in neither catalog table -> still locked, and said')
  is('s005', 'locked', [S.noLesson], 'a setup lesson -> the same sentence, its length is not looked at')
  is('s006', 'missing', [S.gone], 'Tella answers 404 -> missing')
  is('s007', 'error', [S.notAsked('Tella did not answer within 10 s.')], 'no answer in 10 s -> error, in a plain sentence')
  is('s008', 'error', [S.notAsked('Tella did not answer within 10 s.')], 'headers and then nothing -> the same limit, the same sentence')
  is('s009', 'error', [S.notAsked('Tella\'s API answered 503.')], 'a 503 -> error')
  is('s010', 'error', [S.notAsked('Tella\'s API answered without the video\'s settings.')], 'an answer nobody can read -> error, never locked')
  is('s011', 'error', [S.notAsked('Tella could not be reached (ECONNRESET).')], 'a network failure -> error, in our own words')
  is('s012', 'open', [S.scope('public'), S.noList, S.downloads, S.length(67, 753)], 'four things wrong at once -> open, four sentences in order')
  is('s013', 'locked', [S.length(67, 300)], 'a lesson in both catalogs is measured against the live one')
  ok(w.asked.length === 14 && same(w.asked.map((a) => a.lessonId), kinds.map(([id]) => id)), 'every video was asked about once, and the run went on after each failure')

  ok(row.s001.lock_status === 'locked' && row.s001.lock_detail === null && typeof row.s001.lock_checked_at === 'string', 'a clean row is written: locked, no detail, checked now')
  ok(row.s012.lock_status === 'open' && row.s012.lock_detail === p.s012.problems.join(' | '), 'an open row is written with its sentences joined by " | "')
  ok(row.s003.lock_status === 'locked' && row.s003.lock_detail === S.noLength, 'a locked row with a catalog problem keeps `locked` and gets the sentence')
  ok(row.s007.lock_status === 'error' && row.s006.lock_status === 'missing', 'error and missing rows are written as such')
  ok(w.writes.length === 14 && w.writes.every((x, i) => same(x.filters, { lesson_id: kinds[i][0], tella_video_id: fakeVideoId(i) }) && x.returning === 'lesson_id'),
     'every write is filtered on the lesson AND the video it asked about, and asks which rows it touched')
  ok(same(w.reads.map((r) => `${r.table}: ${r.columns}`), ['lesson_videos: lesson_id, tella_video_id', 'lessons_next: id, type, duration_seconds', 'lessons: id, type, duration_seconds']),
     'three reads, by column name, the live catalog last')

  ok(w.alerts.length === 1, 'one message to the team')
  ok(w.alerts[0].content === 'Lesson video lock check' && w.alerts[0].embeds.length === 1 && w.alerts[0].embeds[0].title === 'Lesson videos need attention' && w.alerts[0].embeds[0].color === 0xE8A86A,
     'with the documented text, title and colour')
  ok(lines.length === 12 && same(lines, body.problems.map((x) => `${x.lessonId}: ${x.problems.join(' ')}`)), 'one line per reported lesson: its id, then its sentences', lines[0])
  ok(same(w.cronRuns.map((r) => [r.route_name, r.auth_status, r.status, r.rows_affected, r.error_message]), [['check-lesson-videos', 'ok', 'success', 14, null]]) && typeof cron.finished_at === 'string',
     'cron_runs: one row, started and finished, success, 14 rows')
})

await scenario('2. a row that changes while the run is on', async () => {
  const { body, w, cron, description } = await run({
    videos: manyVideos(4),
    lessons_next: manyLessons(4),
    tella: (videoId, world) => {
      if (videoId === fakeVideoId(1)) {
        // s001 is rotated to a fresh copy while Tella answers about the old, open one.
        world.videos.find((r) => r.lesson_id === 's001').tella_video_id = fakeVideoId(901)
        secretsUsed.add(fakeVideoId(901))
        return { ...GOOD, linkScope: 'public' }
      }
      if (videoId === fakeVideoId(2)) {
        // s002's row is deleted while Tella answers.
        world.videos.splice(world.videos.findIndex((r) => r.lesson_id === 's002'), 1)
      }
      return GOOD
    },
  })
  const swapped = w.videos.find((r) => r.lesson_id === 's001')
  ok(swapped.tella_video_id === fakeVideoId(901) && swapped.lock_status === 'unchecked' && swapped.lock_detail === null && swapped.lock_checked_at === null,
     'the swapped row is left exactly as it was: the old video\'s "open" is not stamped on the new one')
  ok(body.notReached === 2 && body.checked === 2 && body.locked === 2 && body.open === 0 && body.problems.length === 0,
     'both rows are counted under notReached, in no status and in no problem', `checked ${body.checked}, notReached ${body.notReached}`)
  ok(w.alerts.length === 1 && description === '2 of 4 videos were NOT reached this run: 2 rows changed while it ran. Nothing was written for them.',
     'the team is told although no lesson has a problem', description)
  ok(cron.status === 'failed' && cron.error_message === '2 rows changed during the run and got no verdict' && cron.rows_affected === 2, 'cron_runs: failed, saying why', cron.error_message)
  ok(w.logs.filter((l) => l.includes('changed during the run')).length === 2, 'and each of the two is in the log by lesson id')
})

await scenario('3. the 270 s budget on the worst day (every request runs into its 10 s limit)', async () => {
  const world = { videos: manyVideos(145), lessons_next: manyLessons(145), tella: () => 'no answer', costs: { writeMs: 200 } }
  const first = await run(world)
  const { body, w, cron, lines } = first
  const lastStart = Math.max(...w.asked.map((a) => a.at))
  ok(body.checked === 27 && body.error === 27 && body.notReached === 118, '27 videos are asked, each becomes an error, 118 are not reached', `checked ${body.checked}, notReached ${body.notReached}`)
  ok(body.checked + body.notReached === 145, 'checked + notReached = the rows read')
  ok(lastStart < 270_000, 'no request to Tella starts after 270 s', `the last one started at ${(lastStart / 1000).toFixed(1)} s`)
  ok(clock.t < 285_000, 'the run is over with time to spare before 300 s', `it ended at ${(clock.t / 1000).toFixed(1)} s on the pretend clock`)
  ok(w.videos.filter((r) => r.lock_status === 'error').length === 27 && w.videos.filter((r) => r.lock_checked_at === null).length === 118, 'the 27 verdicts found were written; the 118 rows were not touched')
  ok(lines[0] === '118 of 145 videos were NOT reached this run: the check stopped asking Tella after 270 s with 118 to go. Nothing was written for them.', 'the alert opens with how many were not reached and why', lines[0])
  ok(lines.length === 28 && lines[1] === `s000: ${S.notAsked('Tella did not answer within 10 s.')}`, 'followed by the 27 lessons that were', lines[1])
  ok(cron.status === 'failed' && cron.error_message === 'stopped asking Tella at 270 s: 118 of 145 videos not reached' && cron.rows_affected === 27, 'cron_runs: failed, saying how many were left', cron.error_message)
  ok(w.logs.some((l) => l.includes('stopped asking Tella at 270 s with 118 of 145 videos not reached')), 'and the same in the log')
  ok(same(w.reads[0].order, [{ column: 'lock_checked_at', ascending: true, nullsFirst: true }, { column: 'lesson_id' }]), 'the rows are read longest unchecked first, never checked before all')

  // The next day is as bad. The rows are as the first run left them.
  const second = await run({ ...world, videos: w.videos })
  const firstAsked = new Set(w.asked.map((a) => a.lessonId))
  ok(second.w.asked.length === 27 && second.w.asked.every((a) => !firstAsked.has(a.lessonId)), 'the next run starts with rows the first one did not reach: none is asked twice',
     `run 1 asked ${w.asked[0]?.lessonId} to ${w.asked.at(-1)?.lessonId}, run 2 asked ${second.w.asked[0]?.lessonId} to ${second.w.asked.at(-1)?.lessonId}`)
  let rows = second.w.videos
  for (let day = 3; day <= 6; day++) rows = (await run({ ...world, videos: rows })).w.videos
  ok(rows.every((r) => r.lock_status === 'error'), 'six such days in a row still get to every one of the 145')
})

await scenario('4. the pace, and how many videos fit', async () => {
  const world = (n, costs) => ({ videos: manyVideos(n), lessons_next: manyLessons(n), costs })
  const seconds = () => (clock.t / 1000).toFixed(1)
  {
    const { body } = await run(world(145, { tellaMs: 300, writeMs: 100 }))
    ok(body.checked === 145 && body.notReached === 0 && clock.t > 100_000 && clock.t < 103_000, 'fast answers (0.3 s, 0.1 s write): 145 videos take about 100 s, held to one request per 700 ms', `${seconds()} s`)
  }
  {
    const { body, w } = await run(world(600, { tellaMs: 300, writeMs: 100 }))
    const firstMinute = w.asked.filter((a) => a.at < 60_000).length
    ok(body.checked === 386 && body.notReached === 214, 'fast answers: 386 fit in the budget', `of 600, ${body.notReached} not reached`)
    ok(firstMinute === 86, 'never more than 86 requests in a minute (Tella allows 100)', `${firstMinute} in the first minute`)
  }
  {
    const { body } = await run(world(145, { tellaMs: 1200, writeMs: 200 }))
    ok(body.checked === 145 && body.notReached === 0 && Math.round(clock.t / 1000) === 203, 'answers of 1.2 s with a 0.2 s write: 145 videos fit, with no pause added to a slow answer', `${seconds()} s`)
  }
  {
    const { body } = await run(world(300, { tellaMs: 1200, writeMs: 200 }))
    ok(body.checked === 193 && body.notReached === 107, 'at that speed 193 fit', `of 300, ${body.notReached} not reached`)
  }
  {
    const { body } = await run(world(145, { tellaMs: 1700, writeMs: 200 }))
    ok(body.checked === 143 && body.notReached === 2, 'answers of 1.7 s: the 145 no longer fit, and the run says so', `${body.notReached} not reached at ${seconds()} s`)
  }
})

await scenario('5. the alert, cut to fit Discord', async () => {
  const allOpen = () => ({ ...GOOD, linkScope: 'public', allowedEmbedDomains: [...EXPECTED_HOSTS, 'localhost'], downloadsEnabled: true })
  const lineFor = (i) => `${lessonId(i)}: ${[S.scope('public'), S.extra('localhost'), S.downloads].join(' ')}`
  const cutCheck = (label, lines, runLines, reported) => {
    const tail = lines[lines.length - 1]
    const shown = lines.slice(runLines, -1)
    const more = Number(tail.match(/^…and (\d+) more lessons\. Every reason is in lesson_videos\.lock_detail\.$/)?.[1] ?? NaN)
    const used = lines.slice(0, -1).reduce((n, l) => n + l.length + 1, 0)
    ok(shown.length > 0 && shown.every((l, i) => l === lineFor(i)), `${label}: every lesson line shown is whole`, `${shown.length} lines`)
    ok(shown.length + more === reported, `${label}: the last line says how many more there are`, tail)
    ok(used <= 3800 && used + lineFor(shown.length).length + 1 > 3800, `${label}: it stops at the last line that fits in 3,800 characters`, `${used} used`)
    ok(lines.join('\n').length <= 4096, `${label}: the whole message is under Discord's 4,096`, `${lines.join('\n').length} characters`)
  }
  {
    const { body, lines } = await run({ videos: manyVideos(60), lessons_next: manyLessons(60), tella: allOpen })
    ok(body.open === 60 && body.problems.length === 60, 'the answer itself still lists all 60 lessons')
    cutCheck('60 open lessons', lines, 0, 60)
  }
  {
    const { body, lines } = await run({ videos: manyVideos(400), lessons_next: manyLessons(400), tella: allOpen, costs: { tellaMs: 1200, writeMs: 200 } })
    ok(lines[0] === '207 of 400 videos were NOT reached this run: the check stopped asking Tella after 270 s with 207 to go. Nothing was written for them.', 'a partial run with a long list: the run\'s own line comes first and is never the one cut', lines[0])
    cutCheck('193 open lessons after it', lines, 1, body.problems.length)
  }
})

await scenario('6. a catalog table that cannot be read', async () => {
  const { body, cron, lines } = await run({
    videos: [
      { lesson_id: 'l001', tella_video_id: fakeVideoId(1) },
      { lesson_id: 'l002', tella_video_id: fakeVideoId(2) },
      { lesson_id: 's001', tella_video_id: fakeVideoId(3) },
    ],
    lessons: [{ id: 'l001', type: 'watch', duration_seconds: 67 }, { id: 'l002', type: 'watch', duration_seconds: null }],
    unreadable: ['lessons_next'],
    tella: (videoId) => (videoId === fakeVideoId(3) ? { ...GOOD, downloadsEnabled: true } : GOOD),
  })
  const p = Object.fromEntries(body.problems.map((x) => [x.lessonId, x]))
  ok(p.s001?.status === 'open' && same(p.s001.problems, [S.downloads]), 's001, whose table failed: the lock rules still ran, and it is NOT called an unknown lesson', JSON.stringify(p.s001?.problems))
  ok(!p.l001 && same(p.l002?.problems, [S.noLength]), 'the lessons in the table that was read are judged as usual')
  ok(lines[0] === 'The catalog could not be read in full (lessons_next), so a video whose lesson is missing from the catalog was not reported this run.', 'the alert says once that the catalog was not read in full', lines[0])
  ok(cron.status === 'failed' && cron.error_message === 'catalog not read in full (lessons_next)', 'cron_runs: failed, saying which table', cron.error_message)
})

await scenario('7. the refusals', async () => {
  const one = { videos: manyVideos(1), lessons_next: manyLessons(1) }
  {
    const { status, body, w, cron } = await run({ ...one, authorization: null })
    ok(status === 401 && body.error === 'Unauthorized' && w.asked.length === 0 && w.reads.length === 0, 'no secret -> 401, nothing read and Tella not asked')
    ok(cron.status === 'auth_failed' && cron.auth_status === 'missing_header', 'cron_runs: the refusal is recorded with its reason', cron.auth_status)
  }
  {
    const { status, w, cron } = await run({ ...one, authorization: 'Bearer not-the-secret' })
    ok(status === 401 && w.asked.length === 0 && cron.auth_status === 'mismatch', 'a wrong secret -> 401', cron.auth_status)
  }
  {
    const { status, body, w, cron } = await run({ ...one, env: { TELLA_API_KEY: undefined } })
    ok(status === 500 && same(body, { error: 'Lock check not configured' }) && w.asked.length === 0 && w.reads.length === 0, 'no TELLA_API_KEY -> 500 "Lock check not configured"')
    ok(cron.status === 'failed' && cron.error_message === 'Lock check not configured', 'cron_runs: failed, with the same words')
  }
  {
    const { status, body, w } = await run({ ...one, env: { TELLA_EMBED_DOMAINS: ' , ' } })
    ok(status === 500 && same(body, { error: 'Lock check not configured' }) && w.asked.length === 0, 'a domain list of only commas and spaces -> 500: it would judge every video against nothing')
  }
  {
    const { status, w, cron } = await run({ ...one, unreadable: ['lesson_videos'] })
    ok(status === 500 && w.asked.length === 0 && w.alerts.length === 0 && cron.status === 'failed' && cron.error_message === 'pretend failure reading lesson_videos',
       'the table of videos cannot be read -> 500, Tella not asked, cron_runs failed', cron.error_message)
  }
})

await scenario('8. nothing wrong', async () => {
  const clean = await run({ videos: manyVideos(3), lessons_next: manyLessons(3) })
  ok(clean.status === 200 && clean.body.locked === 3 && clean.body.problems.length === 0 && clean.body.notReached === 0, 'three clean videos: all locked, nothing reported')
  ok(clean.w.alerts.length === 0 && clean.cron.status === 'success' && clean.cron.rows_affected === 3, 'no message to the team, cron_runs success')
  const empty = await run({ videos: [] })
  ok(empty.status === 200 && empty.body.checked === 0 && empty.w.alerts.length === 0 && empty.cron.status === 'success', 'no rows at all: 200, nothing checked, no message')
})

await scenario('9. an alert that does not go out', async () => {
  const open = { videos: manyVideos(1), lessons_next: manyLessons(1), tella: () => ({ ...GOOD, linkScope: 'public' }) }
  {
    const { status, body, w, cron } = await run({ ...open, discord: 'refuses' })
    ok(status === 200 && body.open === 1 && w.alerts.length === 1, 'Discord refuses the post: the answer is unchanged')
    ok(cron.status === 'failed' && cron.error_message === 'alert not delivered (discord-500: pretend Discord error)', 'cron_runs: failed, alert not delivered', cron.error_message)
    ok(w.videos[0].lock_status === 'open', 'and the verdict is on the row all the same')
  }
  {
    const { w, cron } = await run({ ...open, env: { DISCORD_TEAM_WEBHOOK_URL: undefined } })
    ok(w.alerts.length === 0 && cron.status === 'failed' && cron.error_message === 'alert not delivered (env-var-missing)', 'no webhook configured: cron_runs says the alert was not delivered', cron.error_message)
  }
})

await scenario('10. a write that fails', async () => {
  const { body, w, cron } = await run({ videos: manyVideos(2), lessons_next: manyLessons(2), tella: () => ({ ...GOOD, linkScope: 'public' }), unwritable: ['s001'] })
  const line = w.logs.find((l) => l.includes('not written')) ?? ''
  ok(body.checked === 2 && body.open === 2 && body.notReached === 0 && body.problems.length === 2, 'a verdict that could not be written is still counted and reported')
  ok(w.videos.find((r) => r.lesson_id === 's001').lock_status === 'unchecked', 'its row is unchanged')
  ok(cron.status === 'failed' && cron.error_message === '1 verdict not written' && cron.rows_affected === 1, 'cron_runs: failed, 1 verdict not written, 1 row', cron.error_message)
  ok(line.includes('s001') && line.includes('[video id]') && !line.includes(fakeVideoId(1)), 'the log names the lesson, and the video id the database error repeated is blanked', line)
})

await scenario('across every run above', async () => {
  ok(invariants.requests > 1000 && invariants.tooClose === 0, 'no two requests to Tella started less than 700 ms apart', `${invariants.requests} requests in all`)
  ok(invariants.noLimit === 0 && invariants.wrongLimit === 0, 'every request to Tella carried the 10 s limit')
  ok(invariants.wrongAuth === 0 && invariants.wrongMethod === 0, 'every request to Tella was a GET with the key as a bearer token')
  const said = everythingSaid.join('\n')
  const leaked = [...secretsUsed].filter((s) => said.includes(s))
  ok(said.length > 10_000 && leaked.length === 0, 'no video id, key or secret is in any answer, alert, cron_runs row or log line', `${secretsUsed.size} values searched for in ${said.length} characters`)
  ok(networkAttempts.length === 0, 'nothing tried to reach the network', networkAttempts.join('; '))
})

finish()
