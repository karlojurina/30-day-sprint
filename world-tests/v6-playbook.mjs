/**
 * The Playbook link on the map (cutover PRD, Work Item 8), walked in a real
 * browser.
 *
 *   node world-tests/v6-playbook.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-hud.mjs: the real stage, map and corner, a pretend student, no login, no
 * server call. ?playbook=1 gives the pretend student the Playbook
 * (FixtureStudentProvider.tsx: playbookUnlocked, as StudentProvider works it
 * out), ?hud= the streak and achievements beside it. Headless Chrome on the
 * real GPU, 1691x1278 unless a row says otherwise (390x844 phone, 3428x1230
 * wide). About a minute.
 *
 * One PASS or FAIL line per row, with what was measured. After the rows, one
 * MEASURED line: requests to /api, requests to Supabase and page errors over
 * every page the run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  without ?playbook: no link, and the pill is what it was (the stats, the
 *      discount's segment, which every student has since 2026-10-16, and Sign
 *      out; no empty slot, no extra line)
 *   2  with ?playbook=1: a link labelled Playbook to /dashboard/playbook, in
 *      the pill between the stats and Sign out (after the discount's segment:
 *      since 2026-10-15 the pill is the header's group at the right end), the
 *      pill clear of the brand; Tab reaches it after the discount, and it
 *      takes the keyboard's focus ring
 *   3  phone (390x844): the stats stay in the header's row and the link drops
 *      to the row under them with the discount, both inside the screen and
 *      apart, with the longest streak and the chip up, open or closed (since
 *      2026-10-16 the chip is there for every student)
 *   4  wide (3428x1230): the link in the pill, clear of everything
 *
 * Pictures for a person, in world-tests/shots/v6/playbook/ (git-ignored):
 *   corner-none.png       the header's left end without the Playbook (row 1)
 *   corner-playbook.png   with it (row 2)
 *   corner-focus.png      the link with the keyboard's ring (row 2)
 *   map-playbook.png      the whole frame with it (row 2)
 *   phone-playbook.png    the phone's top, the link and the chip (row 3)
 *   phone-long.png        the same with a 128-day streak (row 3)
 *   phone-closed.png      a 128-day streak and the closed chip (row 3)
 *   wide-playbook.png     the header's left end, wide (row 4)
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'playbook')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const WIDE = { width: 3428, height: 1230 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}) => `${APP}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

/** The corner and its neighbours, as boxes. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const seen = (el) => {
    if (!el) return false
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0
  }
  const header = document.querySelector('main header')
  const stats = document.querySelector('main header button[aria-expanded]')
  const pill = stats?.parentElement ?? null
  const link = document.querySelector('main header a[href="/dashboard/playbook"]')
  const out = document.querySelector('main header button[aria-label="Sign out"]')
  const chip = document.querySelector('main header button[aria-label*="discount checkpoint"]')
  // Since 2026-10-15 the header holds two things: the brand, then the group at the right end.
  const brand = header?.firstElementChild
  const end = header?.lastElementChild
  // The pill's parts, through any wrapper that draws no box of its own (the slots sit in
  // `.more`, display: contents, which is always 0 wide): so row 1 measures the empty slot itself.
  const flat = (els) => els.flatMap((el) => (getComputedStyle(el).display === 'contents' ? flat([...el.children]) : [el]))
  const kids = pill ? flat([...pill.children]).map((el) => ({ tag: el.tagName, slot: el.dataset.slot ?? null, seen: seen(el), empty: el.childElementCount === 0 && !el.textContent.trim(), w: Math.round(el.getBoundingClientRect().width) })) : []
  return {
    view: document.querySelector('main')?.dataset.view ?? null,
    pill: box(pill),
    kids,
    stats: box(stats),
    out: out ? { box: box(out), seen: seen(out) } : null,
    link: link ? { text: norm(link.textContent), href: link.getAttribute('href'), box: box(link), seen: seen(link), inPill: !!pill?.contains(link) } : null,
    chip: chip ? box(chip) : null,
    brand: box(brand),
    end: box(end),
    vw: innerWidth,
    focus: document.activeElement?.getAttribute('href') ?? document.activeElement?.tagName ?? null,
    ring: (() => {
      const a = document.activeElement
      if (!a || a.tagName !== 'A') return null
      const cs = getComputedStyle(a)
      return { outline: cs.outlineStyle, width: cs.outlineWidth }
    })(),
  }
}

const apart = (a, b) => !a || !b || a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t
/** a's box within b's (a pixel of rounding either way). */
const inside = (a, b) => !!a && !!b && a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1

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

async function openPage(ctx, row, urlPath, viewport = DESKTOP) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
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
  const phone = viewport.width < 760
  await waitFor(page, phone ? () => document.querySelector('main[data-view="list"] header button[aria-expanded]') !== null : () => window.__worldReady === true, {
    timeout: READY_MS,
    poll: 400,
    what: `${urlPath}: the map was not ready`,
  })
  await sleep(900)
  return page
}

async function crop(page, file, b, vp, pad = 16) {
  if (!b) return
  const x = Math.max(0, b.l - pad)
  const y = Math.max(0, b.t - pad)
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: Math.min(vp.width - x, b.w + 2 * pad), height: Math.min(vp.height - y, b.h + 2 * pad) } })
}

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, vp) => openPage(ctx, row, url(params), vp),
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

/** The header's right end (since 2026-10-15): the pill, padded. */
const groupEnd = (s) => s.pill

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

try {
  await runRow(1, 'without ?playbook: no link, the pill as it was', async (r) => {
    const page = await r.open({ hud: 'some' })
    const s = await page.evaluate(SNAP)
    r.check('no Playbook link on the page', s.link === null && (await page.evaluate(() => document.querySelectorAll('a[href="/dashboard/playbook"]').length)) === 0, s.link)
    const shown = s.kids.filter((k) => k.seen)
    // The dev page's student paid 3 days ago, so the discount's segment is up (it is for every student since 2026-10-16).
    r.check('the pill shows three parts, the stats, the discount and Sign out', shown.length === 3 && shown[0].tag === 'BUTTON' && shown[1].slot === 'discount' && shown[2].tag === 'BUTTON', s.kids)
    r.check('the empty slot takes no room', s.kids.every((k) => k.seen || k.w === 0), s.kids)
    await crop(page, 'corner-none.png', groupEnd(s), DESKTOP, 20)
  })

  await runRow(2, 'with ?playbook=1: a link to /dashboard/playbook in the pill, clear of the rest, with a focus ring', async (r) => {
    const page = await r.open({ hud: 'some', playbook: '1', discount: 'locked' })
    const s = await page.evaluate(SNAP)
    r.check('the link is there, says Playbook, goes to /dashboard/playbook', s.link?.text === 'Playbook' && s.link.href === '/dashboard/playbook' && s.link.seen, s.link)
    r.check('it is in the pill, after the stats and before Sign out', s.link?.inPill && s.stats && s.out && s.link.box.l >= s.stats.r - 1 && s.link.box.r <= s.out.box.l + 1, { stats: s.stats, link: s.link?.box, out: s.out?.box })
    r.check('the pill is the group at the header\'s right end, clear of the brand; the discount and the link are parts of it, apart', apart(s.pill, s.brand) && s.pill.r === s.end.r && inside(s.chip, s.pill) && apart(s.link?.box, s.chip) && s.link.box.l >= s.chip.r - 1, { pill: s.pill, brand: s.brand, end: s.end, chip: s.chip, link: s.link?.box })
    r.check('the link is as tall as the pill (one row)', s.link && s.pill && s.link.box.h <= s.pill.h, { link: s.link?.box, pill: s.pill })
    await crop(page, 'corner-playbook.png', groupEnd(s), DESKTOP, 20)
    await page.screenshot({ path: path.join(OUT, 'map-playbook.png') })
    // The keyboard follows the pill's order: the stats, the discount (this row has one up), the link, Sign out.
    await page.evaluate(() => document.querySelector('main header button[aria-expanded]').focus())
    await page.keyboard.press('Tab')
    await sleep(150)
    const between = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
    r.check('Tab from the stats reaches the discount first', /discount checkpoint/.test(between ?? ''), between)
    await page.keyboard.press('Tab')
    await sleep(250)
    const f = await page.evaluate(SNAP)
    r.check('the next Tab reaches the link, with the focus ring', f.focus === '/dashboard/playbook' && f.ring?.outline === 'solid', { focus: f.focus, ring: f.ring })
    await crop(page, 'corner-focus.png', groupEnd(f), DESKTOP, 20)
  })

  await runRow(3, 'phone (390x844): the link fits, clear of the chip, inside the screen', async (r) => {
    for (const [hud, discount, file] of [['some', 'locked', 'phone-playbook.png'], ['long', 'locked', 'phone-long.png'], ['long', 'no-payment', 'phone-closed.png']]) {
      const page = await r.open({ hud, playbook: '1', ...(discount ? { discount } : {}) }, PHONE)
      const s = await page.evaluate(SNAP)
      const name = `${hud}, ${discount ? 'chip up' : 'no chip'}`
      r.check(`${name}: the list view`, s.view === 'list', s.view)
      r.check(`${name}: the link is there and seen, in the pill`, s.link?.seen && s.link.inPill && s.link.href === '/dashboard/playbook', s.link)
      r.check(`${name}: the pill and the link are inside the screen (16 px gutter at least)`, s.pill && s.pill.l >= 16 && s.pill.r <= PHONE.width - 16 && s.link && s.link.box.l >= 16 && s.link.box.r <= PHONE.width - 16, { pill: s.pill, link: s.link?.box })
      // Since 2026-10-15 the stats keep the header's row (its right end) and the discount and the link drop to the row under them.
      if (discount) {
        r.check(`${name}: the discount and the link drop to the row under the stats, the discount first, apart`, s.chip && s.chip.t >= s.pill.b + 4 && s.link.box.t >= s.pill.b + 4 && apart(s.chip, s.link.box) && s.chip.r <= s.link.box.l + 1, { pill: s.pill, chip: s.chip, link: s.link?.box })
      } else {
        r.check(`${name}: with no chip the link alone drops to the row under the stats, right-aligned with them`, s.chip === null && s.link.box.t >= s.pill.b + 4 && Math.abs(s.link.box.r - s.pill.r) <= 2, { pill: s.pill, link: s.link?.box })
      }
      // The pill's segments reach past the 28 px they draw (corner.module.css .link::before):
      // the link's target is the same as the stats segment beside it.
      const target = await page.evaluate(() => {
        const h = (el) => (el ? el.getBoundingClientRect().height + 2 * Math.abs(parseFloat(getComputedStyle(el, '::before').top) || 0) : 0)
        return { link: h(document.querySelector('main header a[href="/dashboard/playbook"]')), stats: h(document.querySelector('main header button[aria-expanded]')) }
      })
      r.check(`${name}: the link's touch target is the stats segment's`, target.link > 0 && target.link === target.stats, target)
      r.row[`width_${hud}_${discount ?? 'nochip'}`] = s.pill?.w
      await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: PHONE.width, height: 200 } })
      await page.close()
    }
  })

  await runRow(4, 'wide (3428x1230): the link in the pill, clear of everything', async (r) => {
    const page = await r.open({ hud: 'long', playbook: '1', discount: 'locked' }, WIDE)
    const s = await page.evaluate(SNAP)
    r.check('the link is there and seen, in the pill', s.link?.seen && s.link.inPill, s.link)
    r.check('the pill is the group at the right end, clear of the brand; the chip and the link are parts of it, apart', apart(s.pill, s.brand) && s.pill.r === s.end.r && inside(s.chip, s.pill) && apart(s.link?.box, s.chip), { pill: s.pill, brand: s.brand, chip: s.chip, link: s.link?.box })
    await crop(page, 'wide-playbook.png', s.end, WIDE, 20)
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
