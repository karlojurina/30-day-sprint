import { createWatchHeartbeat, clientsCreated } from './_gen/watch-heartbeat.ts'
import { calls, reset, setResponder } from './_gen/stub-supabase.ts'

// ── controllable clock ───────────────────────────────────────────────
const realNow = Date.now
let clock = 1_000_000
Date.now = () => clock
const advance = (ms) => { clock += ms }
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
for (const [label, step] of [['1x', 0.25], ['2x', 0.503], ['2x, largest step seen', 0.521],
                             ['2.5x', 0.621], ['2.5x, largest step seen', 0.643]]) {
  const { beat, sent } = rig()
  let t = 0
  beat.tick(t, 753)
  await settle()
  for (let i = 0; i < 40; i++) {
    advance(250); t += step; beat.tick(t, 753)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  const last = await flushed(beat, sent)
  ok(last !== null && near(last.p_delta_seconds, 40 * step),
     `${label}: 40 reports of ${step}s are all played time`,
     `delta=${last?.p_delta_seconds.toFixed(3)} of ${(40 * step).toFixed(3)} in 10 clock seconds`)
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

console.log('\n=== 13. the gap is capped at 2s: a 10s gap allows at most 5.35s ===')
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

console.log('\n=== 14. noteSeek resets the gap as well as the position ===')
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

Date.now = realNow
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
