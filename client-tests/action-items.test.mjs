// action-items.ts: the rules behind an action item's Discord link and its
// complete button, which the old dashboard's form, the new lesson page, the
// two routes and the development page all use. The module is the real source
// (build.mjs copies it untouched), and so is progress.ts, whose
// isLessonComplete() decides whether the writes below finish a lesson.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DISCORD_LINK_ERROR,
  DISCORD_MESSAGE_LINK_RE,
  LESSON_NOT_SAVABLE_YET,
  actionItemView,
  actionWrite,
  applyActionWrite,
  checkDiscordLink,
  hasActionHalf,
  plainWriteError,
  takesDiscordLink,
  watchHalfIsSeparate,
} from './_gen/action-items.ts'
import { isLessonComplete } from './_gen/progress.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const NOW = '2026-10-14T20:00:00.000Z'
const EARLIER = '2026-10-10T08:00:00.000Z'
const GOOD = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'

console.log('\n=== The link: what is accepted ===')
// The old route's pattern and message, typed here from the route as it was
// before this change (save-action-link/route.ts at d107ab2), so a change to
// either fails by name.
const OLD_RE = /^https:\/\/discord\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+\/?$/
const OLD_ERROR = "That doesn't look like a Discord message link. Right-click the message in #ad-review and click \"Copy Message Link.\""
ok(DISCORD_MESSAGE_LINK_RE.source === OLD_RE.source && DISCORD_MESSAGE_LINK_RE.flags === OLD_RE.flags, "the pattern is the old route's, character for character", DISCORD_MESSAGE_LINK_RE.source)
ok(DISCORD_LINK_ERROR === OLD_ERROR, "the message for a wrong link is the old route's, word for word", DISCORD_LINK_ERROR)
{
  // The database's CHECK constraint (v28): the same pattern, in Postgres's spelling.
  const sql = read('../supabase/migrations/2026_v28_discord_message_link.sql')
  const m = /discord_message_link ~ '([^']+)'/.exec(sql)
  const db = m ? m[1] : null
  ok(db !== null && db === DISCORD_MESSAGE_LINK_RE.source.replace(/\\\//g, '/'), 'the pattern is the database CHECK constraint\'s (migration v28)', db)
}
for (const [label, raw, want] of [
  ['a message link: server, channel, message', GOOD, GOOD],
  ['with a slash at the end', `${GOOD}/`, `${GOOD}/`],
  ['a message inside a thread (the thread id where the channel id goes)', 'https://discord.com/channels/1/987654321/123', 'https://discord.com/channels/1/987654321/123'],
  ['spaces and a line break around it are dropped', `  ${GOOD}\n`, GOOD],
]) {
  const c = checkDiscordLink(raw)
  ok(c.ok && c.link === want, `accepted: ${label}`, show(c))
}
for (const [label, raw] of [
  ['nothing', ''],
  ['spaces only', '   '],
  ['null', null],
  ['undefined', undefined],
  ['a value that is not a string', 42],
]) {
  const c = checkDiscordLink(raw)
  ok(c.ok && c.link === null, `${label} means "clear the link" (null), as the old route read it`, show(c))
}

console.log('\n=== The link: what is refused, and what it says ===')
for (const [label, raw] of [
  ["a thread's own link (two ids)", 'https://discord.com/channels/1100000000000000001/1200000000000000002'],
  ['a channel link (one id)', 'https://discord.com/channels/1100000000000000001'],
  ['four ids', `${GOOD}/4`],
  ['http, not https', GOOD.replace('https:', 'http:')],
  ['discordapp.com', GOOD.replace('discord.com', 'discordapp.com')],
  ['ptb.discord.com', GOOD.replace('discord.com', 'ptb.discord.com')],
  ['a direct message link (@me)', 'https://discord.com/channels/@me/1200000000000000002/1300000000000000003'],
  ['letters in an id', 'https://discord.com/channels/abc/1200000000000000002/1300000000000000003'],
  ['a query string', `${GOOD}?x=1`],
  ['an invite link', 'https://discord.gg/abcdef'],
  ['no scheme', GOOD.replace('https://', '')],
  ['two links pasted together', `${GOOD} ${GOOD}`],
  ['a link inside a sentence', `here: ${GOOD}`],
  ['a script', 'javascript:alert(1)'],
]) {
  const c = checkDiscordLink(raw)
  ok(!c.ok && c.error === OLD_ERROR, `refused with the old message: ${label}`, show(c.ok ? c : { ok: false }))
}

console.log('\n=== Which lessons ===')
const SETUP = { type: 'setup', requires_action: true }
const WATCH = { type: 'watch', requires_action: true }
const PLAIN = { type: 'watch', requires_action: false }
const OLD_ACTION = { type: 'action', requires_action: false }
ok(takesDiscordLink(SETUP) && takesDiscordLink(WATCH) && takesDiscordLink(OLD_ACTION), 'a link goes on any action item, and on the old type "action" (save-action-link as it was)')
ok(!takesDiscordLink(PLAIN) && !takesDiscordLink(null) && !takesDiscordLink(undefined), 'not on a plain lesson, nor on a lesson that was not found')
ok(hasActionHalf(SETUP) && hasActionHalf(WATCH) && !hasActionHalf(OLD_ACTION) && !hasActionHalf(PLAIN) && !hasActionHalf(null), 'an action half only where requires_action is true (mark-action-shipped as it was)')
ok(watchHalfIsSeparate(WATCH, true) && !watchHalfIsSeparate(SETUP, true), "new course: a video lesson's other half comes from watching, a setup lesson has none")
ok(watchHalfIsSeparate(WATCH, false) && watchHalfIsSeparate(SETUP, false) && watchHalfIsSeparate(OLD_ACTION, false), 'old catalog (the live app): always separate, so the route writes what it wrote before')

console.log('\n=== The writes: an action item with a video ===')
const W = (shipped, existing) => actionWrite({ separateWatchHalf: true, shipped, existing, now: NOW })
const row = (completed_at, action_completed_at) => ({ completed_at, action_completed_at })
ok(same(W(true, null), { kind: 'insert', fields: { completed_at: null, action_completed_at: NOW } }), 'no row, complete: a new row with the action half only', show(W(true, null)))
ok(same(W(false, null), { kind: 'none' }), 'no row, undo: nothing to do')
ok(same(W(true, row(EARLIER, null)), { kind: 'update', fields: { action_completed_at: NOW } }), 'video watched, complete: the action half is set, the video half left alone')
ok(same(W(true, row(null, null)), { kind: 'update', fields: { action_completed_at: NOW } }), 'a row holding only a link, complete: the action half is set')
ok(same(W(false, row(EARLIER, EARLIER)), { kind: 'update', fields: { action_completed_at: null } }), 'both halves, undo: the action half is cleared, the video half kept')
ok(same(W(false, row(null, EARLIER)), { kind: 'delete' }), 'action half only, undo: the row is dropped, as the route always did')

console.log('\n=== The writes: an action item with no video (a setup lesson) ===')
const S = (shipped, existing) => actionWrite({ separateWatchHalf: false, shipped, existing, now: NOW })
ok(same(S(true, null), { kind: 'insert', fields: { completed_at: NOW, action_completed_at: NOW } }), 'no row, complete: a new row with BOTH halves', show(S(true, null)))
ok(same(S(true, row(null, null)), { kind: 'update', fields: { completed_at: NOW, action_completed_at: NOW } }), 'the row the saved link made, complete: both halves are set')
ok(same(S(true, row(EARLIER, null)), { kind: 'update', fields: { completed_at: EARLIER, action_completed_at: NOW } }), 'an earlier completed_at is kept')
ok(same(S(false, row(EARLIER, EARLIER)), { kind: 'update', fields: { completed_at: null, action_completed_at: null } }), 'undo: both halves cleared and the row kept, so its link stays')
ok(same(S(false, null), { kind: 'none' }), 'no row, undo: nothing to do')

console.log('\n=== The writes against isLessonComplete (progress.ts) ===')
const done = (halves, lesson) => !!halves && isLessonComplete({ lesson_id: 'x', skipped_at: null, ...halves }, { id: 'x', ...lesson })
{
  const after = applyActionWrite(row(null, null), S(true, row(null, null)))
  ok(done(after, SETUP), 'a setup lesson: its link saved, then the button, and the lesson is complete', show(after))
}
ok(done(applyActionWrite(null, S(true, null)), SETUP), 'a setup lesson with no row: the button alone completes it')
{
  const after = applyActionWrite(row(null, null), W(true, row(null, null)))
  ok(!done(after, WATCH), 'a video action item: the button before the video is watched does not complete it', show(after))
  const watched = { ...after, completed_at: NOW }
  ok(done(watched, WATCH), '… and the video watched afterwards does', show(watched))
}
ok(done(applyActionWrite(row(EARLIER, null), W(true, row(EARLIER, null))), WATCH), 'a video action item already watched: the button completes it')
ok(!done(row(EARLIER, null), WATCH), 'a video action item watched and not completed is not complete (the old rule: both halves)')
{
  const undone = applyActionWrite(row(EARLIER, EARLIER), S(false, row(EARLIER, EARLIER)))
  ok(!done(undone, SETUP) && undone !== null, 'a setup lesson undone is not complete, and its row is still there', show(undone))
}
ok(applyActionWrite(row(null, EARLIER), W(false, row(null, EARLIER))) === null, 'applying a delete leaves no row')
ok(same(applyActionWrite(null, { kind: 'none' }), null) && same(applyActionWrite(row(EARLIER, null), { kind: 'none' }), row(EARLIER, null)), 'applying "none" changes nothing')

console.log('\n=== A failed write ===')
ok(plainWriteError({ code: '23503', message: 'insert or update on table "student_lesson_completions" violates foreign key constraint' }) === LESSON_NOT_SAVABLE_YET,
   'a foreign key violation (a new-course lesson before the cutover) gets plain words', LESSON_NOT_SAVABLE_YET)
ok(plainWriteError({ code: '23505' }) === null && plainWriteError({ code: '23514' }) === null && plainWriteError(null) === null && plainWriteError({}) === null,
   'any other failure is left to the route, which answers it as before')
ok(!/^[{\[]|violates|constraint|23503/i.test(LESSON_NOT_SAVABLE_YET) && /nothing was recorded/i.test(LESSON_NOT_SAVABLE_YET), 'the plain words say nothing was recorded, and carry no database text')

console.log('\n=== The lesson page block: its states ===')
{
  const v = actionItemView(null, false)
  ok(v.state === 'empty' && !v.canComplete && v.link === null && v.completedAt === null && !v.waitingOnVideo, 'no row: empty, and nothing to complete', show(v))
}
{
  const v = actionItemView({ ...row(null, null), discord_message_link: '' }, false)
  ok(v.state === 'empty' && !v.canComplete && v.link === null, 'an empty link is no link', show(v))
}
{
  const v = actionItemView({ ...row(EARLIER, null), discord_message_link: null }, true)
  ok(v.state === 'empty' && !v.canComplete, 'video watched, no link: still empty, and no complete button (the old app: the link first)', show(v))
}
{
  const v = actionItemView({ ...row(null, null), discord_message_link: GOOD }, false)
  ok(v.state === 'saved' && v.canComplete && v.link === GOOD, 'a link saved: saved, and the button can be pressed', show(v))
}
{
  const v = actionItemView({ ...row(null, null), discord_message_link: GOOD }, true)
  ok(v.state === 'saved' && v.canComplete, 'on a video lesson too, before the video is watched (the old app: canShip = shipped or a saved link)', show(v))
}
{
  const v = actionItemView({ ...row(NOW, NOW), discord_message_link: GOOD }, false)
  ok(v.state === 'completed' && !v.canComplete && v.completedAt === NOW && v.link === GOOD && !v.waitingOnVideo, 'a setup lesson completed: completed, with its date and its link', show(v))
}
{
  const v = actionItemView({ ...row(null, NOW), discord_message_link: GOOD }, true)
  ok(v.state === 'completed' && v.waitingOnVideo, 'a video lesson with the action done and the video not watched: completed, waiting on the video', show(v))
}
{
  const v = actionItemView({ ...row(EARLIER, NOW), discord_message_link: GOOD }, true)
  ok(v.state === 'completed' && !v.waitingOnVideo, '… and once the video is watched, not waiting', show(v))
}
{
  const v = actionItemView({ ...row(NOW, NOW), discord_message_link: null }, false)
  ok(v.state === 'completed' && v.link === null && !v.canComplete, 'completed with no link (an older row): completed, the link can still be added', show(v))
}

console.log('\n=== Who uses it: one rule, not copies ===')
const SOURCES = {
  'the old dashboard (LessonSheet.tsx)': '../src/components/map/LessonSheet.tsx',
  'the save-action-link route': '../src/app/api/student/save-action-link/route.ts',
  'the mark-action-shipped route': '../src/app/api/student/mark-action-shipped/route.ts',
  'the new lesson page (ActionItemBlock.tsx)': '../src/components/world/ActionItemBlock.tsx',
  "the development page's pretend student (fixtureActionItems.ts)": '../src/app/dev/world-app/fixtureActionItems.ts',
}
const src = Object.fromEntries(Object.entries(SOURCES).map(([k, p]) => [k, read(p)]))
const importsFrom = (s, names) => {
  const m = /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/world\/action-items"/.exec(s)
  const got = m ? m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '')) : []
  return names.every((n) => got.includes(n))
}
const ownPattern = (s) => /discord\\\.com\\\/channels|DISCORD_LINK_RE\s*=/.test(s)
ok(importsFrom(src['the old dashboard (LessonSheet.tsx)'], ['checkDiscordLink']) && /checkDiscordLink\(draft\)/.test(src['the old dashboard (LessonSheet.tsx)']),
   "the old dashboard's form imports checkDiscordLink from @/lib/world/action-items and checks the draft with it")
ok(importsFrom(src['the save-action-link route'], ['checkDiscordLink', 'plainWriteError', 'takesDiscordLink']) && /checkDiscordLink\(body\?\.link\)/.test(src['the save-action-link route']),
   'the save-action-link route checks the posted link with it')
ok(importsFrom(src['the mark-action-shipped route'], ['actionWrite', 'hasActionHalf', 'plainWriteError', 'watchHalfIsSeparate']), 'the mark-action-shipped route takes its write from actionWrite')
ok(importsFrom(src['the new lesson page (ActionItemBlock.tsx)'], ['actionItemView', 'checkDiscordLink']), 'the new lesson page uses checkDiscordLink and actionItemView')
ok(importsFrom(src["the development page's pretend student (fixtureActionItems.ts)"], ['actionWrite', 'applyActionWrite', 'checkDiscordLink', 'watchHalfIsSeparate']), "the development page's pretend student uses the same rules")
for (const [who, s] of Object.entries(src)) ok(!ownPattern(s), `${who} holds no Discord pattern of its own`)
for (const who of ['the save-action-link route', 'the mark-action-shipped route']) {
  const s = src[who]
  ok(/\.from\(LESSONS_TABLE\)/.test(s) && !/\.from\("lessons"\)/.test(s) && /import \{[^}]*LESSONS_TABLE[^}]*\} from "@\/lib\/catalog-tables"/.test(s),
     `${who} reads the lesson from the active catalog (LESSONS_TABLE), never from "lessons" by name`)
}
{
  const s = src['the mark-action-shipped route']
  ok(/watchHalfIsSeparate\(lesson, CATALOG_IS_V2\)/.test(s), 'mark-action-shipped asks for both halves only on the new course\'s catalog (CATALOG_IS_V2)')
  // Every write in the route answers its own error: a failed delete was once a success.
  const writes = (s.match(/\.(insert|update|delete)\(/g) ?? []).length
  const checked = (s.match(/if \(error\) \{/g) ?? []).length
  ok(writes === 3 && checked === 3, 'mark-action-shipped: each of its 3 writes (insert, update, delete) answers its error', `${writes} writes, ${checked} error checks`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
