/**
 * The Ad Bounty checkpoint (map review 2026-10-15, plan item 18), walked in a
 * real browser.
 *
 *   node world-tests/v6-bounty.mjs [--only 1,3]
 *
 * Lovro at 13:23 to 14:09 of the review: "how to win on the bounty program,
 * that is going to require another checkpoint. So this is not going to be
 * inside creative strategy ... and then here we go through the crates. We
 * definitely don't want to go through the crates ... maybe on this island
 * over here. Just think of something nice again, clickable, and then that is
 * going to have the one video for bounties."
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-course.mjs and v6-discount.mjs: the real stage, map, place route and
 * lesson page, a pretend student, no login, no server call. Headless Chrome on
 * the real GPU, 1691x1278 (row 6 at 390x844). About 3 minutes.
 *
 * One PASS or FAIL line per row, with what was measured. Every row loads its
 * own page in its own browser context. After the rows, one MEASURED line:
 * requests to /api, requests to Supabase and page errors over every page the
 * run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  the board in the world: the scene has the landmark LM_Bounty; from the
 *      rope bridge (0.3044 of the way from Creative Strategy's stop to How To
 *      Land Clients', the review picture w-bounty) the checkpoint's marker is
 *      up as a plaque saying "Ad Bounty", on screen, over the board; the
 *      timeline has its tag, "Ad Bounty", on its post between the 7th and 8th
 *      diamonds. A student with nothing watched: it is always open.
 *   2  the marker opens the panel (a real mouse click on the plaque): the
 *      camera parks at the board's view (BOUNTY.park, typed below), the panel
 *      says Checkpoint, after Creative Strategy, "Ad Bounty", one plain line,
 *      and holds the one lesson, its title read from course_catalog.json, "Not
 *      recorded yet" (it has no length in course-lengths.fixture.json, so no
 *      video) and no Watch; the panel sits left of the board's pin; focus is on
 *      its heading. Esc comes home: the panel goes, the camera is back on the
 *      rail where it was, the page scrolls again.
 *   3  the timeline's tag opens it from the opening frame, far from the isle:
 *      the scroll jumps to the rail point that frames the board (scene
 *      depthFor: the point whose view 400 ahead comes nearest it, the bridge's
 *      head on the Sky Island), the camera parks; Back to map leaves it there,
 *      the board and its marker in view.
 *   4  Creative Strategy's panel no longer lists it: its 18 rows, none of
 *      them and no button with the lesson's title, no "Ad Bounty" anywhere in it.
 *   5  its lesson page: the panel's row opens /dev/world-app/a7/a7l19 with the
 *      lesson's title as its heading, and the place it is filed under does not
 *      open under it (the camera stays parked at the board); the page names
 *      the checkpoint, not the place: its eyebrow "Checkpoint · Ad Bounty"
 *      with no "Creative Strategy" in it, its back link "Ad Bounty" to the
 *      map's address. The browser's back, the back link and Esc (each from a
 *      fresh open of the page) all come home to the map's address with the
 *      checkpoint's panel still up, no place's panel, the camera at the board.
 *   6  a phone (390x844): the list keeps the eight places' rows, and a row
 *      "Ad Bounty checkpoint" sits in Creative Strategy's item; it opens the
 *      sheet with the lesson, whose row opens the lesson page.
 *   7  the camera goes through nothing on the way to the ship and off it: at
 *      every sample from the rope bridge's isle end to the flight's first key
 *      (every 2 units) and from the last flight key to How To Land Clients'
 *      stop (every 2 units), with the flight between (every 40), no triangle
 *      of the isle's dressing (Sky_Land, the board's Bounty_Board, the mooring
 *      ropes) or of your airship (Airship_Art, its deck cargo and helm) within
 *      NEAR_GAP of the camera, the near plane being 2. The nearest triangle and
 *      what it belongs to are printed, so the measure is seen to reach real
 *      geometry (the isle's top and the deck lie about 12 under the camera),
 *      and a control puts the camera inside the board, which must be caught.
 *      Before the change the stack of crates stood on this walk (the frame
 *      went dark inside it at 0.366 of the stretch) and the boarding went
 *      through the ship's wheel (0.408). The wheel now stands where it stood,
 *      at 0.7 its size (dress-sky.ts), its top 2.7 under the camera: the
 *      nearest triangle on the walk.
 *   8  Creative Strategy's last lesson does not lead into it: with every
 *      lesson watched (?p=all), the page of the lesson before it in the
 *      catalog (a7l18) has no "Next lesson" and no link to its page anywhere,
 *      while the control, the lesson before that (a7l17), has "Next lesson"
 *      to a7l18 (so the check finds such a link when there is one).
 *   9  one checkpoint's panel gives way to the other's (?discount=locked):
 *      the tag opens the bounty's panel, focus on its heading; the header's
 *      discount segment then parks the camera at the cache with the
 *      discount's panel up and focus on ITS heading (#cp-panel-title), not
 *      left on the segment; Esc comes home.
 *  10  its page opened by its address (a refresh, a link from outside the
 *      map), so no checkpoint panel stood under it: nothing opens behind the
 *      page, and Esc, then in a fresh page the back link, come home to the
 *      checkpoint's panel all the same, parked at the board, no place's panel,
 *      focus on its heading. Before WorldV6 opened the checkpoint for such a
 *      page, both landed on the opening frame with no panel.
 *
 * Pictures for a person, in world-tests/shots/v6/bounty/ (git-ignored):
 *   world-bridge.png   the isle from the rope bridge, the marker and the tag (row 1)
 *   panel.png          parked at the board, the panel open (row 2)
 *   timeline-tag.png   the timeline round the two checkpoints' tags (row 1)
 *   lesson-page.png    the lesson's page over the parked board (row 5)
 *   phone-list.png     the phone's list round the checkpoint's row (row 6)
 *   phone-sheet.png    the phone's sheet (row 6)
 *
 * What a row reads:
 *   hooks      window.__worldReady, __worldFrame, __worldScrollFor(depth),
 *              __worldCheckpoint("bounty") (shown, open, mode, marker, panel,
 *              depth), __worldPark, __worldLandmarks, __worldCamera(),
 *              __worldV6Debug (debugRail, seedDepth, debugScene) for row 7
 *   the marker main button[data-mode][aria-label^="Ad Bounty checkpoint"], its
 *              plaque = last child
 *   the tag    main nav[aria-label="Places"] button[data-gate="bounty"]; the
 *              places' diamonds: nav[aria-label="Places"] > div > button:not([data-cp])
 *   the panel  main section[aria-labelledby="bounty-panel-title"], #bounty-panel-title,
 *              its ol's row (a button whose aria-label starts with the lesson's title)
 *   the place  main section[aria-labelledby="v4-panel-title"], its ol > li rows
 *   phone      main ol > li > button[aria-label^="Ad Bounty checkpoint"],
 *              main section[role="dialog"][aria-labelledby="bounty-panel-title"]
 *   lesson     the h1 outside `main`; its eyebrow is the p before it, and its
 *              back link the a in the row before that (LessonScreen.tsx)
 *   discount   main header button[aria-label*="discount checkpoint"] (the
 *              header's segment), main section[aria-labelledby="cp-panel-title"]
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'bounty')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const PARK_MS = 30000
const NAV_MS = 40000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

// ── What is expected, typed here on purpose ─────────────────────────────────

/** The lesson, read from the course file the dev page serves: the one row with the bounty key. */
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase', 'catalog', 'course_catalog.json'), 'utf8'))
const LESSON = CATALOG.lessons.find((l) => l.feature_key === 'bounty_access')
const LENGTHS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'app', 'dev', 'world-app', 'course-lengths.fixture.json'), 'utf8'))
/** Creative Strategy: the place the lesson is filed under, and the 7th of the 8. */
const PLACE = { k: 6, id: 'a7', name: 'Creative Strategy', counting: 18 }
/** Row 8: the place's lessons before the bounty's in the catalog, the last (a7l18) and the one before it (a7l17, the control). */
const BEFORE = (() => {
  const own = CATALOG.lessons.filter((l) => l.area === PLACE.id)
  const at = own.findIndex((l) => l.id === LESSON?.id)
  return at >= 2 ? { last: own[at - 1], control: own[at - 2] } : null
})()
/** The board's view (src/lib/world-v6/bounty.ts BOUNTY.park). */
const PARK = { x: -1735, y: 1650, z: -2330, bearing: 28, pitch: 6 }
/** The board's centre (bounty.ts: 58 along the walk from the bridge's isle end, 34 to its left), for row 7's control. */
const BOARD = { x: -1689.6, z: -2408.0 }
/** The rope bridge's picture (v6-review-shots.mjs w-bounty): share of the route from stop a7 to a8. */
const ON_BRIDGE = 0.3044
/** The camera's near plane is 2 (scene.ts NEAR): no triangle may come this close. */
const NEAR_GAP = 2.5

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

// ── In the page ─────────────────────────────────────────────────────────────

const FIND = {
  marker: () => {
    const b = document.querySelector('main button[data-mode][aria-label^="Ad Bounty checkpoint"]')
    return b ? (b.dataset.mode === 'text' ? b.lastElementChild : b) : null
  },
  tag: () => document.querySelector('main nav[aria-label="Places"] button[data-gate="bounty"]'),
  back: () => [...(document.querySelector('main section[aria-labelledby="bounty-panel-title"]')?.querySelectorAll('button') ?? [])].find((b) => /Back to map/.test(b.textContent)) ?? null,
  lessonRow: (title) => {
    const ol = document.querySelector('main section[aria-labelledby="bounty-panel-title"] ol')
    return [...(ol?.querySelectorAll('button') ?? [])].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(title) || (b.getAttribute('aria-label') ?? '') === `Watch ${title}`) ?? null
  },
  phoneRow: () => document.querySelector('main ol > li > button[aria-label^="Ad Bounty checkpoint"]'),
  /** The lesson page's back link: the a in the row before its eyebrow (LessonScreen.tsx). */
  lessonBack: () => [...document.querySelectorAll('h1')].find((h) => !h.closest('main'))?.previousElementSibling?.previousElementSibling?.querySelector('a') ?? null,
  /** The header's discount segment. */
  chip: () => document.querySelector('main header button[aria-label*="discount checkpoint"]'),
}

/** The lesson page as drawn: its heading, its eyebrow's words, its back link, its "Next lesson" links, and every link to the bounty's page. */
const LESSON_PAGE = (bountyPath) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const h1 = [...document.querySelectorAll('h1')].find((h) => !h.closest('main'))
  if (!h1) return null
  const eyebrow = h1.previousElementSibling
  const back = eyebrow?.previousElementSibling?.querySelector('a') ?? null
  return {
    title: norm(h1.textContent),
    eyebrow: [...(eyebrow?.children ?? [])].map((c) => norm(c.textContent)).filter(Boolean).join(' '),
    back: back ? { text: norm(back.textContent.replace('←', '')), href: back.getAttribute('href') } : null,
    next: [...document.querySelectorAll('a')].filter((a) => !a.closest('main') && /Next lesson/.test(a.textContent)).map((a) => a.getAttribute('href')),
    toBounty: [...document.querySelectorAll('a[href]')].filter((a) => a.getAttribute('href').split('?')[0].endsWith(bountyPath)).length,
  }
}

/** What the map shows of the Ad Bounty's checkpoint right now. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const marker = document.querySelector('main button[data-mode][aria-label^="Ad Bounty checkpoint"]')
  const tag = document.querySelector('main nav[aria-label="Places"] button[data-gate="bounty"]')
  const stops = [...document.querySelectorAll('main nav[aria-label="Places"] > div > button:not([data-cp])')]
  const panel = document.querySelector('main section[aria-labelledby="bounty-panel-title"]')
  const rows = panel ? [...panel.querySelectorAll('ol > li')] : []
  const fr = window.__worldFrame ?? null
  const cam = window.__worldCamera?.() ?? null
  return {
    path: location.pathname,
    y: Math.round(scrollY),
    locked: document.body.style.overflow === 'hidden',
    marker: marker ? { mode: marker.dataset.mode, label: norm(marker.lastElementChild?.textContent), aria: marker.getAttribute('aria-label'), box: box(marker.lastElementChild) } : null,
    tag: tag ? { state: tag.dataset.cp, text: norm(tag.textContent), label: tag.getAttribute('aria-label'), box: box(tag) } : null,
    stops: stops.map((b) => box(b)),
    panel: panel
      ? {
          title: norm(panel.querySelector('#bounty-panel-title')?.textContent),
          eyebrow: norm(panel.querySelector('#bounty-panel-title')?.previousElementSibling?.textContent),
          text: norm(panel.textContent),
          rows: rows.map((li) => ({ text: norm(li.textContent), button: li.querySelector('button')?.getAttribute('aria-label') ?? null, watch: !!li.querySelector('button[aria-label^="Watch "]') })),
          box: box(panel),
          focusHeading: document.activeElement === panel.querySelector('#bounty-panel-title'),
        }
      : null,
    cp: window.__worldCheckpoint?.('bounty') ?? null,
    park: fr ? { id: fr.parkedId, p: fr.parkProgress, depth: fr.depth } : null,
    cam: cam ? { x: cam.x, y: cam.y, z: cam.z, bearing: ((Math.atan2(cam.dx, -cam.dz) * 180) / Math.PI + 360) % 360, pitch: cam.pitch } : null,
    lesson: norm([...document.querySelectorAll('h1')].find((h) => !h.closest('main'))?.textContent) || null,
  }
}

/** Creative Strategy's panel as drawn: its title, its rows' labels, its buttons' words outside the list, its whole text. */
const PLACE_PANEL = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  if (!panel) return null
  const ol = panel.querySelector('ol')
  return {
    title: norm(panel.querySelector('#v4-panel-title')?.textContent),
    rows: ol ? [...ol.querySelectorAll(':scope > li')].map((li) => norm(li.querySelector('button')?.getAttribute('aria-label') ?? li.textContent)) : [],
    after: [...panel.querySelectorAll('button')].filter((b) => !ol || !ol.contains(b)).map((b) => norm(b.textContent)),
    text: norm(panel.textContent),
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

function listen(page, row) {
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
}

async function openPage(ctx, row, urlPath) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 })
  listen(page, row)
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
  listen(page, row)
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  await waitFor(page, () => document.querySelector('main[data-view="list"] ol > li > button') !== null, { timeout: READY_MS, poll: 400, what: `${urlPath}: the phone's list was not ready` })
  await sleep(900)
  return page
}

/** The rail depth at share g of the route from stop k to stop k + 1. */
const depthAt = (page, k, g) =>
  page.evaluate(
    ({ k, g }) => {
      const r = window.__worldV6Debug.debugRail()
      return r.depthOfS(r.stopS[k] + g * (r.stopS[k + 1] - r.stopS[k]))
    },
    { k, g },
  )

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
  await sleep(600)
}

async function parked(page, what) {
  await waitFor(page, () => window.__worldFrame?.parkedId === 'bounty' && window.__worldFrame.parkProgress >= 0.999 && !!document.querySelector('main section[aria-labelledby="bounty-panel-title"]'), {
    timeout: PARK_MS,
    what: `${what}: the camera did not park at the board with the panel open`,
  })
  await sleep(800)
}

async function home(page, what) {
  await waitFor(page, () => !document.querySelector('main section[aria-labelledby="bounty-panel-title"]') && (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== 'hidden', {
    timeout: PARK_MS,
    what: `${what}: the panel did not close and the camera did not come home`,
  })
  await sleep(300)
}

/** Click an element the way a person would when it is on top, else through the DOM. */
async function click(page, find, arg, what) {
  const via = await page.evaluate(
    ({ src, arg }) => {
      const el = new Function(`return (${src})`)()(arg)
      if (!el) return null
      el.scrollIntoView?.({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const top = r.width > 0 ? document.elementFromPoint(x, y) : null
      if (top && (top === el || el.contains(top) || top.closest('button') === el.closest('button'))) return { mouse: true, x, y }
      el.click()
      return { mouse: false }
    },
    { src: find.toString(), arg },
  )
  if (!via) throw new Error(`${what}: not on the page`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  return via.mouse ? 'mouse' : 'dom click'
}

/** A part of the screen (viewport px). Puppeteer's clip is in page px, cut to the visible viewport, so the scroll is added. */
async function crop(page, file, b, pad = 16, view = DESKTOP) {
  if (!b) return
  const x = Math.max(0, b.l - pad)
  const y = Math.max(0, b.t - pad)
  const at = await page.evaluate(() => ({ x: window.visualViewport.pageLeft, y: window.visualViewport.pageTop }))
  await page.screenshot({ path: path.join(OUT, file), captureBeyondViewport: false, clip: { x: x + at.x, y: y + at.y, width: Math.min(view.width - x, b.w + 2 * pad), height: Math.min(view.height - y, b.h + 2 * pad) } })
}
const shot = (page, file) => page.screenshot({ path: path.join(OUT, file), captureBeyondViewport: false })

/**
 * Row 7, in the page: the nearest triangle of the isle's dressing and your
 * ship to the camera at route distance s. The static meshes' triangles near
 * the isle are gathered once (world space); the ship's in its own frame, the
 * camera taken into it through the group's matrix at each sample (the ship
 * moves with the rail).
 */
const NEAREST = ({ s }) => {
  const sc = window.__worldV6Debug
  const scene = sc.debugScene()
  const cache = (window.__bountyTris ??= (() => {
    const pick = (name) => {
      let found = null
      scene.traverse((o) => {
        if (!found && o.isMesh && o.name === name) found = o
      })
      return found
    }
    const world = []
    for (const name of ['Sky_Land', 'Bounty_Board', 'Sky_MooringRopes']) {
      const m = pick(name)
      if (!m) continue
      m.updateWorldMatrix(true, false)
      const e = m.matrixWorld.elements
      const p = m.geometry.getAttribute('position')
      for (let i = 0; i + 2 < p.count; i += 3) {
        const t = []
        for (let k = 0; k < 3; k++) {
          const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k)
          t.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14])
        }
        // Only what stands near the walk from the bridge's isle end to the gangway (and the docks are elsewhere).
        const cx = (t[0] + t[3] + t[6]) / 3
        const cz = (t[2] + t[5] + t[8]) / 3
        if (cx < -1760 || cx > -1500 || cz < -2600 || cz > -2280) continue
        world.push({ t, name })
      }
    }
    const ship = pick('Airship_Art')
    const local = []
    if (ship) {
      const p = ship.geometry.getAttribute('position')
      for (let i = 0; i + 2 < p.count; i += 3) {
        const t = []
        for (let k = 0; k < 3; k++) t.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k))
        local.push({ t, name: 'Airship_Art' })
      }
    }
    return { world, local, ship }
  })())
  // Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5), squared distance.
  const d2 = (px, py, pz, t) => {
    const ax = t[0], ay = t[1], az = t[2], bx = t[3], by = t[4], bz = t[5], cx = t[6], cy = t[7], cz = t[8]
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az
    const apx = px - ax, apy = py - ay, apz = pz - az
    const d1 = abx * apx + aby * apy + abz * apz, d2_ = acx * apx + acy * apy + acz * apz
    let qx, qy, qz
    if (d1 <= 0 && d2_ <= 0) { qx = ax; qy = ay; qz = az } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz } else {
        const vc = d1 * d4 - d3 * d2_
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v } else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz } else {
            const vb = d5 * d2_ - d1 * d6
            if (vb <= 0 && d2_ >= 0 && d6 <= 0) { const w = d2_ / (d2_ - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w } else {
              const va = d3 * d6 - d5 * d4
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w } else {
                const den = 1 / (va + vb + vc), v = vb * den, w = vc * den
                qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w
              }
            }
          }
        }
      }
    }
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
  }
  const cam = sc.cameraPose()
  let best = Infinity
  let bestName = null
  for (const { t, name } of cache.world) {
    const v = d2(cam.x, cam.y, cam.z, t)
    if (v < best) { best = v; bestName = name }
  }
  if (cache.ship) {
    cache.ship.updateWorldMatrix(true, false)
    const inv = cache.ship.matrixWorld.clone().invert().elements
    const lx = inv[0] * cam.x + inv[4] * cam.y + inv[8] * cam.z + inv[12]
    const ly = inv[1] * cam.x + inv[5] * cam.y + inv[9] * cam.z + inv[13]
    const lz = inv[2] * cam.x + inv[6] * cam.y + inv[10] * cam.z + inv[14]
    for (const { t, name } of cache.local) {
      const v = d2(lx, ly, lz, t)
      if (v < best) { best = v; bestName = name }
    }
  }
  return { s, d: Math.sqrt(best), name: bestName, cam: [cam.x, cam.y, cam.z].map((n) => Math.round(n * 10) / 10), world: cache.world.length, local: cache.local.length }
}

// ── Rows ────────────────────────────────────────────────────────────────────

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], values: {}, pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    ctx,
    values: row.values,
    open: (params, sub) => openPage(ctx, row, url(params, sub)),
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

/** The panel holds the one lesson, not recorded, and says what the checkpoint is. */
function checkPanel(r, s) {
  const p = s.panel
  r.check('the panel says Checkpoint, after Creative Strategy', !!p && /^Checkpoint\s*after Creative Strategy/.test(p.eyebrow), p?.eyebrow ?? null)
  r.check('its title is "Ad Bounty", with one plain line under it', !!p && p.title === 'Ad Bounty' && /Make ads for real brands/.test(p.text), p ? { title: p.title, text: p.text.slice(0, 160) } : null)
  r.check(`it holds one lesson: "${LESSON.title}"`, !!p && p.rows.length === 1 && p.rows[0].text.includes(LESSON.title) && !!p.rows[0].button && p.rows[0].button.startsWith(LESSON.title), p?.rows ?? null)
  const recorded = LENGTHS[LESSON.id] !== undefined
  r.check(
    recorded ? 'it has a video on the dev page: Watch' : 'no video on the dev page (no length in the fixture): "Not recorded yet", no Watch',
    !!p && p.rows.length === 1 && (recorded ? p.rows[0].watch : !p.rows[0].watch && /Not recorded yet/i.test(p.rows[0].text)),
    p?.rows[0] ?? null,
  )
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
})

try {
  if (!LESSON) throw new Error('course_catalog.json has no lesson with the bounty key')

  // 1 ── The board in the world
  await runRow(1, 'The board in the world: its marker from the bridge, its tag on the timeline', async (r) => {
    const page = await r.open({})
    const names = await page.evaluate(() => window.__worldLandmarks ?? [])
    r.check('the scene has the landmark LM_Bounty', names.includes('LM_Bounty'), names.filter((n) => /Bounty|Checkpoint/.test(n)))
    await railTo(page, await depthAt(page, PLACE.k, ON_BRIDGE), 'row 1')
    await sleep(600)
    const s = await page.evaluate(SNAP)
    r.values.marker = s.marker
    r.check('from the bridge the marker is up as a plaque, "Ad Bounty"', s.marker?.mode === 'text' && s.marker.label === 'Ad Bounty', s.marker)
    r.check('its plaque is on screen, in the frame\'s upper half over the isle', !!s.marker?.box && s.marker.box.l >= 0 && s.marker.box.r <= DESKTOP.width && s.marker.box.t >= 0 && s.marker.box.b < DESKTOP.height / 2, s.marker?.box ?? null)
    r.check('the scene projects it visible', s.cp?.marker?.visible === true && s.cp.shown === true, s.cp)
    const st = s.stops
    const tagX = s.tag ? (s.tag.box.l + s.tag.box.r) / 2 : NaN
    const left = st[PLACE.k] ? (st[PLACE.k].l + st[PLACE.k].r) / 2 : NaN
    const right = st[PLACE.k + 1] ? (st[PLACE.k + 1].l + st[PLACE.k + 1].r) / 2 : NaN
    r.check('the timeline has its tag, "Ad Bounty", open', s.tag?.text === 'Ad Bounty' && s.tag.state === 'open', s.tag)
    r.check('the tag stands between the 7th and 8th diamonds', st.length === 8 && tagX > left && tagX < right, { tagX, between: [left, right] })
    await shot(page, 'world-bridge.png')
    if (s.tag) await crop(page, 'timeline-tag.png', { l: s.tag.box.l - 520, t: s.tag.box.t - 10, w: 760, h: 90, r: 0, b: 0 }, 0)
  })

  // 2 ── The marker opens the panel
  await runRow(2, 'The marker opens the panel, parked at the board; Esc comes home', async (r) => {
    const page = await r.open({})
    const depth = await depthAt(page, PLACE.k, ON_BRIDGE)
    await railTo(page, depth, 'row 2')
    const before = await page.evaluate(SNAP)
    r.values.click = await click(page, FIND.marker, null, 'row 2: the marker\'s plaque')
    await parked(page, 'row 2')
    const s = await page.evaluate(SNAP)
    const c = s.cam
    const off = c ? Math.hypot(c.x - PARK.x, c.y - PARK.y, c.z - PARK.z) : NaN
    const db = c ? Math.abs(((c.bearing - PARK.bearing + 540) % 360) - 180) : NaN
    r.check('the camera parks at the board\'s view (BOUNTY.park)', s.park?.id === 'bounty' && off < 0.5 && db < 0.5 && Math.abs((c?.pitch ?? NaN) - PARK.pitch) < 0.5, { park: s.park, cam: c, off })
    checkPanel(r, s)
    const pin = s.cp?.marker
    r.check('the panel sits on the left, the board\'s pin right of it', !!s.panel && !!pin && s.panel.box.r < pin.x && s.panel.box.l < DESKTOP.width / 3, { panel: s.panel?.box, pin })
    r.check('focus is on the panel\'s heading', s.panel?.focusHeading === true, s.panel?.focusHeading)
    r.check('the page scroll is locked', s.locked, s.locked)
    await shot(page, 'panel.png')
    await page.keyboard.press('Escape')
    await home(page, 'row 2')
    const h = await page.evaluate(SNAP)
    r.check('Esc: the panel goes, the camera is back on the rail where it was, the page scrolls again', !h.panel && h.park?.id === null && Math.abs(h.park.depth - before.park.depth) < 2e-4 && !h.locked, { before: before.park, after: h.park, locked: h.locked })
  })

  // 3 ── The timeline's tag, from far away
  await runRow(3, 'The timeline\'s tag opens it from the opening frame; Back leaves the board in view', async (r) => {
    const page = await r.open({})
    const at0 = await page.evaluate(SNAP)
    r.values.click = await click(page, FIND.tag, null, 'row 3: the tag')
    await parked(page, 'row 3')
    const s = await page.evaluate(SNAP)
    const want = s.cp?.depth
    r.check('the scroll jumped to the rail point that frames the board, the camera parked', at0.park?.depth < 0.01 && Math.abs(s.park.depth - want) < 1e-3 && s.park.id === 'bounty', { from: at0.park?.depth, at: s.park?.depth, frames: want })
    checkPanel(r, s)
    await click(page, FIND.back, null, 'row 3: Back to map')
    await home(page, 'row 3')
    await sleep(600)
    const h = await page.evaluate(SNAP)
    const share = await page.evaluate((d) => {
      const r = window.__worldV6Debug.debugRail()
      return (r.sOfDepth(d) - r.stopS[6]) / (r.stopS[7] - r.stopS[6])
    }, h.park.depth)
    r.check('Back leaves the camera on the rail point that frames the board, on the way to it, the panel gone', !h.panel && Math.abs(h.park.depth - want) < 1e-3 && share > 0 && share < ON_BRIDGE, { depth: h.park.depth, frames: want, share })
    r.check('from there the board\'s marker is on screen', h.cp?.marker?.visible === true && h.marker?.mode !== 'hidden', { marker: h.cp?.marker, mode: h.marker?.mode })
  })

  // 4 ── Creative Strategy no longer lists it
  await runRow(4, 'Creative Strategy\'s panel no longer lists the Ad Bounty\'s lesson', async (r) => {
    const page = await r.open({ p: 'partial' })
    await page.evaluate((id) => window.__worldPark(id), PLACE.id)
    await waitFor(page, () => !!document.querySelector('main section[aria-labelledby="v4-panel-title"]') && (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { timeout: PARK_MS, what: 'row 4: Creative Strategy did not open' })
    await sleep(800)
    const p = await page.evaluate(PLACE_PANEL)
    r.check(`the panel is ${PLACE.name}'s`, p?.title === PLACE.name, p?.title ?? null)
    r.check('none of its rows is the bounty lesson', !!p && p.rows.length > 0 && !p.rows.some((x) => x.includes(LESSON.title)), p ? { rows: p.rows.length, first: p.rows.slice(0, 2) } : null)
    r.check('no button outside the list holds it, and no "Ad Bounty" anywhere in the panel', !!p && !p.after.some((t) => t.includes(LESSON.title)) && !/Ad Bounty/.test(p.text), p ? { after: p.after, mentions: /Ad Bounty/.test(p.text) } : null)
    // The fold row at ?p=partial holds the 6 watched: count every lesson the panel lists.
    const listed = await page.evaluate(() => {
      const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
      const fold = panel?.querySelector('button[data-state="fold"]')
      if (fold) fold.click()
      return true
    })
    await sleep(500)
    const p2 = await page.evaluate(PLACE_PANEL)
    r.check(`unfolded, it lists exactly the ${PLACE.counting} counting lessons`, listed && p2?.rows.length === PLACE.counting, p2 ? p2.rows.length : null)
  })

  // 5 ── Its lesson page
  await runRow(5, 'The panel\'s row opens the lesson page over the board; the browser\'s back comes home to the panel', async (r) => {
    const page = await r.open({})
    await page.evaluate(() => window.__worldPark('bounty'))
    await parked(page, 'row 5')
    r.values.click = await click(page, FIND.lessonRow, LESSON.title, 'row 5: the lesson\'s row')
    await waitFor(page, (p) => location.pathname === p, { arg: `${APP}/${PLACE.id}/${LESSON.id}`, timeout: NAV_MS, what: 'row 5: the address did not change to the lesson' })
    await waitFor(page, (t) => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.replace(/\s+/g, ' ').trim() === t), { arg: LESSON.title, timeout: NAV_MS, what: 'row 5: no lesson page' })
    await sleep(1200)
    const s = await page.evaluate(SNAP)
    r.check(`it opens ${APP}/${PLACE.id}/${LESSON.id}, headed with the lesson's title`, s.path === `${APP}/${PLACE.id}/${LESSON.id}` && s.lesson === LESSON.title, { path: s.path, lesson: s.lesson })
    r.check('the place it is filed under did not open under it: no place panel, the camera still at the board', !(await page.evaluate(() => !!document.querySelector('main section[aria-labelledby="v4-panel-title"]'))) && s.park?.id === 'bounty', s.park)
    // The page names the checkpoint, not the place (Lovro, 13:31: "this is not going to be inside creative strategy").
    const lp = await page.evaluate(LESSON_PAGE, `/${PLACE.id}/${LESSON.id}`)
    r.values.page = lp
    r.check('its eyebrow is "Checkpoint · Ad Bounty", with no "Creative Strategy" in it', lp?.eyebrow === 'Checkpoint · Ad Bounty' && !lp.eyebrow.includes(PLACE.name), lp?.eyebrow ?? null)
    r.check('its back link reads "Ad Bounty" and goes to the map\'s address', lp?.back?.text === 'Ad Bounty' && lp.back.href === APP, lp?.back ?? null)
    r.check('no "Next lesson" on it', lp?.next.length === 0, lp?.next ?? null)
    await shot(page, 'lesson-page.png')
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await waitFor(page, (p) => location.pathname === p, { arg: APP, timeout: NAV_MS, what: 'row 5: back did not reach the map' })
    await sleep(1200)
    const b = await page.evaluate(SNAP)
    r.check('the browser\'s back: the map\'s address, the checkpoint\'s panel still up, the camera at the board', b.path === APP && !!b.panel && b.park?.id === 'bounty' && !b.lesson, { path: b.path, panel: !!b.panel, park: b.park, lesson: b.lesson })
    // The page's own ways home, each from a fresh open of the page: its back link, then Esc.
    for (const way of ['the back link', 'Esc']) {
      await click(page, FIND.lessonRow, LESSON.title, `row 5: the lesson's row again (${way})`)
      await waitFor(page, (t) => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.replace(/\s+/g, ' ').trim() === t), { arg: LESSON.title, timeout: NAV_MS, what: `row 5: no lesson page (${way})` })
      await sleep(800)
      if (way === 'Esc') await page.keyboard.press('Escape')
      else r.values.backClick = await click(page, FIND.lessonBack, null, 'row 5: the page\'s back link')
      await waitFor(page, (p) => location.pathname === p, { arg: APP, timeout: NAV_MS, what: `row 5: ${way} did not reach the map` })
      await sleep(1200)
      const h = await page.evaluate(SNAP)
      const place = await page.evaluate(() => !!document.querySelector('main section[aria-labelledby="v4-panel-title"]'))
      r.check(`${way}: the map's address, the checkpoint's panel still up, no place's panel, the camera at the board`, h.path === APP && !!h.panel && !place && h.park?.id === 'bounty' && !h.lesson, { path: h.path, panel: !!h.panel, place, park: h.park, lesson: h.lesson })
    }
  })

  // 6 ── A phone
  await runRow(6, 'A phone: a row under Creative Strategy\'s opens the sheet, and the lesson from it', async (r) => {
    const page = await openPhone(r.ctx, r.row, url({}))
    const list = await page.evaluate(() => {
      const ol = document.querySelector('main ol')
      const items = [...(ol?.children ?? [])]
      return {
        places: items.map((li) => li.querySelector('button')?.getAttribute('aria-label') ?? null),
        cp: items.map((li, i) => (li.querySelector('button[aria-label^="Ad Bounty checkpoint"]') ? i : -1)).filter((i) => i >= 0),
      }
    })
    r.check('the list keeps the eight places\' rows (each item\'s first button)', list.places.length === 8 && list.places.every((l) => !!l && !/^Ad Bounty/.test(l)), list.places)
    r.check(`the checkpoint's row sits in ${PLACE.name}'s item`, list.cp.length === 1 && list.cp[0] === PLACE.k && new RegExp(`^${PLACE.name}`).test(list.places[PLACE.k] ?? ''), list.cp)
    const rowBox = await page.evaluate(() => {
      const b = document.querySelector('main ol > li > button[aria-label^="Ad Bounty checkpoint"]')
      b?.scrollIntoView({ block: 'center' })
      const r = b?.getBoundingClientRect()
      return r ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null
    })
    await sleep(300)
    const box2 = await page.evaluate(() => {
      const r = document.querySelector('main ol > li > button[aria-label^="Ad Bounty checkpoint"]')?.getBoundingClientRect()
      return r ? { l: Math.round(r.left), t: Math.round(r.top) - 90, w: Math.round(r.width), h: Math.round(r.height) + 110 } : null
    })
    r.check('the row is at least 40 px tall', !!rowBox && rowBox.h >= 40, rowBox)
    if (box2) await crop(page, 'phone-list.png', box2, 0, PHONE)
    await click(page, FIND.phoneRow, null, 'row 6: the checkpoint\'s row')
    await waitFor(page, () => !!document.querySelector('main section[role="dialog"][aria-labelledby="bounty-panel-title"]'), { timeout: 8000, what: 'row 6: no sheet' })
    await sleep(500)
    const s = await page.evaluate(SNAP)
    r.check('the sheet holds the checkpoint\'s panel and its lesson', s.panel?.title === 'Ad Bounty' && s.panel.rows.length === 1 && s.panel.rows[0].text.includes(LESSON.title), s.panel)
    await shot(page, 'phone-sheet.png')
    await click(page, FIND.lessonRow, LESSON.title, 'row 6: the lesson\'s row')
    await waitFor(page, (t) => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.replace(/\s+/g, ' ').trim() === t), { arg: LESSON.title, timeout: NAV_MS, what: 'row 6: no lesson page' })
    const l = await page.evaluate(SNAP)
    r.check(`the row opens ${APP}/${PLACE.id}/${LESSON.id}`, l.path === `${APP}/${PLACE.id}/${LESSON.id}` && l.lesson === LESSON.title, { path: l.path, lesson: l.lesson })
  })

  // 7 ── Through nothing
  await runRow(7, `The camera goes through nothing from the rope bridge's end onto the ship, and off it (no triangle within ${NEAR_GAP})`, async (r) => {
    const page = await r.open({})
    const plan = await page.evaluate(() => {
      const r = window.__worldV6Debug.debugRail()
      return { a7: r.stopS[6], a8: r.stopS[7], f0: r.flightS[0], f1: r.flightS[1], len: r.length }
    })
    // The isle's end of the bridge: 0.341 of the stretch (the rail's kind turns "board" there).
    const isle = plan.a7 + 0.335 * (plan.a8 - plan.a7)
    const ss = []
    for (let s = isle; s <= plan.f0 + 12; s += 2) ss.push(s)
    for (let s = plan.f0 + 40; s < plan.f1 - 60; s += 40) ss.push(s)
    for (let s = plan.f1 - 60; s <= plan.a8; s += 2) ss.push(s)
    let worst = null
    const near = []
    for (const s of ss) {
      await page.evaluate((s) => {
        const sc = window.__worldV6Debug
        const d = sc.debugRail().depthOfS(s)
        window.scrollTo(0, Math.round(sc.scrollYForDepth(d)))
        sc.seedDepth(d)
      }, s)
      // Two frames: the camera and the ship are where the seeded depth puts them.
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
      const m = await page.evaluate(NEAREST, { s })
      if (!worst || m.d < worst.d) worst = m
      if (m.d < NEAR_GAP) near.push(m)
    }
    r.values.samples = ss.length
    r.values.worst = worst
    r.check(`sampled ${ss.length} points; the measure reaches real geometry (the isle's set and the ship: ${worst?.world} and ${worst?.local} triangles)`, !!worst && worst.world > 1000 && worst.local > 1000 && Number.isFinite(worst.d) && worst.d < 40, worst)
    r.check(`no triangle within ${NEAR_GAP} of the camera anywhere (the nearest: ${worst ? worst.d.toFixed(2) : '?'}, ${worst?.name ?? '?'})`, near.length === 0, near.slice(0, 4))
    // The control: a camera put inside the board is caught.
    await page.evaluate((b) => window.__worldV6Debug.debugPose({ x: b.x, y: 1622, z: b.z, bearing: 0, pitch: 0 }), BOARD)
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
    const inside = await page.evaluate(NEAREST, { s: -1 })
    await page.evaluate(() => window.__worldV6Debug.debugPose(null))
    r.check('the control: a camera put inside the board (its centre, 12 up) is caught, under 1 from the board\'s triangles', inside.d < 1 && inside.name === 'Bounty_Board', inside)
  })

  // 8 ── Creative Strategy's last lesson does not lead into it
  await runRow(8, 'Creative Strategy\'s last lesson has no "Next lesson" into the Ad Bounty\'s (the lesson before it does have one)', async (r) => {
    if (!BEFORE) throw new Error('course_catalog.json has fewer than 2 Creative Strategy lessons before the bounty\'s')
    const bountyPath = `/${PLACE.id}/${LESSON.id}`
    const seen = {}
    for (const [which, l] of [['control', BEFORE.control], ['last', BEFORE.last]]) {
      const page = await r.open({ p: 'all' }, `/${PLACE.id}/${l.id}`)
      await waitFor(page, (t) => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.replace(/\s+/g, ' ').trim() === t), { arg: l.title, timeout: NAV_MS, what: `row 8: no page for ${l.id}` })
      await sleep(600)
      seen[which] = { id: l.id, ...(await page.evaluate(LESSON_PAGE, bountyPath)) }
      await page.close()
    }
    r.values.pages = seen
    r.check(`the control: ${BEFORE.control.id}'s page has "Next lesson" to ${BEFORE.last.id}`, seen.control.next.length === 1 && seen.control.next[0] === `${APP}/${PLACE.id}/${BEFORE.last.id}`, seen.control.next)
    r.check(`${BEFORE.last.id} ("${BEFORE.last.title}") has no "Next lesson"`, seen.last.next.length === 0, seen.last.next)
    r.check(`no link on ${BEFORE.last.id}'s page goes to ${LESSON.id}`, seen.last.toBounty === 0, seen.last.toBounty)
    r.check(`its back link still names ${PLACE.name} (it is the place's lesson)`, seen.last.back?.text === PLACE.name && seen.last.back.href === `${APP}/${PLACE.id}`, seen.last.back)
  })

  // 9 ── One checkpoint's panel gives way to the other's, and focus follows
  await runRow(9, 'The bounty\'s panel gives way to the discount\'s from the header: focus moves to the discount panel\'s heading', async (r) => {
    const page = await r.open({ discount: 'locked' })
    await click(page, FIND.tag, null, 'row 9: the bounty\'s tag')
    await parked(page, 'row 9')
    const a = await page.evaluate(() => document.activeElement?.id ?? null)
    r.check('the tag opens the bounty\'s panel, focus on its heading', a === 'bounty-panel-title', a)
    r.values.chipClick = await click(page, FIND.chip, null, 'row 9: the header\'s discount segment')
    await waitFor(page, () => window.__worldFrame?.parkedId === 'checkpoint' && window.__worldFrame.parkProgress >= 0.999 && !!document.querySelector('main section[aria-labelledby="cp-panel-title"]') && !document.querySelector('main section[aria-labelledby="bounty-panel-title"]'), {
      timeout: PARK_MS,
      what: 'row 9: the camera did not park at the cache with the discount\'s panel up',
    })
    await sleep(800)
    const b = await page.evaluate(() => ({ id: document.activeElement?.id ?? null, label: document.activeElement?.getAttribute('aria-label') ?? null, locked: document.body.style.overflow === 'hidden' }))
    r.check('the discount\'s panel is up in its place, focus on its heading (#cp-panel-title), not left on the segment', b.id === 'cp-panel-title' && b.locked, b)
    await page.keyboard.press('Escape')
    await waitFor(page, () => !document.querySelector('main section[aria-labelledby="cp-panel-title"]') && (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== 'hidden', { timeout: PARK_MS, what: 'row 9: Esc did not come home' })
    r.check('Esc comes home from it', true, null)
  })

  // 10 ── Its page opened by its address
  await runRow(10, 'Its page opened by its address: Esc and the back link still come home to the checkpoint\'s panel', async (r) => {
    for (const way of ['Esc', 'the back link']) {
      const page = await r.open({}, `/${PLACE.id}/${LESSON.id}`)
      await waitFor(page, (t) => [...document.querySelectorAll('h1')].some((h) => !h.closest('main') && h.textContent.replace(/\s+/g, ' ').trim() === t), { arg: LESSON.title, timeout: NAV_MS, what: `row 10: no lesson page (${way})` })
      await sleep(1200)
      const under = await page.evaluate(() => ({
        bounty: !!document.querySelector('main section[aria-labelledby="bounty-panel-title"]'),
        place: !!document.querySelector('main section[aria-labelledby="v4-panel-title"]'),
      }))
      r.check(`${way}: the page is up with nothing open behind it (no checkpoint's panel, no place's)`, !under.bounty && !under.place, under)
      if (way === 'Esc') await page.keyboard.press('Escape')
      else await click(page, FIND.lessonBack, null, 'row 10: the page\'s back link')
      await waitFor(page, (p) => location.pathname === p, { arg: APP, timeout: NAV_MS, what: `row 10: ${way} did not reach the map` })
      await parked(page, `row 10 (${way})`)
      const s = await page.evaluate(SNAP)
      const place = await page.evaluate(() => !!document.querySelector('main section[aria-labelledby="v4-panel-title"]'))
      const c = s.cam
      const off = c ? Math.hypot(c.x - PARK.x, c.y - PARK.y, c.z - PARK.z) : NaN
      r.check(`${way}: the map's address, the checkpoint's panel up, parked at the board's view, no place's panel, focus on its heading`, s.path === APP && !!s.panel && s.park?.id === 'bounty' && off < 0.5 && !place && s.panel.focusHeading === true, { path: s.path, panel: !!s.panel, park: s.park, off, place, focus: s.panel?.focusHeading })
      await page.close()
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter((x) => !x.pass).length
console.log(
  `\nMEASURED  pages ${tally.pages} · requests to /api ${tally.api.length}${tally.api.length ? ` ${show(tally.api.slice(0, 4))}` : ''} · requests to Supabase ${tally.supabase.length}${tally.supabase.length ? ` ${show(tally.supabase.slice(0, 4))}` : ''} · page errors ${tally.pageErrors.length}${tally.pageErrors.length ? ` ${show(tally.pageErrors.slice(0, 2))}` : ''}`,
)
const measuredOk = tally.api.length === 0 && tally.supabase.length === 0 && tally.pageErrors.length === 0
console.log(`PASS ${results.length - failed}  FAIL ${failed}${measuredOk ? '' : '  (MEASURED fails)'}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, tally }, null, 1))
process.exit(failed || !measuredOk ? 1 : 0)
