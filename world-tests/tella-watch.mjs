/**
 * Tella player, Work Item 4: the lesson player against Tella's REAL player,
 * in a real browser.
 * (_admin/prds/tella-player/tella_player_prd.md, section 12, the path table.)
 *
 *   node world-tests/tella-watch.mjs [--only T1,T6]
 *
 * Runs against the session-free harness http://localhost:3111/dev/world-app,
 * which must already be up (this script never starts a server). The harness
 * gives three pretend lessons a video when its server has two Tella video ids
 * in .env.local: a2l01 plays video A, a2l02 plays video B, a2l03 points at an
 * id no video has. The component under test is the real LessonPlayer inside
 * the real LessonScreen; its three calls are answered by the stand-in server
 * of src/app/dev/world-app/fixtureTransport.ts. Headless Chrome on the real
 * GPU, autoplay allowed, muted, 1691x1278. Takes about 7 minutes (seven
 * lesson pages watched in real time, then v6-app.mjs for row T9): run it in
 * the background.
 *
 * One PASS or FAIL line per row of the table (T1 to T9), with what was
 * measured after it. Every row loads its own fresh page in its own browser
 * context. Row T8 is read in the middle of row T1. Row T9 runs
 * `node world-tests/v6-app.mjs` and reads its totals line. The five gap rows
 * (G1 to G5) are printed as NOT COVERED with their reason and are never a
 * pass. After the rows, the MEASURED lines say what the real player was seen
 * to do. Exit code 1 on any FAIL.
 *
 * THE VIDEO IDS ARE NEVER READ, PRINTED OR SAVED HERE. From .env.local this
 * script reads the NAMES of the lines and whether each has a value, nothing
 * else: the harness has the ids, the script does not need them. Every line it
 * prints goes through scrub(), which removes anything shaped like a video id
 * or a Tella address, because a browser's own error text can carry one. The
 * videos are called "video A" and "video B".
 *
 * How playback is driven: the commands Tella's player was measured to obey,
 * posted to its frame from the page ({type:"play"}, {type:"seek", time}). The
 * 2.5x of row T4 is clicked in the player's own speed menu, inside the frame.
 * The component is never touched: a second `message` listener on the page
 * records what the frame says, an observer stamps the moment the lesson's
 * frame is put on the page and the moment a line is added under the bar
 * (window.__probe, this script's own), and window.__fixture
 * (FixtureStudentProvider) holds what the stand-in server was told.
 *
 * Screenshots: world-tests/shots/tella/ (git-ignored).
 *
 * What a row reads, so a change in the markup is found fast:
 *   harness    [data-dev-videos], [data-dev-video-seconds] (layout.tsx),
 *              window.__fixture.completed(), .watch[lessonId], .calls
 *   the frame  iframe[title="Lesson video"]
 *   progress   [role="progressbar"][aria-label="Lesson progress"] (aria-valuenow)
 *   the lines  p[role="status"] outside `main`: the "not counted" note and the
 *              no-load line
 *   lesson     the h1 outside `main`, the "Next lesson" link (aria-disabled),
 *              the back link (an `a` to the place with an arrow)
 *   the map    window.__worldReady, __worldFrameCount, __worldFrame, `main` (inert)
 *   the panel  main section[aria-labelledby="v4-panel-title"], its row buttons
 *              ("Watch lesson 1, ..." or "Lesson 1, ...")
 *   the player (inside the Tella frame) the button whose text is "1.0x", and
 *              the leaf whose text is "2.5x"
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'tella')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim().toUpperCase())) : null
const wanted = (id) => !ONLY || ONLY.has(id)

const TELLA = 'https://www.tella.tv'
const DESKTOP = { width: 1691, height: 1278 }
const LOAD_MS = 80000
/** A first visit to a route compiles it on the dev server. */
const NAV_MS = 40000
/** The player said "ready" about 3 s after its frame was asked for. */
const READY_MS = 45000
const ROW_MS = 300000
/** v6-app.mjs takes about 3 minutes. */
const CHILD_MS = 600000

// ── The fixture, as FixtureStudentProvider and fixtureTransport.ts make it ──
const AREA = 'a2'
const AREA_NAME = 'Fundamentals'
const LESSON_A = 'a2l01'
const LESSON_B = 'a2l02'
const LESSON_MISSING = 'a2l03'
const LESSON_PLAIN = 'a2l04'
const lessonTitle = (id) => `${AREA_NAME} · lesson ${Number(id.slice(-2))}`
const NO_LOAD = "This video didn't load. Refresh the page. If it keeps happening, tell the team."
const NOT_COUNTED = /^Not marked as watched yet\. You've watched (\d+)% of this lesson and it needs (\d+)%\. Skipped parts don't count\.$/
/** LessonPlayer's NO_LOAD_MS: how long the player may stay silent from the moment its frame is put on the page. */
const NO_LOAD_MS = 12000
/** Row T6 looks this long before the 12 s mark (the line must not be there) and this long after it (it must). */
const NO_LOAD_LOOK_BEFORE_MS = 600
const NO_LOAD_LOOK_AFTER_MS = 500
/** How far from 12 s the line may be put up: a timer, a render and a busy main thread. */
const NO_LOAD_EARLY_MS = 100
const NO_LOAD_LATE_MS = 500
const ENV_REQUIRED = ['DEV_TELLA_VIDEO_ID', 'DEV_TELLA_VIDEO_ID_2']
const ENV_OPTIONAL = 'DEV_TELLA_VIDEO_SECONDS'
const V6_TOTALS = 'PASS 20  FAIL 0  NOT COVERED 3'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const f = (n, d = 2) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : String(n))
const pct = (x) => (typeof x === 'number' && isFinite(x) ? `${(x * 100).toFixed(1)}%` : String(x))
/** Nothing shaped like a video id or a Tella address leaves this script. */
const scrub = (s) =>
  String(s)
    .replace(/https?:\/\/[^\s"'<>)]*tella[^\s"'<>)]*/gi, '<a Tella address>')
    .replace(/vid_[a-z0-9]+/gi, 'vid_<hidden>')
const say = (line) => console.log(scrub(line))
const show = (v, max = 520) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > max ? `${s.slice(0, max)}…` : s
}
const url = (sub, params = {}) => {
  const q = new URLSearchParams(params).toString()
  return `${APP}${sub}${q ? `?${q}` : ''}`
}
const lessonUrl = (id) => url(`/${AREA}/${id}`, { p: 'p0', arrive: 0, poster: 'off' })

/** Everything the run saw, over every page it opened. */
const tally = { pages: 0, apiStudent: [], api: [], pageErrors: [], consoleErrors: [], forbidden: [], ownHosts: new Set(), frameHosts: new Set() }
const results = []
/** One entry per load of a real video: when "ready" came, and when the frame's own load fired. */
const loadTimes = []
/** What the player said and did before anything was asked of it. */
const quiet = []
const endTimes = []
/** Row T8's readings, taken in the middle of row T1. */
let t8 = null

// ── .env.local: the names only ──────────────────────────────────────────────

/** Which of the three names have a value. The values are never kept: each line is cut at its "=". */
function envNames() {
  const file = path.join(APP_ROOT, '.env.local')
  const found = new Map()
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { missingFile: true, found }
  }
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const name = line.slice(0, eq).trim()
    if (![...ENV_REQUIRED, ENV_OPTIONAL].includes(name)) continue
    found.set(name, line.slice(eq + 1).trim().replace(/^["']|["']$/g, '').length > 0)
  }
  return { missingFile: false, found }
}

// ── Functions that run in the page ──────────────────────────────────────────

/**
 * Installed before the page's own scripts: records what the Tella frame says,
 * when the lesson's frame is put on the page, when a frame's load fires, and
 * when a line is added under the bar.
 */
const PROBE = (tellaOrigin) => {
  if (window !== window.top) return
  window.__probe = { msgs: [], loads: [], sent: [], mounts: [], lines: [] }
  window.addEventListener('message', (e) => {
    if (e.origin !== tellaOrigin) return
    let d = e.data
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d)
      } catch {
        return
      }
    }
    if (!d || typeof d !== 'object') return
    window.__probe.msgs.push({
      at: Math.round(performance.now()),
      type: String(d.type),
      state: typeof d.state === 'string' ? d.state : null,
      t: typeof d.currentTime === 'number' ? d.currentTime : null,
      d: typeof d.duration === 'number' ? d.duration : null,
    })
  })
  // A frame's `load` does not bubble, but it is seen on the way down.
  document.addEventListener(
    'load',
    (e) => {
      if (e.target && e.target.tagName === 'IFRAME') window.__probe.loads.push(Math.round(performance.now()))
    },
    true,
  )
  // Stamped as it happens, so neither time depends on how often this script
  // looks: the lesson's frame being put on the page (the player's 12 s run
  // from there), and a line being added under the bar.
  new MutationObserver((records) => {
    const at = Math.round(performance.now())
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches('iframe[title="Lesson video"]') || node.querySelector('iframe[title="Lesson video"]')) window.__probe.mounts.push(at)
        const lines = node.matches('p[role="status"]') ? [node] : [...node.querySelectorAll('p[role="status"]')]
        for (const p of lines) {
          const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text !== '' && !p.closest('main')) window.__probe.lines.push({ at, text })
        }
      }
    }
  }).observe(document, { childList: true, subtree: true })
}

/** Post one command to the lesson's frame, the way the measured player takes them. */
const SEND = ({ message, tellaOrigin }) => {
  const frame = document.querySelector('iframe[title="Lesson video"]')
  if (!frame || !frame.contentWindow) return false
  frame.contentWindow.postMessage(message, tellaOrigin)
  window.__probe.sent.push({ at: Math.round(performance.now()), ...message })
  return true
}

/** What is on the lesson page, and what the stand-in server holds for `lessonId`. */
const STATE = (lessonId) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const outside = (el) => !el.closest('main')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const frame = document.querySelector('iframe[title="Lesson video"]')
  const bar = document.querySelector('[role="progressbar"][aria-label="Lesson progress"]')
  const lines = [...document.querySelectorAll('p[role="status"]')].filter(outside).filter((p) => norm(p.textContent) !== '')
  const next = [...document.querySelectorAll('a')].filter(outside).find((a) => /Next lesson/.test(a.textContent)) ?? null
  const h1 = [...document.querySelectorAll('h1')].find(outside) ?? null
  const main = document.querySelector('main')
  const fx = window.__fixture ?? null
  const origin = performance.timeOrigin
  let words = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    words += ` ${n.textContent}`
  }
  return {
    now: Math.round(performance.now()),
    path: location.pathname,
    title: h1 ? norm(h1.textContent) : null,
    frames: document.querySelectorAll('iframe').length,
    frame: box(frame),
    frameKept: frame ? frame.__kept === true : null,
    bar: bar ? { now: Number(bar.getAttribute('aria-valuenow')), fill: bar.firstElementChild ? bar.firstElementChild.style.transform : null, box: box(bar) } : null,
    lines: lines.map((p) => ({
      text: norm(p.textContent),
      box: box(p),
      size: getComputedStyle(p).fontSize,
      color: getComputedStyle(p).color,
      seen: getComputedStyle(p).visibility === 'visible' && Number(getComputedStyle(p).opacity) > 0,
    })),
    next: next ? { disabled: next.getAttribute('aria-disabled'), href: next.getAttribute('href') } : null,
    words: norm(words),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    completed: fx ? fx.completed() : null,
    row: fx && fx.watch ? (fx.watch[lessonId] ?? null) : null,
    calls: fx && fx.calls ? fx.calls.filter((c) => c.lessonId === lessonId).map((c) => ({ ...c, at: Math.round(c.at - origin) })) : null,
    mapReady: window.__worldReady === true,
    mapFrames: typeof window.__worldFrameCount === 'number' ? window.__worldFrameCount : null,
    inert: main ? main.inert === true || main.hasAttribute('inert') : null,
  }
}

/** The frame's messages from index `from` on. */
const MSGS = (from) => ({
  total: window.__probe.msgs.length,
  list: window.__probe.msgs.slice(from),
  loads: window.__probe.loads.slice(),
  mounts: window.__probe.mounts.slice(),
  lines: window.__probe.lines.slice(),
  now: Math.round(performance.now()),
})

/** The last position report at or after index `from`, or null. */
const LAST_REPORT = (from) => {
  const m = window.__probe.msgs
  for (let i = m.length - 1; i >= from; i--) if (m[i].type === 'timeUpdate') return { ...m[i], now: Math.round(performance.now()) }
  return null
}

const FIND = {
  backLink: (pathname) => {
    const links = [...document.querySelectorAll('a')].filter((a) => !a.closest('main') && new URL(a.href, location.href).pathname === pathname)
    return links.find((a) => /←/.test(a.textContent)) ?? links[0] ?? null
  },
  panelRow: (n) =>
    document.querySelector(`main section[aria-labelledby="v4-panel-title"] button[aria-label^="Watch lesson ${n},"]`) ??
    document.querySelector(`main section[aria-labelledby="v4-panel-title"] button[aria-label^="Lesson ${n},"]`),
}

// ── Driving the page ────────────────────────────────────────────────────────

/** Poll `fn` in the page until it returns something truthy. Throws (or, with soft, returns null) after `timeout`. */
async function waitFor(page, fn, { arg, timeout = 10000, poll = 120, what, soft = false }) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch {
      // A page load in flight drops the context: look again.
    }
    if (Date.now() - t0 > timeout) {
      if (soft) return null
      throw new Error(`${what} (waited ${timeout} ms)`)
    }
    await sleep(poll)
  }
}

async function openPage(ctx, row, urlPath) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(60000)
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(PROBE, TELLA)
  page.on('pageerror', (e) => {
    const rec = { row: row.id, message: scrub(`${String(e.message).slice(0, 240)} :: ${(e.stack || '').split('\n').slice(1, 4).join(' <- ').slice(0, 400)}`) }
    row.pageErrors.push(rec)
    tally.pageErrors.push(rec)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback|Download the React DevTools/i.test(t)) return
    tally.consoleErrors.push({ row: row.id, message: scrub(t.slice(0, 300)) })
  })
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    const own = req.frame() === page.mainFrame()
    // Hosts only. A path on Tella's side can hold a video id, so it is never kept.
    if (u.origin !== ORIGIN) (own ? tally.ownHosts : tally.frameHosts).add(u.host)
    if (/supabase|discord/i.test(u.host) || u.host === 'api.tella.com') tally.forbidden.push({ row: row.id, host: u.host, from: own ? 'the page' : 'a frame' })
    if (u.origin !== ORIGIN || !u.pathname.startsWith('/api/')) return
    const rec = { row: row.id, method: req.method(), path: u.pathname }
    row.api.push(rec)
    tally.api.push(rec)
    if (u.pathname.startsWith('/api/student/')) {
      row.apiStudent.push(rec)
      tally.apiStudent.push(rec)
    }
  })
  // Headless Chrome pauses a muted video in a hidden tab: the page under test stays in front.
  await page.bringToFront()
  await page.goto(`${ORIGIN}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: LOAD_MS })
  return page
}

const waitPath = (page, pathname, what, timeout = NAV_MS) =>
  waitFor(page, (p) => location.pathname === p, { arg: pathname, timeout, what: `${what}: the address did not become ${pathname}` })

const waitLesson = (page, id, what, timeout = NAV_MS) =>
  waitFor(
    page,
    (t) => {
      const h = [...document.querySelectorAll('h1')].find((x) => !x.closest('main'))
      return !!h && h.textContent.trim() === t
    },
    { arg: lessonTitle(id), timeout, what: `${what}: the lesson page "${lessonTitle(id)}" did not show` },
  )

/** The panel of the place is open and the camera has arrived. */
async function waitPanel(page, what, timeout = 40000) {
  await waitFor(
    page,
    (name) => {
      const p = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
      if (!p || (p.querySelector('#v4-panel-title')?.textContent ?? '').trim() !== name) return false
      const fr = window.__worldFrame
      return !fr || fr.parkProgress >= 0.999
    },
    { arg: AREA_NAME, timeout, what: `${what}: the panel of ${AREA_NAME} did not open` },
  )
  await sleep(300)
}

/** Click what `find` returns: a real mouse click when it is on screen with nothing over it, a DOM click otherwise. */
async function click(page, find, arg, { what, scroll = 'none' }) {
  const handle = await page.evaluateHandle(find, arg)
  const el = handle.asElement()
  if (!el) {
    await handle.dispose()
    throw new Error(`${what}: not on the page`)
  }
  const hit = await page.evaluate(
    (node, scrollMode) => {
      if (scrollMode === 'box') {
        for (let box = node.parentElement; box && box !== document.body; box = box.parentElement) {
          const overflowY = getComputedStyle(box).overflowY
          if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight + 1) {
            const at = node.getBoundingClientRect()
            const frame = box.getBoundingClientRect()
            box.scrollTop += at.top + at.height / 2 - (frame.top + frame.height / 2)
            break
          }
        }
      }
      const r = node.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const onScreen = r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
      const top = onScreen ? document.elementFromPoint(x, y) : null
      const control = (e) => e.closest('button, a')
      if (top && (top === node || node.contains(top) || (control(top) !== null && control(top) === control(node)))) return { via: 'mouse', x, y }
      node.click()
      return { via: 'dom click' }
    },
    el,
    scroll,
  )
  await el.dispose()
  if (hit.via === 'mouse') await page.mouse.click(hit.x, hit.y)
  return hit.via
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  return path.relative(HERE, file)
}

const state = (page, lessonId) => page.evaluate(STATE, lessonId)
const msgsFrom = (page, from = 0) => page.evaluate(MSGS, from)
const messageCount = (page) => page.evaluate(() => window.__probe.msgs.length)

async function send(page, message, what) {
  const ok = await page.evaluate(SEND, { message, tellaOrigin: TELLA })
  if (!ok) throw new Error(`${what}: there is no lesson frame to send "${message.type}" to`)
}

/**
 * Wait for the player's "ready" (index `from` on). Returns when it came and
 * when the frame's own `load` fired, both in page milliseconds.
 */
async function waitReady(page, what, from = 0) {
  const at = await waitFor(page, (i) => window.__probe.msgs.slice(i).find((m) => m.type === 'ready')?.at ?? null, {
    arg: from,
    timeout: READY_MS,
    what: `${what}: the player never said "ready"`,
  })
  return at
}

/**
 * The player has said "ready" and nothing has been asked of it. Watch it for
 * `ms` and report what it said, whether it moved, and whether a heartbeat was
 * written: the three things nobody could know before a real player was tried.
 */
async function quietWatch(page, lessonId, label, from, ms = 3000) {
  const before = await state(page, lessonId)
  await sleep(ms)
  const after = await state(page, lessonId)
  const m = await msgsFrom(page, from)
  const reports = m.list.filter((x) => x.type === 'timeUpdate')
  const said = m.list.map((x) => (x.type === 'playbackState' ? `${x.type}:${x.state}` : x.type)).filter((x) => x !== 'timeUpdate')
  const beats = (c) => (c ?? []).filter((x) => x.call === 'heartbeat').length
  const rec = {
    label,
    ms,
    said: [...new Set(said)],
    reports: reports.length,
    firstReport: reports[0]?.t ?? null,
    heartbeats: beats(after.calls) - beats(before.calls),
    lastPosition: { before: before.row?.last_position_seconds ?? null, after: after.row?.last_position_seconds ?? null },
  }
  quiet.push(rec)
  return rec
}

/** Open a video lesson and wait for its player. Records when "ready" and the frame's load came. */
async function openVideoLesson(r, lessonId, what) {
  const page = await r.open(lessonUrl(lessonId))
  await waitLesson(page, lessonId, what, LOAD_MS)
  await waitFor(page, () => !!document.querySelector('iframe[title="Lesson video"]'), { timeout: NAV_MS, what: `${what}: the lesson has no video frame` })
  const readyAt = await waitReady(page, what)
  return { page, readyAt }
}

/** After the row: when the frame was put on the page, when "ready" came, and when the frame's own load fired. */
async function noteLoad(page, row, readyAt, loadIndex = 0) {
  const loadAt = await waitFor(page, (i) => window.__probe.loads[i] ?? null, { arg: loadIndex, timeout: 20000, soft: true, what: 'the frame load' })
  const mountAt = await page.evaluate((i) => window.__probe.mounts[i] ?? null, loadIndex)
  loadTimes.push({ row, readyAt, loadAt, mountAt })
}

/** Wait until the page's own clock (performance.now) reads `t` ms. Returns what it read. */
const untilPageTime = (page, t) =>
  page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const tick = () => {
          const now = performance.now()
          if (now >= target) resolve(Math.round(now))
          else setTimeout(tick, Math.min(50, Math.max(1, target - now)))
        }
        tick()
      }),
    t,
  )

/** Wait for the first position report at or after index `from`. */
const waitReport = (page, from, what, timeout = 20000) =>
  waitFor(page, LAST_REPORT, { arg: from, timeout, what: `${what}: the player reported no position` }).then(async () => {
    const m = await msgsFrom(page, from)
    return m.list.find((x) => x.type === 'timeUpdate')
  })

const waitPosition = (page, seconds, from, what, timeout) =>
  waitFor(page, ({ s, i }) => window.__probe.msgs.slice(i).some((m) => m.type === 'timeUpdate' && m.t >= s), {
    arg: { s: seconds, i: from },
    timeout,
    poll: 200,
    what: `${what}: the video did not reach ${seconds} s`,
  })

/**
 * Wait for the END of the video at or after index `from`. Returns the message.
 *
 * The real player usually ends on "stopped" and sometimes on "paused" (seen
 * 2026-10-12 on a replay: timeUpdate 67.20, then playbackState "paused" at
 * 67.27 and no "stopped" in the next 60 s). So the end is told by position:
 * a "stopped" or "paused" that sits in the last 1.5 s of the video, after a
 * position report from there. A "paused" anywhere else is an ordinary pause
 * (the player sends one at 0 after a seek to 0 from the end). The name is
 * kept; the message's own `state` says which word the player used.
 */
const waitStopped = (page, from, what, timeout) =>
  waitFor(
    page,
    ({ i, end }) => {
      const tail = window.__probe.msgs.slice(i)
      let near = false
      for (const m of tail) {
        if (m.type === 'timeUpdate') near = m.t >= end
        else if (m.type === 'playbackState' && (m.state === 'stopped' || m.state === 'paused') && near && (m.t === null || m.t === undefined || m.t >= end)) return m
      }
      return null
    },
    {
      arg: { i: from, end: SECONDS - 1.5 },
      timeout,
      poll: 200,
      what: `${what}: the player never reached the end (neither "stopped" nor "paused" in the last 1.5 s)`,
    },
  )

const waitCompleted = (page, lessonId, what, timeout) =>
  waitFor(page, (id) => window.__fixture?.completed().includes(id), { arg: lessonId, timeout, what: `${what}: ${lessonId} was not marked watched` })

const waitNote = (page, source, what, timeout) =>
  waitFor(
    page,
    (src) => {
      const re = new RegExp(src)
      return [...document.querySelectorAll('p[role="status"]')].some((p) => !p.closest('main') && re.test(p.textContent.trim()))
    },
    { arg: source, timeout, what },
  )

/** The stand-in server's calls for one lesson, in words. */
const beatsOf = (calls) => (calls ?? []).filter((c) => c.call === 'heartbeat')
const claimsOf = (calls) => (calls ?? []).filter((c) => c.call === 'claim')

/**
 * What happened when the video ended: the last heartbeat and the answer,
 * against "stopped". The frame's messages are timed by performance.now() and
 * the stand-in server's calls by Date.now(), which can disagree by a
 * millisecond or two, so a difference is never shown below zero.
 */
function endTiming(label, stopped, s) {
  const beat = beatsOf(s.calls).filter((c) => c.at >= stopped.at - 60).at(0) ?? null
  const done = claimsOf(s.calls).find((c) => c.completed) ?? null
  const rec = {
    label,
    stoppedAt: stopped.at,
    heartbeatAfterMs: beat ? Math.max(0, beat.at - stopped.at) : null,
    heartbeatForced: beat ? beat.force : null,
    completedAfterMs: done ? Math.max(0, done.at - stopped.at) : null,
    claims: claimsOf(s.calls).length,
  }
  endTimes.push(rec)
  return rec
}

/** Skip to `back` seconds before the end and play it out. Returns the "stopped" message. */
async function skipToEnd(page, seconds, back, what) {
  const from = await messageCount(page)
  await send(page, { type: 'seek', time: seconds - back }, what)
  await sleep(400)
  await send(page, { type: 'play' }, what)
  const first = await waitReport(page, from, what)
  const stopped = await waitStopped(page, from, what, 30000)
  return { first, stopped }
}

/** Open the player's own speed menu inside the Tella frame and pick `label`. */
async function pickSpeed(page, label, what) {
  const frame = page.frames().find((fr) => fr.url().startsWith(TELLA))
  if (!frame) throw new Error(`${what}: the Tella frame is not among the page's frames`)
  const box = (await state(page, LESSON_A)).frame
  // The controls show when the mouse is over the video.
  await page.mouse.move(box.left + box.w / 2, box.top + box.h / 2)
  await sleep(250)
  await page.mouse.move(box.left + box.w / 2 + 24, box.top + box.h / 2 + 12)
  await sleep(450)
  const speedLabels = () => [...document.querySelectorAll('button, [role="button"]')].map((b) => (b.textContent ?? '').trim()).filter((t) => /^\d\.\dx$/.test(t))
  const before = await frame.evaluate(speedLabels)
  const button = (await frame.evaluateHandle(() => [...document.querySelectorAll('button, [role="button"]')].find((b) => /^\d\.\dx$/.test((b.textContent ?? '').trim())) ?? null)).asElement()
  if (!button) throw new Error(`${what}: no speed button in the player`)
  await button.click()
  await sleep(600)
  const menu = await frame.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\d\.\dx$/.test((e.textContent ?? '').trim())).map((e) => e.textContent.trim()))
  const leaf = (await frame.evaluateHandle((want) => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() === want).at(-1) ?? null, label)).asElement()
  if (!leaf) throw new Error(`${what}: the menu has no "${label}" (it has ${[...new Set(menu)].join(', ')})`)
  await leaf.click()
  await sleep(700)
  const after = await frame.evaluate(speedLabels)
  return { before: [...new Set(before)], menu: [...new Set(menu)], after: [...new Set(after)] }
}

// ── Rows ────────────────────────────────────────────────────────────────────

function printRow(rec) {
  const parts = rec.checks.map((c) => `${c.ok ? 'ok' : 'NOT OK'} ${c.label}: ${show(c.got)}`)
  if (rec.error) parts.push(`STOPPED: ${rec.error}`)
  if (Object.keys(rec.values).length) parts.push(`also: ${show(rec.values, 1600)}`)
  say(`${rec.pass ? 'PASS' : 'FAIL'}  ${rec.id}  ${rec.name}: ${parts.join(' | ')}`)
}

let browser = null

async function runRow(id, name, fn) {
  if (!wanted(id)) return
  const rec = { id, name, pass: false, checks: [], values: {}, error: null, ms: 0 }
  const t0 = Date.now()
  const ctx = await browser.createBrowserContext()
  let page = null
  const row = {
    id,
    api: [],
    apiStudent: [],
    pageErrors: [],
    values: rec.values,
    check(label, ok, got) {
      rec.checks.push({ label, ok: !!ok, got })
      return !!ok
    },
    /** One page at a time: a page behind another is hidden, and a hidden video pauses. */
    async open(urlPath) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, urlPath)
      return page
    },
    shot: (label) => shot(page, `${id}-${label}`),
  }
  const work = fn(row)
  work.catch(() => {})
  let timer = null
  try {
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`row ${id}: gave up after ${ROW_MS / 1000} s`)), ROW_MS)
      }),
    ])
  } catch (e) {
    rec.error = String(e?.message ?? e)
    if (page) {
      try {
        rec.values.failedShot = await shot(page, `${id}-STOPPED`)
        rec.values.at = await page.evaluate(() => location.pathname)
        const m = await msgsFrom(page, 0)
        rec.values.playerSaid = { messages: m.total, last: m.list.slice(-3).map((x) => `${x.type}${x.state ? `:${x.state}` : ''}${x.t !== null ? ` ${f(x.t)}` : ''}`), frameLoads: m.loads.length }
      } catch {
        // the page is gone
      }
    }
  } finally {
    clearTimeout(timer)
    await ctx.close().catch(() => {})
  }
  rec.ms = Date.now() - t0
  rec.pass = !rec.error && rec.checks.length > 0 && rec.checks.every((c) => c.ok)
  results.push(rec)
  printRow(rec)
}

/** A row with no page of its own. */
function record(id, name, checks, values = {}, error = null) {
  if (!wanted(id)) return
  const rec = { id, name, pass: !error && checks.length > 0 && checks.every((c) => c.ok), checks, values, error, ms: 0 }
  results.push(rec)
  printRow(rec)
}

/**
 * Before the rows: load the lesson route once with an empty catalog (no 3D,
 * no video), so the dev server has compiled it, and read what the harness
 * says about its videos. Returns { seconds } or { down: why }.
 */
async function warmUp() {
  const ctx = await browser.createBrowserContext()
  const row = { id: 'warm-up', api: [], apiStudent: [], pageErrors: [] }
  const t0 = Date.now()
  let page = null
  try {
    for (const sub of ['', `/${AREA}`, `/${AREA}/${LESSON_A}`]) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, url(sub, { catalog: 'empty' }))
      await waitFor(page, () => /There are no lessons here yet\./.test(document.body.innerText), {
        timeout: LOAD_MS,
        poll: 250,
        what: `${APP}${sub}?catalog=empty did not show the empty-catalog card`,
      })
    }
    const seen = await page.evaluate(() => {
      const el = document.querySelector('[data-dev-videos]')
      return el ? { videos: el.getAttribute('data-dev-videos'), seconds: Number(el.getAttribute('data-dev-video-seconds')) } : null
    })
    if (!seen || seen.videos !== '2' || !(seen.seconds > 0)) {
      return {
        down: `the harness does not have the two test videos (it says ${seen ? `data-dev-videos="${seen.videos}"` : 'nothing: no [data-dev-videos] on the page'}). The dev server has not picked the lines up from .env.local, or an id is malformed. This script does not restart the server.`,
      }
    }
    say(`warm-up: the three routes render and the harness has ${seen.videos} test videos of ${seen.seconds} s (${Date.now() - t0} ms)`)
    return { seconds: seen.seconds }
  } catch (e) {
    let seen = ''
    try {
      seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    } catch {
      // no page
    }
    const errs = row.pageErrors.map((x) => x.message).slice(0, 2).join(' || ')
    return { down: `${String(e?.message ?? e)}${seen ? `; the page says: ${seen}` : ''}${errs ? `; page errors: ${errs}` : ''}` }
  } finally {
    await ctx.close().catch(() => {})
  }
}

/** Run v6-app.mjs and return its totals line. Its output is not echoed: only the totals and any FAIL line are kept. */
function runV6() {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [path.join(HERE, 'v6-app.mjs')], { cwd: APP_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let outText = ''
    let errText = ''
    child.stdout.on('data', (b) => (outText += b))
    child.stderr.on('data', (b) => (errText += b))
    const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      const lines = outText.split('\n').map((l) => l.trimEnd())
      resolve({
        code,
        seconds: Math.round((Date.now() - t0) / 1000),
        totals: lines.filter((l) => /^PASS \d+ {2}FAIL \d+ {2}NOT COVERED \d+$/.test(l)).at(-1) ?? null,
        fails: lines.filter((l) => /^FAIL /.test(l)).map((l) => l.slice(0, 500)),
        down: lines.find((l) => /^HARNESS DOWN/.test(l)) ?? null,
        stderr: errText.trim().split('\n').slice(-3).join(' / ').slice(0, 400),
      })
    })
  })
}

const ROWS = [
  ['T1', 'Watched start to finish at normal speed'],
  ['T2', 'Skipped to the last 3 s'],
  ['T3', 'Skipped first, then watched from the start'],
  ['T4', "Watched at 2.5x from the player's own menu"],
  ['T5', 'Left at about 20 s, came back'],
  ['T6', 'A video Tella refuses'],
  ['T7', 'A lesson with no video'],
  ['T8', 'The lesson page while playing'],
  ['T9', 'Nothing else broke'],
]
const nameOf = (id) => ROWS.find((r) => r[0] === id)[1]

const GAPS = [
  [
    'G1',
    'The real route for a real member, the real database function, a completion written on production',
    'nobody here. It needs v100 on production, a stamped test lesson and Lovro\'s login (ship order steps 1 to 6). The server in this run is a stand-in: fixtureTransport.ts answers the three calls from memory.',
  ],
  [
    'G2',
    'A lapsed member is refused (403), a logged-out caller is refused (401)',
    'not covered by a run: read in the route\'s code. Step 4 of the ship order makes the 401 request; no lapsed test account exists.',
  ],
  [
    'G3',
    'Safari, Firefox, Windows, a phone; a real viewer\'s click instead of a `play` command',
    'no device here (ship order step 7). Playback in this run is started by a `play` command in Chrome with autoplay allowed.',
  ],
  ['G4', 'A lesson playing in a background tab', 'headless Chrome pauses a muted video in a hidden tab, so nothing can be measured here (validation row 28).'],
  [
    'G5',
    'The alert reaching Discord',
    'no message may be sent tonight. `postTeamAlert` is called with the documented shape; Lovro fires it once in the morning if he wants the check on.',
  ],
]

// ── The run ─────────────────────────────────────────────────────────────────

const env = envNames()
const envMissing = env.missingFile ? ENV_REQUIRED : ENV_REQUIRED.filter((n) => env.found.get(n) !== true)
say(
  env.missingFile
    ? 'env: there is no .env.local in the app root'
    : `env (names only): ${ENV_REQUIRED.map((n) => `${n} ${env.found.get(n) === true ? 'has a value' : env.found.has(n) ? 'IS EMPTY' : 'IS MISSING'}`).join(', ')}, ${ENV_OPTIONAL} ${env.found.get(ENV_OPTIONAL) === true ? 'has a value' : 'is not set (the harness uses 67)'}`,
)

let down = envMissing.length ? `.env.local has no value for ${envMissing.join(' and ')}, so the harness has no video to play` : null
let SECONDS = 67

if (!down) {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    protocolTimeout: 85000,
  })
}

try {
  if (!down) {
    const warm = await warmUp()
    if (warm.down) down = warm.down
    else SECONDS = warm.seconds
  }
  if (down) {
    say(`HARNESS DOWN: ${down}`)
    for (const [id, name] of ROWS) record(id, name, [], {}, 'not run, the harness could not play a video')
  } else {
    const at95 = 0.95 * SECONDS

    // T1 ── Watched start to finish at normal speed (and T8, read in the middle of it)
    await runRow('T1', nameOf('T1'), async (r) => {
      const { page, readyAt } = await openVideoLesson(r, LESSON_A, 'T1')
      const q = await quietWatch(page, LESSON_A, 'T1, video A, first open', 0)
      const live = await waitFor(page, () => window.__worldReady === true, { timeout: 30000, poll: 250, soft: true, what: 'T1: the map under the lesson' })
      const t0 = Date.now()
      const from = await messageCount(page)
      await send(page, { type: 'play' }, 'T1')
      const first = await waitReport(page, from, 'T1')

      // Midway: the screenshot, and row T8's readings while the video runs.
      await waitPosition(page, 30, from, 'T1', 60000)
      r.values.shotMid = await r.shot('mid')
      const a = await state(page, LESSON_A)
      const ra = await page.evaluate(LAST_REPORT, from)
      await sleep(1500)
      const b = await state(page, LESSON_A)
      const rb = await page.evaluate(LAST_REPORT, from)
      t8 = {
        sceneLive: !!live,
        f0: a.mapFrames,
        f1: b.mapFrames,
        inert: b.inert,
        videoMoved: rb.t - ra.t,
        clock: (rb.at - ra.at) / 1000,
        at: ra.t,
        apiStudent: r.apiStudent.slice(),
        api: r.api.slice(),
        pageErrors: r.pageErrors.slice(),
        barMid: a.bar?.now ?? null,
      }

      const stopped = await waitStopped(page, from, 'T1', 90000)
      await waitCompleted(page, LESSON_A, 'T1', 20000)
      const clock = (Date.now() - t0) / 1000
      await sleep(700) // the bar's 200 ms, and the "Done." line
      const s = await state(page, LESSON_A)
      const m = await msgsFrom(page, from)
      const reports = m.list.filter((x) => x.type === 'timeUpdate')
      const end = endTiming('T1 (1x, nothing asked before the end)', stopped, s)
      r.values.shotEnd = await r.shot('end')
      await noteLoad(page, 'T1', readyAt)
      // A counter that stood still proves nothing unless it can move. Close the
      // lesson by its own link and read it again once the map is running.
      try {
        await click(page, FIND.backLink, `${APP}/${AREA}`, { what: 'T1: the back link' })
        await waitPath(page, `${APP}/${AREA}`, 'T1, closing the lesson')
        await waitFor(page, (n) => typeof window.__worldFrameCount === 'number' && window.__worldFrameCount > n + 5, { arg: t8.f1 ?? 0, timeout: 15000, poll: 200, soft: true, what: 'T1: the map drawing again' })
        t8.fAfter = (await state(page, LESSON_A)).mapFrames
      } catch (e) {
        t8.fAfter = null
        t8.afterError = String(e?.message ?? e)
      }
      // The whole page, not only up to the midpoint.
      t8.apiStudent = r.apiStudent.slice()
      t8.api = r.api.slice()
      t8.pageErrors = r.pageErrors.slice()

      const row = s.row
      r.check('the bar is full', s.bar?.now === 100, s.bar ? `aria-valuenow ${s.bar.now}, fill ${s.bar.fill}` : 'no progress bar')
      r.check('no note', s.lines.length === 0, s.lines.length ? s.lines.map((l) => l.text) : 'none')
      r.check(`furthest point is at least 95% of ${SECONDS} s`, !!row && row.max_position_seconds >= at95, row ? `${f(row.max_position_seconds)} s, ${pct(row.max_position_seconds / SECONDS)}` : 'no watch row')
      r.check('really watched is at least 95%', !!row && row.watched_seconds >= at95, row ? `${f(row.watched_seconds)} s, ${pct(row.watched_seconds / SECONDS)}` : 'no watch row')
      r.check('the lesson is in the completed set', s.completed?.includes(LESSON_A) === true, s.completed)
      r.check('"Next lesson" is enabled', s.next?.disabled === 'false' && s.next?.href === `${APP}/${AREA}/${LESSON_B}`, s.next)
      r.values.reports = `${reports.length} position reports from ${f(first.t)} to ${f(reports.at(-1)?.t)} s (the player says the video is ${f(reports.at(-1)?.d, 3)} s) in ${f(clock, 1)} clock s`
      r.values.heartbeats = beatsOf(s.calls).map((c) => `${f(c.position, 1)} s +${f(c.credited, 1)}${c.force ? ' forced' : ''}${c.accepted ? '' : ' REFUSED'}`)
      r.values.claims = claimsOf(s.calls).map((c) => `${c.completed ? 'completed' : c.reason} at ${pct(c.playedRatio)}`)
      r.values.atTheEnd = `"${stopped.state}" at ${f(stopped.t)} s; the end heartbeat ${end.heartbeatAfterMs} ms later; the completion ${end.completedAfterMs} ms after "stopped"`
      r.values.beforePlay = q
    })

    // T2 ── Skipped to the last 3 s
    await runRow('T2', nameOf('T2'), async (r) => {
      const { page, readyAt } = await openVideoLesson(r, LESSON_B, 'T2')
      await quietWatch(page, LESSON_B, 'T2, video B, first open', 0)
      const { first, stopped } = await skipToEnd(page, SECONDS, 3, 'T2')
      await waitNote(page, '^Not marked as watched yet\\.', 'T2: the note did not show', 15000)
      const early = await state(page, LESSON_B)
      // The claim owed to the heartbeat at the end is made when the 10 s are up.
      await waitFor(page, (id) => window.__fixture.calls.filter((c) => c.call === 'claim' && c.lessonId === id).length >= 2, {
        arg: LESSON_B,
        timeout: 20000,
        soft: true,
        what: 'T2: the second claim',
      })
      await sleep(500)
      const s = await state(page, LESSON_B)
      r.values.shot = await r.shot('note')
      await noteLoad(page, 'T2', readyAt)
      const note = s.lines[0] ?? null
      const m = note ? NOT_COUNTED.exec(note.text) : null
      const claims = claimsOf(s.calls)
      endTiming('T2 (a claim was refused 3 s before the end)', stopped, s)
      r.check('not completed', s.completed?.includes(LESSON_B) === false && s.next?.disabled === 'true', { completed: s.completed, nextLessonDisabled: s.next?.disabled ?? null })
      r.check('the note is on the page and reads as written', !!m && s.lines.length === 1, s.lines.map((l) => l.text))
      r.check('N is under 20', !!m && Number(m[1]) < 20, m ? `N = ${m[1]}, M = ${m[2]}` : null)
      r.check(
        'the note can be seen, under the progress bar',
        !!note && note.seen && note.box.h > 0 && !!s.bar && note.box.top >= s.bar.box.bottom && note.box.bottom <= s.viewport.h && !!s.frame && Math.abs(note.box.left - s.frame.left) <= 1,
        note ? { note: note.box, bar: s.bar?.box ?? null, frame: s.frame, type: `${note.size}, ${note.color}` } : null,
      )
      r.check('the frame is still there', s.frames === 1, s.frames)
      r.values.skip = `seek to ${SECONDS - 3} s, first report at ${f(first.t)} s, "${stopped.state}" at ${f(stopped.t)} s`
      r.values.row = s.row ? `furthest ${pct(s.row.max_position_seconds / SECONDS)}, really watched ${f(s.row.watched_seconds)} s (${pct(s.row.watched_seconds / SECONDS)})` : null
      r.values.claims = claims.map((c) => `${c.completed ? 'completed' : c.reason} at ${pct(c.playedRatio)}, ${c.at - stopped.at} ms from "stopped"`)
      r.values.noteFirstRead = early.lines[0]?.text ?? null
    })

    // T3 ── Skipped first, then watched from the start
    await runRow('T3', nameOf('T3'), async (r) => {
      const { page, readyAt } = await openVideoLesson(r, LESSON_B, 'T3')
      const skip = await skipToEnd(page, SECONDS, 3, 'T3, the skip')
      await waitNote(page, '^Not marked as watched yet\\.', 'T3: the note did not show after the skip', 15000)
      const before = await state(page, LESSON_B)
      const loadsBefore = (await msgsFrom(page, 0)).loads.length
      const from = await messageCount(page)
      const t0 = Date.now()
      await send(page, { type: 'seek', time: 0 }, 'T3')
      await sleep(600)
      await send(page, { type: 'play' }, 'T3')
      const first = await waitReport(page, from, 'T3, the watch from the start')
      await waitCompleted(page, LESSON_B, 'T3', 110000)
      const landed = await page.evaluate(LAST_REPORT, from)
      const stopped = await waitStopped(page, from, 'T3', 60000)
      await sleep(700)
      const s = await state(page, LESSON_B)
      const m = await msgsFrom(page, 0)
      await noteLoad(page, 'T3', readyAt)
      const claims = claimsOf(s.calls)
      r.check('after the skip it is not completed and the note shows', before.completed?.includes(LESSON_B) === false && NOT_COUNTED.test(before.lines[0]?.text ?? ''), before.lines.map((l) => l.text))
      r.check('watched from the start, it completes', s.completed?.includes(LESSON_B) === true, s.completed)
      r.check('without a reload: the same page and the same frame', m.loads.length === loadsBefore && s.frames === 1 && s.path === `${APP}/${AREA}/${LESSON_B}`, { frameLoads: m.loads.length, frames: s.frames })
      r.check('the claim was made again and answered yes', claims.length >= 2 && claims.at(-1)?.completed === true && claims[0].completed === false, claims.map((c) => `${c.completed ? 'completed' : c.reason} at ${pct(c.playedRatio)}`))
      r.check('the note is gone', s.lines.length === 0, s.lines.length ? s.lines.map((l) => l.text) : 'none')
      r.check('"Next lesson" is enabled', s.next?.disabled === 'false', s.next)
      r.values.skip = `first report at ${f(skip.first.t)} s, "${skip.stopped.state}" at ${f(skip.stopped.t)} s`
      r.values.again = `seek 0 then play: first report at ${f(first.t)} s; completed with the video at ${f(landed?.t)} s, ${f((Date.now() - t0) / 1000, 0)} clock s after the seek; "${stopped.state}" at ${f(stopped.t)} s`
      r.values.row = s.row ? `really watched ${f(s.row.watched_seconds)} s (${pct(s.row.watched_seconds / SECONDS)}), ${s.row.heartbeat_count} heartbeats` : null
    })

    // T4 ── Watched at 2.5x from the player's own menu
    await runRow('T4', nameOf('T4'), async (r) => {
      const { page, readyAt } = await openVideoLesson(r, LESSON_A, 'T4')
      const from = await messageCount(page)
      const t0 = Date.now()
      await send(page, { type: 'play' }, 'T4')
      await waitReport(page, from, 'T4')
      const speed = await pickSpeed(page, '2.5x', 'T4')
      const a = await page.evaluate(LAST_REPORT, from)
      r.values.shot = await r.shot('speed')
      await sleep(6000)
      const b = await page.evaluate(LAST_REPORT, from)
      const stopped = await waitStopped(page, from, 'T4', 90000)
      await waitCompleted(page, LESSON_A, 'T4', 20000)
      const clock = (Date.now() - t0) / 1000
      await sleep(700)
      const s = await state(page, LESSON_A)
      await noteLoad(page, 'T4', readyAt)
      endTiming('T4 (2.5x)', stopped, s)
      // Every beat after the first: what it was credited against the clock seconds since the one before.
      const beats = beatsOf(s.calls).filter((c) => c.accepted)
      const pairs = beats.slice(1).map((c, i) => ({ elapsed: (c.at - beats[i].at) / 1000, sent: c.delta, credited: c.credited }))
      const fastest = pairs.reduce((best, p) => (p.credited / p.elapsed > (best ? best.credited / best.elapsed : 0) ? p : best), null)
      const overCap = pairs.filter((p) => p.credited > p.elapsed * 2.5 + 0.05)
      const cut = pairs.filter((p) => p.sent - p.credited > 0.05)
      // Between two reports, by the reports' own times.
      const moved = b.t - a.t
      const span = (b.at - a.at) / 1000
      r.check('the menu was set to 2.5x', speed.after.length === 1 && speed.after[0] === '2.5x', speed)
      r.check('the video runs at 2.5x', moved / span > 2.3 && moved / span < 2.7, `${f(moved)} s of video in ${f(span)} clock s, ${f(moved / span)}x`)
      r.check('it completes', s.completed?.includes(LESSON_A) === true && s.next?.disabled === 'false', { completed: s.completed, nextLessonDisabled: s.next?.disabled ?? null })
      r.check('really watched is at least 80%', !!s.row && s.row.watched_seconds >= 0.8 * SECONDS, s.row ? `${f(s.row.watched_seconds)} s, ${pct(s.row.watched_seconds / SECONDS)}` : 'no watch row')
      r.check(
        'the stand-in server credited faster than the clock, and never over elapsed × 2.5',
        !!fastest && fastest.credited > fastest.elapsed * 1.5 && overCap.length === 0,
        pairs.map((p) => `sent ${f(p.sent)} s, ${f(p.elapsed)} clock s, credited ${f(p.credited)} s (${f(p.credited / p.elapsed)}x)`),
      )
      r.check('no note', s.lines.length === 0, s.lines.length ? s.lines.map((l) => l.text) : 'none')
      r.values.clock = `the ${SECONDS} s lesson took ${f(clock, 1)} clock s`
      r.values.cutByTheCap = cut.length ? cut.map((p) => `${f(p.sent - p.credited)} s of ${f(p.sent)}`) : 'nothing'
    })

    // T5 ── Left at about 20 s, came back
    await runRow('T5', nameOf('T5'), async (r) => {
      const { page, readyAt } = await openVideoLesson(r, LESSON_A, 'T5')
      const from = await messageCount(page)
      await send(page, { type: 'play' }, 'T5')
      await waitReport(page, from, 'T5')
      await waitPosition(page, 20, from, 'T5', 60000)
      const leftAt = await page.evaluate(LAST_REPORT, from)
      // Away, by the page's own link, to the place's panel.
      r.values.back = await click(page, FIND.backLink, `${APP}/${AREA}`, { what: 'T5: the back link' })
      await waitPath(page, `${APP}/${AREA}`, 'T5, leaving')
      await waitPanel(page, 'T5, leaving')
      await noteLoad(page, 'T5 (first open)', readyAt)
      const away = await state(page, LESSON_A)
      const stored = away.row?.last_position_seconds ?? null
      // And back, by the panel's own row.
      const again = await messageCount(page)
      r.values.reopen = await click(page, FIND.panelRow, 1, { what: 'T5: the row of lesson 1 in the panel', scroll: 'box' })
      await waitPath(page, `${APP}/${AREA}/${LESSON_A}`, 'T5, coming back')
      await waitLesson(page, LESSON_A, 'T5, coming back')
      // The bar as the reopened page first shows it, before the player has said anything.
      await waitFor(page, () => !!document.querySelector('[role="progressbar"][aria-label="Lesson progress"]'), { timeout: NAV_MS, what: 'T5, coming back: the lesson has no progress bar' })
      const onOpen = await state(page, LESSON_A)
      const readyAgain = await waitReady(page, 'T5, coming back', again)
      const q = await quietWatch(page, LESSON_A, 'T5, video A, reopened with a stored position (the resume seek was sent)', again)
      const mid = await state(page, LESSON_A)
      r.values.shotBackBeforePlay = await r.shot('back-before-play')
      const afterQuiet = await messageCount(page)
      await send(page, { type: 'play' }, 'T5, coming back')
      const first = await waitReport(page, afterQuiet, 'T5, coming back')
      await sleep(1500)
      const s = await state(page, LESSON_A)
      await noteLoad(page, 'T5 (reopened)', readyAgain, 1)
      r.check('leaving wrote the position', stored !== null && Math.abs(stored - leftAt.t) < 1.5, `the video was at ${f(leftAt.t)} s, the stored position is ${f(stored)} s`)
      r.check('away, the frame is gone and the panel is open', away.frames === 0 && away.path === `${APP}/${AREA}`, { frames: away.frames, path: away.path })
      r.check(
        'before play the bar already shows the stored position (between 22% and 37%)',
        !!mid.bar && mid.bar.now >= 22 && mid.bar.now <= 37,
        mid.bar ? `aria-valuenow ${mid.bar.now}, fill ${mid.bar.fill}, ${q.ms / 1000} s after "ready" and before play; the stored position is ${f(stored)} s of ${SECONDS} s, ${pct((stored ?? 0) / SECONDS)}` : 'no progress bar',
      )
      r.check(
        'nothing is written at open: no position report, no heartbeat, the stored position untouched',
        q.reports === 0 && q.heartbeats === 0 && mid.row?.last_position_seconds === stored,
        `${q.reports} reports and ${q.heartbeats} heartbeats in ${q.ms / 1000} s after "ready"; the stored position is ${f(mid.row?.last_position_seconds)} s; the player said ${q.said.length ? q.said.join(', ') : 'nothing'}`,
      )
      r.check('the first report after play is between 15 and 25 s', !!first && first.t >= 15 && first.t <= 25, first ? `${f(first.t)} s` : null)
      r.check('once it plays the bar follows the video, with no jump back', (s.bar?.now ?? 0) >= (mid.bar?.now ?? 100), s.bar ? `aria-valuenow ${s.bar.now} with the video at about ${f(first.t + 1.5, 1)} s` : null)
      r.values.resumeSeekStartedPlayback = q.reports > 0 || q.said.includes('playbackState:playing')
      r.values.barWhenThePageReopened = onOpen.bar ? `aria-valuenow ${onOpen.bar.now}, read ${f((readyAgain - onOpen.now) / 1000)} s before "ready"` : 'no bar'
      r.values.heartbeats = beatsOf(s.calls).map((c) => `${f(c.position, 1)} s +${f(c.credited, 1)}${c.force ? ' forced' : ''}`)
    })

    // T6 ── A video Tella refuses
    await runRow('T6', nameOf('T6'), async (r) => {
      const page = await r.open(lessonUrl(LESSON_MISSING))
      await waitLesson(page, LESSON_MISSING, 'T6', LOAD_MS)
      // When the frame was put on the page, stamped by the page as it happened. The 12 s run from here.
      const mountAt = await waitFor(page, () => window.__probe.mounts[0] ?? null, { timeout: NAV_MS, what: 'T6: the lesson has no video frame' })
      // Marked, so "still mounted" means this very element.
      await page.evaluate(() => {
        document.querySelector('iframe[title="Lesson video"]').__kept = true
      })
      // Shortly before the 12 s mark the line must not be there, and shortly after it must.
      await untilPageTime(page, mountAt + NO_LOAD_MS - NO_LOAD_LOOK_BEFORE_MS)
      const before = await state(page, LESSON_MISSING)
      await untilPageTime(page, mountAt + NO_LOAD_MS + NO_LOAD_LOOK_AFTER_MS)
      const s = await state(page, LESSON_MISSING)
      const m = await msgsFrom(page, 0)
      r.values.shot = await r.shot('no-load')
      let frameSays = null
      try {
        const frame = page.frames().find((fr) => fr.url().startsWith(TELLA))
        frameSays = frame ? (await frame.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim())).slice(0, 120) : 'no Tella frame among the page\'s frames'
      } catch {
        frameSays = 'could not be read'
      }
      const line = s.lines[0] ?? null
      // When the page itself added the line, against the frame's mount.
      const added = m.lines.find((l) => l.text === NO_LOAD) ?? null
      const after = added ? added.at - mountAt : null
      const loadAt = m.loads[0] ?? null
      const sec = (ms) => f(ms / 1000)
      r.check('the line reads as written', s.lines.length === 1 && line.text === NO_LOAD, s.lines.map((l) => l.text))
      r.check(
        'shortly before the 12 s mark the line is not there',
        before.lines.length === 0 && before.now - mountAt < NO_LOAD_MS - NO_LOAD_EARLY_MS,
        `looked ${sec(before.now - mountAt)} s after the frame was put on the page: ${before.lines.length === 0 ? 'no line' : before.lines.map((l) => l.text)}`,
      )
      r.check(
        '12 s after the frame is put on the page the line is shown',
        after !== null && after >= NO_LOAD_MS - NO_LOAD_EARLY_MS && after <= NO_LOAD_MS + NO_LOAD_LATE_MS && s.lines.length === 1,
        after === null
          ? `never added; looked ${sec(s.now - mountAt)} s after the frame was put on the page`
          : `added ${sec(after)} s after the frame was put on the page (which was ${sec(mountAt)} s into the page load), and on the page when looked at ${sec(s.now - mountAt)} s after it`,
      )
      r.check('the line is under the progress bar', !!line && line.seen && !!s.frame && !!s.bar && line.box.top >= s.bar.box.bottom && s.bar.box.top >= s.frame.bottom && Math.abs(line.box.left - s.frame.left) <= 1, line ? { line: line.box, bar: s.bar?.box ?? null, frame: s.frame } : null)
      r.check('the frame is still mounted, the same element', s.frames === 1 && s.frameKept === true && m.mounts.length === 1, { frames: s.frames, sameElement: s.frameKept, timesAFrameWasPutOnThePage: m.mounts.length })
      r.check('Tella said nothing', m.total === 0, `${m.total} messages`)
      r.check('nothing was written and nothing counted', s.row === null && s.completed?.includes(LESSON_MISSING) === false && s.bar?.now === 0, { row: s.row, bar: s.bar?.now ?? null })
      // A measurement, no longer what the 12 s are counted from.
      r.values.theFramesOwnLoad = loadAt === null ? 'never fired' : `fired ${sec(loadAt - mountAt)} s after the frame was put on the page${after !== null ? `, ${sec(mountAt + after - loadAt)} s before the line` : ''}`
      r.values.theFrameSays = frameSays
    })

    // T7 ── A lesson with no video
    await runRow('T7', nameOf('T7'), async (r) => {
      const page = await r.open(lessonUrl(LESSON_PLAIN))
      await waitLesson(page, LESSON_PLAIN, 'T7', LOAD_MS)
      await sleep(2500) // long enough for a frame to have been asked for, had one been coming
      const s = await state(page, LESSON_PLAIN)
      r.values.shot = await r.shot('not-recorded')
      r.check('"Not recorded yet." shows', /Not recorded yet\./.test(s.words), /Not recorded yet\./.test(s.words))
      r.check('no frame', s.frames === 0, s.frames)
      r.check('nothing was asked of the stand-in server', s.calls?.length === 0, s.calls)
      r.check('no progress bar and no line', s.bar === null && s.lines.length === 0, { bar: s.bar, lines: s.lines.map((l) => l.text) })
    })

    // T8 ── The lesson page while playing: read in the middle of T1.
    if (wanted('T8')) {
      if (!t8) {
        record('T8', nameOf('T8'), [], {}, wanted('T1') ? 'not measured: row T1 stopped before its midpoint' : 'not measured: this row is read during T1, which was not run')
      } else {
        record(
          'T8',
          nameOf('T8'),
          [
            { label: 'requests to /api/student/* from the T1 page', ok: t8.apiStudent.length === 0, got: t8.apiStudent.length === 0 ? 0 : t8.apiStudent.map((x) => `${x.method} ${x.path}`) },
            { label: 'page errors on the T1 page', ok: t8.pageErrors.length === 0, got: t8.pageErrors.length === 0 ? 0 : t8.pageErrors.map((x) => x.message).slice(0, 3) },
            {
              label: 'the map behind is paused while the video runs',
              ok: t8.sceneLive && typeof t8.f0 === 'number' && t8.f0 === t8.f1 && t8.inert === true && t8.videoMoved > 1,
              got: `__worldFrameCount ${t8.f0} then ${t8.f1}, ${f(t8.clock)} s later, while the video went from ${f(t8.at)} to ${f(t8.at + t8.videoMoved)} s; the map root is inert: ${t8.inert}; the scene was live: ${t8.sceneLive}`,
            },
            {
              label: 'that counter can move: it ran once the lesson was closed',
              ok: typeof t8.fAfter === 'number' && t8.fAfter > t8.f1,
              got: t8.afterError ? `could not be read: ${t8.afterError}` : `${t8.f1} under the lesson, ${t8.fAfter} after it closed`,
            },
            {
              label: 'over every page of this run: requests to /api/student/*, to Supabase, to Discord or to api.tella.com',
              ok: tally.apiStudent.length === 0 && tally.forbidden.length === 0,
              got: tally.apiStudent.length + tally.forbidden.length === 0 ? 0 : [...tally.apiStudent.map((x) => `row ${x.row}: ${x.method} ${x.path}`), ...tally.forbidden.map((x) => `row ${x.row}: ${x.host} from ${x.from}`)].slice(0, 6),
            },
          ],
          {
            pagesOpened: tally.pages,
            otherApiRequestsToThisApp: tally.api.length - tally.apiStudent.length,
            pageErrorsOverTheRun: tally.pageErrors.length,
            consoleErrors: tally.consoleErrors.length,
            ...(tally.consoleErrors.length ? { firstConsoleErrors: [...new Set(tally.consoleErrors.map((x) => `row ${x.row}: ${x.message}`))].slice(0, 3) } : {}),
            otherHostsThePageItselfAsked: [...tally.ownHosts],
            hostsTheTellaFrameAsked: [...tally.frameHosts],
            barAtTheMidpoint: t8.barMid,
          },
        )
      }
    }
  }
} finally {
  // Closed before T9: v6-app.mjs starts a Chrome of its own, and two share one GPU badly.
  if (browser) await browser.close().catch(() => {})
}

// T9 ── Nothing else broke
if (!down && wanted('T9')) {
  const v6 = await runV6()
  record(
    'T9',
    nameOf('T9'),
    [{ label: `node world-tests/v6-app.mjs ends "${V6_TOTALS}"`, ok: v6.totals === V6_TOTALS && v6.code === 0, got: v6.totals ?? `no totals line (exit code ${v6.code})` }],
    { exitCode: v6.code, seconds: v6.seconds, ...(v6.fails.length ? { itsFailLines: v6.fails } : {}), ...(v6.down ? { itSaid: v6.down.slice(0, 300) } : {}), ...(v6.stderr ? { stderr: v6.stderr } : {}) },
  )
}

for (const [id, name, why] of GAPS) say(`NOT COVERED  ${id}  ${name}: ${why}`)

// ── What the real player was seen to do ─────────────────────────────────────
if (loadTimes.length) {
  const sec = (ms) => f(ms / 1000)
  const parts = loadTimes.map((x) => {
    const ready = x.mountAt === null ? `"ready" ${sec(x.readyAt)} s into the page (the frame's mount was not stamped)` : `"ready" ${sec(x.readyAt - x.mountAt)} s`
    const load = x.loadAt === null ? 'no load seen' : x.mountAt === null ? `load ${sec(x.loadAt)} s into the page` : `load ${sec(x.loadAt - x.mountAt)} s`
    return `${x.row}: ${ready}, ${load}`
  })
  const waits = loadTimes.filter((x) => x.mountAt !== null).map((x) => x.readyAt - x.mountAt)
  const seen = loadTimes.filter((x) => x.loadAt !== null)
  const readyFirst = seen.filter((x) => x.readyAt <= x.loadAt).length
  say(
    `MEASURED  "ready" and the frame's own load, each counted from the moment the frame was put on the page, ${loadTimes.length} loads of a real video: ${parts.join('; ')}. Longest wait for "ready": ${waits.length ? `${sec(Math.max(...waits))} s` : 'not measured'} (the no-load line goes up at ${NO_LOAD_MS / 1000} s). "ready" came before the load in ${readyFirst} of ${seen.length}`,
  )
}
for (const q of quiet) {
  say(
    `MEASURED  before play (${q.label}): in the ${q.ms / 1000} s after "ready" the player said ${q.said.length ? q.said.join(', ') : 'nothing'}; position reports ${q.reports}${q.firstReport !== null ? ` (first at ${f(q.firstReport)} s)` : ''}; heartbeats written ${q.heartbeats}; stored position ${q.lastPosition.before === null ? 'none' : f(q.lastPosition.before)} then ${q.lastPosition.after === null ? 'none' : f(q.lastPosition.after)}`,
  )
}
for (const e of endTimes) {
  say(
    `MEASURED  at the end (${e.label}): the end heartbeat ${e.heartbeatAfterMs === null ? 'WAS NOT SENT' : `${e.heartbeatAfterMs} ms after "stopped"${e.heartbeatForced ? ', forced' : ''}`}; ${e.completedAfterMs === null ? 'not completed' : `completed ${e.completedAfterMs} ms after "stopped"`}; ${e.claims} claim${e.claims === 1 ? '' : 's'} in all`,
  )
}

const passed = results.filter((x) => x.pass).length
const failed = results.length - passed
if (ONLY) say(`partial run: rows ${[...ONLY].join(', ')} only`)
say(`PASS ${passed}  FAIL ${failed}  NOT COVERED ${GAPS.length}`)
process.exit(failed > 0 ? 1 : 0)
