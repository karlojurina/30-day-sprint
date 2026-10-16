// A heartbeat that keeps failing says so (src/lib/world/watch-heartbeat.ts,
// the onSaveTrouble option; backend_readiness.md section 5, item 14). It was
// silent forever: a student could watch a whole lesson that never counted and
// see no message. Now, after 3 failed reports in a row, onSaveTrouble(true)
// fires once, and LessonPlayer shows one plain line; the next report that gets
// through fires onSaveTrouble(false) and the line goes. Any answer from the
// server gets through, a refusal included: the connection is fine then.
// The module is the real source (build.mjs copies it); the clock and the
// timers are this file's, as in watch-heartbeat.test.mjs.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWatchHeartbeat } from './_gen/watch-heartbeat.ts'

let clock = 5_000_000
const realNow = Date.now
Date.now = () => clock
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
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const answer = (args, accepted = true) => ({
  data: {
    accepted, max_position_seconds: args.p_position_seconds, last_position_seconds: args.p_position_seconds,
    watched_seconds: 0, threshold_met: false, threshold_crossed: false,
  },
  error: null,
})
const FAILED = { data: null, error: { message: 'Failed to fetch' } }

/** A heartbeat whose rpc answers from `script(n)`: 'fail', 'throw', 'ok' or 'refused'. */
function scripted(script) {
  advance(1000)
  const sent = []
  const trouble = []
  const beat = createWatchHeartbeat({
    lessonId: 'a2l01', durationSeconds: 900,
    rpc: async (args) => {
      sent.push(args)
      const what = script(sent.length)
      if (what === 'throw') throw new TypeError('Failed to fetch')
      if (what === 'fail') return FAILED
      return answer(args, what !== 'refused')
    },
    now: () => clock,
    onSaveTrouble: (failing) => trouble.push({ failing, afterCall: sent.length }),
  })
  return { beat, sent, trouble }
}
/** Plays at 1x for `seconds`, a report every 250 ms; a routine beat goes every 15 s. */
async function play(beat, from, seconds) {
  let t = from
  for (let i = 0; i < seconds * 4; i++) {
    advance(250); t += 0.25; beat.tick(t, 900)
    if (i % 4 === 3) await new Promise((r) => setImmediate(r))
  }
  await settle()
  return t
}

console.log('\n=== Three failed reports in a row: it says so, once ===')
{
  const { beat, sent, trouble } = scripted(() => 'fail')
  let t = await play(beat, 0, 1)
  ok(sent.length === 1 && trouble.length === 0, 'the first report fails: nothing said yet', `${sent.length} calls`)
  t = await play(beat, t, 15)
  ok(sent.length === 2 && trouble.length === 0, 'the second fails 15 s later: still nothing', `${sent.length} calls`)
  t = await play(beat, t, 15)
  ok(sent.length === 3 && show(trouble) === show([{ failing: true, afterCall: 3 }]),
     'the third fails: onSaveTrouble(true), once (it was silent forever)', show(trouble))
  t = await play(beat, t, 45)
  ok(sent.length === 6 && trouble.length === 1, 'three more fail: nothing said again', `${sent.length} calls, ${trouble.length} said`)
  beat.destroy()
}

console.log('\n=== A report that gets through takes it back ===')
{
  const { beat, sent, trouble } = scripted((n) => (n <= 3 ? 'fail' : 'ok'))
  let t = await play(beat, 0, 31)
  ok(trouble.length === 1 && trouble[0].failing === true, 'three failures: trouble', show(trouble))
  t = await play(beat, t, 15)
  ok(sent.length === 4 && show(trouble[1]) === show({ failing: false, afterCall: 4 }), 'the fourth gets through: onSaveTrouble(false)', show(trouble))
  t = await play(beat, t, 30)
  ok(trouble.length === 2, 'and nothing more while they keep getting through', `${trouble.length} said`)
  beat.destroy()
}
{
  // A refusal is an answer: the server heard the report.
  const { beat, trouble } = scripted((n) => (n <= 3 ? 'fail' : 'refused'))
  let t = await play(beat, 0, 31)
  t = await play(beat, t, 15)
  ok(show(trouble.map((x) => x.failing)) === show([true, false]), 'a refused report also takes it back (the connection works)', show(trouble))
  beat.destroy()
}

console.log('\n=== Only failures in a row count ===')
{
  const { beat, trouble, sent } = scripted((n) => (n === 3 ? 'ok' : 'fail'))
  await play(beat, 0, 61)
  ok(sent.length === 5 && trouble.length === 0, 'fail, fail, through, fail, fail: nothing said', `${sent.length} calls, ${show(trouble)}`)
  beat.destroy()
}
{
  const { beat, trouble } = scripted(() => 'throw')
  await play(beat, 0, 31)
  ok(trouble.length === 1 && trouble[0].failing === true, 'a call that throws is a failed report too', show(trouble))
  beat.destroy()
}
{
  // The forced beat at a pause, and its retries 2 s and 5 s on: three in a row.
  const { beat, sent, trouble } = scripted((n) => (n === 1 ? 'ok' : 'fail'))
  const t = await play(beat, 0, 2)
  beat.flush('pause'); await settle()
  advance(2000); await settle()
  ok(sent.length === 3 && trouble.length === 0, 'the pause and its first retry fail: nothing yet', `${sent.length} calls`)
  advance(5000); await settle()
  ok(sent.length === 4 && show(trouble) === show([{ failing: true, afterCall: 4 }]), 'the second retry fails: said', show(trouble))
  void t
  beat.destroy()
}
{
  const { beat, trouble } = scripted(() => 'fail')
  await play(beat, 0, 16)
  beat.destroy()
  await play(beat, 16, 30)
  advance(60_000); await settle()
  ok(trouble.length === 0, 'destroy() before the third: nothing is ever said', show(trouble))
}

console.log('\n=== The lesson player shows it ===')
{
  // LessonPlayer is a React component, so its line is checked in the source;
  // the browser check is in decisions.md (final pass).
  const src = read('../src/components/world/LessonPlayer.tsx')
  const text = /const NOT_SAVING_TEXT =\s*"([^"]+)";/.exec(src)?.[1]
  ok(typeof text === 'string' && /isn't being saved/.test(text) && /connection/.test(text) && !/—|unlock/i.test(text),
     'one plain line: the watching is not being saved, check the connection', show(text))
  ok(/onSaveTrouble:\s*\(failing\)\s*=>\s*setNotSaving\(failing\)/.test(src), 'the player hands the heartbeat the switch for it')
  ok(/\{notSaving && \(\s*<p role="status" className=\{u\.barNote\}>\s*\{NOT_SAVING_TEXT\}/.test(src), 'and shows the line under the progress bar while it is on')
}

Date.now = realNow
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
