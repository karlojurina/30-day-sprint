import { TELLA_ORIGIN } from './_gen/tella.ts'
import { attachTellaPlayer, parseTellaMessage } from './_gen/tella-player.ts'

// Read before anything below sets one up: the module has just been imported
// and Node has no window.
const windowAtImport = typeof globalThis.window

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (v) => JSON.stringify(v)

// The numbers are the ones measured on the real player on 2026-10-12: a
// 67.262 s video whose last report was at 67.21. No video id appears in this
// file; the protocol does not carry one.
const DURATION = 67.262

console.log('\n=== parseTellaMessage: each message the player sends ===')
ok(windowAtImport === 'undefined', 'the module loads with no window (nothing touches it at import)', `typeof window: ${windowAtImport}`)
ok(same(parseTellaMessage({ type: 'ready' }), { type: 'ready' }), 'ready')
ok(same(parseTellaMessage({ type: 'timeUpdate', currentTime: 12.25, duration: DURATION }),
        { type: 'timeUpdate', currentTime: 12.25, duration: DURATION }), 'timeUpdate keeps its position and its duration')
ok(same(parseTellaMessage({ type: 'timeUpdate', currentTime: 0, duration: DURATION }),
        { type: 'timeUpdate', currentTime: 0, duration: DURATION }), 'a position of 0 is a position')
for (const state of ['idle', 'playing', 'paused', 'stopped', 'seeking', 'stalled']) {
  const m = parseTellaMessage({ type: 'playbackState', state, currentTime: 3, duration: DURATION })
  ok(same(m, { type: 'playbackState', state, currentTime: 3, duration: DURATION }), `playbackState "${state}"`, show(m))
}
{
  const m = parseTellaMessage({ type: 'timeUpdate', currentTime: 1, duration: 2, extra: 'x', nested: { a: 1 } })
  ok(same(Object.keys(m).sort(), ['currentTime', 'duration', 'type']), 'only the known fields come out', show(m))
}
{
  const input = { type: 'playbackState', state: 'stopped', currentTime: 67.21, duration: 0 }
  const before = show(input)
  parseTellaMessage(input)
  ok(show(input) === before, 'the message it was given is not changed')
}

console.log('\n=== a JSON string is read the same way ===')
ok(same(parseTellaMessage('{"type":"ready"}'), { type: 'ready' }), 'ready as a string')
ok(same(parseTellaMessage(JSON.stringify({ type: 'timeUpdate', currentTime: 40.2, duration: DURATION })),
        { type: 'timeUpdate', currentTime: 40.2, duration: DURATION }), 'timeUpdate as a string')
ok(same(parseTellaMessage(JSON.stringify({ type: 'playbackState', state: 'paused', currentTime: 9, duration: DURATION })),
        { type: 'playbackState', state: 'paused', currentTime: 9, duration: DURATION }), 'playbackState as a string')

console.log('\n=== a duration of 0 or less is no duration ===')
{
  // What the player really sends at the end of a video.
  const m = parseTellaMessage({ type: 'playbackState', state: 'stopped', currentTime: 67.21, duration: 0 })
  ok(same(m, { type: 'playbackState', state: 'stopped', currentTime: 67.21, duration: null }),
     '"stopped" with duration 0: the state is kept, the duration is null', show(m))
}
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5, duration: 0 })?.duration === null, 'timeUpdate with duration 0: duration null, the message kept')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5, duration: -1 })?.duration === null, 'a negative duration: null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5 })?.duration === null, 'no duration at all: null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5, duration: NaN })?.duration === null, 'duration NaN: null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5, duration: Infinity })?.duration === null, 'duration Infinity: null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: 5, duration: '67' })?.duration === null, 'a duration that is a string: null')

console.log('\n=== numbers that are not numbers ===')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: NaN, duration: DURATION }) === null, 'timeUpdate with position NaN -> null (the position is the message)')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: Infinity, duration: DURATION }) === null, 'timeUpdate with position Infinity -> null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: '12', duration: DURATION }) === null, 'timeUpdate with a string position -> null')
ok(parseTellaMessage({ type: 'timeUpdate', currentTime: null, duration: DURATION }) === null, 'timeUpdate with a null position -> null')
{
  const m = parseTellaMessage({ type: 'playbackState', state: 'playing', currentTime: NaN, duration: NaN })
  ok(same(m, { type: 'playbackState', state: 'playing', currentTime: null, duration: null }),
     'playbackState with NaN numbers: the state is kept, both numbers are null', show(m))
}

console.log('\n=== missing fields ===')
ok(parseTellaMessage({ type: 'timeUpdate', duration: DURATION }) === null, 'timeUpdate with no position -> null')
ok(parseTellaMessage({ type: 'timeUpdate' }) === null, 'timeUpdate with nothing -> null')
ok(parseTellaMessage({ type: 'playbackState', currentTime: 3, duration: DURATION }) === null, 'playbackState with no state -> null')
{
  const m = parseTellaMessage({ type: 'playbackState', state: 'idle' })
  ok(same(m, { type: 'playbackState', state: 'idle', currentTime: null, duration: null }),
     'playbackState with a state and nothing else: kept, numbers null', show(m))
}
ok(parseTellaMessage({ currentTime: 3, duration: DURATION }) === null, 'no type -> null')
ok(parseTellaMessage({}) === null, 'an empty object -> null')

console.log('\n=== unknown types and states ===')
ok(parseTellaMessage({ type: 'seeked', currentTime: 3 }) === null, 'an unknown type -> null')
ok(parseTellaMessage({ type: 'timeupdate', currentTime: 3 }) === null, 'the type is case sensitive ("timeupdate" is not Tella\'s)')
ok(parseTellaMessage({ type: 'playbackState', state: 'buffering', currentTime: 3 }) === null, 'an unknown state -> null')
ok(parseTellaMessage({ type: 'playbackState', state: 7 }) === null, 'a state that is not a string -> null')
ok(parseTellaMessage({ type: 'toString' }) === null && parseTellaMessage({ type: '__proto__' }) === null,
   'a type named after an object method -> null')
// player.js, the envelope other players speak, must not be mistaken for a Tella message.
ok(parseTellaMessage({ context: 'player.js', event: 'ready', value: {} }) === null, 'a player.js envelope -> null')

console.log('\n=== things that are not a message at all ===')
{
  const junk = [null, undefined, 42, true, [], [{ type: 'ready' }], () => {}, '', 'not json', '{"type":', '42', 'null', '"ready"', '[1,2]']
  const let_through = junk.filter((v) => parseTellaMessage(v) !== null)
  ok(let_through.length === 0, `non-objects and unreadable strings -> null`, `${junk.length} values, ${let_through.length} let through`)
}

// ── attachTellaPlayer, against a stand-in window and frame ───────────
// Not a browser. It proves the listener's two checks, the shape of the three
// commands and the held seek. Whether Tella's real player sends and obeys
// exactly this is proved in a real browser, not here.
const listeners = new Set()
globalThis.window = {
  addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn) },
  removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn) },
}
function frame() {
  const posted = []
  const contentWindow = { postMessage: (data, origin) => { posted.push({ data, origin }) } }
  return { iframe: { contentWindow }, contentWindow, posted }
}
function deliver(data, source, origin = TELLA_ORIGIN) {
  for (const fn of [...listeners]) fn({ data, origin, source })
}
function recorder() {
  const log = []
  return {
    log,
    events: {
      onReady: () => log.push(['ready']),
      onState: (state, seconds) => log.push(['state', state, seconds]),
      onTimeUpdate: (seconds, duration) => log.push(['time', seconds, duration]),
    },
  }
}

console.log('\n=== attachTellaPlayer: who it listens to ===')
{
  const { iframe, contentWindow } = frame()
  const other = frame()
  const { log, events } = recorder()
  const player = attachTellaPlayer(iframe, events)
  ok(listeners.size === 1, 'one listener on window, from the moment it is attached', `${listeners.size}`)

  deliver({ type: 'timeUpdate', currentTime: 1, duration: DURATION }, other.contentWindow)
  ok(log.length === 0, 'a message from another frame, even one on Tella\'s origin, is ignored')

  const lookalikes = ['https://tella.tv', 'http://www.tella.tv', 'https://www.tella.tv:444',
    'https://www.tella.tv.example.com', 'https://evilwww.tella.tv', 'https://www.tella.tv/', 'null', '']
  for (const origin of lookalikes) deliver({ type: 'timeUpdate', currentTime: 1, duration: DURATION }, contentWindow, origin)
  ok(log.length === 0, 'our frame on any other origin is ignored', `${lookalikes.length} lookalike origins`)

  deliver({ type: 'timeUpdate', currentTime: 1, duration: DURATION }, contentWindow)
  ok(same(log, [['time', 1, DURATION]]), 'our frame on Tella\'s origin is heard', show(log))
  player.destroy()
}
{
  // A frame that has no window yet, and a message with no source.
  const { log, events } = recorder()
  const player = attachTellaPlayer({ contentWindow: null }, events)
  deliver({ type: 'ready' }, null)
  ok(log.length === 0, 'a frame with no window matches nothing, not even a message with a null source')
  let threw = false
  try { player.play(); player.seekTo(5) } catch { threw = true }
  ok(!threw, 'and a command to it is dropped without an error')
  player.destroy()
}

console.log('\n=== attachTellaPlayer: what it passes on ===')
{
  const { iframe, contentWindow } = frame()
  const { log, events } = recorder()
  const player = attachTellaPlayer(iframe, events)

  deliver({ type: 'ready' }, contentWindow)
  deliver({ type: 'ready' }, contentWindow)
  ok(same(log, [['ready']]), 'ready is passed on once', show(log))

  log.length = 0
  deliver(JSON.stringify({ type: 'playbackState', state: 'playing', currentTime: 0, duration: DURATION }), contentWindow)
  deliver({ type: 'timeUpdate', currentTime: 0.25, duration: DURATION }, contentWindow)
  deliver({ type: 'playbackState', state: 'paused', currentTime: 0.25, duration: DURATION }, contentWindow)
  ok(same(log, [['state', 'playing', 0], ['time', 0.25, DURATION], ['state', 'paused', 0.25]]),
     'states and positions arrive in order, a JSON string included', show(log))

  log.length = 0
  deliver({ type: 'playbackState', state: 'stopped', currentTime: 67.21, duration: 0 }, contentWindow)
  deliver({ type: 'timeUpdate', currentTime: 0.5 }, contentWindow)
  ok(same(log, [['state', 'stopped', 67.21], ['time', 0.5, DURATION]]),
     'the duration 0 that comes with "stopped" does not replace the last real duration', show(log))

  log.length = 0
  deliver({ type: 'nonsense' }, contentWindow)
  deliver('not json', contentWindow)
  deliver({ type: 'timeUpdate', currentTime: NaN }, contentWindow)
  ok(log.length === 0, 'messages the parser refuses reach no callback')
  player.destroy()
}
{
  // No callbacks at all is allowed.
  const { iframe, contentWindow } = frame()
  const player = attachTellaPlayer(iframe, {})
  let threw = false
  try {
    deliver({ type: 'ready' }, contentWindow)
    deliver({ type: 'playbackState', state: 'playing', currentTime: 0, duration: DURATION }, contentWindow)
    deliver({ type: 'timeUpdate', currentTime: 1, duration: DURATION }, contentWindow)
  } catch { threw = true }
  ok(!threw, 'every callback is optional')
  player.destroy()
}

console.log('\n=== attachTellaPlayer: the three commands ===')
{
  const { iframe, contentWindow, posted } = frame()
  const player = attachTellaPlayer(iframe, {})
  deliver({ type: 'ready' }, contentWindow)
  player.play()
  player.pause()
  player.seekTo(40)
  player.seekTo(-3)
  ok(same(posted.map((p) => p.data), [{ type: 'play' }, { type: 'pause' }, { type: 'seek', time: 40 }, { type: 'seek', time: 0 }]),
     'play, pause and seek go out as {type}, {type} and {type, time}; a seek below 0 goes to 0', show(posted.map((p) => p.data)))
  ok(posted.every((p) => p.origin === TELLA_ORIGIN), 'each is posted to Tella\'s origin and never to "*"',
     show([...new Set(posted.map((p) => p.origin))]))
  player.destroy()
}
{
  // A frame that throws when posted to (it has not finished loading).
  const contentWindow = { postMessage: () => { throw new Error('not ready') } }
  const player = attachTellaPlayer({ contentWindow }, {})
  deliver({ type: 'ready' }, contentWindow)
  let threw = false
  try { player.play() } catch { threw = true }
  ok(!threw, 'a frame that throws on postMessage does not throw here')
  player.destroy()
}

console.log('\n=== attachTellaPlayer: a seek asked for before "ready" ===')
{
  const { iframe, contentWindow, posted } = frame()
  const order = []
  const player = attachTellaPlayer(iframe, { onReady: () => order.push(`ready, with ${posted.length} posted`) })
  player.seekTo(12)
  player.seekTo(40)
  ok(posted.length === 0, 'nothing is posted before the player says "ready"', `${posted.length} posted`)
  deliver({ type: 'ready' }, contentWindow)
  ok(same(posted.map((p) => p.data), [{ type: 'seek', time: 40 }]), 'on "ready" the last seek asked for is sent, once', show(posted.map((p) => p.data)))
  ok(same(order, ['ready, with 1 posted']), 'and it is sent before onReady runs', show(order))
  deliver({ type: 'ready' }, contentWindow)
  ok(posted.length === 1, 'a second "ready" sends nothing more', `${posted.length} posted`)
  player.seekTo(50)
  ok(same(posted[1]?.data, { type: 'seek', time: 50 }), 'after "ready" a seek goes straight out', show(posted[1]?.data))
  player.destroy()
}

console.log('\n=== attachTellaPlayer: destroy ===')
{
  const { iframe, contentWindow, posted } = frame()
  const { log, events } = recorder()
  const player = attachTellaPlayer(iframe, events)
  deliver({ type: 'ready' }, contentWindow)
  const size = listeners.size
  player.destroy()
  ok(listeners.size === size - 1, 'the listener is taken off window', `${size} -> ${listeners.size}`)
  log.length = 0
  deliver({ type: 'timeUpdate', currentTime: 9, duration: DURATION }, contentWindow)
  player.play()
  player.seekTo(3)
  ok(log.length === 0 && posted.length === 0, 'after destroy nothing is heard and nothing is posted')
}
ok(listeners.size === 0, 'every player made in this file took its listener with it', `${listeners.size} left`)

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
