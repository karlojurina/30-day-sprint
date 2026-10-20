// engagement-alerts.test.mjs: the engagement alerts reach the team's Discord
// whatever their number (bug hunt of 19 October, cron-1).
//
// check-engagement put every new alert into ONE embed. Discord refuses an
// embed whose description is over 4096 characters, which that embed passed
// at about 22 alerts, and the run still recorded success. On the new course
// that post is the only place the team sees no_login_5d and no_tasks_7d, and
// an open alert blocks a new one, so a refused post lost those alerts for
// good. The first such run: Wed 21 Oct at 16:10 UTC, course Day 3 for every
// student who paid before the switch.
//
// Now src/lib/discord.ts cuts the alerts into embeds of at most 4096
// characters, the route posts each as its own message, and a post that fails
// marks the run failed in cron_runs with the reason. postTeamAlert also waits
// out Discord's 429 (Retry-After) and sends again, at most twice, since the
// alerts now go out as several messages in a row.
//
// The route runs as it is: the real route, src/lib/discord.ts, cron-auth.ts,
// dm-toggles.ts, curriculum-reset.ts and supabase-server.ts, copied here
// with their import lines pointed at the copies, and a real supabase-js
// client. Only the network is stood in (_gen/stub-cron.ts): a PostgREST over
// plain rows and a Discord webhook with Discord's documented limits. The
// route and discord.ts as they stood at BASE (production on 19 October) are
// taken from git and run on the same stand-ins, to show what was wrong.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BASE = '70c934a'
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })
// dropComments leaves out every comment line of a copy (a line that starts
// with //, /* or *): some name team members, and this repository is public.
// The code must stay the same, so the app's own TypeScript prints the source
// and the copy without comments and the two must match, or the test stops.
const ts = createRequire(import.meta.url)('typescript')
const codeOf = (text) => ts.createPrinter({ removeComments: true })
  .printFile(ts.createSourceFile('copy.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS))
function write(text, label, outRel, rewrites = [], { dropComments = false } = {}) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (dropComments) {
    const kept = s.split('\n').filter((l) => !/^(\/\/|\/\*|\*)/.test(l.trimStart())).join('\n')
    if (codeOf(kept) !== codeOf(s)) throw new Error(`leaving out the comment lines of ${label} would change its code`)
    s = kept
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${label}`)
}

// The libraries the route imports. constants.ts, curriculum-reset.ts and
// metrics-definitions.ts are the same copies build.mjs and
// discount-queue.test.mjs make. dm-toggles.ts's copy has no comment lines,
// as in cron-failed-reads.test.mjs.
const LIBS = [
  ['src/lib/constants.ts', './_gen/constants.ts', []],
  ['src/lib/curriculum-reset.ts', './_gen/curriculum-reset.ts', []],
  ['src/lib/admin/metrics-definitions.ts', './_gen/metrics-definitions.ts', [['from "@/lib/constants"', 'from "./constants.ts"']]],
  ['src/lib/dm-toggles.ts', './_gen/dm-toggles.ts', [], { dropComments: true }],
  ['src/lib/supabase-server.ts', './_gen/supabase-server.ts', []],
  ['src/lib/cron-auth.ts', './_gen/cron-auth.ts', [['from "@/lib/supabase-server"', 'from "./supabase-server.ts"']]],
  ['src/lib/discord.ts', './_gen/discord.ts', []],
]
for (const [src, out, rw, opts] of LIBS) write(fromSrc(src), src, out, rw, opts)
write(fromBase('src/lib/discord.ts'), `src/lib/discord.ts@${BASE}`, './_gen/discord.old.ts')
const ROUTE = 'src/app/api/cron/check-engagement/route.ts'
const routeRewrites = (discord) => [
  ['from "next/server"', 'from "./stub-cron.ts"'],
  ['from "@/lib/supabase-server"', 'from "./supabase-server.ts"'],
  ['from "@/lib/discord"', `from "${discord}"`],
  ['from "@/lib/dm-toggles"', 'from "./dm-toggles.ts"'],
  ['from "@/lib/admin/metrics-definitions"', 'from "./metrics-definitions.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/cron-auth"', 'from "./cron-auth.ts"'],
]
write(fromSrc(ROUTE), ROUTE, './_gen/check-engagement-route.ts', routeRewrites('./discord.ts'))
write(fromBase(ROUTE), `${ROUTE}@${BASE}`, './_gen/check-engagement-route.old.ts', routeRewrites('./discord.old.ts'))

const SECRET = 'cron-secret-for-the-test'
process.env.CRON_SECRET = SECRET
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-the-test'
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
const WEBHOOK = 'https://discord.test/api/webhooks/1/stand-in'
process.env.DISCORD_TEAM_WEBHOOK_URL = WEBHOOK

const { StandInDb, StandInDiscord, installNetwork, discordProblems } = await import('./_gen/stub-cron.ts')
const { buildAlertsEmbeds, EMBED_DESCRIPTION_MAX } = await import('./_gen/discord.ts')
const NEW = await import('./_gen/check-engagement-route.ts')
const OLD = await import('./_gen/check-engagement-route.old.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

let db = null
let discord = null
installNetwork({ db: () => db, discord: () => discord })

const H = 3_600_000
const D = 24 * H
const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const uuid = (i) => `5a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
const nameOf = (i) => `Student Number ${String(i + 1).padStart(3, '0')} Longname`
// The switch 2.5 days ago: for a student who paid before it, the run is on
// course Day 3, as the 21 October run is for every one of them.
const SWITCH = NOW - 2.5 * D

function freshDb(n, { toggle = true, name = nameOf } = {}) {
  return new StandInDb({
    students: Array.from({ length: n }, (_, i) => ({
      id: uuid(i), name: name(i), membership_status: 'active', whop_plan_id: 'plan_4ZrwR4PmBsVsx',
      first_paid_at: iso(NOW - 20 * D), joined_at: iso(NOW - 20 * D), last_active_at: iso(NOW - H),
    })),
    student_lesson_completions: [],
    disengagement_alerts: [],
    admin_config: [
      { key: 'curriculum_reset_at', value: iso(SWITCH) },
      { key: 'dms_master_enabled', value: toggle ? 'true' : 'false' },
      { key: 'engagement_alerts_enabled', value: toggle ? 'true' : 'false' },
    ],
    cron_runs: [],
  })
}
function freshDiscord({ limit = 5, windowMs = 600, retryAfter = '0.6', failWhen = null } = {}) {
  const d = new StandInDiscord()
  Object.assign(d, { limit, windowMs, retryAfter, failWhen })
  return d
}
async function run(route) {
  const res = await route.GET(new Request('http://app.test/api/cron/check-engagement', { headers: { authorization: `Bearer ${SECRET}` } }))
  return { status: res.status, body: await res.json() }
}
const theRun = () => db.rows('cron_runs').at(-1)
const idsIn = (text) => [...text.matchAll(/\/admin\/students\/([0-9a-f-]{36})\)/g)].map((m) => m[1])
const embedsOf = (messages) => messages.flatMap((m) => m.embeds ?? [])
const textOf = (e) => `${e.title ?? ''}\n${e.description ?? ''}\n${e.footer?.text ?? ''}`
const alertsFor = (n, name = nameOf) => Array.from({ length: n }, (_, i) => ({
  studentId: uuid(i), studentName: name(i), alertType: i % 3 === 0 ? 'no_login_5d' : 'no_lessons_3d',
  message: `${name(i)} still hasn't started (Day 3)`,
}))
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

console.log('\n=== The embeds: each within 4096 characters, every alert once, in order ===')
for (const [n, name, what] of [[60, nameOf, '60 alerts'], [100, (i) => `Forty Character Name For Student ${String(i).padStart(6, '0')}`, '100 alerts with 40-character names']]) {
  const alerts = alertsFor(n, name)
  const embeds = buildAlertsEmbeds(alerts, 'https://app.test')
  const longest = Math.max(...embeds.map((e) => e.description.length))
  ok(embeds.length > 1 && embeds.every((e) => e.description.length <= EMBED_DESCRIPTION_MAX),
     `${what}: ${embeds.length} embeds, each description within 4096 characters`, `longest ${longest}`)
  ok(embeds.every((e) => discordProblems({ embeds: [e] }).length === 0),
     `${what}: each embed alone is a message Discord takes (6000 characters a message, title 256, footer 2048)`,
     `largest message ${Math.max(...embeds.map((e) => textOf(e).length))} characters`)
  const ids = embeds.flatMap((e) => idsIn(e.description))
  ok(show(ids) === show(alerts.map((a) => a.studentId)), `${what}: every alert appears exactly once, in the order given`, `${ids.length} of ${n}`)
  ok(embeds.every((e, i) => e.title === `🚨 ${n} students flagged (part ${i + 1} of ${embeds.length})`),
     `${what}: each title gives the whole count and its part`, embeds[0].title)
  ok(embeds.every((e) => e.description.split('\n\n').every((entry) => idsIn(entry).length === 1)),
     `${what}: no alert is split across two embeds`)
}
{
  const [e, ...rest] = buildAlertsEmbeds(alertsFor(1), 'https://app.test')
  ok(rest.length === 0 && e.title === '🚨 1 student flagged'
     && e.description === `**${nameOf(0)}**: hasn't logged in for 5+ days\n${nameOf(0)} still hasn't started (Day 3)\n[Open in admin](https://app.test/admin/students/${uuid(0)})`,
     'one alert: one embed, the title as before, the entry as before with a colon in place of the dash', show(e.title))
  ok(buildAlertsEmbeds([], 'https://app.test').length === 0, 'no alerts: no embed')
}
{
  // Only a name thousands of characters long makes one entry too long alone.
  const huge = buildAlertsEmbeds(alertsFor(3, (i) => (i === 1 ? 'N'.repeat(5000) : nameOf(i))), 'https://app.test')
  const emoji = buildAlertsEmbeds(alertsFor(1, () => '😀'.repeat(3000)), 'https://app.test')
  ok(huge.length === 3 && huge.every((e) => e.description.length <= EMBED_DESCRIPTION_MAX) && huge[1].description.endsWith('…')
     && show(idsIn(huge[0].description).concat(idsIn(huge[2].description))) === show([uuid(0), uuid(2)]),
     'a 5000-character name: its entry is cut to 4096 and alone in its embed, the others are whole', huge.map((e) => e.description.length).join(','))
  ok(emoji[0].description.length <= EMBED_DESCRIPTION_MAX && !lone.test(emoji[0].description),
     'a name of emoji cut at the limit is never cut through an emoji', `${emoji[0].description.length} characters`)
}
{
  const words = buildAlertsEmbeds(alertsFor(60), 'https://app.test').map(textOf).join('\n')
  ok(!/—|EcomTalent|unlock/i.test(words), 'the words the team reads: no em dash, no "EcomTalent", no "unlock"',
     buildAlertsEmbeds(alertsFor(1), 'https://app.test')[0].footer.text)
}

console.log('\n=== Before: one embed for 60 alerts, refused, and the run says success ===')
{
  db = freshDb(60)
  discord = freshDiscord()
  const r = await run(OLD)
  ok(r.status === 200 && r.body.alerts === 60 && db.rows('disengagement_alerts').length === 60,
     'the old route inserts the 60 alerts (no_lessons_3d on course Day 3)', show(r.body))
  ok(discord.posts.length === 1 && discord.posts[0].status === 400 && r.body.discord_posted === false,
     'it posts one embed of every alert, and Discord refuses it (400, description over 4096)',
     `${discord.posts[0]?.payload.embeds[0].description.length} characters`)
  ok(theRun().status === 'success' && theRun().error_message === null,
     'and cron_runs records success: nobody finds out', show({ status: theRun().status, error: theRun().error_message }))
}

console.log('\n=== After: 60 alerts, one message per embed, every one taken ===')
{
  db = freshDb(60)
  discord = freshDiscord()
  const r = await run(NEW)
  const delivered = discord.delivered()
  const ids = embedsOf(delivered).flatMap((e) => idsIn(e.description))
  ok(r.status === 200 && r.body.alerts === 60 && db.rows('disengagement_alerts').length === 60,
     'the route inserts the 60 alerts, as before', show({ alerts: r.body.alerts }))
  ok(discord.posts.length >= 2 && discord.posts.every((p) => p.status === 204) && delivered.every((m) => m.embeds.length === 1),
     'it posts one embed per message, and Discord takes every message', `${delivered.length} messages`)
  ok(show(ids) === show(db.rows('students').map((s) => s.id)), 'every alert reaches the channel exactly once, in order', `${ids.length} of 60`)
  ok(r.body.discord_posted === true && r.body.discord_reason === null && theRun().status === 'success' && theRun().rows_affected === 60,
     'the response says posted, and cron_runs records success with 60 rows', show({ posted: r.body.discord_posted, run: theRun().status }))
}

console.log('\n=== After: a post Discord does not take marks the run failed, and says which ===')
{
  db = freshDb(60)
  discord = freshDiscord({ failWhen: (n) => (n === 2 ? { status: 500, body: 'stand-in: Discord had an error' } : null) })
  const r = await run(NEW)
  const parts = discord.posts.length
  ok(parts >= 3 && discord.posts.filter((p) => p.status === 204).length === parts - 1,
     'the other parts still go out', `${parts - 1} of ${parts} taken`)
  ok(r.body.discord_posted === false && r.body.discord_reason === `1 of ${parts} Discord posts not delivered (part 2: discord-500: stand-in: Discord had an error)`,
     'the response says not posted, and the reason names the part and Discord\'s answer', r.body.discord_reason)
  ok(theRun().status === 'failed' && theRun().error_message === r.body.discord_reason && theRun().rows_affected === 60,
     'cron_runs records the run failed, with the same reason', show({ status: theRun().status, rows: theRun().rows_affected }))
  ok(db.rows('disengagement_alerts').length === 60, 'the alerts are still written: only the post failed')
}

console.log('\n=== After: 200 alerts in a row meet Discord\'s rate limit, wait it out, and all land ===')
{
  db = freshDb(200)
  discord = freshDiscord({ limit: 5, windowMs: 600, retryAfter: '0.6' })
  const started = Date.now()
  const r = await run(NEW)
  const delivered = discord.delivered()
  const ids = embedsOf(delivered).flatMap((e) => idsIn(e.description))
  const limited = discord.posts.filter((p) => p.status === 429).length
  ok(delivered.length > 5 && limited > 0, `${delivered.length} messages: Discord answered 429 (Retry-After 0.6 s) ${limited} time(s)`)
  ok(r.body.discord_posted === true && show(ids) === show(db.rows('students').map((s) => s.id)) && theRun().status === 'success',
     'each refused post waited and went again: every alert landed once, and the run is a success',
     `${ids.length} of 200 in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}
{
  db = freshDb(60)
  discord = freshDiscord({ limit: 0, retryAfter: '0.05' })
  const r = await run(NEW)
  const parts = discord.posts.length / 3
  ok(Number.isInteger(parts) && parts >= 3 && discord.posts.every((p) => p.status === 429),
     'a rate limit that does not lift: each post is sent 3 times (2 retries), then given up', `${discord.posts.length} attempts for ${parts} parts`)
  ok(r.body.discord_posted === false && theRun().status === 'failed' && /discord-429/.test(theRun().error_message),
     'and the run is failed with Discord\'s 429 in the reason', theRun().error_message.slice(0, 90))
}

console.log('\n=== After: what has not changed ===')
{
  db = freshDb(60, { toggle: false })
  discord = freshDiscord()
  const r = await run(NEW)
  ok(discord.posts.length === 0 && r.body.discord_posted === false && r.body.discord_reason === 'paused-by-toggle'
     && theRun().status === 'success' && db.rows('disengagement_alerts').length === 60,
     'the toggle off: no post, "paused-by-toggle", the run a success, the alerts written', show(r.body))
}
{
  db = freshDb(60)
  discord = freshDiscord()
  delete process.env.DISCORD_TEAM_WEBHOOK_URL
  const r = await run(NEW)
  process.env.DISCORD_TEAM_WEBHOOK_URL = WEBHOOK
  ok(discord.posts.length === 0 && r.body.discord_posted === false && theRun().status === 'failed' && /env-var-missing/.test(theRun().error_message),
     'the toggle on with no webhook address: nothing can go out, so the run is failed and says why', theRun().error_message)
}
{
  db = freshDb(0)
  discord = freshDiscord()
  const r = await run(NEW)
  ok(r.body.checked === 0 && r.body.alerts === 0 && discord.posts.length === 0 && theRun().status === 'success',
     'nobody in the pool: no post, a success', show(r.body))
}
{
  db = freshDb(2)
  db.rows('disengagement_alerts').push({ id: 'a-open', student_id: uuid(0), alert_type: 'no_lessons_3d', message: 'earlier', is_dismissed: false })
  discord = freshDiscord()
  const r = await run(NEW)
  const ids = embedsOf(discord.delivered()).flatMap((e) => idsIn(e.description))
  ok(r.body.alerts === 1 && show(ids) === show([uuid(1)]) && discord.delivered()[0].embeds[0].title === '🚨 1 student flagged',
     'a student with the alert still open gets no second one; the other gets one post', show(r.body))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
