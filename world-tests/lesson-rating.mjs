/**
 * The lesson page's "How was this lesson?" block in a real browser (admin
 * rebuild 2, D10, lane WI-7): src/components/world/LessonRating.tsx under
 * src/components/world/LessonScreen.tsx, on the session-free harness
 * /dev/world-app with its pretend student (no login, no server call; ratings
 * in memory, src/app/dev/world-app/fixtureRatings.ts).
 *
 *   node world-tests/lesson-rating.mjs
 *
 * Opens BASE_URL (default http://localhost:3111): a development server
 * started for the run in the app root. This script never starts one.
 *
 *   who      the block shows on a finished video lesson (and appears the
 *            moment one is finished), and never on a lesson not finished, a
 *            video action item whose hand-in is still open, a setup step or
 *            the Ad Bounty lesson
 *   keyboard Tab to the stars, the arrow keys pick, Tab to the comment and
 *            to Save, Enter saves; "Saving…", then "You rated it 4 of 5.",
 *            the comment, Edit, and the focus on the saved line
 *   edit     Edit puts the saved rating back in the form; Cancel changes
 *            nothing; Save with nothing changed sends nothing; a mouse click
 *            on a star and Save change it; another lesson's block starts
 *            empty, and the first one keeps its rating
 *   limit    the counter from 100 characters left, and no more than 1000
 *   fail     ?rating=refuse and ?rating=offline: the sentence under the
 *            buttons, the stars and the comment kept, the focus on Save;
 *            ?rating=slow: "Saving…" with every control off
 *   saved    ?rating=saved: the ratings a student already gave
 *   phone    at 390x844 every star, Save, Cancel and Edit is 44px tall or
 *            more, nothing runs past the right edge, and every word in the
 *            block measures 4.5:1 on the phone's solid card
 *
 * Every page: no em dash, "unlock" or "EcomTalent" in what the block shows
 * or announces; no request to another host (the browser cannot even resolve
 * one: --host-resolver-rules), no console error, no uncaught exception.
 * Screenshots go to SHOTS (default world-tests/shots/rating/, which git
 * ignores). One ok or FAIL line per check, then PASS / FAIL. Exit code 1 on
 * any FAIL. About 2 minutes.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = (process.env.BASE_URL || 'http://localhost:3111').replace(/\/$/, '')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.SHOTS || fileURLToPath(new URL('./shots/rating/', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BANNED = [/—/, /\bunlock/i, /ecomtalent/i]
const DESKTOP = [1440, 900]
const PHONE = [390, 844]

let passed = 0
let failed = 0
const failures = []
const expect = (c, label, detail = '') => {
  if (c) { passed++; console.log(`  ok   ${label}`) }
  else { failed++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The course's video action items, read from the catalog the harness serves.
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/catalog/course_catalog.json'), 'utf8'))
const VIDEO_ACTION = catalog.lessons.find((l) => l.type === 'watch' && l.action_brief)
const SETUP = catalog.lessons.find((l) => l.type === 'setup')
const BOUNTY = catalog.lessons.find((l) => l.feature_key === 'bounty_access')

fs.mkdirSync(OUT, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-rating-chrome-'))
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir,
  protocolTimeout: 180000,
  // The map is WebGL: the real GPU, as world-tests/v6-app.mjs runs it. No host
  // but this machine resolves, so not even a preconnect leaves it.
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars',
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'],
})
const page = await browser.newPage()
const offMachine = []
const consoleErrors = []
const pageErrors = []
await page.setRequestInterception(true)
page.on('request', (req) => {
  const u = req.url()
  if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue()
  // The root layout's Vercel Analytics script, answered here and empty (as admin-pages.mjs does).
  if (new URL(u).hostname === 'va.vercel-scripts.com') return req.respond({ status: 200, contentType: 'application/javascript', body: '' })
  offMachine.push(u.split('?')[0])
  return req.abort()
})
const NOISE = /Download the React DevTools|favicon|\[HMR\]|\[Fast Refresh\]/i
page.on('console', (msg) => { if (msg.type() === 'error' && !NOISE.test(msg.text())) consoleErrors.push(msg.text()) })
page.on('pageerror', (e) => pageErrors.push(String(e)))

const BLOCK = 'section[data-rating]'
async function open(sub, query, size = DESKTOP) {
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 1 })
  await page.goto(`${ORIGIN}/dev/world-app${sub}${query ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  // The lesson page's title: the h1 outside the map's <main>.
  await page.waitForFunction(() => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.trim()), { timeout: 120000 })
  await sleep(300)
}
const block = () => page.$(BLOCK)
const state = () => page.$eval(BLOCK, (s) => s.dataset.rating).catch(() => null)
const blockText = () => page.$eval(BLOCK, (s) => s.innerText.replace(/\s+/g, ' ').trim()).catch(() => '')
const checked = () => page.$$eval(`${BLOCK} input[type="radio"]`, (rs) => rs.findIndex((r) => r.checked) + 1)
const fixtureCalls = () => page.evaluate(() => (window.__fixtureRatings?.calls ?? []).map((c) => ({ ...c })))
const fixtureSaved = () => page.evaluate(() => window.__fixtureRatings?.saved() ?? null)
const button = (label) => page.evaluateHandle((sel, l) => [...(document.querySelector(sel)?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === l) ?? null, BLOCK, label)
const activeIs = (fn) => page.evaluate(fn)

/** Scrolls the lesson's own scroll box (never the page, whose scroll is the map's camera) so the block is in view. */
async function showBlock() {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return
    let box = el.parentElement
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    if (!box) return
    const r = el.getBoundingClientRect()
    box.scrollTop += r.top - Math.max(16, (innerHeight - r.height) / 2)
  }, BLOCK)
  await sleep(150)
}
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), captureBeyondViewport: false })
}

/** The block's words, placeholders, labels and announcements, and its sideways overflow. */
async function words(label) {
  const w = await page.evaluate((sel) => {
    const s = document.querySelector(sel)
    if (!s) return null
    const announced = [...s.querySelectorAll('[placeholder], [aria-label], [title]')]
      .flatMap((e) => ['placeholder', 'aria-label', 'title'].map((a) => e.getAttribute(a)).filter(Boolean))
    return [s.innerText, ...announced].join('\n')
  }, BLOCK)
  const found = w === null ? [] : BANNED.filter((re) => re.test(w))
  expect(w !== null && found.length === 0, `${label}: no em dash, "unlock" or "EcomTalent" in what the block shows or announces`, found.join(' '))
}

/** Every text run in the block against the colours under it, on the phone's solid card. */
async function contrast(label) {
  const low = await page.evaluate((sel) => {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
    const over = (t, u) => { const a = t.a + u.a * (1 - t.a); const mix = (k) => (t[k] * t.a + u[k] * u.a * (1 - t.a)) / a; return { r: mix('r'), g: mix('g'), b: mix('b'), a } }
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    const bg = (el) => { const layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a >= 1) break } let acc = { r: 0, g: 0, b: 0, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc); return acc }
    const out = []
    const s = document.querySelector(sel)
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = t.textContent.trim()
      const el = t.parentElement
      if (!text || el.closest('.sr-only') || el.closest(':disabled')) continue
      const fg = parse(getComputedStyle(el).color)
      const r = ratio(over(fg, bg(el)), bg(el))
      if (r < 4.5) out.push(`"${text.slice(0, 30)}" ${r.toFixed(2)}`)
    }
    // The placeholder, drawn in its own colour.
    const ta = s.querySelector('textarea')
    if (ta && !ta.value) {
      const ph = parse(getComputedStyle(ta, '::placeholder').color)
      const r = ratio(over(ph, bg(ta)), bg(ta))
      if (r < 4.5) out.push(`placeholder ${r.toFixed(2)}`)
    }
    return out
  }, BLOCK)
  expect(low.length === 0, `${label}: every word in the block at 4.5:1 or more`, low.join('; '))
}

/** Targets under 44px: each star's box, and the block's buttons. */
const smallTargets = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} label, ${sel} button`)]
  .filter((e) => e.tagName === 'BUTTON' || e.querySelector('input[type="radio"]'))
  .map((e) => ({ text: e.textContent.trim() || e.querySelector('input')?.getAttribute('aria-label'), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))
  .filter((x) => x.h > 0 && (x.h < 44 || (x.text?.includes('star') && x.w < 44))), BLOCK)
const overflowX = () => page.evaluate(() => {
  const s = document.querySelector('section[data-rating]')
  const r = s?.getBoundingClientRect()
  return { page: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth, block: r ? Math.round(r.right - innerWidth) : null }
})

try {
  // ══════════════════════════════════════════════════════════════════════
  console.log('\nwho gets the block')
  {
    await open('/a1/a1l01', 'p=mid')
    expect(await state() === 'empty', 'a finished video lesson (a1l01, ?p=mid): the block, empty', String(await state()))
    await showBlock()
    await shot('rating-empty-1440')
    await words('a1l01, empty')
    const radios = await page.$$eval(`${BLOCK} input[type="radio"]`, (rs) => rs.map((r) => r.getAttribute('aria-label')))
    expect(JSON.stringify(radios) === JSON.stringify(['1 star', '2 stars', '3 stars', '4 stars', '5 stars']) && await checked() === 0,
      'five radios, "1 star" to "5 stars", none picked', JSON.stringify(radios))
    const group = await page.$eval(`${BLOCK} [role="radiogroup"]`, (g) => document.getElementById(g.getAttribute('aria-labelledby'))?.textContent.trim())
    expect(group === 'How was this lesson?', 'the stars are a radio group named "How was this lesson?"', String(group))
    expect(!(await page.$(`${BLOCK} textarea`)), 'no comment box until a star is picked')

    await open('/a3/a3l07', 'p=mid')
    expect(await state() === 'empty', 'a finished action item with a video, hand-in in (a3l07): the block', String(await state()))

    await open('/a4/a4l20', 'p=mid')
    expect(!(await block()), 'a lesson not finished (a4l20): no block')
    await shot('rating-hidden-not-finished-1440')
    const mark = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mark watched (dev)') ?? null)
    await mark.click()
    await page.waitForSelector(BLOCK, { timeout: 5000 })
    expect(await state() === 'empty', 'the moment it is finished (Mark watched), the block appears')

    await open(`/${VIDEO_ACTION.area}/${VIDEO_ACTION.id}`, 'catalog=course')
    expect(!(await block()), `${VIDEO_ACTION.id}, a video action item not finished: no block`)
    const mark2 = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mark watched (dev)') ?? null)
    await mark2.click()
    await sleep(400)
    expect(!(await block()), `${VIDEO_ACTION.id} with its video watched and the hand-in open: still no block, as the map has it not done`)
    await page.evaluate((id) => window.__fixture.complete(id), VIDEO_ACTION.id)
    await page.waitForSelector(BLOCK, { timeout: 5000 }).catch(() => null)
    expect(!!(await block()), `${VIDEO_ACTION.id} done: the block`)

    for (const [what, l] of [['a setup step', SETUP], ['the Ad Bounty lesson', BOUNTY]]) {
      await open(`/${l.area}/${l.id}`, 'catalog=course')
      await page.evaluate((id) => window.__fixture.complete(id), l.id)
      await sleep(400)
      const done = await page.evaluate(() => document.body.innerText.includes('Done.'))
      expect(!(await block()), `${what} (${l.id}), finished: no block`, `the page says Done.: ${done}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\nkeyboard: pick, write, save')
  {
    await open('/a1/a1l01', 'p=mid')
    await showBlock()
    await page.focus(`${BLOCK} input[type="radio"]`)
    await page.keyboard.press('Space')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    expect(await checked() === 4 && await state() === 'picking', 'Space then the right arrow 3 times: 4 stars picked', `picked ${await checked()}`)
    expect((await blockText()).includes('4 of 5') && !!(await page.$(`${BLOCK} textarea`)), '"4 of 5" beside the stars, and the comment box')
    await page.keyboard.press('Tab')
    expect(await activeIs(() => document.activeElement?.tagName === 'TEXTAREA'), 'Tab: the comment box')
    await page.keyboard.type('Clear, and the example at the end helped.')
    await showBlock()
    await shot('rating-picking-1440')
    await page.keyboard.press('Tab')
    expect(await activeIs(() => document.activeElement?.textContent.trim() === 'Save'), 'Tab: Save')
    await page.keyboard.press('Enter')
    const saving = await page.waitForFunction((sel) => document.querySelector(sel)?.innerText.includes('Saving…'), { timeout: 2000 }, BLOCK).then(() => true).catch(() => false)
    expect(saving, 'Enter: "Saving…" while the save is on its way')
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.rating === 'saved', { timeout: 5000 }, BLOCK)
    const text = await blockText()
    expect(text.includes('You rated it 4 of 5.') && text.includes('Clear, and the example at the end helped.') && text.includes('Edit'),
      'saved: "You rated it 4 of 5.", the comment and Edit', text)
    expect(await activeIs(() => /You rated it 4 of 5\./.test(document.activeElement?.textContent ?? '')), 'the focus is on the saved line, for a screen reader')
    expect(JSON.stringify(await fixtureCalls()) === JSON.stringify([{ lessonId: 'a1l01', stars: 4, comment: 'Clear, and the example at the end helped.', answer: null }]),
      'one save: a1l01, 4 stars, the comment', JSON.stringify(await fixtureCalls()))
    await showBlock()
    await shot('rating-saved-1440')
    await words('a1l01, saved')

    console.log('\nedit')
    await (await button('Edit')).click()
    await sleep(150)
    expect(await state() === 'editing' && await checked() === 4 && (await page.$eval(`${BLOCK} textarea`, (t) => t.value)) === 'Clear, and the example at the end helped.',
      'Edit: the form with 4 stars and the comment')
    expect(await activeIs(() => document.activeElement?.getAttribute('aria-label') === '4 stars'), 'the focus on the 4th star')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    expect(await checked() === 2, 'the left arrow twice: 2 stars')
    await (await button('Cancel')).click()
    await sleep(150)
    expect(await state() === 'saved' && (await blockText()).includes('You rated it 4 of 5.') && (await fixtureCalls()).length === 1,
      'Cancel: back to the saved 4, nothing sent')
    expect(await activeIs(() => document.activeElement?.textContent.trim() === 'Edit'), 'the focus back on Edit')
    await (await button('Edit')).click()
    await sleep(150)
    await (await button('Save')).click()
    await sleep(200)
    expect(await state() === 'saved' && (await fixtureCalls()).length === 1, 'Save with nothing changed: back to the saved rating, nothing sent')
    await (await button('Edit')).click()
    await sleep(150)
    await page.$$eval(`${BLOCK} label`, (ls) => ls[4].click())
    await (await button('Save')).click()
    await page.waitForFunction((sel) => document.querySelector(sel)?.innerText.includes('You rated it 5 of 5.'), { timeout: 5000 }, BLOCK)
    const calls = await fixtureCalls()
    expect(calls.length === 2 && calls[1].stars === 5 && calls[1].comment === 'Clear, and the example at the end helped.',
      'a click on the 5th star and Save: 5 of 5, the comment kept', JSON.stringify(calls[1]))

    // The stage's own link to the next lesson: an in-app trip, the ratings stay in memory.
    const next = await page.evaluateHandle(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Next lesson')) ?? null)
    await next.click()
    await page.waitForFunction(() => location.pathname.endsWith('/a1/a1l02'), { timeout: 30000 })
    await page.waitForSelector(BLOCK, { timeout: 30000 })
    expect(await state() === 'empty' && await checked() === 0, 'the next lesson (a1l02): its own block, empty: nothing carried over')
    await page.goBack()
    await page.waitForFunction((sel) => location.pathname.endsWith('/a1/a1l01') && document.querySelector(sel)?.dataset.rating === 'saved', { timeout: 30000 }, BLOCK)
    expect((await blockText()).includes('You rated it 5 of 5.'), 'back on a1l01: its rating, 5 of 5')
    const saved = await fixtureSaved()
    expect(JSON.stringify(saved) === JSON.stringify({ a1l01: { stars: 5, comment: 'Clear, and the example at the end helped.' } }), 'what the stand-in holds', JSON.stringify(saved))
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\nthe 1000 characters')
  {
    await open('/a1/a1l02', 'p=mid')
    await page.$$eval(`${BLOCK} label`, (ls) => ls[2].click())
    await page.waitForSelector(`${BLOCK} textarea`)
    await page.focus(`${BLOCK} textarea`)
    await page.keyboard.type('a'.repeat(899))
    expect(!(await blockText()).includes('characters left'), '899 characters: no counter yet')
    await page.keyboard.type('a')
    expect((await blockText()).includes('100 characters left'), '900: "100 characters left"')
    await page.keyboard.type('b'.repeat(120))
    const len = await page.$eval(`${BLOCK} textarea`, (t) => t.value.length)
    expect(len === 1000 && (await blockText()).includes('0 characters left'), 'past 1000 the box takes nothing more: "0 characters left"', String(len))
    const described = await page.$eval(`${BLOCK} textarea`, (t) => document.getElementById((t.getAttribute('aria-describedby') ?? '').split(' ')[0])?.textContent.trim())
    expect(described === '0 characters left', 'and the box is described by the counter', String(described))
    await (await button('Save')).click()
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.rating === 'saved', { timeout: 5000 }, BLOCK)
    expect((await fixtureCalls()).at(-1)?.comment.length === 1000, 'the 1000 characters are saved whole')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\nwhen the save fails')
  for (const [mode, sentence] of [['refuse', "Couldn't save your rating. Try again."], ['offline', "Couldn't reach the server. Nothing was saved, so try again."]]) {
    await open('/a1/a1l01', `p=mid&rating=${mode}`)
    await page.$$eval(`${BLOCK} label`, (ls) => ls[3].click())
    await page.waitForSelector(`${BLOCK} textarea`)
    await page.type(`${BLOCK} textarea`, 'Kept when it fails.')
    await (await button('Save')).click()
    await page.waitForSelector(`${BLOCK} [role="alert"]`, { timeout: 5000 })
    const alert = await page.$eval(`${BLOCK} [role="alert"]`, (a) => a.textContent.trim())
    expect(alert === sentence, `?rating=${mode}: "${sentence}" under the buttons`, alert)
    expect(await state() === 'picking' && await checked() === 4 && (await page.$eval(`${BLOCK} textarea`, (t) => t.value)) === 'Kept when it fails.',
      `?rating=${mode}: the 4 stars and the comment kept, nothing shown as saved`)
    expect(await activeIs(() => document.activeElement?.textContent.trim() === 'Save'), `?rating=${mode}: the focus on Save, to try again`)
    if (mode === 'refuse') {
      await showBlock()
      await shot('rating-error-1440')
      await words('a1l01, a refused save')
    }
  }
  {
    await open('/a1/a1l01', 'p=mid&rating=slow')
    await page.$$eval(`${BLOCK} label`, (ls) => ls[3].click())
    await page.waitForSelector(`${BLOCK} textarea`)
    await (await button('Save')).click()
    await sleep(500)
    const off = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} input, ${sel} textarea, ${sel} button`)].every((e) => e.disabled), BLOCK)
    expect((await blockText()).includes('Saving…') && off, '?rating=slow: "Saving…", and every star, the box and both buttons off until the answer')
    await showBlock()
    await shot('rating-saving-1440')
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.rating === 'saved', { timeout: 8000 }, BLOCK)
    expect(true, '...then saved')
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\nratings already given')
  {
    await open('/a1/a1l01', 'p=mid&rating=saved')
    expect(await state() === 'saved' && (await blockText()).includes('You rated it 4 of 5.') && (await blockText()).includes('The example ad at the end helped the most.'),
      '?rating=saved: a1l01 shows 4 of 5 and its comment', await blockText())
    await open('/a1/a1l02', 'p=mid&rating=saved')
    expect(await state() === 'saved' && (await blockText()).includes('You rated it 5 of 5.') && !(await page.$(`${BLOCK} [class*="savedComment"]`)),
      'a1l02 shows 5 of 5 and no comment', await blockText())
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log('\nphone, 390x844')
  {
    await open('/a1/a1l01', 'p=mid', PHONE)
    await showBlock()
    let small = await smallTargets()
    expect(small.length === 0, 'empty: every star is a 44px box', JSON.stringify(small))
    let ox = await overflowX()
    expect(ox.page <= 0 && ox.block <= 0, 'empty: nothing past the right edge', JSON.stringify(ox))
    await contrast('empty, on the phone')
    await shot('rating-empty-390')
    await page.$$eval(`${BLOCK} label`, (ls) => ls[3].click())
    await page.waitForSelector(`${BLOCK} textarea`)
    await page.type(`${BLOCK} textarea`, 'Short and clear.')
    await showBlock()
    small = await smallTargets()
    expect(small.length === 0, 'picking: the stars, Save and Cancel are 44px tall or more', JSON.stringify(small))
    ox = await overflowX()
    expect(ox.page <= 0 && ox.block <= 0, 'picking: nothing past the right edge', JSON.stringify(ox))
    const font = await page.$eval(`${BLOCK} textarea`, (t) => getComputedStyle(t).fontSize)
    expect(font === '16px' || !(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)), 'the comment box is 16px on a touch screen (no zoom on iOS)', font)
    await contrast('picking, on the phone')
    await shot('rating-picking-390')
    await (await button('Save')).click()
    await page.waitForFunction((sel) => document.querySelector(sel)?.dataset.rating === 'saved', { timeout: 5000 }, BLOCK)
    await showBlock()
    small = await smallTargets()
    expect(small.length === 0, 'saved: Edit is 44px tall', JSON.stringify(small))
    await contrast('saved, on the phone')
    await shot('rating-saved-390')
    await open('/a1/a1l01', 'p=mid&rating=refuse', PHONE)
    await page.$$eval(`${BLOCK} label`, (ls) => ls[1].click())
    await page.waitForSelector(`${BLOCK} textarea`)
    await (await button('Save')).click()
    await page.waitForSelector(`${BLOCK} [role="alert"]`, { timeout: 5000 })
    await showBlock()
    await contrast('a refused save, on the phone')
    ox = await overflowX()
    expect(ox.page <= 0 && ox.block <= 0, 'a refused save: nothing past the right edge', JSON.stringify(ox))
    await shot('rating-error-390')
  }
} catch (e) {
  expect(false, `the run finished`, String(e?.stack ?? e).slice(0, 400))
}

console.log('\nevery page the run opened')
expect(offMachine.length === 0, `no request left the machine: ${offMachine.length}`, [...new Set(offMachine)].slice(0, 3).join(', '))
expect(consoleErrors.length === 0, `no error in the browser console: ${consoleErrors.length}`, consoleErrors.slice(0, 3).join(' || '))
expect(pageErrors.length === 0, `no uncaught exception in a page: ${pageErrors.length}`, pageErrors.slice(0, 3).join(' || '))
await browser.close()
fs.rmSync(userDataDir, { recursive: true, force: true })
console.log(`\n${'='.repeat(60)}\n  PASS ${passed}   FAIL ${failed}`)
if (failed) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)) }
process.exit(failed ? 1 : 0)
