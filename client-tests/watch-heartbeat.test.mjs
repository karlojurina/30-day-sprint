import { createWatchHeartbeat, clientsCreated } from './_gen/watch-heartbeat.ts'
import { calls, reset, setResponder } from './_gen/stub-supabase.ts'

// ── controllable clock ───────────────────────────────────────────────
const realNow = Date.now
let clock = 1_000_000
Date.now = () => clock
// ── and controllable timers ──────────────────────────────────────────
// The module sets its retry timer with the global setTimeout. That global is
// swapped here for a queue this file's clock drives, the same way Date.now is
// swapped above, so "2 s later" is a line of test and not 2 s of waiting.
// (The file's own waiting uses setImmediate, which is left alone.)
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const timers = []
let timerIds = 0
globalThis.setTimeout = (fn, ms = 0) => { const id = ++timerIds; timers.push({ id, at: clock + ms, fn }); return id }
globalThis.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) }
// Moves the clock, firing every timer that comes due on the way, in order, each at its own moment.
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
// generous enough to let a queued retry land too
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)) }

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const accepted = (extra = {}) => (args) => ({
  accepted: true,
  max_position_seconds: args.p_position_seconds,
  last_position_seconds: args.p_position_seconds,
  watched_seconds: 0,
  threshold_met: false,
  threshold_crossed: false,
  ...extra,
})

// Real playback: the player ticks ~3.7x/second, and the event loop runs
// between ticks — so an in-flight request actually gets to resolve.
async function playFor(beat, seconds, startAt = 0) {
  const step = 1 / 3.7
  let t = startAt
  const end = startAt + seconds
  let i = 0
  while (t < end) {
    t += step
    advance(Math.round(step * 1000))
    beat.tick(t, 753)
    if (++i % 4 === 0) await new Promise((r) => setImmediate(r))
  }
  await new Promise((r) => setImmediate(r))
  return t
}

console.log('\n=== 1. throttling: 15s of real playback = exactly one write ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  await playFor(beat, 0.5, 0)
  await settle()
  ok(calls.length === 1, 'the first tick writes at once (stamps first_played_at)', `${calls.length} calls`)
  ok(calls[0].args.p_delta_seconds === 0, 'and carries a zero delta')
  await playFor(beat, 13, 0.5)
  await settle()
  ok(calls.length === 1, 'then nothing until the 15s throttle elapses', `${calls.length} calls`)
  await playFor(beat, 3, 13.5)
  await settle()
  ok(calls.length === 2, 'exactly one more write once it does', `${calls.length} calls`)
  const d = calls[1].args.p_delta_seconds
  ok(d > 14 && d < 17, 'delta is the real seconds played, not the event count', `delta=${d.toFixed(2)}`)
  ok(calls[1].args.p_force === false, 'a throttled beat is not forced')
  beat.destroy()
}

console.log('\n=== 2. a full 12-minute lesson stays around 50 writes ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  let t = 0
  for (let i = 0; i < 50; i++) { t = await playFor(beat, 15.5, t); await settle() }
  ok(calls.length >= 45 && calls.length <= 56,
     '~50 writes for a full lesson (vs ~2,800 raw events)', `${calls.length} writes`)
  beat.destroy()
}

console.log('\n=== 3. scrubbing cannot buy watch time ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  await playFor(beat, 5, 0)
  // Student drags the scrub bar from ~5s to 700s.
  beat.noteSeek(700)
  await playFor(beat, 12, 700)
  await settle()
  const last = calls[calls.length - 1]
  const d = last.args.p_delta_seconds
  ok(d > 15 && d < 18, 'delta counts only the ~17s actually played, not the 695s jumped',
     `delta=${d.toFixed(2)} (a naive diff would be ~712)`)
  ok(last.args.p_position_seconds > 700, 'position still reflects where they are',
     `pos=${last.args.p_position_seconds.toFixed(1)}`)
  beat.destroy()
}

console.log('\n=== 4. a throttled/backgrounded tab is not counted as watching ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  beat.tick(10, 753)
  await settle()
  advance(20_000)
  // One tick arrives 20s later having advanced 20s: a browser that throttled
  // rAF, not 20s of someone watching. The gap is capped at 2s, so the rule
  // allows 2 * 2.5 + 0.35 = 5.35s and a 20s step must not count.
  beat.tick(30, 753)
  await settle()
  ok(calls.length === 2, 'the beat still fires (position must be recorded)', `${calls.length}`)
  ok(calls[1].args.p_delta_seconds === 0,
     'but the 20s gap contributes ZERO watch time', `delta=${calls[1].args.p_delta_seconds}`)
  beat.destroy()
}

console.log('\n=== 5. forced writes: exits are exact ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  await playFor(beat, 4, 0)
  await settle()
  ok(calls.length === 1, 'only the first-tick beat so far (well inside the throttle)', `${calls.length}`)
  advance(500)
  beat.flush('pause')
  await settle()
  ok(calls.length === 2, 'pause forces an immediate write', `${calls.length}`)
  ok(calls[1].args.p_force === true, 'and marks it forced, so the server bypasses its 5s limiter')
  beat.destroy()
}

console.log('\n=== 6. pause + visibilitychange + pagehide do not write three times ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  await playFor(beat, 4, 0)
  advance(500); beat.flush('pause'); await settle()
  advance(10);  beat.flush('visibilitychange'); await settle()
  advance(10);  beat.flush('pagehide'); await settle()
  ok(calls.length === 2, 'first-tick beat + pause; the other two have nothing new to say',
     `${calls.length} writes`)
  beat.destroy()
}

console.log('\n=== 7. a REFUSED beat never loses the watch time ===')
reset()
{
  // Server rate-limits the first beat, accepts the second.
  // Refuse beat 2 — the first one carrying real watch time.
  setResponder((args, n) => n === 2
    ? { accepted: false, reason: 'rate_limited', max_position_seconds: 0, watched_seconds: 0,
        threshold_met: false, threshold_crossed: false }
    : accepted()(args))
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  await playFor(beat, 16, 0)
  await settle()
  ok(calls.length === 2, 'first-tick beat + one throttled beat', `${calls.length}`)
  const first = calls[1].args.p_delta_seconds
  await playFor(beat, 16, 16)
  await settle()
  ok(calls.length === 3, 'a third beat follows', `${calls.length}`)
  const second = calls[2].args.p_delta_seconds
  ok(second > first + 14,
     'the refused delta is carried into the next beat, not discarded',
     `first=${first.toFixed(2)} second=${second.toFixed(2)}`)
  beat.destroy()
}

console.log('\n=== 8. threshold_crossed fires the callback exactly once ===')
reset()
{
  let fired = 0
  setResponder((args, n) => ({
    accepted: true,
    max_position_seconds: args.p_position_seconds,
    last_position_seconds: args.p_position_seconds,
    watched_seconds: 700,
    threshold_met: n >= 3,
    threshold_crossed: n === 3,   // server says: this beat crossed it
  }))
  const beat = createWatchHeartbeat({
    lessonId: 'l001', durationSeconds: 753,
    onThresholdCrossed: () => { fired++ },
  })
  let t = 0
  for (let i = 0; i < 4; i++) { t = await playFor(beat, 16, t); await settle() }
  ok(calls.length === 5, 'first-tick beat + four throttled beats', `${calls.length}`)
  ok(fired === 1, 'onThresholdCrossed fired exactly once', `fired ${fired}x`)
  beat.destroy()
}

console.log('\n=== 9. destroy() stops everything ===')
reset(); setResponder(accepted())
{
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  beat.destroy()
  await playFor(beat, 40, 0)
  beat.flush('after-destroy')
  await settle()
  ok(calls.length === 0, 'no writes after destroy', `${calls.length}`)
}

// ── From here: an injected rpc and an injected clock ─────────────────
// The heartbeat is handed its own `rpc`, so nothing goes through the Supabase
// stub, and its own `now`. Date.now keeps reading the same clock, because the
// call gate reads Date.now.
function rig(extra = {}) {
  // The gate is module-level and 400ms wide. Step past it, so the last
  // section's final write cannot hold this section's first one back.
  advance(1000)
  const sent = []
  const beat = createWatchHeartbeat({
    lessonId: 'l001', durationSeconds: 753,
    rpc: async (args) => { sent.push(args); return { data: accepted()(args), error: null } },
    now: () => clock,
    ...extra,
  })
  return { beat, sent }
}
/** The played seconds the next forced beat carries. */
async function flushed(beat, sent) {
  const before = sent.length
  beat.flush('pause')
  await settle()
  return sent.length > before ? sent[sent.length - 1] : null
}
const near = (a, b) => Math.abs(a - b) < 1e-6

console.log('\n=== 10. reports 0.25s apart count at every speed on the player\'s menu ===')
// Steps as measured on Tella's player on 2026-10-12, reports 250ms apart.
// At 2.5x the usual step was 0.621s and the largest seen 0.643s. The largest
// is over what 250ms allows at the cap (0.625s), so it is tested the way it
// was seen, now and then among usual ones. Every report at 0.643s would be
// 2.57x, which is the case after this loop.
for (const [label, stepAt, what] of [
  ['1x', () => 0.25, '0.25s'], ['2x', () => 0.503, '0.503s'], ['2x, largest step seen', () => 0.521, '0.521s'],
  ['2.5x', () => 0.621, '0.621s'],
  ['2.5x, the largest step seen (0.643s) every sixth report', (i) => (i % 6 === 5 ? 0.643 : 0.621), '0.621s and 0.643s'],
]) {
  const { beat, sent } = rig()
  let t = 0
  let all = 0
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 40; i++) {
    const step = stepAt(i)
    advance(250); t += step; all += step; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, all),
     `${label}: 40 reports of ${what} are all played time`,
     `delta=${last?.p_delta_seconds.toFixed(3)} of ${all.toFixed(3)} in 10 clock seconds`)
  beat.destroy()
}
{
  // Faster than the cap, report after report: the allowance runs down by
  // 0.018s each time until one report does not fit. It is not all counted.
  const { beat, sent } = rig()
  let t = 0
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 40; i++) {
    advance(250); t += 0.643; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 39 * 0.643),
     '2.57x (0.643s every report) is over the cap: 39 of 40 reports are counted',
     `delta=${last?.p_delta_seconds.toFixed(3)} of ${(40 * 0.643).toFixed(3)}`)
  beat.destroy()
}

console.log('\n=== 11. a +20s skip arrives as one step and is not counted ===')
{
  const { beat, sent } = rig()
  let t = 0
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 12; i++) { advance(250); t += 0.25; beat.tick(t, 753) }   // plays to 3.00
  advance(250); t += 20.21; beat.tick(t, 753)                                   // the skip, as Tella reports it
  for (let i = 0; i < 8; i++) { advance(250); t += 0.25; beat.tick(t, 753) }    // 2 more seconds
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 5),
     'only the 5s played on either side of the skip', `delta=${last?.p_delta_seconds.toFixed(3)}`)
  ok(last !== null && near(last.p_position_seconds, 25.21), 'the position is where the skip landed',
     `pos=${last?.p_position_seconds.toFixed(2)}`)
  beat.destroy()
}

console.log('\n=== 12. a late report: what a 1s gap allows (1 * 2.5 + 0.35 = 2.85s) ===')
{
  const { beat, sent } = rig()
  beat.tick(10, 753)
  await settle()
  advance(1000); beat.tick(12.5, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 2.5), 'a 1s gap with a 2.5s step is counted',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}
{
  const { beat, sent } = rig()
  beat.tick(10, 753)
  await settle()
  advance(1000); beat.tick(14, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && last.p_delta_seconds === 0 && last.p_position_seconds === 14,
     'a 1s gap with a 4s step is not', `delta=${last?.p_delta_seconds} pos=${last?.p_position_seconds}`)
  beat.destroy()
}

console.log('\n=== 13. however long the gap, at most 5.35s is allowed ===')
{
  const { beat, sent } = rig()
  beat.tick(100, 753)
  await settle()
  advance(10_000); beat.tick(105.3, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 5.3), 'a 5.3s step after 10s is counted',
     `delta=${last?.p_delta_seconds.toFixed(3)}`)
  beat.destroy()
}
{
  const { beat, sent } = rig()
  beat.tick(100, 753)
  await settle()
  advance(10_000); beat.tick(105.4, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && last.p_delta_seconds === 0, 'a 5.4s step after the same 10s is not',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}

console.log('\n=== 14. noteSeek resets the allowance as well as the position ===')
{
  // The control: 10.25s after the last report, a 3s step counts (the gap allows 5.35s).
  const { beat, sent } = rig()
  beat.tick(10, 753)
  await settle()
  advance(10_250); beat.tick(13, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 3), 'with no seek, a 3s step after a 10.25s wait is counted',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}
{
  // The same wait, but a seek lands 0.25s before the report. The gap is now
  // 0.25s (0.975s allowed), so the wait before the seek lends nothing.
  const { beat, sent } = rig()
  beat.tick(10, 753)
  await settle()
  advance(10_000); beat.noteSeek(500)
  advance(250); beat.tick(503, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && last.p_delta_seconds === 0 && last.p_position_seconds === 503,
     'after a seek, the same 3s step is measured from the seek and is not counted',
     `delta=${last?.p_delta_seconds} pos=${last?.p_position_seconds}`)
  beat.destroy()
}
{
  const { beat, sent } = rig()
  beat.tick(10, 753)
  await settle()
  advance(10_000); beat.noteSeek(500)
  advance(250); beat.tick(500.25, 753)
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 0.25), 'and ordinary playing after the seek still counts',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}

console.log('\n=== 15. the rule reads the clock it was given, not Date.now ===')
{
  // A clock of its own that moves while Date.now stands still. Read off
  // Date.now the gap would be 0, the rule would allow 0.35s, and the 0.6s
  // step below would be thrown away.
  let mine = 5_000_000
  const { beat, sent } = rig({ now: () => mine })
  beat.tick(0, 753)
  await settle()
  mine += 250; beat.tick(0.6, 753)
  advance(1000)                      // only so the call gate lets the flush through
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 0.6), 'a 0.6s step 250ms later, by the injected clock, is counted',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}

console.log('\n=== 16. no Supabase client is created when rpc is given ===')
reset(); setResponder(accepted())
{
  const before = clientsCreated
  const { beat, sent } = rig()
  await playFor(beat, 16, 0)
  await settle()
  ok(sent.length === 2, 'the injected rpc carried both beats (the first tick and one throttled)', `${sent.length} beats`)
  ok(clientsCreated === before, 'and no Supabase client was created', `${clientsCreated - before} created`)
  ok(calls.length === 0, 'so nothing reached the Supabase stub', `${calls.length} calls`)
  beat.destroy()
}
{
  // The other half, so the count above is known to count: without an rpc the
  // client is built on the first write (not when the heartbeat is created)
  // and reused after that.
  advance(1000)
  const before = clientsCreated
  const beat = createWatchHeartbeat({ lessonId: 'l001', durationSeconds: 753 })
  ok(clientsCreated === before, 'with no rpc, creating the heartbeat still builds no client')
  await playFor(beat, 16, 0)
  await settle()
  ok(calls.length === 2 && clientsCreated === before + 1,
     'the first write builds one, and the second write reuses it',
     `${calls.length} writes, ${clientsCreated - before} client`)
  beat.destroy()
}

console.log('\n=== 17. a heartbeat that never heard a position writes nothing ===')
{
  // The lesson page was opened and left: tab hidden, then unmounted, and the
  // player never reported a position. A beat here would overwrite the stored
  // resume point with 0.
  const { beat, sent } = rig()
  beat.flush('visibilitychange')
  await settle()
  advance(1000); beat.flush('unmount')
  await settle()
  ok(sent.length === 0, 'forced beats before the first position report are not sent', `${sent.length} beats`)
  advance(1000); beat.tick(300, 753)
  await settle()
  ok(sent.length === 1 && sent[0].p_position_seconds === 300, 'the first position report writes as before',
     `${sent.length} beat at ${sent[0]?.p_position_seconds}`)
  beat.destroy()
}

// ── D16: the allowance carries over ──────────────────────────────────
console.log('\n=== 18. reports handled back to back after a 1s stall lose nothing ===')
// The page is busy for 1s every 5s. The reports that came due meanwhile are
// handled together when it is free again: the first sees a 1s gap, the rest a
// gap of 0. Judged gap by gap the rest were refused; a reviewer measured
// 80.4% credited at 1.5x. One minute of it at each speed.
for (const rate of [1.5, 2, 2.5]) {
  const { beat, sent } = rig()
  const step = 0.25 * rate
  const start = clock
  let t = 0
  beat.tick(t, 753)
  await settle()
  const reports = 240
  let together = 0
  for (let n = 1; n <= reports; n++) {
    const due = n * 250
    // Stalls are (5s, 6s], (10s, 11s], ... : a report due inside one is handled at its end.
    const inStall = due % 5000 !== 0 && Math.floor(due / 5000) >= 1 && due % 5000 <= 1000
    const handledAt = inStall ? Math.floor(due / 5000) * 5000 + 1000 : due
    if (start + handledAt === clock) together++
    advance(start + handledAt - clock)
    t += step
    beat.tick(t, 753)
    if (n % 4 === 0) await new Promise((r) => setImmediate(r))
  }
  await settle()
  await flushed(beat, sent)
  const credited = sent.reduce((sum, a) => sum + a.p_delta_seconds, 0)
  ok(near(credited, reports * step),
     `${rate}x: every report of a minute with a 1s stall every 5s is played time`,
     `credited ${credited.toFixed(3)} of ${(reports * step).toFixed(3)}s; ${together} reports were handled with a gap of 0`)
  beat.destroy()
}

console.log('\n=== 19. the allowance never holds more than 5.35s ===')
// A report this long after the last one also writes (the 15s throttle), so
// these add up what every beat carried instead of reading one of them.
async function creditedAfter(beat, sent) {
  await settle()
  advance(1000)          // past the 400ms gate, which the throttled write has just used
  beat.flush('pause')
  await settle()
  return { credited: sent.reduce((sum, a) => sum + a.p_delta_seconds, 0), position: sent[sent.length - 1].p_position_seconds }
}
{
  // A minute's pause, then a skip of 5.4s: over the most the allowance can hold.
  const { beat, sent } = rig()
  beat.tick(100, 753)
  await settle()
  advance(60_000); beat.tick(105.4, 753)
  const { credited, position } = await creditedAfter(beat, sent)
  ok(credited === 0 && position === 105.4, 'after a long pause, a skip of more than 5.35s counts nothing', `credited ${credited}s, position ${position}`)
  beat.destroy()
}
{
  // Ten minutes of nothing, then three steps handled at the same moment: 2s, 3s, 0.5s.
  // 2 + 3 fit in 5.35. The 0.35 that is left does not cover the 0.5.
  const { beat, sent } = rig()
  beat.tick(100, 753)
  await settle()
  advance(600_000)
  beat.tick(102, 753); beat.tick(105, 753); beat.tick(105.5, 753)
  const { credited, position } = await creditedAfter(beat, sent)
  ok(near(credited, 5) && position === 105.5, 'after ten minutes of nothing the allowance is 5.35s and no more: 2s and 3s fit, the next 0.5s does not',
     `credited ${credited}s, position ${position}`)
  beat.destroy()
}
{
  // A small skip is counted, and it is paid for: the larger one right after it does not fit.
  const { beat, sent } = rig()
  beat.tick(100, 753)
  await settle()
  advance(60_000); beat.tick(103, 753)       // 3s of the 5.35s
  advance(250); beat.tick(106.5, 753)        // 3.5s against 2.35 + 0.625
  const { credited, position } = await creditedAfter(beat, sent)
  ok(near(credited, 3) && position === 106.5,
     'after a long pause a small skip counts and uses the allowance up: the 3.5s skip after it counts nothing',
     `credited ${credited}s, position ${position}`)
  beat.destroy()
}
{
  // A step that does not fit leaves the allowance alone: ordinary playing after a refused skip is all counted.
  const { beat, sent } = rig()
  let t = 0
  beat.tick(t, 753)
  await settle()
  advance(250); t += 20; beat.tick(t, 753)   // the skip, with 0.975s allowed
  for (let i = 0; i < 8; i++) { advance(250); t += 0.625; beat.tick(t, 753) }   // then 2.5x
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 5), 'a refused skip costs the allowance nothing: 2s at 2.5x straight after it are all counted',
     `delta=${last?.p_delta_seconds}`)
  beat.destroy()
}

{
  // The allowance starts at 0.35s, with the first report and after a seek, so
  // the first step after either is judged as it always was: 0.25 * 2.5 + 0.35.
  for (const [how, step, counts] of [['the first report', 0.9, true], ['the first report', 1.0, false], ['a seek', 0.9, true], ['a seek', 1.0, false]]) {
    const { beat, sent } = rig()
    beat.tick(10, 753)
    await settle()
    let from = 10
    if (how === 'a seek') { advance(30_000); beat.noteSeek(400); from = 400 }
    advance(250); beat.tick(from + step, 753)
    const { credited } = await creditedAfter(beat, sent)
    ok(counts ? near(credited, step) : credited === 0, `250ms after ${how}, a step of ${step}s ${counts ? 'counts' : 'does not'} (0.975s allowed)`, `credited ${credited}s`)
    beat.destroy()
  }
}

{
  // Ten seconds at 1x fill the allowance. A seek empties it back to 0.35s: the
  // 3s step that follows the seek is a skip, whatever was saved up before.
  const { beat, sent } = rig()
  let t = 0
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 40; i++) { advance(250); t += 0.25; beat.tick(t, 753) }
  beat.noteSeek(500)
  advance(250); beat.tick(503, 753)
  const { credited, position } = await creditedAfter(beat, sent)
  ok(near(credited, 10) && position === 503, 'an allowance saved up before a seek is not spent after it', `credited ${credited}s of the 10s played, position ${position}`)
  beat.destroy()
}

// ── D17: nothing that matters is sent only once ──────────────────────
const failing = () => ({ data: null, error: { message: 'the database call failed' } })
/** A heartbeat whose rpc answers from a script: `answer(args, n)` returns { data, error } or throws. */
function scripted(answer, extra = {}) {
  advance(1000)
  const sent = []
  const beat = createWatchHeartbeat({
    lessonId: 'l001', durationSeconds: 753,
    rpc: async (args) => { sent.push({ ...args, at: clock }); return answer(args, sent.length) },
    now: () => clock,
    ...extra,
  })
  return { beat, sent }
}
const good = (args) => ({ data: accepted()(args), error: null })
/** Plays 2s at 1x from `from`, 8 reports. The first report of a heartbeat writes at once. */
async function playTwoSeconds(beat, from) {
  let t = from
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 8; i++) { advance(250); t += 0.25; beat.tick(t, 753) }
  await settle()
  return t
}

console.log('\n=== 20. a forced beat that fails is sent again after 2s, 5s and 10s, then given up ===')
{
  // The first report's beat lands. Everything after it fails.
  const { beat, sent } = scripted((args, n) => (n === 1 ? good(args) : failing()))
  await playTwoSeconds(beat, 600)
  beat.flush('ended'); await settle()
  ok(sent.length === 2 && sent[1].p_force === true, 'the beat at the end is sent, and fails', `${sent.length} calls`)
  const failedAt = sent[1].at
  advance(1999); await settle()
  ok(sent.length === 2, 'nothing more in the first 1.999s', `${sent.length} calls`)
  advance(1); await settle()
  ok(sent.length === 3 && sent[2].at - failedAt === 2000, 'the first retry goes 2s after the failure', `${sent[2]?.at - failedAt}ms`)
  advance(4999); await settle()
  ok(sent.length === 3, 'nothing more for 4.999s', `${sent.length} calls`)
  advance(1); await settle()
  ok(sent.length === 4 && sent[3].at - sent[2].at === 5000, 'the second 5s after the first failed', `${sent[3]?.at - sent[2]?.at}ms`)
  advance(9999); await settle()
  advance(1); await settle()
  ok(sent.length === 5 && sent[4].at - sent[3].at === 10_000, 'the third 10s after the second failed', `${sent[4]?.at - sent[3]?.at}ms`)
  ok(sent.slice(1).every((a) => a.p_force === true && a.p_position_seconds === 602 && near(a.p_delta_seconds, 2)),
     'each retry is forced and carries the same position and the same played seconds', JSON.stringify(sent.slice(1).map((a) => [a.p_position_seconds, a.p_delta_seconds])))
  advance(120_000); await settle()
  ok(sent.length === 5 && timers.length === 0, 'after the third it is given up: nothing in the next two minutes, and no timer left', `${sent.length} calls, ${timers.length} timers`)
  beat.destroy()
}
{
  // The same, but the call throws instead of answering with an error.
  const { beat, sent } = scripted((args, n) => { if (n === 1) return good(args); throw new Error('network') })
  await playTwoSeconds(beat, 600)
  beat.flush('ended'); await settle()
  advance(2000); await settle()
  ok(sent.length === 3, 'a call that throws is retried the same way', `${sent.length} calls`)
  beat.destroy()
}
{
  // The first retry lands.
  const results = []
  const { beat, sent } = scripted((args, n) => (n === 2 ? failing() : good(args)), { onResult: (r, b) => results.push(b) })
  await playTwoSeconds(beat, 600)
  beat.flush('ended'); await settle()
  advance(2000); await settle()
  ok(sent.length === 3 && near(sent[2].p_delta_seconds, 2), 'a retry that lands delivers what the failed beat carried', `delta=${sent[2]?.p_delta_seconds}`)
  ok(results.length === 2 && results[1].reason === 'ended' && results[1].force === true, 'and its answer is given under the reason of the beat it retried',
     JSON.stringify(results))
  advance(120_000); await settle()
  ok(sent.length === 3 && timers.length === 0, 'then there is nothing more to retry', `${sent.length} calls, ${timers.length} timers`)
  beat.destroy()
}
{
  // destroy() ends it.
  const { beat, sent } = scripted((args, n) => (n === 1 ? good(args) : failing()))
  await playTwoSeconds(beat, 600)
  beat.flush('pause'); await settle()
  ok(timers.length === 1, 'a failed forced beat leaves one timer', `${timers.length}`)
  beat.destroy()
  ok(timers.length === 0, 'destroy() clears it', `${timers.length}`)
  advance(120_000); await settle()
  ok(sent.length === 2, 'and nothing is sent after destroy', `${sent.length} calls`)
}
{
  // A later write that lands ends it too: the pause failed, the tab-hide half a second later got through.
  const { beat, sent } = scripted((args, n) => (n === 2 ? failing() : good(args)))
  const t = await playTwoSeconds(beat, 600)
  beat.flush('pause'); await settle()
  advance(500); beat.tick(t + 0.5, 753)
  beat.flush('visibilitychange'); await settle()
  ok(sent.length === 3 && near(sent[2].p_delta_seconds, 2.5) && timers.length === 0,
     'a later write that lands carries everything and clears the retry', `${sent.length} calls, delta=${sent[2]?.p_delta_seconds}, ${timers.length} timers`)
  advance(120_000); await settle()
  ok(sent.length === 3, 'so the retry never goes', `${sent.length} calls`)
  beat.destroy()
}
{
  // A forced beat of its own starts its own count: the pause failed twice, then the end fails.
  const { beat, sent } = scripted((args, n) => (n === 1 ? good(args) : failing()))
  const t = await playTwoSeconds(beat, 600)
  beat.flush('pause'); await settle()
  advance(2000); await settle()                    // the pause's first retry, failed; the next would be 5s on
  ok(sent.length === 3, 'the pause has had one retry', `${sent.length} calls`)
  advance(1000); beat.tick(t + 0.5, 753)
  beat.flush('ended'); await settle()              // a new forced beat, failed
  const endedAt = sent[sent.length - 1].at
  ok(sent.length === 4 && timers.length === 1, 'a new forced beat that fails leaves one timer, not two', `${sent.length} calls, ${timers.length} timers`)
  advance(2000); await settle()
  ok(sent.length === 5 && sent[4].at - endedAt === 2000, 'and its first retry is 2s on, not the 5s the old one was waiting for', `${sent[4]?.at - endedAt}ms`)
  beat.destroy()
}
{
  // Not a failure, but the same hole: the video ends 300ms after a routine
  // beat, and the 400ms gate holds the end beat back. It used to be dropped.
  const { beat, sent } = scripted((args) => good(args))
  let t = 0
  // Play until the 15s beat goes, and stop on that very report.
  for (let i = 0; i < 80 && sent.length < 2; i++) {
    advance(250); t += 0.25; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  await settle()
  ok(sent.length === 2 && sent[1].p_force === false && clock - sent[1].at === 0, 'a routine beat has just gone', `${sent.length} calls`)
  advance(300); t += 0.3; beat.tick(t, 753)
  beat.flush('ended'); await settle()
  ok(sent.length === 2 && timers.length === 1, 'the end beat 300ms later is held back by the gate, and a timer is set for it', `${sent.length} calls, ${timers.length} timer`)
  advance(2000); await settle()
  ok(sent.length === 3 && sent[2].p_force === true && sent[2].p_position_seconds === t && near(sent[2].p_delta_seconds, 0.3),
     'and it is sent 2s later with the end position: a forced beat the gate holds back is not dropped', `pos=${sent[2]?.p_position_seconds} delta=${sent[2]?.p_delta_seconds}`)
  ok(timers.length === 0, 'with nothing left to retry', `${timers.length} timers`)
  beat.destroy()
}
{
  // An ordinary beat that fails gets no retry timer. The throttle is its retry.
  const { beat, sent } = scripted(() => failing())
  beat.tick(10, 753); await settle()
  ok(sent.length === 1 && sent[0].p_force === false && timers.length === 0, 'an ordinary beat that fails sets no timer', `${timers.length} timers`)
  beat.destroy()
}

console.log('\n=== 21. a failing database call is tried every 15s, not twice a second ===')
{
  // Every call fails, for a minute of watching at 1x.
  const { beat, sent } = scripted(() => failing())
  let t = 0
  for (let i = 0; i < 240; i++) {
    advance(250); t += 0.25; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  await settle()
  ok(sent.length === 4, 'a minute against a call that always fails is 4 calls (it was measured at 120)', `${sent.length} calls`)
  const gaps = sent.slice(1).map((a, i) => a.at - sent[i].at)
  ok(gaps.every((g) => g >= 15_000 && g <= 16_000), 'each one 15s after the last', gaps.join(', '))
  ok(near(sent[3].p_delta_seconds, sent[3].p_position_seconds - 0.25), 'and each carries everything played so far: nothing banked is dropped',
     `the last carried ${sent[3].p_delta_seconds.toFixed(2)}s at ${sent[3].p_position_seconds.toFixed(2)}s`)
  beat.destroy()
}
{
  // It fails for 30s and then works: the played seconds arrive once, whole.
  const begun = clock + 1000   // scripted() steps the clock 1s before it starts
  const { beat, sent } = scripted((args) => (clock - begun < 30_000 ? failing() : good(args)))
  let t = 0
  for (let i = 0; i < 240; i++) {
    advance(250); t += 0.25; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  await settle()
  await flushed(beat, sent)
  const landed = sent.filter((a) => a.at - begun >= 30_000)
  const credited = landed.reduce((sum, a) => sum + a.p_delta_seconds, 0)
  ok(near(credited, 59.75), 'when the call works again the whole minute is delivered, once', `credited ${credited.toFixed(2)}s over ${landed.length} beats that landed`)
  beat.destroy()
}

// ── D14: every answer says which beat it answers ─────────────────────
console.log('\n=== 22. an answer comes with the beat it answers, and a forced beat always gets one ===')
{
  const got = []
  const { beat, sent } = scripted((args) => good(args), { onResult: (r, b) => got.push({ ...b, pos: r.max_position_seconds }) })
  const t = await playTwoSeconds(beat, 600)
  ok(got.length === 1 && got[0].reason === 'throttle' && got[0].force === false && got[0].repeated === undefined,
     'an ordinary beat\'s answer is marked "throttle", not forced', JSON.stringify(got))
  beat.flush('pause'); await settle()
  ok(got.length === 2 && got[1].reason === 'pause' && got[1].force === true && got[1].repeated === undefined && sent.length === 2,
     'a forced beat\'s answer carries the reason it was flushed for', JSON.stringify(got[1]))
  // The video ends with nothing new since that pause: no call is made, and the pause's answer is given again as the end's.
  advance(1000); beat.flush('ended'); await settle()
  ok(sent.length === 2 && got.length === 3 && got[2].reason === 'ended' && got[2].force === true && got[2].repeated === true && got[2].pos === t,
     'a forced beat with nothing new to say sends nothing and is answered with the last accepted answer, marked repeated', JSON.stringify(got[2]))
  beat.destroy()
}
{
  // Before any beat has been accepted there is no answer to repeat.
  const got = []
  const { beat, sent } = scripted(() => failing(), { onResult: (r, b) => got.push(b) })
  beat.tick(10, 753); await settle()
  advance(1000); beat.flush('ended'); await settle()
  ok(sent.length === 2 && got.length === 0, 'with no accepted beat yet, a forced one is sent, not answered from memory', `${sent.length} calls, ${got.length} answers`)
  beat.destroy()
}
{
  // A callback that throws is not a failed beat: no retry, and the next beat still goes.
  const { beat, sent } = scripted((args) => good(args), { onResult: () => { throw new Error('the caller\'s bug') } })
  const t = await playTwoSeconds(beat, 600)
  beat.flush('pause'); await settle()
  ok(sent.length === 2 && timers.length === 0, 'a callback that throws does not pass for a failed beat: no retry is set', `${sent.length} calls, ${timers.length} timers`)
  advance(1000); beat.tick(t + 1, 753); beat.flush('ended'); await settle()
  ok(sent.length === 3, 'and the heartbeat goes on', `${sent.length} calls`)
  beat.destroy()
}

Date.now = realNow
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
