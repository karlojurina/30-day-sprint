import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TELLA_ORIGIN, WATCH_SPEED_CAP, isTellaVideoId, tellaEmbedUrl } from './_gen/tella.ts'
import { judgeLock, watchLessonSeconds } from './_gen/tella-lock.ts'

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
  noLength: 'The catalog has no length for this lesson, so it can never be counted.',
  noLesson: 'No watch lesson has this id.',
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
// Was "nothing to compare, nothing said" until 2026-10-12. A lesson with no
// length in the catalog can never reach 95% of it, so it is now reported.
verdictIs(judgeLock(facts(), EXPECTED, null), 'locked', [S.noLength],
  'no length in the catalog -> still locked, and said: it can never be counted')
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

console.log('\n=== judgeLock: the catalog rules (a lesson that can never be finished) ===')
// The fourth argument is what the catalog says about the row's lesson id:
// 'watch' (the default), 'none' or 'unread'.
verdictIs(judgeLock(facts(), EXPECTED, 67, 'watch'), 'locked', [],
  'a watch lesson with a matching length, said out loud -> the same as the default')
verdictIs(judgeLock(facts(), EXPECTED, 0), 'locked', [S.noLength],
  'a length of 0 is no length')
verdictIs(judgeLock(facts(), EXPECTED, NaN), 'locked', [S.noLength],
  'a length that is not a number is no length')
verdictIs(judgeLock(facts({ durationSeconds: null }), EXPECTED, null), 'locked', [S.noLength],
  'no length on either side -> the catalog\'s is the one reported')
verdictIs(judgeLock(facts(), EXPECTED, null, 'none'), 'locked', [S.noLesson],
  'no watch lesson has this id -> still locked, and said')
verdictIs(judgeLock(facts(), EXPECTED, 753, 'none'), 'locked', [S.noLesson],
  'no watch lesson has this id -> the length is not looked at, one sentence')
verdictIs(judgeLock(facts(), EXPECTED, null, 'unread'), 'locked', [],
  'the catalog could not be read -> nothing is said about it')
verdictIs(judgeLock(facts(), EXPECTED, 753, 'unread'), 'locked', [],
  'the catalog could not be read -> a length passed anyway is not compared')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [PREVIEW, APP, 'localhost'] }), EXPECTED, null, 'unread'), 'open', [S.extra('localhost')],
  'the catalog could not be read -> the lock rules still run')
verdictIs(judgeLock(facts({ linkScope: 'public', downloadsEnabled: true }), EXPECTED, null), 'open',
  [S.scope('public'), S.downloads, S.noLength],
  'an open video with no catalog length -> open, the catalog sentence last')
verdictIs(judgeLock(facts({ allowedEmbedDomains: [APP] }), EXPECTED, null, 'none'), 'locked',
  [S.absent(PREVIEW), S.noLesson],
  'a missing site and an unknown lesson -> locked with two sentences')
verdictIs(judgeLock(null, EXPECTED, null), 'missing', [S.gone, S.noLength],
  'Tella has no video AND the catalog has no length -> missing, both said')
verdictIs(judgeLock(null, EXPECTED, 67, 'none'), 'missing', [S.gone, S.noLesson],
  'Tella has no video AND no watch lesson has the id -> missing, both said')
verdictIs(judgeLock(null, EXPECTED, 753), 'missing', [S.gone],
  'Tella has no video -> there is no length to compare, one sentence')

console.log('\n=== watchLessonSeconds: which ids have a watch lesson, and how long ===')
{
  // Made-up catalog rows, the three columns the lock check reads.
  const staging = [
    { id: 'a1l01', type: 'watch', duration_seconds: 300 },
    { id: 'a1l02', type: 'watch', duration_seconds: null },
    { id: 'a1l03', type: 'setup', duration_seconds: 120 },
    { id: 'shared', type: 'watch', duration_seconds: 400 },
    { id: 'shared-null', type: 'watch', duration_seconds: 400 },
    { id: 'staging-watch', type: 'watch', duration_seconds: 90 },
  ]
  const live = [
    { id: 'l041', type: 'watch', duration_seconds: '753' },
    { id: 'l042', type: 'action', duration_seconds: null },
    { id: 'l043', type: 'watch', duration_seconds: 0 },
    { id: 'shared', type: 'watch', duration_seconds: 500 },
    { id: 'shared-null', type: 'watch', duration_seconds: null },
    { id: 'staging-watch', type: 'setup', duration_seconds: 10 },
  ]
  const m = watchLessonSeconds([staging, live])
  ok(m.get('a1l01') === 300, 'a watch lesson has its length', `a1l01 -> ${m.get('a1l01')}`)
  ok(m.has('a1l02') && m.get('a1l02') === null, 'a watch lesson with no length is there, holding null')
  ok(!m.has('a1l03'), 'a setup lesson is not a watch lesson, whatever length it carries')
  ok(!m.has('l042'), 'an action lesson is not a watch lesson')
  ok(!m.has('nowhere'), 'an id in neither table has no entry')
  ok(m.get('l041') === 753, 'a length that arrives as a string is read as a number', `l041 -> ${m.get('l041')}`)
  ok(m.has('l043') && m.get('l043') === null, 'a length of 0 is no length')
  ok(m.get('shared') === 500, 'an id in both tables takes the later table\'s length (the live one)', `shared -> ${m.get('shared')}`)
  ok(m.has('shared-null') && m.get('shared-null') === null, 'and takes its missing length too: live is what 95% is measured against')
  ok(m.get('staging-watch') === 90, 'a watch lesson in one table stays one when the other table has the id as something else', `staging-watch -> ${m.get('staging-watch')}`)
  ok(watchLessonSeconds([]).size === 0 && watchLessonSeconds([[], []]).size === 0, 'no tables or empty tables -> an empty map')

  // The whole path the lock check takes for one row: look the id up, then judge.
  const judgeRow = (lessonId) => judgeLock(facts(), EXPECTED, m.get(lessonId) ?? null, m.has(lessonId) ? 'watch' : 'none')
  verdictIs(judgeRow('nowhere'), 'locked', [S.noLesson],
    'a video row whose lesson id is in neither catalog table -> reported')
  verdictIs(judgeRow('l042'), 'locked', [S.noLesson],
    'a video row on a lesson that exists but is not a watch lesson -> reported with the same sentence')
  verdictIs(judgeRow('a1l02'), 'locked', [S.noLength],
    'a video row on a watch lesson with no length -> reported, with the other sentence')
  verdictIs(judgeRow('a1l01'), 'locked', [S.length(67, 300)],
    'a video row on a watch lesson with the wrong length -> the length rule as before')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}   SKIP ${skipped}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
