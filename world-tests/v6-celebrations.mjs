/**
 * The map's two moments (2026-10-14; the streak's made quiet on 2026-10-15),
 * walked in a real browser: the streak's moment on the number in the header's
 * pill, and the discount-approved celebration
 * (src/components/world/WorldCelebrations.tsx: useStreakMoment and
 * WorldCelebrations; the rules in src/lib/world/celebrations.ts; the moment's
 * look in WorldCorner.tsx and corner.module.css).
 *
 *   node world-tests/v6-celebrations.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-hud.mjs: a pretend student, no login, no server call. ?celebrate=1 lets
 * the triggers fire (the pretend student stands in for the signed-in one they
 * need); ?hud= sets the streak, ?discount=approved an approved application,
 * window.__fixture.setStreak(n) the streak going up as a refresh after a
 * finished video would. Headless Chrome on the real GPU, 1691x1278 unless a
 * row says otherwise. About two minutes.
 *
 * Since 2026-10-15 the streak opens no full-screen moment (Lovro: a daily
 * tick is routine). The number in the pill gets a moment of 600 ms at most
 * instead: it rises into place, sand while the moment lasts, then ink. The
 * dev page decides as soon as it hydrates, before the map is ready, so every
 * page carries a recorder from its first byte (RECORD): a MutationObserver
 * that notes, with the time, each start and end of the number's moment (the
 * number, its animation, its colour, where it sits) and each dialog that
 * opens or closes. The rows read that record. Since 2026-10-16 every moment
 * must start where a person can see it: the pill's segment visible, the map's
 * loading screen gone (its opacity under 0.05), no telescope up, and the
 * number's centre the top of the page there, on the screen. The recorder
 * notes those four at each start, and every row that checks a moment checks
 * them.
 *
 * One PASS or FAIL line per row, with what was measured. After the rows, one
 * MEASURED line: requests to /api, requests to Supabase and page errors over
 * every page the run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  a 4-day streak never celebrated in this browser: no full-screen
 *      moment; the number gets its moment once, on 4, once the loading
 *      screen has gone (the rise, 600 ms at most, in sand), then ink; read
 *      out; the browser key says 4; a reload does not bring it back
 *   2  the streak goes up while the map is open (4 to 5): the number changes
 *      to 5 with its moment, once, over in 600 ms (700 with the browser's
 *      timer); read out "Streak: 5 days."; the key says 5; the same 5 again
 *      does not
 *   3  a streak already celebrated on the dashboard (its key already 4): no
 *      moment on the map
 *   4  an approved application never celebrated here: the discount one, its
 *      key set to the request; a reload does not bring it back; one already
 *      celebrated on the dashboard (the key already set) does not show
 *   5  both at once: the discount's celebration first, the number's moment
 *      only once it has closed (one at a time, as before)
 *   6  without ?celebrate=1 (no signed-in student): neither fires, nothing
 *      is written
 *   7  the dashboard's test events: et:test:streak plays the number's moment
 *      (on the number shown, no full-screen moment), et:test:discount-approved
 *      the discount's celebration; neither records anything
 *   8  on a lesson page (the header is hidden there): a streak that goes up
 *      there (a video just finished) opens nothing over the lesson page and
 *      records nothing; back on the map the number gets its moment, once
 *   9  phone (390x844): no full-screen moment; the number's moment stays in
 *      the header's row, inside the pill and the screen
 *  10  reduced motion: the number does not move; it changes at once, sand for
 *      the moment, then ink, at load and when the streak goes up
 *  11  through Creative Strategy's telescope, where the header's group steps
 *      out: a streak that goes up on one of its lessons gets no moment when
 *      the lesson closes back onto the telescope, and nothing is recorded;
 *      once the telescope closes, the number gets its moment, once, in sight
 *  12  phone (390x844), a lesson far down the list: the moment waits under
 *      the place's sheet (over the header) and while the list is scrolled
 *      past the header, records nothing, and plays once the header is back
 *      in view
 *
 * Pictures for a person, in world-tests/shots/v6/celebrations/ (git-ignored).
 * The number's moment lasts 600 ms, so its pictures hold it by hand after the
 * checks: data-tick put back on the streak and the rise paused at 200 ms.
 *   streak-moment.png     the pill during the moment, held (row 2)
 *   streak-after.png      the pill after it, ink (row 2)
 *   discount-map.png      the discount celebration over the map (row 4)
 *   streak-phone.png      the phone's pill during the moment, held (row 9)
 * Row 8 takes no picture: the lesson page shows the dev test video, whose
 * first frame has people's names in it.
 *   streak-reduced.png    reduced motion: the pill during the moment, held, sand and still (row 10)
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'celebrations')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const STREAK_KEY = 'et.streak.lastSeen.fixture-student'
const DISCOUNT_KEY = 'et.discountApproved.lastSeen'
/** The number's moment at its longest (WorldCelebrations.tsx STREAK_MOMENT_MS, Lovro's 600 at most). */
const MOMENT_MS = 600
/** What the browser's timer may add to it on a quiet page; 700 is the brand kit's ceiling for any moment. */
const MOMENT_SLACK_MS = 100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

/**
 * In the page from its first byte (evaluateOnNewDocument): window.__moments,
 * each start ('tick-on') and end ('tick-off') of the number's moment (the
 * streak's segment in the pill carries data-tick while it plays) and each
 * dialog that opens ('dialog-on') or closes ('dialog-off'), with
 * performance.now(). At a start: the number, its animations (name and
 * length), its colour, opacity and transform, and its box beside the pill's.
 */
const RECORD = () => {
  const log = (window.__moments = [])
  const now = () => Math.round(performance.now())
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }
  }
  const tickOf = (seg) => {
    const b = seg.querySelector('b')
    const cs = b ? getComputedStyle(b) : null
    // Whether a person could see it: the segment's own visibility (the telescope hides the group),
    // the map's loading screen (the status line that is a child of <main>), the telescope, and
    // whether the top of the page at the number's centre is its own button (nothing over it, on the screen).
    const main = seg.closest('main')
    const loader = main ? [...main.children].find((el) => el.getAttribute('role') === 'status') : null
    const sr = seg.getBoundingClientRect()
    const top = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2)
    return {
      n: b ? b.textContent : null,
      anims: b ? b.getAnimations().map((a) => ({ name: a.animationName ?? null, ms: a.effect?.getComputedTiming().duration ?? null })) : [],
      color: cs?.color ?? null,
      opacity: cs?.opacity ?? null,
      transform: cs?.transform ?? null,
      box: box(b),
      pill: box(seg.closest('button')?.parentElement),
      vis: getComputedStyle(seg).visibility,
      loader: loader ? Number(getComputedStyle(loader).opacity) : null,
      tel: !!main?.querySelector('[data-tel]'),
      hit: !!top && (seg.closest('button') ?? seg).contains(top),
    }
  }
  const all = (node, sel) => (node instanceof Element ? [...(node.matches(sel) ? [node] : []), ...node.querySelectorAll(sel)] : [])
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') {
        const on = m.target.hasAttribute('data-tick')
        const b = m.target.querySelector('b')
        log.push(on
          ? { kind: 'tick-on', t: now(), path: location.pathname, ...tickOf(m.target) }
          : { kind: 'tick-off', t: now(), path: location.pathname, n: b?.textContent ?? null, color: b ? getComputedStyle(b).color : null })
        continue
      }
      for (const node of m.addedNodes) {
        for (const d of all(node, '[role="dialog"]')) log.push({ kind: 'dialog-on', t: now(), label: d.getAttribute('aria-label'), path: location.pathname })
        for (const seg of all(node, '[data-tick]')) log.push({ kind: 'tick-on', inserted: true, t: now(), path: location.pathname, ...tickOf(seg) })
      }
      for (const node of m.removedNodes) for (const d of all(node, '[role="dialog"]')) log.push({ kind: 'dialog-off', t: now(), label: d.getAttribute('aria-label') })
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tick'] })
}

/** What is up now, what the pill's number shows, and what the browser has recorded. */
const SNAP = ([streakKey, discountKey]) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  // The old full-screen streak moment, should it ever come back.
  const streak = document.querySelector('[role="dialog"][aria-label$="day streak"]')
  const discount = document.querySelector('[role="dialog"][aria-label="30% discount approved"]')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const pill = document.querySelector('main header button[aria-expanded]')
  const seg = pill?.querySelector(':scope > span')
  const num = seg?.querySelector('b')
  const countNum = pill?.querySelectorAll(':scope > span')[2]?.querySelector('b')
  // The sand of the moment, read off the map's token (the accent is still Lovro's to pick).
  let sand = null
  const header = document.querySelector('main header')
  if (header) {
    const probe = document.createElement('i')
    probe.style.color = 'var(--color-accent-strong)'
    header.appendChild(probe)
    sand = getComputedStyle(probe).color
    probe.remove()
  }
  let keys = null
  try {
    keys = { streak: localStorage.getItem(streakKey), discount: localStorage.getItem(discountKey) }
  } catch {
    keys = null
  }
  return {
    fullScreen: streak ? { label: streak.getAttribute('aria-label'), box: box(streak) } : null,
    discount: discount ? { text: norm(discount.textContent), box: box(discount), z: getComputedStyle(discount).zIndex } : null,
    pill: pill ? norm(pill.innerText) : null,
    number: num ? { text: num.textContent, color: getComputedStyle(num).color, ticking: seg.hasAttribute('data-tick') } : null,
    ink: countNum ? getComputedStyle(countNum).color : null,
    sand,
    // The header's status lines: the toast's, then the streak's.
    say: [...document.querySelectorAll('main header [role="status"]')].map((s) => norm(s.textContent))[1] ?? null,
    keys,
    path: location.pathname,
  }
}
const snap = (page) => page.evaluate(SNAP, [STREAK_KEY, DISCOUNT_KEY])
const record = (page) => page.evaluate(() => window.__moments ?? [])
const forget = (page) => page.evaluate(() => { if (window.__moments) window.__moments.length = 0 })
const starts = (log) => log.filter((e) => e.kind === 'tick-on')
const dialogs = (log) => log.filter((e) => e.kind === 'dialog-on')
const ended = () => (window.__moments ?? []).some((e) => e.kind === 'tick-off')
/** A start a person could see: the pill's segment visible, no loading screen over it (opacity under 0.05), no telescope up, and the number's centre the top of the page, on the screen. */
const inSight = (e) => e.vis === 'visible' && (e.loader === null || e.loader < 0.05) && e.tel === false && e.hit === true
/** One start, on `n`, in sight: the rise (one animation, tickIn, 600 ms at most), in the token's sand. */
const rose = (on, n, sand) => on.length === 1 && on[0].n === n && inSight(on[0]) && on[0].anims.length === 1 && /tickIn/.test(on[0].anims[0].name ?? '') && on[0].anims[0].ms > 0 && on[0].anims[0].ms <= MOMENT_MS && on[0].color === sand

/** Hold the moment by hand for a picture, after the checks: data-tick back on, the rise paused at `ms`. */
async function holdMoment(page, ms) {
  await page.evaluate((ms) => {
    const seg = document.querySelector('main header button[aria-expanded] > span')
    seg.setAttribute('data-tick', '')
    const a = seg.querySelector('b').getAnimations()[0]
    if (a) {
      a.pause()
      a.currentTime = ms
    }
  }, ms)
  await sleep(150)
}
const letGo = (page) => page.evaluate(() => document.querySelector('main header button[aria-expanded] > span')?.removeAttribute('data-tick'))

/** The pill and its surroundings, clipped (captureBeyondViewport off: _practices/headless-chrome.md). */
async function pillShot(page, file, vw) {
  const clip = await page.evaluate(() => {
    const r = document.querySelector('main header button[aria-expanded]').parentElement.getBoundingClientRect()
    const x = Math.max(0, Math.floor(r.left - 24))
    return { x, y: 0, width: Math.min(innerWidth - x, Math.ceil(r.width + 48)), height: Math.ceil(r.bottom + 20) }
  })
  if (clip.width > 0 && clip.width <= vw) await page.screenshot({ path: path.join(OUT, file), clip, captureBeyondViewport: false })
}

async function waitFor(page, fn, { arg, timeout = 10000, poll = 120, what }) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch {
      // A navigation in flight drops the context: look again.
    }
    if (Date.now() - t0 > timeout) throw new Error(`${what} (waited ${timeout} ms)`)
    await sleep(poll)
  }
}

const discountUp = () => !!document.querySelector('[role="dialog"][aria-label="30% discount approved"]')
const noneUp = () => !document.querySelector('[role="dialog"][aria-label$="day streak"]') && !document.querySelector('[role="dialog"][aria-label="30% discount approved"]')

async function openPage(ctx, row, urlPath, { viewport = DESKTOP, before = null, reduced = false } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.evaluateOnNewDocument(RECORD)
  page.on('pageerror', (e) => {
    const rec = { row: row.id, message: `${String(e.message).slice(0, 240)}` }
    row.pageErrors.push(rec)
    tally.pageErrors.push(rec)
  })
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) tally.api.push({ row: row.id, path: u.pathname })
    if (/supabase/i.test(u.hostname)) tally.supabase.push({ row: row.id, host: u.hostname, path: u.pathname })
  })
  // What a browser already holds before the page loads (the dashboard's keys).
  if (before) await page.evaluateOnNewDocument((entries) => {
    try {
      for (const [k, v] of entries) localStorage.setItem(k, v)
    } catch {
      // A page whose storage is off: nothing to seed.
    }
  }, before)
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  const phone = viewport.width < 760
  const lesson = /\/a\d\/a\dl\d\d/.test(urlPath)
  await waitFor(page, lesson
    ? () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main'))
    : phone
      ? () => document.querySelector('main[data-view="list"] header button[aria-expanded]') !== null
      : () => window.__worldReady === true, {
    timeout: READY_MS,
    poll: 400,
    what: `${urlPath}: the page was not ready`,
  })
  await sleep(900)
  return page
}

/** Close a celebration the way a person does: a click anywhere. */
async function dismiss(page, what) {
  await page.mouse.click(400, 400)
  await waitFor(page, noneUp, { timeout: 4000, what: `${what}: the celebration did not close on a click` })
  await sleep(300)
}

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, o = {}) => openPage(ctx, row, url(params, o.sub ?? ''), o),
    check: (what, ok, value) => {
      row.checks.push({ what, ok: !!ok, value })
      if (!ok) row.pass = false
    },
  }
  const t0 = Date.now()
  try {
    await body(r)
  } catch (e) {
    row.pass = false
    row.error = String(e?.message ?? e).slice(0, 300)
  } finally {
    await ctx.close().catch(() => {})
  }
  if (row.pageErrors.length) {
    row.pass = false
    row.checks.push({ what: 'no page error', ok: false, value: row.pageErrors.slice(0, 2) })
  }
  row.ms = Date.now() - t0
  results.push(row)
  console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${id}. ${name}  (${(row.ms / 1000).toFixed(1)} s)`)
  for (const c of row.checks) if (!c.ok || process.env.VERBOSE) console.log(`        ${c.ok ? 'ok  ' : 'NOT '} ${c.what}: ${show(c.value)}`)
  if (row.error) console.log(`        error: ${row.error}`)
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

try {
  await runRow(1, 'a 4-day streak never celebrated here: no full-screen moment; the number gets its moment once, on 4; recorded; not after a reload', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' })
    await waitFor(page, ended, { timeout: 8000, what: 'row 1: the number had no moment' })
    let log = await record(page)
    let s = await snap(page)
    const on = starts(log)
    r.check('no full-screen moment: no dialog opened at all', dialogs(log).length === 0 && s.fullScreen === null, dialogs(log))
    r.check('the number got one moment, on 4, in sight (the loading screen gone): the rise (one animation, 600 ms at most), in sand', rose(on, '4', s.sand), { on, sand: s.sand })
    r.check('then the moment is over: the pill says 4 days, the number in ink', s.number?.text === '4' && !s.number.ticking && s.number.color === s.ink && s.ink !== s.sand && /^4 days 4\/10$/i.test(s.pill ?? ''), { number: s.number, ink: s.ink, pill: s.pill })
    r.check('read out: "Streak: 4 days."', s.say === 'Streak: 4 days.', s.say)
    r.check('the browser key (the dashboard\'s) says 4', s.keys?.streak === '4', s.keys)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 400, what: 'row 1: the map did not come back after the reload' })
    await sleep(2000)
    log = await record(page)
    s = await snap(page)
    r.check('after a reload: no moment, no dialog, the key still 4', starts(log).length === 0 && dialogs(log).length === 0 && s.keys?.streak === '4', { log, keys: s.keys })
  })

  await runRow(2, 'the streak goes up while the map is open (4 to 5): the number changes with its moment, once, over in 600 ms; not again for the same 5', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' })
    await waitFor(page, ended, { timeout: 8000, what: 'row 2: no moment for 4 at load' })
    await forget(page)
    const before = await snap(page)
    r.check('before: the pill says 4 days', /^4 days/i.test(before.pill ?? '') && before.number?.text === '4', before.pill)
    await page.evaluate(() => window.__fixture.setStreak(5))
    await waitFor(page, ended, { timeout: 4000, what: 'row 2: no moment for 5' })
    const log = await record(page)
    const s = await snap(page)
    const on = starts(log)
    const off = log.filter((e) => e.kind === 'tick-off')
    const ms = on[0] && off[0] ? off[0].t - on[0].t : null
    r.check('no full-screen moment', dialogs(log).length === 0 && s.fullScreen === null, dialogs(log))
    r.check('5: the number changes with one moment, on 5, in sight: the rise (600 ms at most), in sand', rose(on, '5', s.sand), on)
    r.check(`the moment lasts its 600 ms and no more (${MOMENT_MS + MOMENT_SLACK_MS} with the browser's timer), then ink`, off.length === 1 && ms >= MOMENT_MS - 50 && ms <= MOMENT_MS + MOMENT_SLACK_MS && off[0].color === s.ink && s.number?.color === s.ink, { ms, off, ink: s.ink })
    r.check('the pill says 5 days; read out "Streak: 5 days."; the key says 5', /^5 days 4\/10$/i.test(s.pill ?? '') && s.say === 'Streak: 5 days.' && s.keys?.streak === '5', { pill: s.pill, say: s.say, keys: s.keys })
    await holdMoment(page, 200)
    await pillShot(page, 'streak-moment.png', DESKTOP.width)
    await letGo(page)
    await sleep(150)
    await pillShot(page, 'streak-after.png', DESKTOP.width)
    await forget(page)
    await page.evaluate(() => window.__fixture.setStreak(5))
    await sleep(1500)
    r.check('the same 5 again: nothing', starts(await record(page)).length === 0, await record(page))
  })

  await runRow(3, 'a streak already celebrated on the dashboard: nothing on the map', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' }, { before: [[STREAK_KEY, '4']] })
    await sleep(2000)
    const log = await record(page)
    const s = await snap(page)
    r.check('the key was 4 already: no moment for 4, no dialog, the key still 4', starts(log).length === 0 && dialogs(log).length === 0 && s.keys?.streak === '4', { log, keys: s.keys })
  })

  await runRow(4, 'an approved application: the discount celebration once; one the dashboard already showed does not', async (r) => {
    let page = await r.open({ discount: 'approved', celebrate: '1' })
    await waitFor(page, discountUp, { timeout: 4000, what: 'row 4: no discount celebration' })
    await sleep(1600)
    let s = await snap(page)
    r.check('the discount celebration is up: 30% OFF, Discount approved', /30% OFF/.test(s.discount?.text ?? '') && /Discount approved/i.test(s.discount?.text ?? ''), s.discount?.text)
    r.check('the key holds the request (the dashboard\'s key)', s.keys?.discount === 'fixture-request', s.keys)
    await page.screenshot({ path: path.join(OUT, 'discount-map.png') })
    await dismiss(page, 'row 4')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 400, what: 'row 4: the map did not come back after the reload' })
    await sleep(2000)
    s = await snap(page)
    r.check('after a reload: no celebration', s.discount === null, s.discount)
    await page.close()
    const ctx2 = await browser.createBrowserContext()
    try {
      page = await openPage(ctx2, r.row, url({ discount: 'approved', celebrate: '1' }), { before: [[DISCOUNT_KEY, 'fixture-request']] })
      await sleep(2000)
      s = await snap(page)
      r.check('a browser that celebrated it on the dashboard: nothing', s.discount === null, s.discount)
    } finally {
      await ctx2.close().catch(() => {})
    }
  })

  await runRow(5, "both at once: the discount's celebration first, the number's moment once it has closed", async (r) => {
    const page = await r.open({ hud: 'some', discount: 'approved', celebrate: '1' })
    await waitFor(page, discountUp, { timeout: 4000, what: 'row 5: no discount celebration' })
    await sleep(1200)
    let log = await record(page)
    let s = await snap(page)
    r.check('the discount celebration is up, and under it the number has had no moment, nothing recorded for it', s.discount !== null && starts(log).length === 0 && s.keys?.streak === null, { discount: !!s.discount, log, keys: s.keys })
    await page.mouse.click(400, 400)
    await waitFor(page, ended, { timeout: 5000, what: 'row 5: no moment after the discount closed' })
    log = await record(page)
    s = await snap(page)
    const closed = log.find((e) => e.kind === 'dialog-off' && e.label === '30% discount approved')
    const on = starts(log)
    r.check("then the number's moment, once, on 4, in sight, after the celebration has gone", !!closed && rose(on, '4', s.sand) && on[0].t >= closed.t && s.discount === null, { closed, on })
    r.check('recorded once it played: the key says 4', s.keys?.streak === '4', s.keys)
  })

  await runRow(6, 'without ?celebrate=1 (no signed-in student): neither fires, nothing written', async (r) => {
    const page = await r.open({ hud: 'some', discount: 'approved' })
    await sleep(2500)
    const log = await record(page)
    const s = await snap(page)
    r.check('no moment and no celebration', starts(log).length === 0 && dialogs(log).length === 0 && s.discount === null && s.fullScreen === null, { log, discount: s.discount })
    r.check('nothing written', s.keys?.streak === null && s.keys?.discount === null, s.keys)
  })

  await runRow(7, "the dashboard's test events: the number's moment and the discount's celebration, nothing recorded", async (r) => {
    const page = await r.open({})
    await forget(page)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('et:test:streak', { detail: 12 })))
    await waitFor(page, ended, { timeout: 3000, what: 'row 7: et:test:streak did nothing' })
    let log = await record(page)
    let s = await snap(page)
    r.check('et:test:streak: the number\'s moment, in sight, on the number shown (0; the event\'s 12 is not shown), no full-screen moment', rose(starts(log), '0', s.sand) && dialogs(log).length === 0 && s.fullScreen === null, { log, pill: s.pill })
    await page.evaluate(() => window.dispatchEvent(new Event('et:test:discount-approved')))
    await waitFor(page, discountUp, { timeout: 3000, what: 'row 7: et:test:discount-approved did nothing' })
    await dismiss(page, 'row 7 (discount)')
    s = await snap(page)
    r.check('nothing recorded by either', s.keys?.streak === null && s.keys?.discount === null, s.keys)
  })

  await runRow(8, 'on a lesson page: a streak that goes up there opens nothing over it and records nothing; back on the map the number gets its moment', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' }, { sub: '/a1/a1l01' })
    // The 4 this browser has never seen waits for the map; then the video "finishes".
    await sleep(1500)
    let log = await record(page)
    let s = await snap(page)
    r.check('on the lesson page: no moment, nothing over it', /\/a1\/a1l01$/.test(s.path) && starts(log).length === 0 && dialogs(log).length === 0, { path: s.path, log })
    await page.evaluate(() => window.__fixture.setStreak(5))
    await sleep(1500)
    log = await record(page)
    s = await snap(page)
    const over = await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
      return el ? `${el.tagName}${el.closest('[role="dialog"]') ? ' in a dialog' : ''}` : null
    })
    r.check('the streak goes up there (4 to 5): still no moment and no dialog over the lesson page, the key not written', /\/a1\/a1l01$/.test(s.path) && starts(log).length === 0 && dialogs(log).length === 0 && !/dialog/.test(over ?? '') && s.keys?.streak === null, { log, over, keys: s.keys })
    // No picture of the lesson page: the dev test video's first frame has people's names in it.
    await page.keyboard.press('Escape')
    await waitFor(page, () => location.pathname === '/dev/world-app/a1', { timeout: 10000, what: 'row 8: Esc did not go back to the place' })
    await waitFor(page, ended, { timeout: 6000, what: 'row 8: no moment back on the map' })
    log = await record(page)
    s = await snap(page)
    const on = starts(log)
    r.check('back on the map: one moment, on 5 (the 4 it passed is not played), in sight, on the place\'s page', rose(on, '5', s.sand) && on[0].path === '/dev/world-app/a1', on)
    r.check('recorded once it played: the key says 5, read out "Streak: 5 days."', s.keys?.streak === '5' && s.say === 'Streak: 5 days.', { keys: s.keys, say: s.say })
  })

  await runRow(9, "phone (390x844): no full-screen moment; the number's moment stays in the header's row, inside the pill", async (r) => {
    const page = await r.open({ hud: 'long', celebrate: '1' }, { viewport: PHONE })
    await waitFor(page, ended, { timeout: 8000, what: 'row 9: the number had no moment' })
    const log = await record(page)
    const s = await snap(page)
    const on = starts(log)
    const b = on[0]?.box
    const p = on[0]?.pill
    r.check('no full-screen moment; one moment, on 128, in sight: the rise (600 ms at most), in sand', dialogs(log).length === 0 && s.fullScreen === null && rose(on, '128', s.sand), on)
    r.check("it plays in the header's row, inside the pill (where the rise starts, 6 px low) and inside the screen", !!b && !!p && b.l >= p.l && b.r <= p.r && b.t >= p.t && b.b <= p.b && p.b <= 72 && p.r <= PHONE.width, { number: b, pill: p })
    r.check('nothing runs off the screen sideways', (await page.evaluate(() => document.documentElement.scrollWidth)) <= PHONE.width)
    await holdMoment(page, 200)
    await pillShot(page, 'streak-phone.png', PHONE.width)
    await letGo(page)
  })

  await runRow(10, 'reduced motion: the number does not move; it changes at once, sand for the moment, then ink', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' }, { reduced: true })
    await waitFor(page, ended, { timeout: 8000, what: 'row 10: the number had no moment' })
    let log = await record(page)
    let s = await snap(page)
    const still = (on, n) => on.length === 1 && on[0].n === n && inSight(on[0]) && on[0].anims.length === 0 && on[0].opacity === '1' && on[0].transform === 'none' && on[0].color === s.sand
    r.check('at load, on 4, in sight (the loading screen gone): no animation, in place at full opacity, sand', still(starts(log), '4'), { on: starts(log), sand: s.sand })
    r.check('then ink; the key says 4', s.number?.color === s.ink && !s.number.ticking && s.keys?.streak === '4', { number: s.number, keys: s.keys })
    await forget(page)
    await page.evaluate(() => window.__fixture.setStreak(5))
    await waitFor(page, ended, { timeout: 4000, what: 'row 10: no moment for 5' })
    log = await record(page)
    s = await snap(page)
    const off = log.find((e) => e.kind === 'tick-off')
    const ms = off && starts(log)[0] ? off.t - starts(log)[0].t : null
    r.check(`4 to 5: the same, still and sand, for its 600 ms (${MOMENT_MS + MOMENT_SLACK_MS} with the timer), then ink; no dialog`, still(starts(log), '5') && ms >= MOMENT_MS - 50 && ms <= MOMENT_MS + MOMENT_SLACK_MS && s.number?.color === s.ink && dialogs(log).length === 0, { ms, on: starts(log) })
    r.check('read out "Streak: 5 days."; the key says 5', s.say === 'Streak: 5 days.' && s.keys?.streak === '5', { say: s.say, keys: s.keys })
    await holdMoment(page, 200)
    await pillShot(page, 'streak-reduced.png', DESKTOP.width)
    await letGo(page)
  })

  await runRow(11, "through Creative Strategy's telescope (the group steps out): a streak that goes up on its lesson gets no moment back in the telescope, records nothing, and gets its moment once the telescope closes", async (r) => {
    // The 4 was celebrated here before, so the 5 is the one moment due.
    const page = await r.open({ hud: 'some', celebrate: '1' }, { sub: '/a7', before: [[STREAK_KEY, '4']] })
    const telescope = () => !!document.querySelector('main section[data-tel]') && (window.__worldFrame?.parkProgress ?? 0) >= 0.999
    await waitFor(page, telescope, { timeout: 30000, what: 'row 11: the telescope did not come up' })
    await sleep(600)
    // Into the place's first lesson from its panel, as a student does: the map stays in the telescope under it.
    await page.evaluate(() => document.querySelector('main section[data-tel] button[aria-label^="Lesson 1,"]').click())
    await waitFor(page, () => /\/a7\/a7l\d\d$/.test(location.pathname) && [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), { timeout: 15000, what: 'row 11: the lesson page did not open' })
    await sleep(800)
    // The video "finishes" there: the streak goes up (4 to 5).
    await page.evaluate(() => window.__fixture.setStreak(5))
    await sleep(1200)
    let log = await record(page)
    r.check('on the lesson page: no moment and no dialog', starts(log).length === 0 && dialogs(log).length === 0, log)
    await page.keyboard.press('Escape')
    await waitFor(page, () => location.pathname === '/dev/world-app/a7' && !!document.querySelector('main section[data-tel]'), { timeout: 10000, what: 'row 11: Esc did not close the lesson back onto the telescope' })
    await sleep(3000)
    log = await record(page)
    let s = await snap(page)
    const corner = await page.evaluate(() => getComputedStyle(document.querySelector('main header button[aria-expanded]')).visibility)
    r.check('back in the telescope for 3 s, the group out of sight: no moment, nothing read out, the key still 4', corner === 'hidden' && starts(log).length === 0 && s.say === '' && s.keys?.streak === '4', { corner, log, say: s.say, keys: s.keys })
    // Back to map closes the telescope.
    await page.evaluate(() => [...document.querySelectorAll('main section[data-tel] button')].find((b) => b.textContent.trim() === 'Back to map').click())
    await waitFor(page, ended, { timeout: 15000, what: 'row 11: no moment once the telescope closed' })
    log = await record(page)
    s = await snap(page)
    const on = starts(log)
    r.check('once the telescope has closed: one moment, on 5, in sight (no telescope, the group visible)', rose(on, '5', s.sand) && !/a7l\d\d/.test(on[0].path), on)
    r.check('recorded once it played: the key says 5, read out "Streak: 5 days."', s.keys?.streak === '5' && s.say === 'Streak: 5 days.', { keys: s.keys, say: s.say })
  })

  await runRow(12, "phone (390x844), a lesson far down the list: the moment waits under the place's sheet and while the list is scrolled past the header, then plays once the header is back in view", async (r) => {
    // The 4 was celebrated here before, so the 5 is the one moment due.
    const page = await r.open({ hud: 'some', celebrate: '1' }, { viewport: PHONE, before: [[STREAK_KEY, '4']] })
    const row = () => [...document.querySelectorAll('main ol > li > button')].find((b) => /^Creative Strategy,/.test(b.getAttribute('aria-label') ?? ''))
    // Down the list to Creative Strategy, as a student scrolls, into its sheet and its first lesson.
    await page.evaluate((src) => new Function(`return (${src})()`)().scrollIntoView({ block: 'center' }), row.toString())
    await sleep(400)
    await page.evaluate((src) => new Function(`return (${src})()`)().click(), row.toString())
    await waitFor(page, () => !!document.querySelector('main section[role="dialog"] button[aria-label^="Lesson 1,"]'), { timeout: 8000, what: "row 12: the place's sheet did not open" })
    await sleep(500)
    await page.evaluate(() => document.querySelector('main section[role="dialog"] button[aria-label^="Lesson 1,"]').click())
    await waitFor(page, () => /\/a7\/a7l\d\d$/.test(location.pathname) && [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), { timeout: 15000, what: 'row 12: the lesson page did not open' })
    await sleep(800)
    // The video "finishes" there: the streak goes up (4 to 5).
    await page.evaluate(() => window.__fixture.setStreak(5))
    await sleep(800)
    await page.keyboard.press('Escape')
    await waitFor(page, () => location.pathname === '/dev/world-app/a7' && !!document.querySelector('main section[role="dialog"]'), { timeout: 10000, what: "row 12: Esc did not go back to the place's sheet" })
    await sleep(2500)
    let log = await record(page)
    let s = await snap(page)
    r.check("back on the place's sheet, which covers the header: no moment, the key still 4", starts(log).length === 0 && s.keys?.streak === '4', { log, keys: s.keys })
    // Its "All areas" closes the sheet: the list as the student left it.
    await page.evaluate(() => [...document.querySelectorAll('main section[role="dialog"] button')].find((b) => b.textContent.trim() === 'All areas').click())
    await waitFor(page, () => !document.querySelector('main section[role="dialog"]'), { timeout: 8000, what: 'row 12: the sheet did not close' })
    await sleep(2000)
    log = await record(page)
    s = await snap(page)
    const where = await page.evaluate(() => ({ scrollY: Math.round(scrollY), pillBottom: Math.round(document.querySelector('main header button[aria-expanded]').getBoundingClientRect().bottom) }))
    r.check('the list, scrolled past the header (the pill above the screen): no moment, the key still 4', where.pillBottom <= 0 && starts(log).length === 0 && s.keys?.streak === '4', { where, log, keys: s.keys })
    // Back up to the top, as a student scrolls.
    await page.evaluate(() => window.scrollTo(0, 0))
    await waitFor(page, ended, { timeout: 5000, what: 'row 12: no moment once the header was back in view' })
    log = await record(page)
    s = await snap(page)
    r.check('back at the top: one moment, on 5, in sight; the key says 5; read out "Streak: 5 days."', rose(starts(log), '5', s.sand) && s.keys?.streak === '5' && s.say === 'Streak: 5 days.', { on: starts(log), keys: s.keys, say: s.say })
  })
} finally {
  await browser.close()
}

const failed = results.filter((x) => !x.pass).length
console.log(`\nMEASURED  pages ${tally.pages} · requests to /api ${tally.api.length}${tally.api.length ? ` ${show(tally.api.slice(0, 4))}` : ''} · requests to Supabase ${tally.supabase.length}${tally.supabase.length ? ` ${show(tally.supabase.slice(0, 4))}` : ''} · page errors ${tally.pageErrors.length}${tally.pageErrors.length ? ` ${show(tally.pageErrors.slice(0, 2))}` : ''}`)
const measuredOk = tally.api.length === 0 && tally.supabase.length === 0 && tally.pageErrors.length === 0
console.log(`PASS ${results.length - failed}  FAIL ${failed}${measuredOk ? '' : '  (MEASURED fails)'}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, tally }, null, 1))
process.exit(failed || !measuredOk ? 1 : 0)
