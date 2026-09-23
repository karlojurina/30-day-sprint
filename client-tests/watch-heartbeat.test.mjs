import { createWatchHeartbeat } from './_gen/watch-heartbeat.ts'
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
  // rAF, not 20s of someone watching. Over MAX_TICK_DELTA_S, so it must not count.
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

Date.now = realNow
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
