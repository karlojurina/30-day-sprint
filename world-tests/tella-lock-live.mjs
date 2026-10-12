/**
 * Tella player, Work Item 2: the lock check's logic, run once against the real
 * Tella API. (_admin/prds/tella-player/tella_player_prd.md, section 12.)
 *
 *   node world-tests/tella-lock-live.mjs
 *
 * Run it from the app root (30-day-sprint). The code under test is the real
 * TypeScript, imported as it is: src/lib/world/tella-api.ts
 * (fetchTellaVideoFacts), tella-lock.ts (judgeLock) and tella.ts. Node has to
 * strip the types, so on a Node that does not do that by default (older than
 * 22.18) the script starts itself again as
 *
 *   node --experimental-strip-types world-tests/tella-lock-live.mjs
 *
 * which is also the command to type by hand. Needs Node 22.6 or newer.
 *
 * READ-ONLY, AND TWO REQUESTS: one GET https://api.tella.com/v1/videos/{id}
 * for each of the two test videos. It writes nothing, to Tella or anywhere
 * else, and it does not touch Supabase, the app or Discord.
 *
 * It reads TELLA_API_KEY, DEV_TELLA_VIDEO_ID ("video A") and
 * DEV_TELLA_VIDEO_ID_2 ("video B") from .env.local by parsing the file.
 * NOTHING IT PRINTS CONTAINS THE KEY OR AN ID: every line goes through say(),
 * which blanks all three, including inside an error message.
 *
 * The two expectations (exit code 1 if either fails):
 *   1. expected sites = the preview host and the production host: both videos
 *      are `open` with exactly one problem, and it names `localhost`. True of
 *      the two test videos by design (PRD decision D8): they keep `localhost`
 *      on their list so the harness can play them, and no real lesson may.
 *   2. with `localhost` added to the expected sites: both are `locked` with no
 *      problem.
 */
import fs from 'node:fs'
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

const src = (name) => new URL(`../src/lib/world/${name}`, import.meta.url).href
const { isTellaVideoId } = await import(src('tella.ts'))
const { judgeLock } = await import(src('tella-lock.ts'))
const { fetchTellaVideoFacts } = await import(src('tella-api.ts'))

const PREVIEW = '30-day-sprint-smkv-git-world-engine-karlojurinas-projects.vercel.app'
const PRODUCTION = '30-day-sprint-smkv.vercel.app'
/** The same spacing the lock check keeps between its calls to Tella. */
const CALL_GAP_MS = 700

function readEnvLocal() {
  const file = new URL('../.env.local', import.meta.url)
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    let value = line.slice(eq + 1).trim()
    const quoted = /^(["']).*\1$/.test(value)
    if (quoted) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

const env = readEnvLocal()
const apiKey = env.TELLA_API_KEY
const VIDEOS = [
  { name: 'video A', envName: 'DEV_TELLA_VIDEO_ID', id: env.DEV_TELLA_VIDEO_ID },
  { name: 'video B', envName: 'DEV_TELLA_VIDEO_ID_2', id: env.DEV_TELLA_VIDEO_ID_2 },
]

const secrets = [apiKey, ...VIDEOS.map((v) => v.id)].filter(Boolean)
const hide = (text) => secrets.reduce((t, s) => t.split(s).join('[hidden]'), String(text))
const say = (line = '') => console.log(hide(line))

let pass = 0
const fails = []
function expectation(cond, label) {
  if (cond) { pass++; say(`  PASS  ${label}`) }
  else { fails.push(label); say(`  FAIL  ${label}`) }
}
function finish() {
  say(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
  if (fails.length) { fails.forEach((f) => say('  - ' + f)); process.exit(1) }
  process.exit(0)
}

say('Lesson video lock check, live. Read-only: 2 GET requests to api.tella.com.\n')

// Nothing is sent unless all three values are there and well formed.
if (!apiKey) expectation(false, 'TELLA_API_KEY is set in .env.local')
for (const v of VIDEOS) {
  if (!isTellaVideoId(v.id)) expectation(false, `${v.envName} in .env.local is a well formed Tella id`)
}
if (VIDEOS[0].id && VIDEOS[0].id === VIDEOS[1].id) {
  expectation(false, 'DEV_TELLA_VIDEO_ID and DEV_TELLA_VIDEO_ID_2 are two different videos')
}
if (fails.length) finish()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

say('=== what Tella says ===')
for (const [i, v] of VIDEOS.entries()) {
  if (i > 0) await sleep(CALL_GAP_MS)
  try {
    v.facts = await fetchTellaVideoFacts(v.id, apiKey)
    v.asked = true
    say(v.facts === null
      ? `  ${v.name}  404, Tella does not have it`
      : `  ${v.name}  access "${v.facts.linkScope}", ${v.facts.allowedEmbedDomains.length} site(s) on its list, ` +
        `downloads ${v.facts.downloadsEnabled || v.facts.rawDownloadsEnabled ? 'ON' : 'off'}, ${v.facts.durationSeconds} s`)
  } catch (err) {
    v.asked = false
    v.askError = err instanceof Error ? err.message : String(err)
    say(`  ${v.name}  could not be asked: ${v.askError}`)
  }
}

/** The verdict for each video against one list of expected sites, printed. No catalog length here, so the length rule stays quiet. */
function judgeAll(title, expectedDomains) {
  say(`\n=== ${title} ===`)
  return VIDEOS.map((v) => {
    const verdict = v.asked
      ? judgeLock(v.facts, expectedDomains, null)
      : { status: 'error', problems: [`Tella could not be asked: ${v.askError}`] }
    say(`  ${v.name}  ${verdict.status}`)
    if (verdict.problems.length === 0) say('             (no problem)')
    for (const p of verdict.problems) say(`             - ${p}`)
    return verdict
  })
}

{
  const verdicts = judgeAll('expected sites: preview + production', [PREVIEW, PRODUCTION])
  expectation(
    verdicts.every((v) => v.status === 'open' && v.problems.length === 1 && v.problems[0].includes('localhost')),
    'both videos are open with exactly one problem, and it names localhost',
  )
}
{
  const verdicts = judgeAll('expected sites: preview + production + localhost', [PREVIEW, PRODUCTION, 'localhost'])
  expectation(
    verdicts.every((v) => v.status === 'locked' && v.problems.length === 0),
    'both videos are locked with no problem',
  )
}

finish()
