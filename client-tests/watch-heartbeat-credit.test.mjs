// What the server CREDITS, not what the heartbeat sends (2026-10-20, the night
// bug hunt: lessons-1).
//
// v100's record_lesson_heartbeat credits a beat at most 60 s of video (20 s on
// a lesson's first stored beat) and at most 2.5 times the clock since the beat
// it stored before. The heartbeat banked everything played while beats failed,
// sent it all in the next beat that got through, and dropped all of it from
// the bank once that beat was accepted, credited or not. So a student who kept
// watching through a minute or two of failed beats was refused at the end:
// "You've watched 79% of this lesson and it needs 80%. Skipped parts don't
// count." watch-heartbeat.test.mjs (section 21) adds up what was SENT, which is
// why it passed.
//
// The stand-in below is v100's arithmetic, steps 3 to 7 of
// supabase/migrations/2026_v100_lesson_videos_and_speed.sql, on one row; the
// verdict is the real judgeWatch (watch-rules.ts, 95% reached and 80% played).
// The heartbeat is the real module (build.mjs copies it), with this file's
// clock and timers, as in watch-heartbeat.test.mjs.
import { createWatchHeartbeat } from './_gen/watch-heartbeat.ts'
import { judgeWatch } from './_gen/watch-rules.ts'

// ── the clock and the timers ─────────────────────────────────────────
const realNow = Date.now
let clock = 7_000_000
Date.now = () => clock
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const timers = []
let timerIds = 0
globalThis.setTimeout = (fn, ms = 0) => { const id = ++timerIds; timers.push({ id, at: clock + ms, fn }); return id }
globalThis.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
const advance = (ms) => {
  const end = clock + ms
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
    if (!due) break
    timers.splice(timers.indexOf(due), 1)
    clock = Math.max(clock, due.at)
    due.fn()
  }
  clock = end
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)) }

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? `: ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}
const pct = (x) => `${(x * 100).toFixed(1)}%`

/** record_lesson_heartbeat as v100 runs it, on one (student, lesson) row. `down(ms)` fails the call. */
function v100(duration, down = () => false) {
  const row = { has: false, max: 0, watched: 0, last: 0, thresh: false }
  const sent = []
  const rpc = async (a) => {
    sent.push({ ...a, at: clock, failed: down(clock) })
    if (down(clock)) return { data: null, error: { message: 'Failed to fetch' } }
    const now = clock / 1000
    const pos = Math.min(Math.max(0, a.p_position_seconds), duration)
    let elapsed = null
    let delta
    let newMax
    if (row.has) {
      elapsed = now - row.last
      delta = Math.max(0, Math.min(a.p_delta_seconds, elapsed * 2.5, 60))
      newMax = Math.max(row.max, pos)
    } else {
      delta = Math.max(0, Math.min(a.p_delta_seconds, 20))
      newMax = pos
    }
    const had = row.thresh
    const crosses = !had && newMax >= 0.95 * duration
    if (row.has && elapsed < 5 && !a.p_force && !crosses) {
      return { data: { accepted: false, reason: 'rate_limited', max_position_seconds: row.max, watched_seconds: row.watched, threshold_met: had, threshold_crossed: false }, error: null }
    }
    Object.assign(row, { has: true, max: newMax, watched: row.watched + delta, last: now, thresh: had || crosses })
    return {
      data: { accepted: true, max_position_seconds: row.max, last_position_seconds: pos, watched_seconds: row.watched, duration_seconds: duration, threshold_met: row.thresh, threshold_crossed: row.thresh && !had },
      error: null,
    }
  }
  return { row, rpc, sent }
}
const verdictOf = (row, duration) =>
  judgeWatch({ max_position_seconds: row.max, watched_seconds: row.watched, threshold_met_at: row.thresh ? '2026-10-20T00:00:00Z' : null, reported_duration_seconds: duration }, duration)

/**
 * A whole lesson watched without skipping at `speed`, a report every 250 ms,
 * with the heartbeat's calls failing from `outage[0]` to `outage[1]` seconds of
 * clock after play was pressed. The video ends, its end beat goes, and the
 * retries a failed or held-back end beat gets (2, 5 and 10 s on) are let run.
 */
async function watch({ duration, speed = 1, outage = null }) {
  advance(1000)   // past the module's 400 ms gate
  const start = clock
  const down = outage ? (c) => c - start >= outage[0] * 1000 && c - start < outage[1] * 1000 : () => false
  const server = v100(duration, down)
  const beat = createWatchHeartbeat({ lessonId: 'a3l17', durationSeconds: duration, rpc: server.rpc, now: () => clock })
  let t = 0
  beat.tick(t, duration)
  await settle()
  let i = 0
  while (t < duration) {
    advance(250)
    t = Math.min(duration, t + 0.25 * speed)
    beat.tick(t, duration)
    if (++i % 4 === 0) await new Promise((r) => setImmediate(r))
  }
  await settle()
  beat.flush('ended')
  await settle()
  advance(20_000)
  await settle()
  return { server, beat, played: t, verdict: verdictOf(server.row, duration) }
}

console.log('\n=== Watched through failed beats at 1x: it counts (lessons-1) ===')
for (const [duration, outage, what] of [
  [370, [61, 181], 'Your First Boss Battle (370 s), beats failing for 2 minutes from 61 s'],
  [756, [120, 330], 'the median lesson (756 s), beats failing for 3.5 minutes'],
]) {
  const { server, beat, played, verdict } = await watch({ duration, outage })
  ok(verdict.complete && verdict.playedRatio >= 0.8, `${what}: complete`, `${pct(verdict.playedRatio)} credited, ${verdict.reason}`)
  ok(server.row.watched <= played + 1e-6, '  and never more than was played', `${server.row.watched.toFixed(2)} of ${played.toFixed(2)} s`)
  const before = server.sent.findIndex((a) => !a.failed)
  ok(server.sent.every((a) => a.p_delta_seconds <= 60) && server.sent.slice(0, before + 1).every((a) => a.p_delta_seconds <= 20),
     '  no beat carries more than v100 credits one (60 s; 20 s until one is accepted)', `largest ${Math.max(...server.sent.map((a) => a.p_delta_seconds)).toFixed(2)} s`)
  beat.destroy()
}

console.log('\n=== At 2x a minute of failed beats is made up too ===')
{
  const { beat, verdict } = await watch({ duration: 600, speed: 2, outage: [60, 120] })
  ok(verdict.complete, '600 s at 2x, beats failing for a minute: complete', `${pct(verdict.playedRatio)} credited, ${verdict.reason}`)
  beat.destroy()
}

console.log('\n=== A healthy watch is credited in full, and no more ===')
for (const speed of [1, 1.5, 2, 2.5]) {
  const { server, beat, played, verdict } = await watch({ duration: 370, speed })
  ok(verdict.complete && Math.abs(server.row.watched - played) < 1e-6, `${speed}x with no failure: every second played is credited once`,
     `${server.row.watched.toFixed(3)} of ${played.toFixed(3)} s`)
  beat.destroy()
}

console.log('\n=== What the server could not credit yet is kept, and a later beat delivers it ===')
{
  // A 38 s lesson at 2.5x whose first beat fails: the first beat that gets
  // through may bank only 20 s, and the end comes 15 s of clock after play.
  const { server, beat, played } = await watch({ duration: 38, speed: 2.5, outage: [0, 1] })
  const atEnd = server.row.watched
  // The student reads the page for 10 s and closes the lesson.
  advance(10_000)
  beat.flush('unmount')
  await settle()
  const verdict = verdictOf(server.row, 38)
  ok(server.row.watched > atEnd && verdict.complete, 'the beat when the lesson is closed carries the rest: complete',
     `${pct(atEnd / 38)} at the end, ${pct(server.row.watched / 38)} after the close, of ${played.toFixed(1)} s played`)
  ok(server.row.watched <= played + 1e-6, '  and never more than was played', `${server.row.watched.toFixed(2)} of ${played.toFixed(2)} s`)
  beat.destroy()
}
{
  // At 2.5x the server's clock rule leaves nothing to make up a backlog with
  // while the video plays: that needs a change on the server (Lovro's call).
  // What the client can do is keep it for a later beat.
  const { server, beat, played } = await watch({ duration: 370, speed: 2.5, outage: [30, 75] })
  const atEnd = server.row.watched
  advance(30_000)
  beat.flush('visibilitychange')
  await settle()
  ok(server.row.watched > atEnd + 30 && server.row.watched <= played + 1e-6,
     '370 s at 2.5x with 45 s of failed beats: what was kept is delivered when the tab is hidden 30 s after the end',
     `${pct(atEnd / 370)} at the end (the server's limit), ${pct(server.row.watched / 370)} after`)
  beat.destroy()
}

console.log('\n=== An answer without a total is read as before ===')
{
  advance(1000)
  const sent = []
  const beat = createWatchHeartbeat({
    lessonId: 'a3l17', durationSeconds: 370, now: () => clock,
    rpc: async (a) => { sent.push(a); return { data: { accepted: true, max_position_seconds: a.p_position_seconds, threshold_met: false, threshold_crossed: false }, error: null } },
  })
  let t = 0
  beat.tick(t, 370)
  await settle()
  for (let i = 0; i < 4 * 31; i++) { advance(250); t += 0.25; beat.tick(t, 370); if (i % 4 === 3) await new Promise((r) => setImmediate(r)) }
  await settle()
  const deltas = sent.map((a) => a.p_delta_seconds)
  ok(deltas.length === 3 && deltas.every((d) => Number.isFinite(d)) && deltas[2] > 14 && deltas[2] < 17,
     'each beat still carries what was played since the last one (the whole beat counts, nothing is held back forever)', JSON.stringify(deltas.map((d) => +d.toFixed(2))))
  beat.destroy()
}

Date.now = realNow
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
