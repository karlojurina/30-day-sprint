import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TELLA_ORIGIN, WATCH_SPEED_CAP, isTellaVideoId, tellaEmbedUrl } from './_gen/tella.ts'
import { judgeLock } from './_gen/tella-lock.ts'

let pass = 0
let skipped = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
// A check that could not run is neither a pass nor a failure, and it is
// counted on the last line so it cannot go unnoticed.
function skip(label, why) { skipped++; console.log(` SKIP  ${label} — ${why}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Every id in this file is made up. The repository is public and a real Tella
// id is the video's address, so a real one is never written here.
const FAKE_ID = 'vid_testaaaaaaaaaaaa01'

console.log('\n=== isTellaVideoId: the same shape the table\'s check constraint enforces ===')
ok(isTellaVideoId(FAKE_ID), 'accepts the vid_ shape')
ok(isTellaVideoId('vid_' + 'a'.repeat(10)), 'accepts the shortest id (10 characters after vid_)')
ok(isTellaVideoId('vid_' + 'a1'.repeat(32)), 'accepts the longest id (64 characters after vid_)')
ok(!isTellaVideoId('vid_' + 'a'.repeat(9)), 'rejects 9 characters after vid_')
ok(!isTellaVideoId('vid_' + 'a'.repeat(65)), 'rejects 65 characters after vid_')
ok(!isTellaVideoId(`https://www.tella.tv/video/${FAKE_ID}/embed`), 'rejects a URL, even one that contains a well formed id')
ok(!isTellaVideoId('0a1b2c3d-0000-4000-8000-000000000000'), 'rejects a Bunny GUID')
ok(!isTellaVideoId(''), 'rejects an empty string')
ok(!isTellaVideoId('vid_TESTAAAAAAAAAAAA01'), 'rejects upper case')
ok(!isTellaVideoId(`${FAKE_ID}\n`), 'rejects a trailing newline')
ok(!isTellaVideoId(`${FAKE_ID}/../x`), 'rejects a path after the id')
ok(!isTellaVideoId(` ${FAKE_ID}`), 'rejects a leading space')
{
  const nonStrings = [null, undefined, 42, true, {}, [], [FAKE_ID], { toString: () => FAKE_ID }]
  ok(nonStrings.every((v) => !isTellaVideoId(v)), 'rejects non-strings', `${nonStrings.length} values, one an object that prints as an id`)
}

console.log('\n=== tellaEmbedUrl ===')
{
  const url = tellaEmbedUrl(FAKE_ID)
  ok(url === 'https://www.tella.tv/video/vid_testaaaaaaaaaaaa01/embed?title=0&b=0&wt=0&a=0&o=1',
     'the exact address for a sample id', url)
  ok(new URL(url).origin === TELLA_ORIGIN, 'its origin is TELLA_ORIGIN, the one the player listens to', TELLA_ORIGIN)
}
{
  const bad = 'not-an-id-zzzzzzzzzz'
  let thrown = null
  try { tellaEmbedUrl(bad) } catch (e) { thrown = e }
  ok(thrown instanceof Error, 'throws on a malformed id')
  ok(thrown instanceof Error && !thrown.message.includes(bad),
     'the error does not repeat the value it was given', thrown?.message)
  let thrownUrl = null
  try { tellaEmbedUrl(`https://www.tella.tv/video/${FAKE_ID}/embed`) } catch (e) { thrownUrl = e }
  ok(thrownUrl instanceof Error, 'throws on a whole URL passed as an id')
}

console.log('\n=== WATCH_SPEED_CAP: one number in two places ===')
ok(WATCH_SPEED_CAP === 2.5, 'WATCH_SPEED_CAP is 2.5', `got ${WATCH_SPEED_CAP}`)
{
  // The same cap is a constant inside record_lesson_heartbeat. The client
  // counts by it and the server credits by it, so the two must not drift.
  const label = 'the SQL function\'s v_speed_cap is the same number'
  const sqlPath = fileURLToPath(new URL('../supabase/migrations/2026_v100_lesson_videos_and_speed.sql', import.meta.url))
  if (!fs.existsSync(sqlPath)) {
    skip(label, 'supabase/migrations/2026_v100_lesson_videos_and_speed.sql does not exist yet, so the two numbers were NOT compared')
  } else {
    const m = fs.readFileSync(sqlPath, 'utf8').match(/v_speed_cap\s+constant\s+numeric\s*:=\s*([0-9.]+)\s*;/i)
    ok(m !== null && Number(m[1]) === WATCH_SPEED_CAP, label,
       m ? `the v100 file says ${m[1]}` : 'no "v_speed_cap constant numeric := N;" line in the v100 file')
  }
}

// Made-up hosts. `.test` never resolves.
const APP = 'app.example.test'
const PREVIEW = 'preview-branch.example.test'
const EXPECTED = [PREVIEW, APP]
const facts = (o = {}) => ({
  linkScope: 'embedonly',
  allowedEmbedDomains: [PREVIEW, APP],
  downloadsEnabled: false,
  rawDownloadsEnabled: false,
  durationSeconds: 67.262,
  ...o,
})
const S = {
  gone: 'Tella no longer has this video.',
  scope: (s) => `Access is "${s}"; it must be Embed only.`,
  noList: 'No domain list: any site can embed it.',
  extra: (d) => `"${d}" is on its domain list and should not be.`,
  absent: (d) => `"${d}" is missing from its domain list, so it will not play there.`,
  downloads: 'Downloads are switched on.',
  length: (a, b) => `The video is ${a} s long and the catalog says ${b} s, so the 95% rule is measuring the wrong length.`,
}
function verdictIs(v, status, problems, label) {
  ok(v.status === status && same(v.problems, problems), label,
     v.status === status && same(v.problems, problems) ? `${v.status}, ${v.problems.length} problem(s)` : `got ${v.status} ${JSON.stringify(v.problems)}`)
}

console.log('\n=== judgeLock: the clean case ===')
verdictIs(judgeLock(facts(), EXPECTED, 67), 'locked', [],
  'embed only, exactly the expected sites, downloads off, length matches -> locked, nothing to say')

console.log('\n=== judgeLock: one case per rule ===')
verdictIs(judgeLock(null, EXPECTED, 67), 'missing', [S.gone],
  'rule 1: Tella answered 404 -> missing')
verdictIs(judgeLock(facts({ linkScope: 'public' }), EXPECTED, 67), 'open', [S.scope('public')],
  'rule 2: access is not Embed only -> open')
verdictIs(judgeLock(facts({ linkScope: null }), EXPECTED, 67), 'open', [S.scope('unknown')],
  'rule 2: no access level in Tella\'s answer -> open, never locked')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [] }), EXPECTED, 67), 'open', [S.noList],
  'rule 3: no domain list -> open, and no "missing from its list" line beside it')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [PREVIEW, APP, 'someone-else.example.test'] }), EXPECTED, 67), 'open',
  [S.extra('someone-else.example.test')],
  'rule 4: a site on the list that should not be -> open')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [APP] }), EXPECTED, 67), 'locked', [S.absent(PREVIEW)],
  'rule 5: an expected site missing from the list -> still locked, and said')
verdictIs(judgeLock(facts({ downloadsEnabled: true }), EXPECTED, 67), 'open', [S.downloads],
  'rule 6: downloads on -> open')
verdictIs(judgeLock(facts({ rawDownloadsEnabled: true }), EXPECTED, 67), 'open', [S.downloads],
  'rule 6: raw downloads on -> open')
verdictIs(judgeLock(facts({ downloadsEnabled: true, rawDownloadsEnabled: true }), EXPECTED, 67), 'open', [S.downloads],
  'rule 6: both download switches on -> one sentence, not two')
verdictIs(judgeLock(facts(), EXPECTED, 753), 'locked', [S.length(67, 753)],
  'rule 7: the catalog says a different length -> still locked, and said')

console.log('\n=== judgeLock: the length rule\'s edges ===')
verdictIs(judgeLock(facts({ durationSeconds: 69 }), EXPECTED, 67), 'locked', [],
  'a difference of exactly 2 s is not reported')
verdictIs(judgeLock(facts({ durationSeconds: 69.5 }), EXPECTED, 67), 'locked', [S.length(70, 67)],
  'a difference of 2.5 s is reported')
verdictIs(judgeLock(facts({ durationSeconds: 64.4 }), EXPECTED, 67), 'locked', [S.length(64, 67)],
  'a video shorter than the catalog by 2.6 s is reported')
verdictIs(judgeLock(facts(), EXPECTED, null), 'locked', [],
  'no length in the catalog -> nothing to compare, nothing said')
verdictIs(judgeLock(facts({ durationSeconds: null }), EXPECTED, 753), 'locked', [],
  'no length from Tella -> nothing to compare, nothing said')

console.log('\n=== judgeLock: localhost ===')
{
  // Any page on any machine's localhost could embed the lesson, so it is
  // reported like every other unexpected site.
  const v = judgeLock(facts({ allowedEmbedDomains: [PREVIEW, APP, 'localhost'] }), EXPECTED, 67)
  verdictIs(v, 'open', [S.extra('localhost')], 'localhost on the list -> open, one problem')
  ok(v.problems.length === 1 && v.problems[0].includes('localhost'), 'and the problem names localhost', v.problems[0])
  verdictIs(judgeLock(facts({ allowedEmbedDomains: [PREVIEW, APP, 'localhost'] }), [...EXPECTED, 'localhost'], 67), 'locked', [],
    'the same video with localhost expected (the two test videos) -> locked, nothing to say')
}

console.log('\n=== judgeLock: hosts compare without case ===')
verdictIs(judgeLock(facts({ allowedEmbedDomains: ['Preview-Branch.Example.TEST', 'APP.EXAMPLE.TEST'] }), EXPECTED, 67), 'locked', [],
  'upper case on Tella\'s list, lower case expected -> locked')
verdictIs(judgeLock(facts(), ['PREVIEW-BRANCH.example.test', ' App.Example.Test '], 67), 'locked', [],
  'upper case and stray spaces in the expected list -> locked')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [PREVIEW, APP, 'LOCALHOST', 'localhost'] }), EXPECTED, 67), 'open', [S.extra('localhost')],
  'LOCALHOST is still localhost, and a site listed twice is reported once')

console.log('\n=== judgeLock: more than one problem at once ===')
verdictIs(judgeLock(facts({ linkScope: 'public', downloadsEnabled: true }), EXPECTED, 67), 'open',
  [S.scope('public'), S.downloads],
  'public and downloads on -> open, two sentences')
verdictIs(
  judgeLock(facts({ linkScope: 'public', allowedEmbedDomains: [APP, 'localhost'], rawDownloadsEnabled: true }), EXPECTED, 753),
  'open',
  [S.scope('public'), S.extra('localhost'), S.absent(PREVIEW), S.downloads, S.length(67, 753)],
  'five rules at once -> open, five sentences in the rules\' order')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [APP], durationSeconds: 900 }), EXPECTED, 753), 'locked',
  [S.absent(PREVIEW), S.length(900, 753)],
  'the two findings that do not open a video -> locked with two sentences')
verdictIs(judgeLock(facts({ linkScope: 'public', allowedEmbedDomains: [] }), EXPECTED, 67), 'open',
  [S.scope('public'), S.noList],
  'a copy as Tella makes it (public, no list) -> open, two sentences')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}   SKIP ${skipped}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
