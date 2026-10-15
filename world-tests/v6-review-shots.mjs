/**
 * The map review of 2026-10-15 (Lovro's Loom, _admin/prds/map-review-2026-10-15/plan.md):
 * one picture per moment he talked over, taken the same way every run, so a
 * "before" and an "after" can be laid side by side.
 *
 *   node world-tests/v6-review-shots.mjs <label> [--only name,name] [--pose-from <label>]
 *
 * Runs against http://localhost:3111/dev/world-app (BASE_URL overrides), which
 * must already be up: this script never starts a server. The pretend student
 * of FixtureStudentProvider.tsx, on the real course (?catalog=course), no
 * login, no server call. Headless Chrome on the real GPU.
 *
 * Writes world-tests/shots/v6/review-2026-10-15/<label>/ (git-ignored):
 *   <name>-<viewport>.png   the interface views, at 1691x1278, 3428x1230 and 390x844
 *   <name>.png              the world views, at 1691x1278 only
 *   manifest.json           per picture: the name, the address, the viewport, how
 *                           the camera was placed (and where it ended up), what
 *                           the picture should show (a view's `shows` line in a
 *                           run labelled before, its `after` line in any other
 *                           run: what items 1 to 13 changed), the Loom moment it matches
 * --only takes view names (header, w-lake, ...) and picks those views at every
 * size they are taken at; a later run with --only rewrites only those files
 * and their rows of the manifest.
 *
 * REPEATABLE. Every picture loads its own page in its own browser context (no
 * storage carried over), pins the quality tier to 0 (full) so the governor
 * cannot change what is drawn halfway, and freezes the clock before the
 * shot: the page's frame loop is stopped, the scene clock (water, clouds, the
 * lanterns' pulse) is set to SCENE_T and the life clock (birds, smoke, ships)
 * to LIFE_T through window.__worldLife.setTime, the airship's propellers (which
 * turn by frame time) are put back at their built angle, and two frames are
 * drawn by hand with no time passing (the way v6-perf.mjs and
 * v6-overdraw-try.mjs drive the scene); the page's CSS animations are run to
 * their end, a looping one held half way. In two pairs of full runs on an
 * unchanged tree (2026-10-15) 44 of the 49 files came out pixel for pixel the
 * same; the other 5 differed in 2 to 8,468 pixels (at most 0.2%), in trees
 * swapping their level of detail:
 * forest.ts keeps each tree's last one, so it follows the frames drawn while
 * the page loaded or the camera flew, which vary. A rail view puts the camera on the route by distance:
 * a share of the route between two stops (stop-relative, so a change to the
 * scroll budgets alone does not move it), seeded straight there with no glide.
 * A parked view clicks the place in (window.__worldPark), as a student does.
 *
 * --pose-from <label>: the rail views are taken from the camera poses that
 * run recorded in its manifest (pinned with the scene's debugPose), for a
 * change that moves the route itself; the light still follows the view's
 * own place on the current route. Without it, a view is wherever the
 * current route puts that share of the stretch.
 *
 * PROGRESS. The world views use ?p=partial (courseCatalog.ts): the first 6
 * counting lessons of every place watched, so each place has lit and dark
 * lanterns, and Creative Strategy has the 6 of the Loom (12:15). They also
 * carry ?discount=locked, as the Loom's page did (the cache and its marker).
 * The interface views use ?discount=<state>&hud=some.
 * --p <preset> takes the world views at another ?p= (p0, mid, partial, all;
 * added for item 13's stars at 0, 6 and every lesson watched).
 *
 * After the run: one line per picture, then the count; exit 1 when a picture
 * could not be taken. Page errors and requests to /api or Supabase are
 * written into the manifest (both should be none).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const ROOT = path.join(HERE, 'shots', 'v6', 'review-2026-10-15')

const argv = process.argv.slice(2)
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? null : null)
const LABEL = argv[0] && !argv[0].startsWith('--') ? argv[0] : null
if (!LABEL || !/^[\w.-]+$/.test(LABEL)) {
  console.error('usage: node world-tests/v6-review-shots.mjs <label> [--only name,name] [--pose-from <label>] [--p <preset>]')
  process.exit(2)
}
const OUT = path.join(ROOT, LABEL)
const onlyArg = flag('--only')
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim()).filter(Boolean)) : null
const POSE_FROM = flag('--pose-from')
const P_PRESET = flag('--p')
if (P_PRESET !== null && !/^[\w-]+$/.test(P_PRESET)) {
  console.error(`--p ${P_PRESET}: a preset name (p0, mid, partial, all)`)
  process.exit(2)
}

const DESKTOP = { width: 1691, height: 1278 }
const WIDE = { width: 3428, height: 1230 }
const PHONE = { width: 390, height: 844 }
const UI_SIZES = [DESKTOP, WIDE, PHONE]
/** The frozen clocks, in seconds: the scene's (water, clouds, the lanterns) and the life module's (birds, smoke, ships). */
const SCENE_T = 40
const LIFE_T = 23
const READY_MS = 120000
const PARK_MS = 30000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vpName = (v) => `${v.width}x${v.height}`
const isPhone = (v) => v.width < 760

// ── The views ───────────────────────────────────────────────────────────────
//
// place:
//   { opening: true }                          depth 0, the first frame
//   { from: k, at: g }                         on the rail, between stop k and k + 1 (0-based),
//                                              at share g of the route's distance between them
//   { tail: g }                                past the last stop, share g of the way to the route's end
//   { park: 'a2' }                             the place clicked in: parked, its panel open
// The shares come from the Loom: the timeline's caret read off the frame
// (pixel column, so about +-2% of a stretch), turned into route distance on
// the route the Loom was recorded on (commit d7d1a73, scroll budgets 120 160
// 300 280 280 200 250 200 vh), then checked by eye against the Loom's frame.
// Two views are placed for their subject rather than the caret: w-va1-pool
// (the Loom's 4:56 frame is the canyon view again) and the added w-mf-hill and
// w-va2-fence (what w-mf and w-va2-hut cover with the panel or show too small).

/** What every world view's page carries. */
const WORLD_QUERY = { p: P_PRESET ?? 'partial', discount: 'locked' }
/** What every interface view's page carries, with its own ?discount. */
const UI_QUERY = { hud: 'some' }

const VIEWS = [
  // Interface: three sizes each.
  { name: 'header', ui: true, query: { discount: 'locked' }, steps: 'header', loom: '14:55-16:46', shows: 'The top bar: the ecomtalent wordmark, the streak and achievements pill with Sign out, the 30% chip with its days, the 01/08 counter and its dashed bar. Crop of the top 120 px, plus the whole page as header-full.', after: 'After items 1 to 3: the Ecom University brand alone on the left (the logo; pictures taken before the logo file went in show the words and the half-sun mark), and one pill on the right with the streak and achievements, the 30% off chip with its days left, and Sign out last. No 01/08 counter and no dashed bar. On the phone the stats stay in the header\'s row and the chip drops to the row under it. Crop of the top 120 px, plus the whole page as header-full.' },
  { name: 'timeline', ui: true, query: { discount: 'locked' }, steps: 'timeline', loom: '16:52-17:26', shows: 'The bottom bar: the count, the line, the eight diamonds and the 30% tag between the 4th and 5th. Crop of the bottom 140 px, plus the whole page as timeline-full. The phone has no timeline (its list view), so its pictures show the bottom of the list.', after: 'After item 6: a capsule with the count ("0/140 lessons"), a cell per place round each of the eight diamonds, filled by its lessons, and the "30% off" tag on a post above the bar between the 4th and 5th diamonds. Crop of the bottom 140 px, plus the whole page as timeline-full. The phone has no timeline (its list view), so its pictures show the bottom of the list.' },
  { name: 'panel-locked', ui: true, query: { discount: 'locked' }, steps: 'checkpoint', loom: '7:47-8:39', shows: 'The discount checkpoint\'s panel open, locked: the deadline, the videos watched and to go with the time estimate ("about 19 hours" here, 0 of 59 watched; the Loom\'s said 14), the Watch row. On a computer the camera is parked at the cache; on a phone the list view\'s sheet.', after: 'After item 4: the discount checkpoint\'s panel open, locked: the deadline, the videos watched and to go with no time estimate, the line "Watch all 59 videos through Video Ads II, then apply here.", no Watch row, and Apply greyed out with a padlock. On a computer the camera is parked at the cache, with no stone stacks beside the path (item 10); on a phone the list view\'s sheet.' },
  { name: 'panel-ready', ui: true, query: { discount: 'ready' }, steps: 'checkpoint', loom: '8:20', shows: 'The discount checkpoint\'s panel open, ready: every video watched, the Apply button.', after: 'The discount checkpoint\'s panel open, ready: every video watched, Apply on (the panel unchanged by item 4). Round the cache: no stone stacks (item 10) and no lesson lantern in the view (item 12, round 3: Video Ads II\'s lanterns end where the trail comes into this view, the last just under the bottom edge; in the after-r1 pictures its last stood on the bottom edge, its post cut).' },
  { name: 'badges-open', ui: true, query: { discount: 'locked' }, steps: 'badges', loom: '15:12-15:25', shows: 'The corner\'s achievement list open (streak 4 days, 4 of 10), in the place panel\'s slot; a full sheet on a phone.', after: 'After item 2: the corner\'s achievement list open (streak 4 days, 4 of 10) under the pill on the right, where it opens now; a full sheet on a phone. The list itself is unchanged.' },
  { name: 'lesson-short', ui: true, sub: '/a6/a6l03', query: {}, steps: 'lesson', loom: '11:12', shows: 'A short lesson page (a6l03, an action item with little text): today it sits at the top of the screen.', after: 'After item 5: a short lesson page (a6l03, an action item with little text), now in the middle of the screen.' },
  { name: 'lesson-long', ui: true, sub: '/a6/a6l10', query: {}, steps: 'lesson', loom: '11:24', shows: 'A long lesson page (a6l10, an action item with a lot of text): it fills the screen from the top.', after: 'After item 5: a long lesson page (a6l10, an action item with a lot of text), now in the middle of the screen when it fits; taller than the screen, it starts at the top and scrolls.' },
  { name: 'lesson-video', ui: true, sub: '/a2/a2l01', query: {}, steps: 'lesson-video', loom: '3:45, 14:26', shows: 'A lesson page with a video player (a2l01): the player\'s 16:9 box under the title, with the dev test video\'s first frame once its player is ready (the manifest\'s notes say whether it got ready, or whether the dev page had no test video).', after: 'After item 5: a lesson page with a video player (a2l01), now in the middle of the screen: the player\'s 16:9 box under the title, with the dev test video\'s first frame once its player is ready (the manifest\'s notes say whether it got ready, or whether the dev page had no test video).' },

  // The world: 1691x1278 only.
  { name: 'w-first', place: { opening: true }, loom: '0:27', shows: 'The opening view: the boulder (3 rocks on an islet) in the foreground right, the sea with its streaks near the camera, the mountains, the airship.', after: 'After item 7: the opening view with no boulder and no islet in the foreground right. As before: the sea\'s streaks near the camera (item 15a), the mountains, the airship.' },
  { name: 'w-signpost', place: { from: 0, at: 0.024 }, loom: '2:40', shows: 'The signpost at the start, close: the signpost and its card, the tents, the trail and the pole line, the stone beside the signpost.', after: 'After items 8, 9 and 12: the signpost at the start, close, with no pole line and no stone behind the camp\'s kettle tripod; Introduction\'s lanterns along the trail; the signpost, its card and the tents as before.' },
  { name: 'w-trail-mf', place: { from: 0, at: 0.18 }, loom: '1:36, 2:15', shows: 'The trail from the signpost up toward the Marketing Fundamentals lookout, with the line of wooden poles and the wire beside it, and Introduction\'s lanterns.', after: 'After items 9 and 12: the trail from the signpost toward the Marketing Fundamentals lookout with no poles and no wire beside it, and Introduction\'s lanterns spaced evenly along it.' },
  { name: 'w-mf-hill', place: { from: 0, at: 0.744 }, loom: '2:22-2:30', shows: 'The trail up the hill to the Marketing Fundamentals lookout: Fundamentals\' lanterns packed together beside the trail, the pole line and its wire. Added to w-mf, whose panel covers these lanterns.', after: 'After items 9 and 12: the trail up the hill to the lookout with no poles and no wire, and Fundamentals\' lanterns spread evenly up the trail instead of packed together near the top.' },
  { name: 'w-mf', place: { park: 'a2' }, loom: '4:00', shows: 'Parked at Marketing Fundamentals: the lookout tower, the cabin, the tents, the wire and its poles, the trail and a few of its lanterns; the place panel on the left.', after: 'After item 9: parked at Marketing Fundamentals, the lookout tower, the cabin and the tents with no wire and no poles; the trail and a few of its lanterns; the place panel on the left.' },
  { name: 'w-va1-canyon', place: { from: 2, at: 0.129 }, loom: '4:40', shows: 'The canyon below the falls looking downstream: the river, the log bridge, the path and its lanterns, the Video Ads II hut up on the cliff, the pool\'s edge at the bottom right.', after: 'After item 12: the canyon below the falls looking downstream, the river, the log bridge and the path, with Video Ads I\'s lanterns on the path at both ends of the log; the Video Ads II hut up on the cliff, the pool\'s edge at the bottom right.' },
  { name: 'w-va1-pool', place: { from: 2, at: 0.0948 }, loom: '4:52-4:56', shows: 'Turning away from the falls: the round plunge pool (teal, foam) and the grey running stream meeting it under the log bridge, two waters with no blend.', after: 'After item 12: turning away from the falls, Video Ads I\'s first lanterns, lit, along the path from the pool\'s shore to the log. As before: the round plunge pool (teal, foam) and the grey running stream meeting under the log bridge with no blend (item 15b).' },
  { name: 'w-va2-hut', place: { park: 'a4' }, loom: '6:22', shows: 'Parked at the Video Ads II hut: the hut, the path down from it with its rope fence, the falls\' pool, and the 6 lit lanterns down by the river, none by the hut.', after: 'After items 11 and 12: parked at the Video Ads II hut, Video Ads II\'s lit lanterns stand along the bench through the hut, from the ladder\'s top on (6 at ?p=partial; with --p loom, Lovro\'s test, 7). The lit ones down by the river are Video Ads I\'s own first ones (6 at partial, 3 at loom). The rope fence\'s posts all stand on the gorge side, no rope across the path.' },
  { name: 'w-va2-fence', place: { from: 2, at: 0.964 }, loom: '6:42-6:58', shows: 'Arriving at the Video Ads II hut on the rail: the rope fence in front of the hut, one rope crossing the path from a post on one side to a post on the other. Added to w-va2-hut, where the crossing is hard to see.', after: 'After item 11: arriving at the Video Ads II hut on the rail, the fence\'s posts all on the gorge side of the path and no rope crossing it.' },
  { name: 'w-turn', place: { from: 3, at: 0.27 }, loom: '7:15', shows: 'Just after the hut, where the camera swings left into the open valley (the sunset haze and the lake far below) instead of up the gully.', after: 'Just after the hut: changed only in the header and the timeline. The camera still swings left into the open valley (item 14 turns it up the gully).' },
  { name: 'w-gully', place: { from: 3, at: 0.412 }, loom: '7:25', shows: 'The gully up to the discount checkpoint (the red cache on stilts, its 30% marker), with the stacked stone cones (cairns) beside the path.', after: 'After items 10 and 12: the gully up to the discount checkpoint (the red cache on stilts, its 30% marker) with no stone cones beside the path; the lanterns there are Video Ads II\'s later ones, dark at 6 watched.' },
  { name: 'w-lake', place: { from: 3, at: 0.824 }, loom: '8:48', shows: 'The Static Ads lake from above: the round shoreline, the boathouse and the jetty, the lanterns on and near the water, the rocks, the path that ends in the water.', after: 'After item 12: the Static Ads lake from above with no lanterns on or in the water. As before: the round shoreline, the boathouse and the jetty with its lamps, the rocks, the path that ends in the water (item 15c).' },
  { name: 'w-lake-reveal', place: { from: 3, at: 0.985 }, loom: '9:45', shows: 'The mirror lake view Lovro loves: the boathouse and its reflection, the jetty\'s lanterns, the magical forest beyond.', after: 'After item 12, changed in a locked view: at the Great Tree\'s foot 6 lit lanterns stand in a tight row, touching, where there was 1 (AI Ads & Content\'s 22 stand 17 apart on its 400 units of ground; whether they go on the floating steps instead waits on Lovro). The lit lanterns on the far shore at the right are gone. The boathouse and its reflection, the jetty\'s lamps and the magical forest beyond are as before.' },
  { name: 'w-magic', place: { from: 4, at: 0.464 }, loom: '10:20', shows: 'The magical forest from outside: the glowing cluster round the Great Tree on its hill, the ordinary forest round it.', after: 'The magical forest from outside, changed only by the lanterns: AI Ads & Content\'s stand in a short row at the Great Tree (item 12). The glowing cluster on its hill and the ordinary forest round it as before (item 17 grows it).' },
  { name: 'w-magic-in', place: { park: 'a6' }, loom: '11:02', shows: 'Parked inside the magical forest (AI Ads & Content): the Great Tree, the glowing stream, the place panel on the left.', after: 'After item 12: parked inside the magical forest (AI Ads & Content), its 6 lit lanterns stand in a row at the Great Tree\'s foot; the Great Tree, the glowing stream and the place panel as before.' },
  { name: 'w-sky', place: { park: 'a7' }, loom: '12:15', shows: 'Creative Strategy through the telescope with 6 of its 18 lessons watched: the 9-star telescope shape, 3 stars lit, the thick lines.', after: 'After item 13: Creative Strategy through the telescope, one star per lesson (18) placed at random in the lens, sizes varying; at ?p=partial 6 are lit with 5 thin lines between them and 12 are dim (each lesson watched lights one more star and adds one line). No telescope shape, no cross on the stars.' },
  { name: 'w-isle', place: { from: 6, at: 0.276 }, loom: '14:02', shows: 'The floating island with the notice board, the rope bridge to it, the airship moored above.', after: 'The floating island with the notice board, the rope bridge to it and the airship moored above: changed only in the header and the timeline (item 18 makes the isle the Ad Bounty\'s checkpoint).' },
  { name: 'w-deck', place: { from: 6, at: 0.724 }, loom: '14:12', shows: 'On the airship\'s deck in flight: the crates and barrels the camera passes through, the arch ahead.', after: 'On the airship\'s deck in flight: changed only in the header and the timeline; the camera still passes through the crates (item 18).' },
  { name: 'w-arch', place: { tail: 0.9775 }, loom: '14:45', shows: 'How To Land Clients: the stone arch at the end of the route, the sun in its opening.', after: 'How To Land Clients, the stone arch at the end of the route with the sun in its opening: changed only in the header and the timeline.' },
]

// ── In the page ─────────────────────────────────────────────────────────────

/** Stop the page's frame loop, set both clocks, draw one frame with no time passing. Returns how many renders it made. */
const DRAW_FROZEN = ({ sceneT, lifeT }) => {
  const sc = window.__worldV6Debug
  if (!sc || !sc.renderer) return { ok: false, why: 'no scene' }
  const stopLoop = () => {
    if (sc.raf) {
      cancelAnimationFrame(sc.raf)
      sc.raf = 0
    }
    if (sc.animTimer !== null && sc.animTimer !== undefined) {
      clearTimeout(sc.animTimer)
      sc.animTimer = null
    }
  }
  sc.paused = true
  stopLoop()
  sc.sceneTime = sceneT
  window.__worldLife?.setTime?.(lifeT)
  // The airship's propellers turn by the frame time, not by a clock (dress-sky.ts adds
  // dt x rate each frame): put them back at the angle they are built at (s x 0.7).
  let props = 0
  sc.debugScene()?.traverse((o) => {
    if (!o.name.startsWith('Airship_Prop')) return
    o.rotation.x = o.name.endsWith('Port') ? -0.7 : 0.7
    props++
  })
  const info = sc.renderer.info.render
  const f0 = info.frame
  sc.paused = false
  sc.dirty = true
  sc.lastTime = performance.now()
  sc.tick(sc.lastTime)
  sc.paused = true
  stopLoop()
  // Read back before the shot: a hot reload that rebuilt the scene since is caught.
  sc.__reviewFrozen = true
  return { ok: true, renders: info.frame - f0, sceneT: sc.sceneTime, props, hidden: document.hidden }
}

/** The frozen scene is still the page's, its clock where it was set, and the landing poster gone. */
const STILL_FROZEN = (sceneT) => {
  const sc = window.__worldV6Debug
  const layer = document.querySelector('main picture')?.parentElement ?? document.querySelector('picture')?.parentElement
  return !!sc && sc.__reviewFrozen === true && sc.sceneTime === sceneT && (!layer || getComputedStyle(layer).visibility === 'hidden')
}

/** Where the camera is, in the units debugPose takes (compass bearing, pitch below the horizon, vertical lens). */
const POSE = () => {
  const sc = window.__worldV6Debug
  const c = sc.cameraPose()
  const r = sc.debugRail()
  const s = r.sOfDepth(c.depth)
  const keys = sc.ctx?.layout?.TRAIL?.length ?? null
  const bearing = ((Math.atan2(c.dx, -c.dz) * 180) / Math.PI + 360) % 360
  const f = window.__worldFrame
  return {
    x: +c.x.toFixed(4),
    y: +c.y.toFixed(4),
    z: +c.z.toFixed(4),
    bearing: +bearing.toFixed(5),
    pitch: +c.pitch.toFixed(5),
    fov: +sc.camera.fov.toFixed(5),
    depth: +c.depth.toFixed(6),
    s: +s.toFixed(1),
    key: keys ? +(r.tAtS(s) * (keys - 1)).toFixed(2) : null,
    kind: r.kindAtS(s),
    parked: f?.parkedId ?? null,
    calls: f?.calls ?? null,
    triangles: f?.triangles ?? null,
    tier: sc.qualityInfo?.()?.quality?.tier ?? null,
    pixelRatio: sc.renderer?.getPixelRatio() ?? null,
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

const query = (params) => new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()

let browser = null

/** A fresh context and page at this size, loaded and ready: the 3D on a computer, the list view on a phone. */
async function open(rec, urlPath, viewport, { lesson = false } = {}) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message).slice(0, 240)))
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if ((u.origin === ORIGIN && u.pathname.startsWith('/api')) || /supabase/i.test(u.hostname)) rec.requests.push(`${u.hostname}${u.pathname}`)
  })
  await page.bringToFront()
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  if (isPhone(viewport)) {
    await waitFor(page, () => document.querySelector('main[data-view="list"]') !== null || [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), {
      timeout: READY_MS,
      poll: 300,
      what: `${urlPath}: the phone's page was not ready`,
    })
    // The list's hero is a still of the student's place that fades in (0.5 s) once it has
    // loaded: a picture taken before shows a dark band where it goes.
    // (WorldV6.tsx PhoneWorld: a div with its height inline, aria-hidden, the img in it.)
    await waitFor(page, () => {
      if (!document.querySelector('main[data-view="list"]')) return true
      const hero = [...document.querySelectorAll('div[aria-hidden="true"] > img')].find((i) => i.parentElement.style.height)
      return !!hero && hero.complete && hero.naturalWidth > 1 && hero.hasAttribute('data-on')
    }, { timeout: 15000, poll: 150, what: `${urlPath}: the phone's hero still did not load` })
    await sleep(700)
  } else {
    await waitFor(page, () => window.__worldReady === true || typeof window.__worldError === 'string', { timeout: READY_MS, poll: 300, what: `${urlPath}: the map was not ready` })
    const err = await page.evaluate(() => window.__worldError ?? null)
    if (err) throw new Error(`${urlPath}: the scene failed: ${err}`)
    // One tier for every run: the governor must not change what is drawn.
    await page.evaluate(() => window.__worldV6Debug?.setQualityTier?.(0))
    // The landing poster (a still of the opening, in the server HTML) fades out
    // once the 3D has drawn a few frames: a picture taken before that shows the
    // still, its own airship and birds and its labels' places.
    await waitFor(page, () => {
      const layer = document.querySelector('main picture')?.parentElement ?? document.querySelector('picture')?.parentElement
      return !layer || getComputedStyle(layer).visibility === 'hidden'
    }, { timeout: 12000, poll: 150, what: `${urlPath}: the landing poster did not fade out` })
  }
  if (lesson) await waitFor(page, () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), { timeout: 40000, what: `${urlPath}: no lesson page` })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await sleep(900)
  return { ctx, page }
}

/** Seed the camera at a rail depth (scroll and camera together, no glide) and let the page settle on it. */
async function seed(page, depth) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug
    sc.debugPose(null)
    window.scrollTo(0, Math.round(sc.scrollYForDepth(d)))
    sc.seedDepth(d)
  }, depth)
  // The scroll lands on a whole pixel: wait for the camera to rest where the page's scroll says.
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
    if (Date.now() - t0 > 15000) throw new Error(`the camera did not settle at depth ${depth}`)
    await sleep(150)
  }
  // The rest timer, the card's fade, the forest and cover catching up with the camera.
  await sleep(1400)
}

/**
 * The page's CSS animations put in one state every run: a finite one (the
 * scroll cue's 4 rounds, the current place's pin pulsing 3 times, a panel
 * sliding in) jumps to its end, a looping one (a loading bar) is held half
 * way through its first round. Returns how many were set.
 */
const HOLD_CSS = () => {
  let n = 0
  for (const a of document.getAnimations()) {
    const t = a.effect?.getComputedTiming?.()
    if (!t) continue
    try {
      if (t.iterations === Infinity) {
        a.pause()
        a.currentTime = (Number(t.delay) || 0) + (Number(t.duration) || 0) / 2
      } else a.finish()
      n++
    } catch {
      // An animation that cannot be finished (a zero playback rate) is left as it is.
    }
  }
  return n
}

/**
 * Draw two frozen frames (retrying while the GPU still owes frames) and wait
 * for the last to reach the screen. Two, because a module can read another's
 * value from the frame before (surfaces.ts takes the sea's swash for the wet
 * sand before water.ts sets it): the second frame has every module on the
 * frozen clock.
 */
async function freeze(page) {
  let renders = 0
  let props = 0
  for (let i = 0; i < 40 && renders < 2; i++) {
    const r = await page.evaluate(DRAW_FROZEN, { sceneT: SCENE_T, lifeT: LIFE_T })
    if (!r.ok) throw new Error(`freeze: ${r.why}`)
    props = r.props
    if (r.renders > 0) renders++
    else await sleep(60)
  }
  if (renders < 2) throw new Error(`freeze: the scene drew ${renders} of the 2 frozen frames`)
  const held = await page.evaluate(HOLD_CSS)
  await sleep(250)
  if (!(await page.evaluate(STILL_FROZEN, SCENE_T))) throw new Error('freeze: the scene was rebuilt, ran on or showed its poster after the freeze')
  return { scene: SCENE_T, life: LIFE_T, propellersReset: props, cssAnimationsSet: held }
}

/**
 * captureBeyondViewport: false on every shot. Puppeteer leaves it true for a
 * clipped shot, and Chrome then grows the page to the whole document for the
 * capture (the map's scroll spacer is about 2,000 vh): the resize reaches the
 * scene, whose frozen loop never redraws, and that shot and the next ones on
 * the page show a canvas drawn for another size, with the labels elsewhere.
 */
async function shoot(page, file, clip) {
  await page.screenshot({ path: path.join(OUT, file), captureBeyondViewport: false, ...(clip ? { clip } : {}) })
  return file
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
    if (top && (top === el || el.contains(top))) return { mouse: true, x, y }
    el.click()
    return { mouse: false }
  }, find.toString())
  if (!via) throw new Error(`${what}: not on the page`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  // The mouse rests in a corner, clear of any hover.
  await page.mouse.move(2, 2)
  return via.mouse ? 'mouse' : 'dom click'
}

const FIND = {
  chip: () => document.querySelector('main header button[aria-label*="discount checkpoint"]'),
  cpPanel: () => document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
  pill: () => document.querySelector('main header button[aria-expanded]'),
  list: () => document.querySelector('main header [role="dialog"]'),
}

// ── One picture ─────────────────────────────────────────────────────────────

const PLACE_NAMES = ['Introduction', 'Marketing Fundamentals', 'Video Ads I', 'Video Ads II', 'Static Ads', 'AI Ads & Content', 'Creative Strategy', 'How To Land Clients']

function describePlace(place) {
  if (place.opening) return 'the opening frame: rail depth 0'
  if (place.park) return `parked at ${place.park} (${PLACE_NAMES[Number(place.park.slice(1)) - 1]}): clicked in with __worldPark('${place.park}') from its stop, the camera at its park pose and its panel open`
  if (place.tail !== undefined) return `on the rail past the last stop, ${place.tail} of the route distance from stop a8 to the route's end`
  return `on the rail between stop a${place.from + 1} and stop a${place.from + 2}, ${place.at} of the route distance between them`
}

/** The rail depth for a placement, from the page's own rail. */
async function depthOf(page, place) {
  return page.evaluate((p) => {
    const sc = window.__worldV6Debug
    const r = sc.debugRail()
    if (p.opening) return 0
    if (p.park) return sc.stopDepths()[Number(p.park.slice(1)) - 1]
    if (p.tail !== undefined) {
      const s0 = r.stopS[r.stopS.length - 1]
      return r.depthOfS(s0 + p.tail * (r.length - s0))
    }
    const s0 = r.stopS[p.from]
    const s1 = r.stopS[p.from + 1]
    return r.depthOfS(s0 + p.at * (s1 - s0))
  }, place)
}

let posesFrom = null
if (POSE_FROM) {
  const file = path.join(ROOT, POSE_FROM, 'manifest.json')
  if (!fs.existsSync(file)) {
    console.error(`--pose-from ${POSE_FROM}: no ${file}`)
    process.exit(2)
  }
  posesFrom = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).pictures.filter((p) => p.camera).map((p) => [p.name, p.camera]))
}

async function worldView(view, rec) {
  const params = { ...WORLD_QUERY }
  const urlPath = `${APP}?${query(params)}`
  rec.url = urlPath
  const { ctx, page } = await open(rec, urlPath, DESKTOP)
  try {
    const p = view.place
    const depth = await depthOf(page, p)
    await seed(page, depth)
    rec.placement = describePlace(p)
    if (p.park) {
      await page.evaluate((id) => window.__worldPark(id), p.park)
      await waitFor(page, (id) => {
        const f = window.__worldFrame
        const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
        return f?.parkedId === id && f.parkProgress >= 0.999 && !!panel && Number(getComputedStyle(panel).opacity) > 0.99
      }, { arg: p.park, timeout: PARK_MS, what: `the camera did not park at ${p.park} with its panel open` })
      await page.mouse.move(2, 2)
      await sleep(1400)
      rec.park = await page.evaluate(() => window.__worldParkInfo?.() ?? null)
    } else if (posesFrom) {
      const cam = posesFrom.get(view.name)
      if (!cam) throw new Error(`--pose-from ${POSE_FROM} has no camera for ${view.name}`)
      await page.evaluate((c) => window.__worldV6Debug.debugPose({ x: c.x, y: c.y, z: c.z, bearing: c.bearing, pitch: c.pitch, fov: c.fov }), cam)
      await sleep(600)
      rec.placement += `; the camera pinned to ${POSE_FROM}'s pose (debugPose)`
    }
    rec.clock = await freeze(page)
    rec.camera = await page.evaluate(POSE)
    rec.markers = await page.evaluate(() => (window.__worldFrame?.markers ?? []).filter((m) => m.visible).map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) })))
    rec.progress = await page.evaluate(() => {
      const w = window.__worldProgress?.()
      return w ? { lessons: w.lessons, done: w.done, current: w.current, next: w.next } : null
    })
    rec.files.push(await shoot(page, `${view.name}.png`))
  } finally {
    await ctx.close().catch(() => {})
  }
}

async function uiView(view, viewport, rec) {
  const phone = isPhone(viewport)
  const params = { ...UI_QUERY, ...view.query }
  const urlPath = `${APP}${view.sub ?? ''}?${query(params)}`
  rec.url = urlPath
  const lesson = view.steps === 'lesson' || view.steps === 'lesson-video'
  const { ctx, page } = await open(rec, urlPath, viewport, { lesson })
  const vp = vpName(viewport)
  // The phone draws no 3D: only its CSS animations are set.
  const frozen = async () => {
    if (phone) {
      rec.clock = { cssAnimationsSet: await page.evaluate(HOLD_CSS) }
      return
    }
    rec.clock = await freeze(page)
    rec.camera = await page.evaluate(POSE)
  }
  try {
    await page.mouse.move(2, 2)
    if (view.steps === 'header' || view.steps === 'timeline') {
      rec.placement = phone ? 'the list view as it loads' : 'the opening frame as it loads (rail depth 0)'
      await frozen()
      if (view.steps === 'header') {
        rec.files.push(await shoot(page, `header-full-${vp}.png`))
        rec.files.push(await shoot(page, `header-${vp}.png`, { x: 0, y: 0, width: viewport.width, height: 120 }))
      } else {
        const nav = await page.evaluate(() => !!document.querySelector('main nav[aria-label="Places"]'))
        rec.notes.push(nav ? 'the timeline is on the page' : 'no timeline on this page (main nav[aria-label="Places"] is absent)')
        rec.files.push(await shoot(page, `timeline-full-${vp}.png`))
        rec.files.push(await shoot(page, `timeline-${vp}.png`, { x: 0, y: viewport.height - 140, width: viewport.width, height: 140 }))
      }
    } else if (view.steps === 'checkpoint') {
      if (phone) {
        rec.placement = 'the list view; the header\'s chip clicked'
        await click(page, FIND.chip, 'the chip')
        await waitFor(page, () => !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), { timeout: 8000, what: 'the chip did not open the checkpoint' })
        await sleep(700)
      } else {
        // From the rail point that frames the cache, as at 7:47 in the Loom (the gully): from the
        // opening the camera jumps and glides first, and the park ends a pixel apart run to run.
        rec.placement = "parked at the cache: the rail seeded at the depth that frames it (__worldCheckpoint().depth), then __worldPark('checkpoint'), the panel open"
        await seed(page, await page.evaluate(() => window.__worldCheckpoint().depth))
        await page.evaluate(() => window.__worldPark('checkpoint'))
        await waitFor(page, () => window.__worldFrame?.parkedId === 'checkpoint' && window.__worldFrame.parkProgress >= 0.999 && Number(getComputedStyle(document.querySelector('main section[aria-labelledby="cp-panel-title"]') ?? document.body).opacity) > 0.99 && !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), {
          timeout: PARK_MS,
          what: 'the camera did not park at the cache with the panel open',
        })
        await sleep(1200)
      }
      await frozen()
      rec.files.push(await shoot(page, `${view.name}-${vp}.png`))
    } else if (view.steps === 'badges') {
      rec.placement = phone ? 'the list view; the corner\'s pill clicked (a full sheet)' : 'the opening frame; the corner\'s pill clicked'
      await click(page, FIND.pill, 'the pill')
      await waitFor(page, () => !!document.querySelector('main header [role="dialog"]'), { timeout: 5000, what: 'the list did not open' })
      await sleep(700)
      await frozen()
      rec.files.push(await shoot(page, `${view.name}-${vp}.png`))
    } else if (view.steps === 'lesson' || view.steps === 'lesson-video') {
      rec.placement = `the lesson page, opened by its address (${view.sub})`
      if (view.steps === 'lesson-video') {
        const hasIds = await page.evaluate(() => document.querySelector('[data-dev-videos]')?.getAttribute('data-dev-videos') === '2')
        if (hasIds) {
          const state = await waitFor(page, () => {
            const veil = document.querySelector('[data-video-veil]')
            const frame = [...document.querySelectorAll('iframe[title="Lesson video"]')].find((x) => !x.closest('main'))
            return frame && veil && veil.hasAttribute('data-gone') ? 'ready' : null
          }, { timeout: 25000, poll: 250, what: 'the video player did not say it was ready' }).catch(() => 'loading')
          rec.notes.push(state === 'ready' ? 'the test video\'s player is up (the placeholder gone)' : 'the player did not get ready within 25 s: the placeholder "Loading video…" is in the picture')
          await sleep(1200)
        } else rec.notes.push('the dev page has no test video ids (.env.local), so no player can mount')
      }
      // The map under a lesson page is paused by the page itself (source.paused): left as it is.
      rec.clock = { cssAnimationsSet: await page.evaluate(HOLD_CSS) }
      await sleep(400)
      rec.files.push(await shoot(page, `${view.name}-${vp}.png`))
      rec.lessonBox = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll('h1')].find((h) => !h.closest('main'))
        let box = h1
        // The window round the heading: the nearest ancestor that is a visible box narrower than the screen.
        for (let e = h1; e && e !== document.body; e = e.parentElement) {
          const r = e.getBoundingClientRect()
          const cs = getComputedStyle(e)
          if (r.width < window.innerWidth - 8 && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px')) box = e
        }
        const r = box?.getBoundingClientRect()
        return r ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), spaceAbove: Math.round(r.top), spaceBelow: Math.round(window.innerHeight - r.bottom) } : null
      })
    } else throw new Error(`unknown steps ${view.steps}`)
  } finally {
    await ctx.close().catch(() => {})
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const picked = VIEWS.filter((v) => !ONLY || ONLY.has(v.name))
if (ONLY) {
  const unknown = [...ONLY].filter((n) => !VIEWS.some((v) => v.name === n))
  if (unknown.length) {
    console.error(`unknown view(s): ${unknown.join(', ')}. Views: ${VIEWS.map((v) => v.name).join(', ')}`)
    process.exit(2)
  }
}
fs.mkdirSync(OUT, { recursive: true })

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: path.join(HERE, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
const manifestFile = path.join(OUT, 'manifest.json')
const old = ONLY && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
const runs = old?.runs ?? []
runs.push({
  at: new Date().toISOString(),
  only: ONLY ? [...ONLY] : null,
  poseFrom: POSE_FROM,
  head: git('rev-parse --short HEAD'),
  changedFiles: git('status --porcelain')?.split('\n').filter(Boolean).length ?? null,
})
const pictures = old ? old.pictures.filter((p) => !picked.some((v) => v.name === p.name)) : []

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

let failed = 0
try {
  for (const view of picked) {
    const sizes = view.ui ? UI_SIZES : [DESKTOP]
    for (const viewport of sizes) {
      const rec = {
        name: view.name,
        viewport: vpName(viewport),
        url: null,
        placement: null,
        shows: LABEL === 'before' ? view.shows : view.after ?? view.shows,
        loom: view.loom,
        files: [],
        notes: [],
        pageErrors: [],
        requests: [],
      }
      const t0 = Date.now()
      // Two tries: a hot reload from another agent's edit can rebuild the scene under a picture.
      for (let attempt = 1; attempt <= 2; attempt++) {
        rec.files = []
        rec.error = null
        try {
          if (view.ui) await uiView(view, viewport, rec)
          else await worldView(view, rec)
          break
        } catch (e) {
          rec.error = String(e?.message ?? e).slice(0, 300)
          if (attempt === 1) rec.notes.push(`first try failed: ${rec.error}`)
        }
      }
      rec.ms = Date.now() - t0
      if (rec.error) failed++
      if (!rec.error) delete rec.error
      pictures.push(rec)
      const cam = rec.camera ? `  depth ${rec.camera.depth} key ${rec.camera.key} ${rec.camera.kind}${rec.camera.parked ? ` parked ${rec.camera.parked}` : ''}  ${rec.camera.calls} calls` : ''
      console.log(`${rec.error ? 'FAIL' : 'ok  '}  ${view.name.padEnd(14)} ${rec.viewport.padEnd(10)} ${(rec.ms / 1000).toFixed(1).padStart(5)} s  ${rec.files.join(', ')}${cam}${rec.error ? `\n        ${rec.error}` : ''}${rec.pageErrors.length ? `\n        page errors: ${rec.pageErrors.slice(0, 2).join(' | ')}` : ''}${rec.requests.length ? `\n        requests: ${rec.requests.slice(0, 3).join(', ')}` : ''}`)
    }
  }
} finally {
  await browser.close()
}

const order = new Map(VIEWS.map((v, i) => [v.name, i]))
pictures.sort((a, b) => order.get(a.name) - order.get(b.name) || a.viewport.localeCompare(b.viewport))
fs.writeFileSync(
  manifestFile,
  JSON.stringify(
    {
      label: LABEL,
      origin: ORIGIN,
      clocks: { scene: SCENE_T, life: LIFE_T },
      worldQuery: query(WORLD_QUERY),
      runs,
      pictures,
    },
    null,
    1,
  ),
)
console.log(`\n${pictures.filter((p) => !p.error).length} pictures in ${OUT}, ${failed} failed this run`)
process.exit(failed ? 1 : 0)
