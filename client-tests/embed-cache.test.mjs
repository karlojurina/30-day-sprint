// The embed cache in front of the lesson transport (src/lib/world/embed-cache.ts),
// copied byte for byte by build.mjs. The transport under it is a stand-in whose
// answers this file hands out by hand, so "on its way" and "answered" are
// moments the test chooses.
import { EMBED_CACHE_SIZE, EMBED_MAX_AGE_MS, PREFETCH_IN_FLIGHT, withEmbedCache } from './_gen/embed-cache.ts'

let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

// Every address here is made up: no real video id is written in this repository.
const READY = (id) => ({ ok: true, embedUrl: `https://example.test/${id}` })

/** A cache told that student S1 is signed in and active, as useLessonTransport.ts tells it. */
function cache(t, opts) {
  const c = withEmbedCache(t, opts)
  c.setAccess('S1', true)
  return c
}

const unhandled = []
process.on('unhandledRejection', (e) => unhandled.push(String(e)))

/**
 * A transport whose getEmbed answers only when told to. `calls` lists every
 * lesson asked for; `answer(id, value)` settles the oldest open request for
 * it (an Error rejects it).
 */
function stand() {
  const calls = []
  const open = []
  const t = {
    calls,
    getEmbed(id) {
      calls.push(id)
      return new Promise((resolve, reject) => open.push({ id, resolve, reject }))
    },
    heartbeat: async () => ({ data: null, error: null }),
    async claim(id) {
      return { completed: this === t, reason: `claimed ${id}` }
    },
    answer(id, value) {
      const i = open.findIndex((r) => r.id === id)
      if (i < 0) throw new Error(`no open request for ${id}`)
      const [r] = open.splice(i, 1)
      if (value instanceof Error) r.reject(value)
      else r.resolve(value)
    },
    openCount: () => open.length,
  }
  return t
}

console.log('\n=== one request per lesson at a time ===')
{
  const t = stand()
  const c = cache(t)
  const a = c.getEmbed('L1')
  const b = c.getEmbed('L1')
  await flush()
  ok(t.calls.length === 1, 'two asks while one is on its way make one request', `${t.calls.length} requests`)
  ok(a === b, 'and the second ask is handed the same promise')
  c.prefetch('L1')
  await flush()
  ok(t.calls.length === 1, 'a prefetch while it is on its way makes none either', `${t.calls.length} requests`)
  t.answer('L1', READY('L1'))
  const [ra, rb] = await Promise.all([a, b])
  ok(ra.ok && rb.ok && ra.embedUrl === rb.embedUrl, 'both asks get the one answer')
}
{
  const t = stand()
  const c = cache(t)
  c.prefetch('L2')
  await flush()
  const click = c.getEmbed('L2')
  await flush()
  ok(t.calls.length === 1, 'a click on a lesson whose prefetch is on its way makes no second request', `${t.calls.length} requests`)
  t.answer('L2', READY('L2'))
  ok((await click).ok === true, 'and the click gets the prefetch\'s answer')
}

console.log('\n=== a ready answer is kept ===')
{
  const t = stand()
  const c = cache(t)
  const first = c.getEmbed('L3')
  await flush()
  t.answer('L3', READY('L3'))
  await first
  const again = await c.getEmbed('L3')
  c.prefetch('L3')
  await flush()
  ok(t.calls.length === 1 && again.ok && again.embedUrl === READY('L3').embedUrl, 'asked again after it was ready: answered from the cache, no request', `${t.calls.length} requests`)
  ok(t.openCount() === 0, 'a prefetch of a kept lesson asks nothing')
}

console.log('\n=== any other answer is not kept ===')
for (const [what, value] of [
  ['not recorded', { ok: false, kind: 'not-recorded' }],
  ['blocked', { ok: false, kind: 'blocked' }],
  ['an error', { ok: false, kind: 'error', message: 'Video lookup failed' }],
  ['a request that threw', new Error('the stand-in request failed')],
]) {
  const t = stand()
  const c = cache(t)
  const first = c.getEmbed('L4')
  await flush()
  t.answer('L4', value)
  let got = null
  let thrown = null
  try { got = await first } catch (e) { thrown = e }
  ok(value instanceof Error ? thrown === value : got === value, `${what}: the ask gets it as the transport gave it`)
  const second = c.getEmbed('L4')
  await flush()
  ok(t.calls.length === 2, `${what}: the next ask goes to the server again`, `${t.calls.length} requests`)
  t.answer('L4', READY('L4'))
  ok((await second).ok === true, `${what}: and its ready answer arrives`)
}
{
  // A transport that throws as it is called, not as a rejected promise.
  let calls = 0
  const c = cache({
    getEmbed() { calls++; throw new Error('thrown at once') },
    claim: async () => null,
  })
  let thrown = null
  try { await c.getEmbed('L5') } catch (e) { thrown = e }
  let again = null
  try { await c.getEmbed('L5') } catch (e) { again = e }
  ok(thrown?.message === 'thrown at once' && again?.message === 'thrown at once' && calls === 2,
     'a transport that throws as it is called: the ask rejects with its error, and the next ask calls it again', `${calls} calls`)
}
{
  const t = stand()
  const c = cache(t)
  c.prefetch('L6')
  await flush()
  t.answer('L6', new Error('the prefetch failed'))
  await flush()
  await flush()
  ok(unhandled.length === 0, 'a prefetch whose request throws is forgotten quietly: no unhandled rejection', unhandled.join(' | '))
  c.prefetch('L6')
  await flush()
  ok(t.calls.length === 2, 'and the lesson can be prefetched again', `${t.calls.length} requests`)
  t.answer('L6', { ok: false, kind: 'not-recorded' })
}

console.log(`\n=== at most ${EMBED_CACHE_SIZE} lessons kept, the oldest dropped ===`)
{
  ok(EMBED_CACHE_SIZE === 40, 'the cap is 40', `${EMBED_CACHE_SIZE}`)
  const t = stand()
  const c = cache(t)
  for (let n = 1; n <= EMBED_CACHE_SIZE + 1; n++) {
    const id = `K${n}`
    const p = c.getEmbed(id)
    await flush()
    t.answer(id, READY(id))
    await p
  }
  const before = t.calls.length
  const second = c.getEmbed('K2')
  const last = c.getEmbed(`K${EMBED_CACHE_SIZE + 1}`)
  await flush()
  ok(t.calls.length === before, `the 2nd and the ${EMBED_CACHE_SIZE + 1}st are still kept`, `${t.calls.length - before} new requests`)
  await Promise.all([second, last])
  const first = c.getEmbed('K1')
  await flush()
  ok(t.calls.length === before + 1 && t.calls.at(-1) === 'K1', `the 1st, the oldest, was dropped when the ${EMBED_CACHE_SIZE + 1}st was kept: asked again`, `${t.calls.length - before} new request`)
  t.answer('K1', READY('K1'))
  await first
}

console.log(`\n=== at most ${PREFETCH_IN_FLIGHT} prefetches on their way ===`)
{
  ok(PREFETCH_IN_FLIGHT === 3, 'the limit is 3', `${PREFETCH_IN_FLIGHT}`)
  const t = stand()
  const c = cache(t)
  for (const id of ['P1', 'P2', 'P3', 'P4']) c.prefetch(id)
  await flush()
  ok(t.calls.join() === 'P1,P2,P3', 'four prefetches while none has answered: three requests, the fourth skipped', t.calls.join())
  const click = c.getEmbed('P5')
  await flush()
  ok(t.calls.at(-1) === 'P5', 'a click is never held back by the limit')
  t.answer('P1', READY('P1'))
  t.answer('P2', READY('P2'))
  t.answer('P3', READY('P3'))
  t.answer('P5', READY('P5'))
  await click
  await flush()
  ok(!t.calls.includes('P4'), 'the skipped one was skipped, never queued: nothing asks for it once the others answer', t.calls.join())
  c.prefetch('P4')
  await flush()
  ok(t.calls.at(-1) === 'P4', 'with the three answered, a new prefetch goes', t.calls.join())
  t.answer('P4', { ok: false, kind: 'error' })
  await flush()
  for (const id of ['Q1', 'Q2', 'Q3']) c.prefetch(id)
  await flush()
  ok(t.calls.slice(-3).join() === 'Q1,Q2,Q3', 'a failed prefetch frees its place too', t.calls.slice(-3).join())
  for (const id of ['Q1', 'Q2', 'Q3']) t.answer(id, READY(id))
}

console.log('\n=== everything else passes straight through ===')
{
  const t = stand()
  const c = cache(t)
  ok(c.heartbeat === t.heartbeat, 'the heartbeat is the transport\'s own function')
  const answer = await c.claim('L7')
  ok(answer.completed === true && answer.reason === 'claimed L7', 'the claim goes to the transport with the lesson, called on the transport, and its answer comes back as it is', JSON.stringify(answer))
  const none = withEmbedCache({ getEmbed: async () => READY('x'), claim: async () => null })
  ok(none.heartbeat === undefined, 'a transport with no heartbeat still has none (undefined = the real RPC)')
  ok((await none.claim('L8')) === null, 'a claim that failed (null) comes back null')
  ok(t.calls.length === 0, 'neither asks for an address')
}

/** A cache with L1 kept ready under student S1, and the stand-in under it. `clock` moves the cache's time. */
async function keptOne() {
  const t = stand()
  const clock = { ms: 1_000_000 }
  const c = cache(t, { now: () => clock.ms })
  const p = c.getEmbed('L1')
  await flush()
  t.answer('L1', READY('L1'))
  await p
  await c.getEmbed('L1')
  return { t, c, clock }
}
/** Ask for L1 again: whether it went to the server, and what came back. */
async function askAgain({ t, c }, value = READY('L1')) {
  const before = t.calls.length
  const p = c.getEmbed('L1')
  await flush()
  const asked = t.calls.length - before
  if (asked) t.answer('L1', value)
  return { asked, answer: await p }
}

console.log('\n=== a kept address never outlives the right to it ===')
{
  const s = await keptOne()
  ok(s.t.calls.length === 1, 'set up: L1 is kept for S1 (asked twice, one request)', `${s.t.calls.length} requests`)
  s.c.setAccess('S1', true)
  ok((await askAgain(s)).asked === 0, 'told the same student and membership again: nothing is emptied')
}
{
  const s = await keptOne()
  s.c.setAccess('S2', true)
  ok((await askAgain(s)).asked === 1, '(a) another student signs in: the cache is emptied and the next ask goes to the server')
}
{
  const s = await keptOne()
  s.c.setAccess(null, false)
  const again = await askAgain(s, { ok: false, kind: 'error', message: 'Not signed in.' })
  ok(again.asked === 1 && again.answer.ok === false, '(a) the student signs out: emptied, the next ask goes to the server (and is refused there)')
}
for (const status of ['canceled', 'past_due', 'expired']) {
  const s = await keptOne()
  // useLessonTransport.ts: active is membership_status === "active".
  s.c.setAccess('S1', status === 'active')
  const again = await askAgain(s, { ok: false, kind: 'blocked' })
  ok(again.asked === 1 && again.answer.kind === 'blocked', `(b) the membership turns ${status}: emptied, the next ask goes to the server`)
}
{
  const s = await keptOne()
  s.clock.ms += EMBED_MAX_AGE_MS - 1000
  ok((await askAgain(s)).asked === 0, '(c) at 29 min 59 s the address is still kept')
  s.clock.ms += 2000
  ok((await askAgain(s)).asked === 1, '(c) past 30 minutes: emptied, the next ask goes to the server')
  ok((await askAgain(s)).asked === 0, '(c) and the new answer is kept again')
  ok(EMBED_MAX_AGE_MS === 30 * 60 * 1000, 'the age limit is 30 minutes', `${EMBED_MAX_AGE_MS} ms`)
}
{
  // Two lessons, kept 20 minutes apart: when the older passes 30 minutes, both go.
  const t = stand()
  const clock = { ms: 0 }
  const c = cache(t, { now: () => clock.ms })
  for (const id of ['A', 'B']) {
    const p = c.getEmbed(id)
    await flush()
    t.answer(id, READY(id))
    await p
    clock.ms += 20 * 60 * 1000
  }
  // A is 40 minutes old, B 20.
  const before = t.calls.length
  const b = c.getEmbed('B')
  await flush()
  ok(t.calls.length === before + 1, '(c) the whole cache is emptied, not only the old entry: B (20 minutes old) is asked for again too', `${t.calls.length - before} new request`)
  t.answer('B', READY('B'))
  await b
}

console.log('\n=== while the membership is not active ===')
{
  const t = stand()
  const c = withEmbedCache(t)
  c.prefetch('N1')
  await flush()
  ok(t.calls.length === 0, 'a new cache, before it is told who is signed in, prefetches nothing')
  c.setAccess('S1', false)
  for (const id of ['N1', 'N2', 'N3']) c.prefetch(id)
  await flush()
  ok(t.calls.length === 0, 'told the membership is not active: three prefetches ask for nothing', `${t.calls.length} requests`)
  const click = c.getEmbed('N1')
  await flush()
  ok(t.calls.length === 1, 'a click still asks the server, which is the one that says "blocked"')
  t.answer('N1', READY('N1'))
  await click
  const again = c.getEmbed('N1')
  await flush()
  ok(t.calls.length === 2, 'and even a ready answer is not kept while it is not active', `${t.calls.length} requests`)
  t.answer('N1', READY('N1'))
  await again
  c.setAccess('S1', true)
  c.prefetch('N2')
  await flush()
  ok(t.calls.at(-1) === 'N2', 'active again: prefetching starts again')
  t.answer('N2', READY('N2'))
}
{
  // An answer on its way when the access changes is never kept.
  const t = stand()
  const c = cache(t)
  c.prefetch('W1')
  await flush()
  c.setAccess('S2', true)
  t.answer('W1', READY('W1'))
  await flush()
  await flush()
  const p = c.getEmbed('W1')
  await flush()
  ok(t.calls.length === 2, 'a prefetch on its way when the student changes: its answer is not kept, the next ask goes to the server', `${t.calls.length} requests`)
  t.answer('W1', READY('W1'))
  await p
}

await flush()
ok(unhandled.length === 0, 'no unhandled rejection anywhere in the run', unhandled.join(' | '))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
