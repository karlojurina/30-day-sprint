/**
 * The discount checkpoint on the map (2026-10-14), walked in a real browser.
 *
 *   node world-tests/v6-discount.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course (row 18:
 * the plain page, the placeholder course), which must already be up (this
 * script never starts a server). The harness of v6-course.mjs: the real
 * stage, map, place route and lesson page, a pretend student, no login, no
 * server call. The student's discount comes from ?discount=<preset>
 * (src/app/dev/world-app/fixtureDiscount.tsx; without it, a first payment 3
 * days ago): the offer's states in memory, Apply resolving in memory.
 * Headless Chrome on the real GPU, 1691x1278 unless a row says otherwise.
 * About 5 minutes.
 *
 * One PASS or FAIL line per row, with what was measured. Every row loads its
 * own page in its own browser context. After the rows, one MEASURED line:
 * requests to /api, requests to Supabase and page errors over every page the
 * run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  locked: the header's chip says 30% off and the days left (11: the
 *      preset's first payment is 3 days old) and carries the offer's state
 *      (2026-10-15: it is a segment of the header's group, and the course bar
 *      with its notch is gone); the timeline has its tag between the 4th and
 *      5th places' diamonds, saying "30% off" and outlined (locked)
 *   2  the checkpoint in the world: from the rail point that frames it the
 *      cache's marker is up as a plaque ("30% off" alone since 2026-10-16: its
 *      "11d" read as "110"), on screen; the cache is closed (no video watched,
 *      not at Video Ads II)
 *   3  the marker opens the panel (a real mouse click on the plaque): the
 *      camera parks at the cache, the panel says the deadline, how many
 *      videos to watch, the videos watched and left (no time estimate and no
 *      Watch row since Lovro's review of 2026-10-15), and shows Apply greyed
 *      out: aria-disabled, still in the keyboard's path, no fill, its reason
 *      ("Watch all 59 videos to apply") its title and its description in the
 *      accessibility tree
 *   4  Esc comes home: the panel goes, the camera is back on the rail where it
 *      was, the page scrolls again
 *   5  the timeline's tag opens the panel (and names the offer and its days
 *      left on hover, the tip clear above the tag)
 *   6  the header's chip opens the panel from the opening frame, far from the
 *      cache: the scroll jumps to the rail point that frames it, the camera
 *      parks; Esc leaves it on the trail in front of the cache
 *   7  locked, Apply takes nothing: a real mouse click, Tab to it then
 *      Enter, and Space open no questions, send nothing (no application, no
 *      plain request) and leave the panel open and the camera parked;
 *      hovered, it stays unfilled
 *   8  ready: the chip says to apply, the cache is ready, Apply is on (no
 *      aria-disabled, no reason, filled) and opens the
 *      application's questions (2026-10-14: WorldDiscountForm.tsx, the six
 *      the stand-in serves); answered and sent (in memory), the form closes,
 *      the panel turns to "in review", the chip too, the cache is claimed
 *   9  pending and approved say so; a student in Video Ads II (locked, ?p=mid)
 *      sees the cache's lantern lit (near)
 *  10  closed for the student (expired, before the new course, no first
 *      payment on record): since Lovro's second Loom (2026-10-16, "clickable
 *      at all times") the chip, the tag and the marker show, grey, and the
 *      chip opens the panel, which says why in one line, "Closed" in its
 *      eyebrow, and has no Apply; with no first payment (his case) the marker
 *      is a plaque in the world, "30% off Closed", and a real click on it
 *      opens the panel
 *  11  the questions one at a time: "1 of 6", a required one holds Next
 *      until it is answered, an optional one says so and can be left, Back
 *      keeps what was chosen; the answers sent are exactly the ones given
 *  12  leaving it: Esc, Cancel and a click on the world beside it each close
 *      the form with nothing sent and the checkpoint still open; opened again
 *      it starts on question 1
 *  13  refused (?questions=fail): the form stays on the last question, says
 *      why, keeps the answers; nothing is in review
 *  14  no active questions (?questions=none): Apply sends the plain request
 *      at once, as before the questions, and no form opens
 *  15  phone (390x844): the chip opens the checkpoint, Apply opens the form as
 *      a full sheet, the numbers in two rows of five, every target at least
 *      40 px; sent, the checkpoint says in review
 *  16  applied (?discount=applied): the chip and the plaque say "Yours", the
 *      tag is done, the cache claimed; the panel says it is on the Whop
 *      subscription, no Apply
 *  17  rejected (?discount=rejected): the chip says "Not approved", the tag
 *      is closed; the panel says the team did not approve it, gives the
 *      team's reason and where to ask, no Apply
 *  18  the plain page, as Lovro reviewed it in his second Loom (the
 *      placeholder course, no ?discount): the pretend student paid 3 days ago,
 *      so the chip, the tag and the marker show; the marker opens the panel,
 *      Apply greyed; the offer's videos marked watched (the three the dev
 *      videos give), it turns ready and Apply is on
 *  19  phone (390x844): the 30% is a row under Video Ads II's, in the same
 *      list item (the eight places keep their rows), there locked and closed,
 *      at least 40 px tall, saying where it stands; it opens the checkpoint's
 *      sheet
 *  20  the approved celebration on a 360 px phone: "30% OFF" on one line,
 *      inside the screen; it says how to close it ("Tap anywhere to close"
 *      with touch, "Click anywhere or press Esc to close" without); Esc
 *      closes it and the checkpoint open under it stays open; under
 *      prefers-reduced-motion its "30% OFF" never springs (scale 1 on every
 *      frame), where without it the spring starts small
 *
 * Pictures for a person, in world-tests/shots/v6/discount/ (git-ignored):
 *   world-passing.png     the cache from the passing camera (row 2)
 *   marker-label.png      the marker's plaque, cropped (row 2)
 *   panel-locked.png      the panel, locked, parked at the cache (row 3)
 *   timeline-tag.png      the timeline round the tag, its tip up (row 5)
 *   header-chip.png       the header's right end: the group with the chip in it (row 1)
 *   panel-ready.png       the panel, ready, before Apply (row 8)
 *   form-map.png          the questions on the map, 1691x1278, a number picked (row 8)
 *   panel-pending.png     the panel after the questions went in (row 8)
 *   world-ready.png       the cache ready, from the passing camera (row 8)
 *   form-choice.png       a choice question, one chosen (row 11)
 *   form-text.png         an optional text question, typed in (row 11)
 *   form-refused.png      the last question with the refusal (row 13)
 *   form-phone.png        the questions as a phone's sheet, 390x844 (row 15)
 *   form-phone-choice.png a choice question on the phone (row 15)
 *   panel-phone-pending.png the phone's checkpoint after sending (row 15)
 *   panel-<preset>.png    the panel, closed: expired, before-launch,
 *                         no-payment (row 10); applied, rejected (rows 16, 17)
 *   world-closed.png      the closed plaque in the world, no first payment (row 10)
 *   plain-world.png       the plain page at the cache, the plaque up (row 18)
 *   plain-ready.png       the plain page's panel once its videos are watched (row 18)
 *   phone-row-<preset>.png the phone's row under Video Ads II (row 19)
 *   phone-sheet-<preset>.png its sheet (row 19)
 *   celebration-360.png   the approved celebration on a 360 px phone (row 20)
 *
 * What a row reads:
 *   hooks      window.__worldReady, __worldFrame, __worldScrollFor(depth),
 *              __worldCheckpoint() (shown, look, open, mode, marker, panel,
 *              depth: the rail depth that frames the cache), __worldPark,
 *              window.__fixtureDiscount.requests()
 *   the chip   main header button[aria-label*="discount checkpoint"]; its
 *              state: main header [data-cp] (the chip's data-cp)
 *   the tag    main nav[aria-label="Places"] button[data-gate="discount"] (its own:
 *              the Ad Bounty's tag is a checkpoint's too since item 18); the places'
 *              diamonds: nav[aria-label="Places"] > div > button:not([data-cp])
 *   the marker main button[data-mode][data-cp], its plaque = last child
 *   the panel  main section[aria-labelledby="cp-panel-title"], #cp-panel-title
 *   the form   [data-discount-form] [role="dialog"] (beside main, not in it),
 *              its h2 (the question), its buttons and labels by their words;
 *              window.__fixtureDiscount.answers() and .plain()
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'discount')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const PARK_MS = 30000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

// ── In the page ─────────────────────────────────────────────────────────────

const FIND = {
  chip: () => document.querySelector('main header button[aria-label*="discount checkpoint"]'),
  chipState: () => document.querySelector('main header [data-cp]'),
  tag: () => document.querySelector('main nav[aria-label="Places"] button[data-gate="discount"]'),
  marker: () => document.querySelector('main button[data-mode][data-cp]'),
  panel: () => document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
  apply: () => [...(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.querySelectorAll('button') ?? [])].find((b) => /^(Apply for|Sending)/.test(b.textContent.trim())) ?? null,
  watch: () => document.querySelector('main section[aria-labelledby="cp-panel-title"] button[aria-label^="Watch "]'),
}

/** The panel's Apply as a person meets it: greyed out or on, its reason, where the focus is (rows 3, 7, 8). */
const APPLY = () => {
  const b = [...(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.querySelectorAll('button') ?? [])].find((x) => /^(Apply for|Sending)/.test(x.textContent.trim()))
  if (!b) return null
  const cs = getComputedStyle(b)
  return {
    text: b.textContent.replace(/\s+/g, ' ').trim(),
    ariaDisabled: b.getAttribute('aria-disabled'),
    disabled: b.disabled,
    tabIndex: b.tabIndex,
    title: b.getAttribute('title'),
    filled: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent',
    cursor: cs.cursor,
    focused: document.activeElement === b,
  }
}

/** The panel's eyebrow, part by part: "Checkpoint", "after Video Ads II", then the state's word when it has one (rows 10, 16, 17). */
const EYEBROW = () => {
  const p = document.getElementById('cp-panel-title')?.previousElementSibling
  return p ? [...p.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean) : null
}

/** What a press on the locked Apply could have set off (row 7). */
const UNMOVED = () => ({
  form: !!document.querySelector('[data-discount-form]'),
  requests: window.__fixtureDiscount?.requests().length ?? null,
  plain: window.__fixtureDiscount?.plain() ?? null,
  answers: window.__fixtureDiscount?.answers().length ?? null,
  panel: !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
  parked: window.__worldFrame?.parkedId === 'checkpoint' && window.__worldFrame.parkProgress >= 0.999,
  sending: /Sending/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''),
  path: location.pathname,
})
/** Nothing came of it: no questions, no application, no plain request, the panel open and parked, the page where it was. */
const unmoved = (u, at) => !!u && !u.form && u.requests === 0 && u.plain === 0 && u.answers === 0 && u.panel && u.parked && !u.sending && u.path === at

/** The Apply's node in the accessibility tree: what a screen reader is told (row 3). */
async function applyAx(page) {
  const h = await page.evaluateHandle(FIND.apply)
  const el = h.asElement()
  const ax = el ? await page.accessibility.snapshot({ root: el, interestingOnly: false }) : null
  await h.dispose()
  return ax ? { role: ax.role, name: ax.name, disabled: ax.disabled === true, description: ax.description ?? null } : null
}

/** What the map shows of the discount right now. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const chip = document.querySelector('main header button[aria-label*="discount checkpoint"]')
  const tag = document.querySelector('main nav[aria-label="Places"] button[data-gate="discount"]')
  const stops = [...document.querySelectorAll('main nav[aria-label="Places"] > div > button:not([data-cp])')]
  const marker = document.querySelector('main button[data-mode][data-cp]')
  const panel = document.querySelector('main section[aria-labelledby="cp-panel-title"]')
  const cp = window.__worldCheckpoint?.() ?? null
  const fr = window.__worldFrame ?? null
  return {
    path: location.pathname,
    y: Math.round(scrollY),
    locked: document.body.style.overflow === 'hidden',
    chip: chip ? { text: norm(chip.textContent), box: box(chip) } : null,
    chipState: document.querySelector('main header [data-cp]')?.getAttribute('data-cp') ?? null,
    tag: tag ? { state: tag.dataset.cp, box: box(tag), label: tag.getAttribute('aria-label'), text: norm(tag.textContent) } : null,
    stops: stops.map((b) => box(b)),
    marker: marker ? { mode: marker.dataset.mode, state: marker.dataset.cp, label: norm(marker.lastElementChild?.textContent), box: box(marker.lastElementChild) } : null,
    panel: panel ? { title: norm(panel.querySelector('#cp-panel-title')?.textContent), text: norm(panel.textContent), box: box(panel), opacity: Number(getComputedStyle(panel).opacity) } : null,
    cp,
    park: fr ? { id: fr.parkedId, p: fr.parkProgress, depth: fr.depth } : null,
    requests: window.__fixtureDiscount?.requests() ?? null,
  }
}

// ── Driving ─────────────────────────────────────────────────────────────────

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

async function openPage(ctx, row, urlPath) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 })
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
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) {
      row.api.push(u.pathname)
      tally.api.push({ row: row.id, path: u.pathname })
    }
    if (/supabase/i.test(u.hostname)) {
      row.api.push(u.hostname)
      tally.supabase.push({ row: row.id, host: u.hostname, path: u.pathname })
    }
  })
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  await waitFor(page, () => window.__worldReady === true && !!window.__worldCheckpoint, { timeout: READY_MS, poll: 400, what: `${urlPath}: the map was not ready` })
  await sleep(900)
  return page
}

/** A phone: the list view, which loads no 3D, so there is no __worldReady to wait on. */
async function openPhone(ctx, row, urlPath) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...PHONE, deviceScaleFactor: 1 })
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
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  await waitFor(page, () => document.querySelector('main[data-view="list"] header button[aria-label*="discount checkpoint"]') !== null, { timeout: READY_MS, poll: 400, what: `${urlPath}: the phone's map was not ready` })
  await sleep(900)
  return page
}

// ── The questions' form ─────────────────────────────────────────────────────

/** What the form shows right now. */
const FORM = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const root = document.querySelector('[data-discount-form]')
  const box = root?.querySelector('[role="dialog"]')
  if (!box) return null
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const buttons = [...box.querySelectorAll('button')].map((b) => ({ text: norm(b.textContent), disabled: b.disabled, busy: b.getAttribute('aria-busy'), h: Math.round(b.getBoundingClientRect().height) }))
  const h2 = box.querySelector('h2')
  const radios = [...box.querySelectorAll('input[type="radio"]')]
  const labels = [...box.querySelectorAll('label')]
  return {
    sheet: root.hasAttribute('data-sheet'),
    box: rect(box),
    // The counter is the first "N of M" in the form (the eyebrow before it says "30% off").
    count: /(\d+) of (\d+)/.exec(norm(box.textContent))?.slice(1, 3).join(' of ') ?? null,
    question: norm(h2?.textContent).replace(/^Question \d+ of \d+\. /, ''),
    optional: /Optional$/.test(norm(h2?.textContent)),
    kind: box.querySelector('textarea') ? 'text' : radios.length ? (labels[0] && /^\d+$/.test(norm(labels[0].textContent)) ? 'scale' : 'choice') : 'none',
    checked: radios.find((r) => r.checked)?.value ?? null,
    text: box.querySelector('textarea')?.value ?? null,
    labels: labels.map((l) => ({ text: norm(l.textContent), box: rect(l) })),
    buttons,
    error: norm(box.querySelector('[role="alert"]')?.textContent) || null,
    focusInside: box.contains(document.activeElement),
    focus: document.activeElement?.tagName ?? null,
  }
}

/** Press a button or a label in the form by its words, with the mouse when it is on top. */
async function pick(page, text, what) {
  const via = await page.evaluate((t) => {
    const box = document.querySelector('[data-discount-form] [role="dialog"]')
    if (!box) return null
    const el = [...box.querySelectorAll('button, label')].find((e) => e.textContent.replace(/\s+/g, ' ').trim() === t)
    if (!el) return null
    el.scrollIntoView({ block: 'nearest' })
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = document.elementFromPoint(x, y)
    if (top && (top === el || el.contains(top))) return { mouse: true, x, y }
    el.click()
    return { mouse: false }
  }, text)
  if (!via) throw new Error(`${what}: "${text}" is not in the form`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  await sleep(120)
  return via.mouse ? 'mouse' : 'dom click'
}

/** Open the checkpoint (parked) and press Apply: the form opens on question 1. */
async function openForm(page, what) {
  await page.evaluate(() => window.__worldPark('checkpoint'))
  await parked(page, what)
  await click(page, FIND.apply, `${what}: Apply`)
  await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="dialog"]'), { timeout: 5000, what: `${what}: Apply did not open the questions` })
  await sleep(400)
}

/** The six questions the stand-in serves, answered: 9, "Just right", "Very helpful", a win, nothing, a wish. */
async function answerAll(page, what, { last = true } = {}) {
  await pick(page, '9', what)
  await pick(page, 'Next', what)
  await pick(page, 'Just right', what)
  await pick(page, 'Next', what)
  await pick(page, 'Very helpful', what)
  await pick(page, 'Next', what)
  await page.keyboard.type('Landed my first client')
  await pick(page, 'Next', what)
  await pick(page, 'Next', what)
  await page.keyboard.type('More live calls')
  if (last) await pick(page, 'Send application', what)
}

/** Put the camera on the rail at `depth` and wait until it rests there (the camera glides after the scroll). */
async function railTo(page, depth, what) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  let last = -1
  let still = 0
  const t0 = Date.now()
  for (;;) {
    const f = await page.evaluate(() => {
      const fr = window.__worldFrame
      return fr ? { d: fr.depth, p: fr.parkProgress, fl: fr.flight } : null
    })
    if (f && f.p === 0 && f.fl >= 0.999 && Math.abs(f.d - last) < 2e-6) {
      if (++still >= 3) break
    } else still = 0
    if (f) last = f.d
    if (Date.now() - t0 > 15000) throw new Error(`${what}: the camera did not settle at depth ${depth}`)
    await sleep(150)
  }
  // The labels are laid out once the scroll rests.
  await sleep(500)
}

async function parked(page, what) {
  await waitFor(page, () => window.__worldFrame?.parkedId === 'checkpoint' && window.__worldFrame.parkProgress >= 0.999 && !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), {
    timeout: PARK_MS,
    what: `${what}: the camera did not park at the cache with the panel open`,
  })
  await sleep(700)
}

async function home(page, what) {
  await waitFor(page, () => !document.querySelector('main section[aria-labelledby="cp-panel-title"]') && (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== 'hidden', {
    timeout: PARK_MS,
    what: `${what}: the panel did not close and the camera did not come home`,
  })
  await sleep(300)
}

/** Click an element the way a person would when it is on top, else through the DOM. */
async function click(page, find, what) {
  const via = await page.evaluate((src) => {
    const el = new Function(`return (${src})()`)()
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = r.width > 0 ? document.elementFromPoint(x, y) : null
    if (top && (top === el || el.contains(top) || top.closest('button') === el.closest('button'))) return { mouse: true, x, y }
    el.click()
    return { mouse: false }
  }, find.toString())
  if (!via) throw new Error(`${what}: not on the page`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  return via.mouse ? 'mouse' : 'dom click'
}

async function crop(page, file, b, pad = 16) {
  if (!b) return
  const x = Math.max(0, b.l - pad)
  const y = Math.max(0, b.t - pad)
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: Math.min(DESKTOP.width - x, b.w + 2 * pad), height: Math.min(DESKTOP.height - y, b.h + 2 * pad) } })
}

// ── Rows ────────────────────────────────────────────────────────────────────

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], values: {}, api: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, sub) => openPage(ctx, row, url(params, sub)),
    /** A page by its own address (row 18: the plain page, no ?catalog). */
    openPath: (urlPath) => openPage(ctx, row, urlPath),
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
  await runRow(1, 'locked: the chip counts the days and carries the state, the timeline its tag between places 4 and 5', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const s = await page.evaluate(SNAP)
    r.check('the chip says 30% off and 11 days left', s.chip && /30% off/i.test(s.chip.text) && /11 days left/i.test(s.chip.text), s.chip)
    // 2026-10-15: the course bar and its notch at the gate are gone; the chip carries the state the notch showed.
    r.check("the header's chip carries the offer's state (locked)", s.chipState === 'locked', s.chipState)
    const [a4, a5] = [s.stops[3], s.stops[4]]
    const mid = s.tag ? (s.tag.box.l + s.tag.box.r) / 2 : NaN
    r.check('the timeline has the tag, between the 4th and 5th diamonds', s.tag && a4 && a5 && mid > (a4.l + a4.r) / 2 + 8 && mid < (a5.l + a5.r) / 2 - 8, { tag: s.tag, a4, a5 })
    r.check('the tag says 30% off (never 30% alone) and is locked', s.tag?.state === 'locked' && /^30% off$/i.test(s.tag.text), s.tag)
    r.check('the tag stands above the bar, clear of the diamonds', s.tag && a4 && a5 && s.tag.box.b <= Math.min(a4.t, a5.t), { tag: s.tag?.box, a4, a5 })
    r.check('the tag is no ninth diamond: the places still have 8', s.stops.length === 8, s.stops.length)
    r.check('the cache is closed (no video watched yet, far from Video Ads II)', s.cp?.shown === true && s.cp?.look === 'closed', s.cp)
    const head = await page.evaluate(() => {
      const r = document.querySelector('main header > :last-child').getBoundingClientRect()
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }
    })
    await crop(page, 'header-chip.png', { ...head, w: head.r - head.l, h: head.b - head.t }, 20)
  })

  await runRow(2, 'the checkpoint in the world: its marker is up from the rail point that frames the cache', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 2')
    await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 2: the marker did not become a plaque' })
    const s = await page.evaluate(SNAP)
    r.row.values.depth = depth
    r.check('the marker is a plaque, on screen', s.marker?.mode === 'text' && s.cp?.marker?.visible && s.marker.box.l > 0 && s.marker.box.r < DESKTOP.width, s.marker)
    r.check('the plaque says 30% off alone (the chip has the days; "11d" read as "110")', /^30% off$/i.test(s.marker?.label ?? ''), s.marker?.label)
    r.check('the camera passes on the rail (not parked)', s.park?.id === null, s.park)
    await page.screenshot({ path: path.join(OUT, 'world-passing.png') })
    await crop(page, 'marker-label.png', s.marker?.box ? { ...s.marker.box, b: s.marker.box.b + 60, h: s.marker.box.h + 60 } : null, 40)
  })

  await runRow(3, 'the marker opens the panel and parks the camera at the cache (a real click); locked, Apply is there and greyed out', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 3')
    await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 3: no plaque to click' })
    const via = await click(page, () => document.querySelector('main button[data-mode][data-cp]')?.lastElementChild, 'row 3: the plaque')
    await parked(page, 'row 3')
    const s = await page.evaluate(SNAP)
    r.row.values.via = via
    r.check('clicked with the mouse', via === 'mouse', via)
    r.check('the panel is up, titled 30% off your next month', s.panel?.title === '30% off your next month' && s.panel.opacity > 0.99, s.panel?.title)
    r.check('it says the deadline and the days left', /Apply by \w{3} \d{1,2} \w{3}/i.test(s.panel?.text ?? '') && /11 days left/i.test(s.panel?.text ?? ''), s.panel?.text)
    r.check('it counts the videos watched and to go (0 of N, N to go)', /0 of (\d+) videos/.test(s.panel?.text ?? '') && /(\d+) to go/.test(s.panel?.text ?? ''), s.panel?.text)
    const total = Number(/0 of (\d+) videos/.exec(s.panel?.text ?? '')?.[1])
    r.check('it says how many videos to watch, the same N as the count', total > 0 && new RegExp(`Watch all ${total} videos through Video Ads II`).test(s.panel?.text ?? ''), s.panel?.text)
    const watchButtons = await page.evaluate(() => [...document.querySelectorAll('main section[aria-labelledby="cp-panel-title"] button')].filter((b) => /^Watch\b/.test(b.textContent.trim()) || /^Watch /.test(b.getAttribute('aria-label') ?? '')).length)
    r.check('no time estimate and no Watch row (Lovro, 2026-10-15)', !/about \d+ (hours?|min)/i.test(s.panel?.text ?? '') && (await page.evaluate(FIND.watch)) === null && watchButtons === 0, { text: s.panel?.text, watchButtons })
    const a = await page.evaluate(APPLY)
    r.check('Apply is there and greyed out: aria-disabled, still in the keyboard path, no fill, not-allowed', a?.text === 'Apply for 30% off' && a.ariaDisabled === 'true' && a.disabled === false && a.tabIndex >= 0 && !a.filled && a.cursor === 'not-allowed', a)
    const why = `Watch all ${total} videos to apply`
    const ax = await applyAx(page)
    r.check(`its reason "${why}" is its title (the hover's tip) and, with it disabled, what a screen reader is told`, a?.title === why && ax?.role === 'button' && ax.name === 'Apply for 30% off' && ax.disabled === true && ax.description === why, { title: a?.title, ax })
    r.check('the page scroll is locked while parked', s.locked === true, s.locked)
    r.check('the cache is in the frame, right of the panel', s.cp?.marker?.visible && s.cp.marker.x > (s.panel?.box.r ?? 0), { marker: s.cp?.marker, panel: s.panel?.box })
    await page.screenshot({ path: path.join(OUT, 'panel-locked.png') })
  })

  await runRow(4, 'Esc comes home: the panel goes, the camera is back where it was, the page scrolls', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 4')
    const before = await page.evaluate(() => ({ y: Math.round(scrollY), d: window.__worldFrame.depth }))
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 4')
    await page.keyboard.press('Escape')
    await home(page, 'row 4')
    const after = await page.evaluate(() => ({ y: Math.round(scrollY), d: window.__worldFrame.depth }))
    r.check('back on the same scroll position and depth', Math.abs(after.y - before.y) <= 1 && Math.abs(after.d - before.d) < 2e-4, { before, after })
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
    r.check('focus lands on the checkpoint again (its tag or marker)', /discount checkpoint/i.test(focus ?? ''), focus)
  })

  await runRow(5, "the timeline's tag opens the panel, and names the offer on hover", async (r) => {
    const page = await r.open({ discount: 'locked' })
    const box = (await page.evaluate(SNAP)).tag?.box
    if (!box) throw new Error('row 5: no tag')
    await page.mouse.move((box.l + box.r) / 2, (box.t + box.b) / 2)
    await sleep(350)
    const tip = await page.evaluate(() => document.querySelector('main nav[aria-label="Places"] button[data-gate="discount"]')?.textContent ?? '')
    r.check('hovered, the tag says 30% off and the days left', /30% off/i.test(tip) && /11 days left/i.test(tip), tip)
    const tipBox = await page.evaluate(() => {
      const t = document.querySelector('main nav[aria-label="Places"] button[data-gate="discount"]')?.children[1]?.getBoundingClientRect()
      return t ? { t: Math.round(t.top), b: Math.round(t.bottom) } : null
    })
    r.check('the tip stands clear above the tag', !!tipBox && tipBox.b <= box.t, { tip: tipBox, tag: box })
    const nav = await page.evaluate(() => {
      const b = document.querySelector('main nav[aria-label="Places"]').getBoundingClientRect()
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }
    })
    await crop(page, 'timeline-tag.png', { ...nav, t: nav.t - 70, h: nav.h + 70 }, 24)
    await page.mouse.click((box.l + box.r) / 2, (box.t + box.b) / 2)
    await parked(page, 'row 5')
    const s = await page.evaluate(SNAP)
    r.check('the panel is up, the camera parked at the cache', s.panel?.title === '30% off your next month' && s.park?.id === 'checkpoint', { panel: s.panel?.title, park: s.park })
  })

  await runRow(6, "the header's chip opens the panel from the opening frame, far from the cache", async (r) => {
    const page = await r.open({ discount: 'locked' })
    const s0 = await page.evaluate(SNAP)
    r.check('the page is at the opening frame', s0.y < 2, s0.y)
    const via = await click(page, FIND.chip, 'row 6: the chip')
    await parked(page, 'row 6')
    const s = await page.evaluate(SNAP)
    r.check('the panel is up and the camera parked at the cache', s.panel?.title === '30% off your next month' && s.park?.id === 'checkpoint', { via, park: s.park })
    r.check('the cache is in the frame', s.cp?.marker?.visible === true, s.cp?.marker)
    await page.keyboard.press('Escape')
    await home(page, 'row 6')
    await sleep(600)
    const back = await page.evaluate(() => ({ d: window.__worldFrame.depth, want: window.__worldCheckpoint().depth, marker: window.__worldCheckpoint().marker }))
    r.check('opened from far, Esc leaves the camera on the trail in front of the cache (its marker up)', Math.abs(back.d - back.want) < 2e-3 && back.marker?.visible === true, back)
  })

  await runRow(7, 'locked: Apply takes no click, no Enter, no Space; nothing opens, nothing is sent, the panel stays', async (r) => {
    const page = await r.open({ discount: 'locked' })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 7')
    const at = await page.evaluate(() => location.pathname)
    // Longer than the stand-in's Apply (600 ms) and the questions' opening: whatever a press set off shows by then.
    const settle = () => sleep(1200)
    const via = await click(page, FIND.apply, 'row 7: Apply')
    await settle()
    let u = await page.evaluate(UNMOVED)
    r.check('a mouse click: no questions, nothing sent, the panel open and parked', via === 'mouse' && unmoved(u, at), { via, ...u })
    // The keyboard's way in: one Tab from the panel's heading (aria-disabled keeps Apply in the path).
    await page.evaluate(() => document.getElementById('cp-panel-title')?.focus())
    await page.keyboard.press('Tab')
    let a = await page.evaluate(APPLY)
    r.check('Tab from the heading reaches Apply', a?.focused === true, a)
    await page.keyboard.press('Enter')
    await settle()
    u = await page.evaluate(UNMOVED)
    a = await page.evaluate(APPLY)
    r.check('Enter on it: nothing opens or is sent, the focus stays on it', unmoved(u, at) && a?.focused === true, { ...u, focused: a?.focused })
    await page.keyboard.press('Space')
    await settle()
    u = await page.evaluate(UNMOVED)
    r.check('Space on it: the same', unmoved(u, at), u)
    // Hovered, it stays greyed out: the accent button it shares fills on hover.
    const c = await page.evaluate((src) => {
      const r = new Function(`return (${src})()`)()?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
    }, FIND.apply.toString())
    if (c) await page.mouse.move(c.x, c.y)
    await sleep(300)
    a = await page.evaluate(APPLY)
    r.check('hovered, it stays unfilled and not-allowed', !!c && !!a && !a.filled && a.cursor === 'not-allowed', a)
    const chip = (await page.evaluate(SNAP)).chip
    r.check('the chip still counts the days (nothing went in for review)', /11 days left/i.test(chip?.text ?? ''), chip)
  })

  await runRow(8, 'ready: Apply opens the questions; sent, the panel and the chip turn to in review, the cache is claimed', async (r) => {
    const page = await r.open({ discount: 'ready' })
    let s = await page.evaluate(SNAP)
    r.check('the chip says to apply, with the days left (9)', /Apply/.test(s.chip?.text ?? '') && /9 days left/i.test(s.chip?.text ?? ''), s.chip)
    r.check('the cache is ready', s.cp?.look === 'ready', s.cp?.look)
    r.check('the tag and the marker are ready', s.tag?.state === 'ready' && s.marker?.state === 'ready', { tag: s.tag?.state, marker: s.marker?.state })
    const depth = s.cp.depth
    await railTo(page, depth, 'row 8')
    await page.screenshot({ path: path.join(OUT, 'world-ready.png') })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 8')
    s = await page.evaluate(SNAP)
    r.check('the panel says every video is watched, and offers Apply', /Every video through Video Ads II is watched/.test(s.panel?.text ?? '') && (await page.evaluate(FIND.apply)) !== null, s.panel?.text)
    const on = await page.evaluate(APPLY)
    r.check('ready, Apply is on: not aria-disabled, no reason, filled, a pointer', on?.ariaDisabled === null && on.disabled === false && on.title === null && on.filled && on.cursor === 'pointer', on)
    await page.screenshot({ path: path.join(OUT, 'panel-ready.png') })
    await click(page, FIND.apply, 'row 8: Apply')
    await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="dialog"]'), { timeout: 3000, what: 'row 8: Apply did not open the questions' })
    await sleep(500)
    let f = await page.evaluate(FORM)
    r.check('Apply opened the questions on the map, question 1 of 6, a scale, focus inside', f?.count === '1 of 6' && f.kind === 'scale' && /recommend EcomTalent/.test(f.question) && f.focusInside && !f.sheet, f && { count: f.count, kind: f.kind, q: f.question, focusInside: f.focusInside })
    r.check('nothing sent yet: no application in memory', (await page.evaluate(() => window.__fixtureDiscount.requests().length)) === 0)
    s = await page.evaluate(SNAP)
    r.check('the checkpoint stays open, parked, under the form', s.panel !== null && s.park?.id === 'checkpoint', { panel: !!s.panel, park: s.park })
    r.check('the form takes the panel\'s slot, under the header on the left, the cache in view to its right', f.box.t === 92 && f.box.l === 48 && s.cp?.marker?.visible && s.cp.marker.x > f.box.r, { form: f.box, marker: s.cp?.marker })
    await pick(page, '9', 'row 8')
    await page.screenshot({ path: path.join(OUT, 'form-map.png') })
    await pick(page, 'Next', 'row 8')
    await pick(page, 'Just right', 'row 8')
    await pick(page, 'Next', 'row 8')
    await pick(page, 'Very helpful', 'row 8')
    await pick(page, 'Next', 'row 8')
    await page.keyboard.type('Landed my first client')
    await pick(page, 'Next', 'row 8')
    await pick(page, 'Next', 'row 8')
    await page.keyboard.type('More live calls')
    f = await page.evaluate(FORM)
    r.check('the last question offers Send application', f?.count === '6 of 6' && f.buttons.some((b) => b.text === 'Send application' && !b.disabled), f?.buttons)
    await pick(page, 'Send application', 'row 8')
    await waitFor(page, () => [...(document.querySelector('[data-discount-form] [role="dialog"]')?.querySelectorAll('button') ?? [])].some((b) => /Sending/.test(b.textContent)), { timeout: 3000, what: 'row 8: Send did not show it is sending' })
    await waitFor(page, () => !document.querySelector('[data-discount-form]') && /Your application is in/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 8000, what: 'row 8: the form did not close into "in review"' })
    await sleep(500)
    s = await page.evaluate(SNAP)
    r.check('the form closed, the panel says it is in review', /In review/.test(s.panel?.text ?? '') && /Your application is in/.test(s.panel?.text ?? ''), s.panel?.text)
    r.check('one application, pending, in memory', s.requests?.length === 1 && s.requests[0].status === 'pending', s.requests)
    r.check('it went with the answers (no plain request)', (await page.evaluate(() => window.__fixtureDiscount.answers().length)) === 1 && (await page.evaluate(() => window.__fixtureDiscount.plain())) === 0)
    r.check('the chip says in review', /In review/.test(s.chip?.text ?? ''), s.chip)
    r.check('the cache is claimed', s.cp?.look === 'claimed', s.cp?.look)
    await page.screenshot({ path: path.join(OUT, 'panel-pending.png') })
  })

  await runRow(9, 'pending and approved say so; a student in Video Ads II sees the lantern lit', async (r) => {
    for (const [preset, words] of [
      ['pending', /Your application is in/],
      ['approved', /Approved\. The team is putting it on your Whop subscription/],
    ]) {
      const page = await r.open({ discount: preset })
      let s = await page.evaluate(SNAP)
      r.check(`${preset}: the chip says ${preset === 'pending' ? 'In review' : 'Approved'}`, new RegExp(preset === 'pending' ? 'In review' : 'Approved').test(s.chip?.text ?? ''), s.chip)
      r.check(`${preset}: the cache is claimed`, s.cp?.look === 'claimed', s.cp?.look)
      await page.evaluate(() => window.__worldPark('checkpoint'))
      await parked(page, `row 9 (${preset})`)
      s = await page.evaluate(SNAP)
      r.check(`${preset}: the panel says so`, words.test(s.panel?.text ?? ''), s.panel?.text)
      await page.close()
    }
    const page = await r.open({ discount: 'locked', p: 'mid' })
    const s = await page.evaluate(SNAP)
    r.check('locked at Video Ads II (?p=mid): the lantern is lit (near)', s.cp?.look === 'near', s.cp)
  })

  await runRow(10, 'closed for the student (expired, before the new course, no first payment): the chip, the tag and the marker show, grey; the panel says why, with no Apply', async (r) => {
    for (const [preset, why] of [
      ['expired', /This offer closed on \w{3} \d{1,2} \w{3}\. It runs for your first 14 days\./],
      ['before-launch', /This offer is for students who joined from 9 October 2026, when the new course opened\. You joined before that, so it's closed for you\./],
      ['no-payment', /We can't see your first payment yet\. If you joined in the last two weeks, tell the team and they'll sort it out\./],
    ]) {
      const page = await r.open({ discount: preset })
      let s = await page.evaluate(SNAP)
      r.check(`${preset}: the chip says 30% off, Closed, and carries the closed state`, /^30% off\s*Closed$/i.test(s.chip?.text ?? '') && s.chipState === 'closed', { chip: s.chip, chipState: s.chipState })
      r.check(`${preset}: the tag is there, "30% off", closed`, s.tag?.state === 'closed' && /^30% off$/i.test(s.tag.text), s.tag)
      r.check(`${preset}: the checkpoint shows, the cache stands closed, its marker is there in the closed look`, s.cp?.shown === true && s.cp.look === 'closed' && s.marker?.state === 'closed', { cp: s.cp, marker: s.marker })
      const via = await click(page, FIND.chip, `row 10 (${preset}): the chip`)
      await parked(page, `row 10 (${preset})`)
      s = await page.evaluate(SNAP)
      r.check(`${preset}: the chip opens the panel, the camera parked at the cache`, s.panel?.title === '30% off your next month' && s.park?.id === 'checkpoint', { via, panel: s.panel?.title, park: s.park })
      r.check(`${preset}: it says why, in one plain line`, why.test(s.panel?.text ?? ''), s.panel?.text)
      const eyebrow = await page.evaluate(EYEBROW)
      r.check(`${preset}: its eyebrow ends "Closed"`, eyebrow?.at(-1) === 'Closed', eyebrow)
      r.check(`${preset}: no Apply (it can no longer be earned)`, (await page.evaluate(FIND.apply)) === null)
      await page.screenshot({ path: path.join(OUT, `panel-${preset}.png`) })
      if (preset === 'no-payment') {
        // Lovro's case in his second Loom: no first payment on the plain page, and the cache took no click.
        await page.keyboard.press('Escape')
        await home(page, 'row 10 (no-payment)')
        const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
        await railTo(page, depth, 'row 10')
        await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 10: the closed marker did not become a plaque' })
        const m = (await page.evaluate(SNAP)).marker
        r.check('no-payment: in the world the marker is a plaque, "30% off Closed", on screen', /^30% off\s*Closed$/i.test(m?.label ?? '') && m.box.l > 0 && m.box.r < DESKTOP.width, m)
        await page.screenshot({ path: path.join(OUT, 'world-closed.png') })
        const via2 = await click(page, () => document.querySelector('main button[data-mode][data-cp]')?.lastElementChild, 'row 10: the closed plaque')
        await parked(page, 'row 10 (the plaque)')
        r.check('no-payment: a real click on the plaque opens the panel', via2 === 'mouse' && (await page.evaluate(SNAP)).panel?.title === '30% off your next month', via2)
      }
      await page.close()
    }
  })

  await runRow(11, 'the questions one at a time: a required one holds Next, an optional one says so, Back keeps the answer; the answers sent are the ones given', async (r) => {
    const page = await r.open({ discount: 'ready' })
    await openForm(page, 'row 11')
    let f = await page.evaluate(FORM)
    const next = (x) => x?.buttons.find((b) => b.text === 'Next')
    r.check('question 1 (required, a scale): Next waits for a number, no Back yet', f.kind === 'scale' && !f.optional && next(f)?.disabled === true && !f.buttons.some((b) => b.text === 'Back'), f.buttons)
    r.check('the scale is one row of ten, each at least 40 px', f.labels.length === 10 && new Set(f.labels.map((l) => l.box.t)).size === 1 && f.labels.every((l) => l.box.w >= 40 && l.box.h >= 40), f.labels.map((l) => l.box))
    await pick(page, '7', 'row 11')
    f = await page.evaluate(FORM)
    r.check('a number picked: Next is on', f.checked === '7' && next(f)?.disabled === false, { checked: f.checked, next: next(f) })
    await pick(page, 'Next', 'row 11')
    f = await page.evaluate(FORM)
    r.check('question 2 of 6, a required choice, Next waits', f.count === '2 of 6' && f.kind === 'choice' && !f.optional && next(f)?.disabled === true && f.labels.length === 5, { count: f.count, kind: f.kind, labels: f.labels.map((l) => l.text) })
    await pick(page, 'A bit too fast', 'row 11')
    await page.screenshot({ path: path.join(OUT, 'form-choice.png') })
    await pick(page, 'Back', 'row 11')
    f = await page.evaluate(FORM)
    r.check('Back: question 1 again, the 7 still picked', f.count === '1 of 6' && f.checked === '7', { count: f.count, checked: f.checked })
    await pick(page, 'Next', 'row 11')
    f = await page.evaluate(FORM)
    r.check('Next again: question 2 still holds "A bit too fast"', f.count === '2 of 6' && f.checked === 'A bit too fast', f.checked)
    await pick(page, 'Next', 'row 11')
    await pick(page, 'Game-changing', 'row 11')
    await pick(page, 'Next', 'row 11')
    f = await page.evaluate(FORM)
    r.check('question 4: optional, says so, a box to type in with the keyboard already in it, Next on while empty', f.count === '4 of 6' && f.optional && f.kind === 'text' && f.focus === 'TEXTAREA' && next(f)?.disabled === false, { count: f.count, optional: f.optional, focus: f.focus })
    await page.keyboard.type('Shipped 3 ads in a week')
    await page.screenshot({ path: path.join(OUT, 'form-text.png') })
    await pick(page, 'Next', 'row 11')
    await pick(page, 'Next', 'row 11')
    f = await page.evaluate(FORM)
    r.check('question 6 of 6, the last, offers Send application', f.count === '6 of 6' && f.buttons.some((b) => b.text === 'Send application'), f.buttons)
    await pick(page, 'Send application', 'row 11')
    await waitFor(page, () => !document.querySelector('[data-discount-form]'), { timeout: 8000, what: 'row 11: the form did not close' })
    const sent = await page.evaluate(() => window.__fixtureDiscount.answers())
    const want = [
      { question_id: 'fixture-q1', answer_scale: 7, answer_choice: null, answer_text: null },
      { question_id: 'fixture-q2', answer_scale: null, answer_choice: 'A bit too fast', answer_text: null },
      { question_id: 'fixture-q3', answer_scale: null, answer_choice: 'Game-changing', answer_text: null },
      { question_id: 'fixture-q4', answer_scale: null, answer_choice: null, answer_text: 'Shipped 3 ads in a week' },
      { question_id: 'fixture-q5', answer_scale: null, answer_choice: null, answer_text: '' },
      { question_id: 'fixture-q6', answer_scale: null, answer_choice: null, answer_text: '' },
    ]
    r.check('one application, with exactly the answers given, the skipped ones empty', sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify(want), sent)
  })

  await runRow(12, 'leaving it: Esc, Cancel and a click beside it close the form, nothing sent, the checkpoint still open; it starts again on question 1', async (r) => {
    const page = await r.open({ discount: 'ready' })
    await openForm(page, 'row 12')
    await pick(page, '8', 'row 12')
    await pick(page, 'Next', 'row 12')
    await page.keyboard.press('Escape')
    await waitFor(page, () => !document.querySelector('[data-discount-form]'), { timeout: 3000, what: 'row 12: Esc did not close the form' })
    await sleep(400)
    let s = await page.evaluate(SNAP)
    r.check('Esc: the form is gone, the checkpoint still open and parked (the map did not take the Esc)', s.panel !== null && s.park?.id === 'checkpoint', { panel: !!s.panel, park: s.park })
    const focus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
    r.check('focus is back on Apply', /^Apply for 30% off/.test(focus ?? ''), focus)
    await click(page, FIND.apply, 'row 12: Apply again')
    await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="dialog"]'), { timeout: 3000, what: 'row 12: Apply did not open the form again' })
    await sleep(300)
    let f = await page.evaluate(FORM)
    r.check('opened again: question 1, nothing picked', f.count === '1 of 6' && f.checked === null, { count: f.count, checked: f.checked })
    await pick(page, 'Cancel', 'row 12')
    await waitFor(page, () => !document.querySelector('[data-discount-form]'), { timeout: 3000, what: 'row 12: Cancel did not close the form' })
    s = await page.evaluate(SNAP)
    r.check('Cancel: the form is gone, the checkpoint still open', s.panel !== null && s.park?.id === 'checkpoint', { panel: !!s.panel, park: s.park })
    await click(page, FIND.apply, 'row 12: Apply a third time')
    await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="dialog"]'), { timeout: 3000, what: 'row 12: Apply did not open the form a third time' })
    await sleep(300)
    f = await page.evaluate(FORM)
    // On the world, right of the form and clear of the header.
    await page.mouse.click(Math.round((f.box.r + DESKTOP.width) / 2), Math.round(DESKTOP.height * 0.6))
    await waitFor(page, () => !document.querySelector('[data-discount-form]'), { timeout: 3000, what: 'row 12: a click beside the form did not close it' })
    await sleep(300)
    s = await page.evaluate(SNAP)
    r.check('a click on the world beside it: the form is gone, the checkpoint still open (the click went no further)', s.panel !== null && s.park?.id === 'checkpoint', { panel: !!s.panel, park: s.park })
    r.check('nothing was sent, the panel still offers Apply', s.requests?.length === 0 && (await page.evaluate(FIND.apply)) !== null, s.requests)
  })

  await runRow(13, 'refused (?questions=fail): the form stays on the last question, says why, keeps the answers', async (r) => {
    const page = await r.open({ discount: 'ready', questions: 'fail' })
    await openForm(page, 'row 13')
    await answerAll(page, 'row 13')
    await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="alert"]'), { timeout: 5000, what: 'row 13: no refusal shown' })
    await sleep(300)
    const f = await page.evaluate(FORM)
    r.check('still open on question 6, saying why', f?.count === '6 of 6' && /Couldn't reach the server/.test(f.error ?? ''), f && { count: f.count, error: f.error })
    r.check('the answer typed is still there, and Send application is on again', f?.text === 'More live calls' && f.buttons.some((b) => b.text === 'Send application' && !b.disabled), f && { text: f.text, buttons: f.buttons })
    const s = await page.evaluate(SNAP)
    r.check('nothing is in review: no application, the chip still says to apply', s.requests?.length === 0 && /Apply/.test(s.chip?.text ?? ''), { requests: s.requests, chip: s.chip })
    await page.screenshot({ path: path.join(OUT, 'form-refused.png') })
  })

  await runRow(14, 'no active questions (?questions=none): Apply sends the plain request, no form', async (r) => {
    const page = await r.open({ discount: 'ready', questions: 'none' })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 14')
    await click(page, FIND.apply, 'row 14: Apply')
    await waitFor(page, () => /Your application is in/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 8000, what: 'row 14: the panel did not turn to in review' })
    const s = await page.evaluate(SNAP)
    const seen = await page.evaluate(() => ({ form: !!document.querySelector('[data-discount-form]'), plain: window.__fixtureDiscount.plain(), answers: window.__fixtureDiscount.answers().length }))
    r.check('no form opened; one plain request; the panel in review', !seen.form && seen.plain === 1 && seen.answers === 0 && s.requests?.length === 1 && s.requests[0].status === 'pending', { ...seen, requests: s.requests })
  })

  await runRow(15, 'phone (390x844): Apply opens the questions as a full sheet; sent, the checkpoint says in review', async (r) => {
    const ctx = await browser.createBrowserContext()
    try {
      const page = await openPhone(ctx, r.row, url({ discount: 'ready' }))
      await click(page, FIND.chip, 'row 15: the chip')
      await waitFor(page, () => !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), { timeout: 8000, what: 'row 15: the chip did not open the checkpoint' })
      await sleep(600)
      await click(page, FIND.apply, 'row 15: Apply')
      await waitFor(page, () => !!document.querySelector('[data-discount-form] [role="dialog"]'), { timeout: 5000, what: 'row 15: Apply did not open the questions' })
      await sleep(500)
      let f = await page.evaluate(FORM)
      r.check('a full sheet, the whole screen', f.sheet && f.box.l === 0 && f.box.t === 0 && f.box.w === PHONE.width && f.box.h === PHONE.height, f.box)
      const rows = [...new Set(f.labels.map((l) => l.box.t))]
      r.check('the numbers in two rows of five, each at least 40 px', f.labels.length === 10 && rows.length === 2 && f.labels.every((l) => l.box.w >= 40 && l.box.h >= 40), f.labels.map((l) => l.box))
      r.check('every button at least 40 px tall', f.buttons.every((b) => b.h >= 40), f.buttons)
      r.check('nothing runs off the screen sideways', (await page.evaluate(() => document.documentElement.scrollWidth)) <= PHONE.width)
      await pick(page, '9', 'row 15')
      await page.screenshot({ path: path.join(OUT, 'form-phone.png') })
      await pick(page, 'Next', 'row 15')
      await pick(page, 'Just right', 'row 15')
      await page.screenshot({ path: path.join(OUT, 'form-phone-choice.png') })
      await pick(page, 'Next', 'row 15')
      await pick(page, 'Very helpful', 'row 15')
      await pick(page, 'Next', 'row 15')
      await pick(page, 'Next', 'row 15')
      await pick(page, 'Next', 'row 15')
      f = await page.evaluate(FORM)
      r.check('the optional questions can be left: on to 6 of 6', f.count === '6 of 6', f.count)
      await pick(page, 'Send application', 'row 15')
      await waitFor(page, () => !document.querySelector('[data-discount-form]') && /Your application is in/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 8000, what: 'row 15: the sheet did not close into "in review"' })
      await sleep(400)
      const sent = await page.evaluate(() => window.__fixtureDiscount.requests())
      r.check('one application, pending', sent.length === 1 && sent[0].status === 'pending', sent)
      await page.screenshot({ path: path.join(OUT, 'panel-phone-pending.png') })
    } finally {
      await ctx.close().catch(() => {})
    }
  })

  for (const [id, preset, chipWord, tagState, look, words] of [
    [16, 'applied', 'Yours', 'done', 'claimed', /It's on your Whop subscription\. You'll see 30% off on your next renewal\./],
    [17, 'rejected', 'Not approved', 'closed', 'closed', /The team didn't approve this one\.\s*Several of the videos were skipped through in under a minute\.\s*If you think that's wrong, ask in Discord and the team will sort it out\./],
  ]) {
    await runRow(id, `${preset}: the chip and the tag say where it stands, the panel says what happened, no Apply`, async (r) => {
      const page = await r.open({ discount: preset })
      let s = await page.evaluate(SNAP)
      r.check(`the chip says 30% off, ${chipWord}`, new RegExp(`^30% off\\s*${chipWord}$`, 'i').test(s.chip?.text ?? ''), s.chip)
      r.check(`the tag is ${tagState}, the cache ${look}`, s.tag?.state === tagState && s.cp?.look === look, { tag: s.tag, cp: s.cp })
      await page.evaluate(() => window.__worldPark('checkpoint'))
      await parked(page, `row ${id}`)
      s = await page.evaluate(SNAP)
      r.check('the panel says what happened', words.test(s.panel?.text ?? ''), s.panel?.text)
      const eyebrow = await page.evaluate(EYEBROW)
      r.check(`its eyebrow ends "${chipWord}"`, eyebrow?.at(-1) === chipWord, eyebrow)
      r.check('no Apply', (await page.evaluate(FIND.apply)) === null)
      await page.screenshot({ path: path.join(OUT, `panel-${preset}.png`) })
    })
  }

  await runRow(18, 'the plain page as Lovro reviewed it (no ?catalog, no ?discount): the 30% shows and opens; its videos watched, Apply turns on', async (r) => {
    const page = await r.openPath(`${APP}?arrive=0&poster=off`)
    let s = await page.evaluate(SNAP)
    const dev = await page.evaluate(() => document.querySelector('[data-dev-videos]')?.getAttribute('data-dev-videos') ?? null)
    r.row.values.devVideos = dev
    // The placeholder course asks only for its lessons with a video: the three the dev videos give (a2l01 to a2l03). Without them it has none, and says so.
    r.check('the chip shows with no parameter: a first payment 3 days ago', dev ? /^30% off\s*11 days left$/i.test(s.chip?.text ?? '') : /^30% off\s*Not open yet$/i.test(s.chip?.text ?? ''), { chip: s.chip, dev })
    const [a4, a5] = [s.stops[3], s.stops[4]]
    const mid = s.tag ? (s.tag.box.l + s.tag.box.r) / 2 : NaN
    r.check('the tag stands between the 4th and 5th diamonds (Video Ads II and Static Ads)', !!s.tag && mid > (a4.l + a4.r) / 2 + 8 && mid < (a5.l + a5.r) / 2 - 8, { tag: s.tag, a4, a5 })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 18')
    await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 18: the marker did not become a plaque' })
    s = await page.evaluate(SNAP)
    r.check('at the cache the marker is a plaque, "30% off", on screen', /^30% off$/i.test(s.marker?.label ?? '') && s.marker.box.l > 0 && s.marker.box.r < DESKTOP.width, s.marker)
    await page.screenshot({ path: path.join(OUT, 'plain-world.png') })
    const via = await click(page, () => document.querySelector('main button[data-mode][data-cp]')?.lastElementChild, 'row 18: the plaque')
    await parked(page, 'row 18')
    s = await page.evaluate(SNAP)
    r.check('a real click on the plaque opens the panel', via === 'mouse' && s.panel?.title === '30% off your next month', { via, panel: s.panel?.title })
    if (!dev) {
      r.check('without the dev videos: the panel says the offer is not open yet', /This offer isn't open yet\./.test(s.panel?.text ?? ''), s.panel?.text)
      return
    }
    let a = await page.evaluate(APPLY)
    r.check('locked: 0 of 3 videos, Apply greyed out with its reason', /0 of 3 videos/.test(s.panel?.text ?? '') && a?.ariaDisabled === 'true' && a.title === 'Watch all 3 videos to apply', { text: s.panel?.text, apply: a })
    await page.evaluate(() => ['a2l01', 'a2l02', 'a2l03'].forEach((id) => window.__fixture.complete(id)))
    await waitFor(page, () => /Every video through Video Ads II is watched/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 5000, what: 'row 18: the panel did not turn ready' })
    await sleep(400)
    a = await page.evaluate(APPLY)
    s = await page.evaluate(SNAP)
    r.check('the three watched: ready, Apply on (no aria-disabled, filled), the chip says to apply', a?.ariaDisabled === null && a.filled && /Apply/.test(s.chip?.text ?? ''), { apply: a, chip: s.chip })
    await page.screenshot({ path: path.join(OUT, 'plain-ready.png') })
  })

  await runRow(19, "phone (390x844): the 30% is a row under Video Ads II's, locked and closed, and opens the checkpoint's sheet", async (r) => {
    for (const [preset, state, says] of [
      ['locked', /11 days left/i, /Watch all \d+ videos through Video Ads II/],
      ['no-payment', /Closed/, /We can't see your first payment yet/],
    ]) {
      const ctx = await browser.createBrowserContext()
      try {
        const page = await openPhone(ctx, r.row, url({ discount: preset }))
        const list = await page.evaluate(() => {
          const items = [...(document.querySelector('main ol')?.children ?? [])]
          return {
            places: items.map((li) => li.querySelector('button')?.getAttribute('aria-label') ?? null),
            cp: items.map((li, i) => (li.querySelector('button[aria-label^="Discount checkpoint"]') ? i : -1)).filter((i) => i >= 0),
          }
        })
        r.check(`${preset}: the eight places keep their rows (each item's first button)`, list.places.length === 8 && list.places.every((l) => !!l && !/^Discount checkpoint/.test(l)), list.places)
        r.check(`${preset}: the 30%'s row sits in Video Ads II's item`, list.cp.length === 1 && list.cp[0] === 3 && /^Video Ads II/.test(list.places[3] ?? ''), list)
        // Scrolled to the middle first, then measured: the list may scroll smoothly.
        await page.evaluate(() => document.querySelector('main ol > li > button[aria-label^="Discount checkpoint"]')?.scrollIntoView({ block: 'center' }))
        await sleep(700)
        const row = await page.evaluate(() => {
          const b = document.querySelector('main ol > li > button[aria-label^="Discount checkpoint"]')
          const x = b?.getBoundingClientRect()
          return x ? { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height), sy: Math.round(scrollY), text: b.textContent.replace(/\s+/g, ' ').trim() } : null
        })
        r.check(`${preset}: the row says 30% off, Checkpoint and where it stands; at least 40 px tall, inside the screen`, !!row && /^30% off/i.test(row.text) && /Checkpoint/i.test(row.text) && state.test(row.text) && row.h >= 40 && row.l >= 0 && row.r <= PHONE.width, row)
        if (row) {
          // The clip is in the page's coordinates (the scroll added) when nothing beyond the viewport is captured.
          const top = Math.max(0, row.t - 90)
          await page.screenshot({ path: path.join(OUT, `phone-row-${preset}.png`), clip: { x: 0, y: row.sy + top, width: PHONE.width, height: Math.min(PHONE.height - top, row.h + 180) }, captureBeyondViewport: false })
        }
        const via = await click(page, () => document.querySelector('main ol > li > button[aria-label^="Discount checkpoint"]'), `row 19 (${preset}): the row`)
        await waitFor(page, () => !!document.querySelector('main section[role="dialog"][aria-labelledby="cp-panel-title"]'), { timeout: 8000, what: `row 19 (${preset}): no sheet` })
        await sleep(500)
        const sheet = await page.evaluate(() => document.querySelector('main section[role="dialog"][aria-labelledby="cp-panel-title"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null)
        r.check(`${preset}: it opens the checkpoint's sheet, which says where the student stands`, via === 'mouse' && /30% off your next month/.test(sheet ?? '') && says.test(sheet ?? ''), { via, sheet })
        r.check(`${preset}: Apply ${preset === 'locked' ? 'greyed out' : 'not there'}`, preset === 'locked' ? (await page.evaluate(APPLY))?.ariaDisabled === 'true' : (await page.evaluate(FIND.apply)) === null)
        await page.screenshot({ path: path.join(OUT, `phone-sheet-${preset}.png`) })
      } finally {
        await ctx.close().catch(() => {})
      }
    }
  })

  await runRow(20, 'the approved celebration on a 360 px phone: one line, says how to close it; Esc closes it and only it; reduced motion: no spring', async (r) => {
    const VP = { width: 360, height: 740 }
    const DIALOG = '[role="dialog"][aria-label="30% discount approved"]'
    /**
     * The hero's scale on each of the first frames it is up, from the page's
     * first byte: read after each frame is painted (a task after the frame's
     * callbacks), so what is read is what was on screen.
     */
    const recorder = (sel) => {
      window.__heroScales = []
      const seen = new WeakSet()
      new MutationObserver(() => {
        const d = document.querySelector(sel)
        if (!d || seen.has(d)) return
        seen.add(d)
        const hero = [...d.querySelectorAll('div')].find((x) => x.textContent.trim() === '30% OFF')
        let n = 0
        const tick = () =>
          requestAnimationFrame(() =>
            setTimeout(() => {
              const m = /^matrix\(([^,]+),/.exec(hero ? getComputedStyle(hero).transform : 'none')
              window.__heroScales.push(m ? Number(m[1]) : 1)
              if (++n < 12) tick()
            }, 0),
          )
        tick()
      }).observe(document, { subtree: true, childList: true })
    }
    /** The hero's line boxes and box, and the closing line's words. */
    const LOOK = (sel) => {
      const d = document.querySelector(sel)
      const hero = d && [...d.querySelectorAll('div')].find((x) => x.textContent.trim() === '30% OFF')
      if (!hero) return null
      const range = document.createRange()
      range.selectNodeContents(hero)
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size
      const b = hero.getBoundingClientRect()
      const ps = [...d.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim())
      return { lines, l: Math.round(b.left), r: Math.round(b.right), fontSize: getComputedStyle(hero).fontSize, close: ps.at(-1) ?? null, overflow: document.documentElement.scrollWidth > innerWidth }
    }
    // The dashboard's test event shows it (WorldCelebrations hears it too) once the page is up, so
    // its 5 s safety net cannot run out while the page loads; it records nothing.
    const fire = (page) => page.evaluate(() => window.dispatchEvent(new Event('et:test:discount-approved')))
    for (const reduced of [false, true]) {
      const name = reduced ? 'reduced motion' : 'motion on'
      const ctx = await browser.createBrowserContext()
      try {
        const page = await ctx.newPage()
        tally.pages++
        page.on('pageerror', (e) => {
          const rec = { row: r.row.id, message: `${String(e.message).slice(0, 240)}` }
          r.row.pageErrors.push(rec)
          tally.pageErrors.push(rec)
        })
        await page.setViewport({ ...VP, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
        if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
        await page.evaluateOnNewDocument(recorder, DIALOG)
        await page.goto(ORIGIN + url({ discount: 'locked' }), { waitUntil: 'domcontentloaded', timeout: READY_MS })
        await waitFor(page, () => document.querySelector('main[data-view="list"] header button[aria-label*="discount checkpoint"]') !== null, { timeout: READY_MS, poll: 400, what: `row 20 (${name}): the phone's map was not ready` })
        await sleep(600)
        await fire(page)
        await waitFor(page, (sel) => !!document.querySelector(sel), { arg: DIALOG, timeout: 4000, what: `row 20 (${name}): the test event showed no celebration` })
        await sleep(1900)
        const look = await page.evaluate(LOOK, DIALOG)
        const scales = await page.evaluate(() => window.__heroScales.slice())
        r.row.values[name] = { look, scales }
        r.check(`${name}: "30% OFF" on one line, inside the 360 px screen, nothing runs off it sideways`, look?.lines === 1 && look.l >= 0 && look.r <= VP.width && !look.overflow, look)
        r.check(`${name}: on a touch screen it says "Tap anywhere to close"`, look?.close === 'Tap anywhere to close', look?.close)
        if (reduced) r.check('reduced motion: "30% OFF" never springs (scale 1 on every frame it is up)', scales.length > 0 && scales.every((x) => Math.abs(x - 1) < 1e-3), scales)
        else r.check('motion on: the spring starts small (the control for the reduced run)', scales.length > 0 && Math.min(...scales) < 0.9, scales)
        if (!reduced) await page.screenshot({ path: path.join(OUT, 'celebration-360.png') })
        await page.keyboard.press('Escape')
        await waitFor(page, (sel) => !document.querySelector(sel), { arg: DIALOG, timeout: 4000, what: `row 20: Esc did not close it (${name})` })
      } finally {
        await ctx.close().catch(() => {})
      }
    }
    // A mouse: the words say click or Esc, and Esc reaches the celebration only (the checkpoint open under it stays).
    const page = await r.open({ discount: 'locked' })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 20')
    // Where the map hears Esc (a listener on the window, after the page's own): what reaches it is counted.
    await page.evaluate(() => {
      window.__escHeard = 0
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.__escHeard++
      })
    })
    await fire(page)
    await waitFor(page, (sel) => !!document.querySelector(sel), { arg: DIALOG, timeout: 4000, what: 'row 20: the test event showed no celebration on the desktop' })
    await sleep(1900)
    const look = await page.evaluate(LOOK, DIALOG)
    r.check('with a mouse it says "Click anywhere or press Esc to close"', look?.close === 'Click anywhere or press Esc to close', look?.close)
    await page.keyboard.press('Escape')
    await waitFor(page, (sel) => !document.querySelector(sel), { arg: DIALOG, timeout: 4000, what: 'row 20: Esc did not close the celebration' })
    await sleep(800)
    const after = await page.evaluate(() => ({
      heard: window.__escHeard,
      cp: window.__worldCheckpoint(),
      panel: !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
      park: window.__worldFrame ? { id: window.__worldFrame.parkedId, p: window.__worldFrame.parkProgress } : null,
    }))
    r.check('Esc closed the celebration only: no Esc reached the map, whose checkpoint is still open, not closing, the camera still parked', after.heard === 0 && after.panel && after.cp?.open === true && after.cp.closing === false && after.park?.id === 'checkpoint', after)
    // The control: with the celebration gone, the same key reaches the map and closes the checkpoint.
    await page.keyboard.press('Escape')
    await home(page, 'row 20 (the control)')
    r.check('the control: the next Esc, with nothing over the map, reaches it and closes the checkpoint', (await page.evaluate(() => window.__escHeard)) === 1, await page.evaluate(() => window.__escHeard))
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
