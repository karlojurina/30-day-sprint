/**
 * Course catalog, Work Item 3: the real course on the development page,
 * walked in a real browser.
 * (_admin/prds/course-catalog/course_catalog_prd.md, section 12, the path table.)
 *
 *   node world-tests/v6-course.mjs [--only 2,4]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). It is the harness of
 * v6-app.mjs (the real stage, map, place route and lesson page, a pretend
 * student, no login, no server call) with the real course in place of the
 * generated one: src/app/dev/world-app/courseCatalog.ts builds the rows from
 * supabase/catalog/course_catalog.json and course-lengths.fixture.json.
 * Headless Chrome on the real GPU, autoplay allowed, muted, 1691x1278. Takes
 * about 7 minutes (31 page loads, 32 when row 2 fails, and row 12 watches a
 * 67 second clip in real time): run it in the background.
 *
 * One PASS or FAIL line per row of the table, with what was measured after it.
 * Every row loads its own fresh page in its own browser context. The five
 * rows a script cannot judge (G1 to G5) are printed as NOT COVERED with their
 * reason and are never a pass. After the rows, one MEASURED line: page errors
 * and requests to /api over every page the run opened. Exit code 1 on any FAIL.
 *
 * ROWS 13 TO 16 ARE THE LESSONS' TEXT, on ?catalog=course&text=sample: the
 * made-up text of course-sample-text.fixture.json on a5l22 (a setup action
 * item, no video) and a5l08 (a watch action item with one). A lesson with no
 * video has no player and no 16:9 box, and its text sits right under the
 * Milestone box (13); a lesson with a video has the player, then the
 * Milestone box, then the text (14); the https link opens in a new tab with
 * no opener and the javascript: one is no link (15); a watch lesson with no
 * video and no text says "Not recorded yet." on one short line (16). Row 13
 * also opens a5l22 without ?text=sample and finds no sample there.
 *
 * ROWS 17 TO 20 ARE THE VIDEO ASKED FOR BEFORE THE CLICK (embed-cache.ts).
 * The pointer on a panel row asks the stand-in server for that lesson's
 * address once, before any click, and the click then has the frame in the
 * page within 300 ms with no second ask (17). The app's placeholder covers
 * the 16:9 box from the click until the player's first word (the real player
 * says playbackState "idle", then "ready" in the same millisecond), over the
 * frame once it is in, then fades out; it pulses except under reduced motion
 * (18).
 * A lesson with no video is never asked for, and the map's first load asks
 * for no place's lessons (19). With ?latency=1500 (the stand-in takes 1.5 s,
 * as the real route can) a row clicked at once waits for it, and a row the
 * pointer rested on first still opens within 300 ms (20). Times are from the
 * click to the frame going into the page, on the page's own clock (FAST).
 * The 300 ms includes the route change to the lesson page, which on the dev
 * server is a request of its own (measured 107 to 299 ms, more on a busy
 * server), so rows 17 and 20 print it apart from the rest of the wait.
 * Rows 17, 18 and 20 need the test videos and are NOT COVERED without them.
 *
 * ROWS 21 AND 22 ARE ACTION ITEMS (src/components/world/ActionItemBlock.tsx,
 * the rules in src/lib/world/action-items.ts), done the way a student does
 * them: typed into the field, Enter or a click. The pretend student keeps the
 * link and the two halves in memory (fixtureActionItems.ts), so nothing is
 * asked of /api. On a5l22 (a setup action item, no video) a thread's own
 * link is refused with the old app's message, a message link is saved and
 * shown, and the complete button finishes the lesson and lights "Next
 * lesson" (21). On a5l08 (an action item with a video) the block sits under
 * the text, the complete button is there once the link is saved, and the
 * lesson is done only with both halves, in either order: the video alone is
 * not enough, the button alone is not enough (22). Row 21 takes the three
 * pictures a person looks at (G6): lesson-a5l22-action-empty.png,
 * lesson-a5l22-action-saved.png, lesson-a5l22-action-done.png (and
 * lesson-a5l22-action-error.png).
 *
 * ROW 12 PLAYS A REAL VIDEO. In course mode every lesson that has a video
 * plays the harness's test video 1, and the stand-in server holds it to that
 * clip's length (fixtureTransport.ts, COURSE MODE). So the row presses play
 * on a1l01, waits for the clip's end at normal speed, and the lesson must be
 * done. Playback is driven the way world-tests/tella-watch.mjs drives it: the
 * `play` command posted to the player's frame, and a second `message`
 * listener on the page (window.__probe, this script's own) that records what
 * the frame says. When the harness has no test video the lesson's frame does
 * not mount, and the row is printed as NOT COVERED with that reason: it is
 * never a failure and never a pass.
 *
 * WHAT IS EXPECTED IS WRITTEN TWICE, ON PURPOSE. The counts, the place names,
 * the action items and the pond row below are the plan's own numbers, typed
 * here. The lesson titles and the briefs are read from the JSON. So a change
 * to the data file that the plan does not know about fails row 1 by name.
 *
 * ROW 2 IS THE LESSON LANTERNS (progress-world.ts; the map review of
 * 2026-10-15, item 12: one lantern per lesson along the trail from each
 * place's landmark toward the next place's, evenly spaced, the first by the
 * landmark). Every place puts down as many lanterns as it has lessons (a
 * place that is short is named with both numbers and pictured with every
 * lantern lit). Every lantern stands on dry ground, judged against the water
 * as it is drawn: no triangle of the water meshes (the sea, the Mirror Lake's
 * mirror, the pool, the river, the stream, the brook, the glowing stream, the
 * tarn) within WATER_GAP of its foot with its surface above the ground the
 * lantern stands on. Each place's lanterns are evenly spaced over the ground
 * beside its walk where a lantern may stand (lanternLayout()'s u: every step
 * within SPACING_TOL of the place's spacing, the first at its walk's first
 * room, the last one spacing short of the walk's end, or at it for the last
 * place and for Video Ads II, round 3), and no two of a place closer than 0.6
 * of its spacing in 3D. The
 * first stands within FIRST_NEAR of the landmark's trail point (typed below,
 * WALK_START). Video Ads I's last ones hang on the rock beside the ladder
 * (round 2): each one's post is in the rock to its top and its glass clear
 * of it, read off the terrain meshes as drawn. The bench at the ladder's top
 * is Video Ads II's: all of its lanterns stand from there on, none of Video
 * Ads I's, and its run ends toward the 30% cache (Lovro's Loom, 6:02 to 6:39),
 * where the trail comes into the cache's park view: none of them in that
 * view, the last within CACHE_NEAR of the cache (round 3). None of its glass
 * hides behind the Trail Hut from the hut's stop or parked view (round 3).
 * Every lantern on land stands on ground no steeper than STEEP, the terrain
 * as drawn (round 3: none on a face).
 * Lovro's own test (3 of Video Ads I, 7 of Video Ads II watched) lights 7 of
 * Video Ads II's on the bench round the hut. And watching k lessons of a place
 * lights its first k from its landmark on, with the next one pulsing in the
 * student's current place: four progress states set through
 * __worldV6Debug.setWorldProgress, the glass's aState read back for every
 * lantern.
 *
 * A place's card only shows at the student's own place. So for the card of
 * place k the pretend student is put there first: every lesson of the places
 * before it is marked watched through window.__fixture.complete(), before the
 * map is live, so that no done moment plays.
 *
 * NO VIDEO ID IS READ, PRINTED OR SAVED HERE. Row 9 asks whether the lesson
 * video's frame is on the page and never reads its address. Every line this
 * script prints or saves goes through scrub(), because a browser's own error
 * text can carry one.
 *
 * Screenshots and results.json: world-tests/shots/v6/course/ (git-ignored).
 * The ten a person looks at: place-N-name-parked.png for the eight places
 * (the camera at the place's stop, the student's card up) and
 * place-N-name-panel.png for places 3 and 5 (the place open). And two more
 * for the lessons' text (G5): lesson-a5l22-text-no-video.png and
 * lesson-a5l08-video-milestone-text.png. And one of the video's placeholder
 * while the address is on its way (row 18): lesson-video-placeholder.png.
 *
 * What a row reads, so a change in the markup is found fast:
 *   hooks      window.__worldReady, __worldError, __worldDepth, __worldDepthFor(id),
 *              __worldScrollFor(depth), __worldFrame, __worldProgress(),
 *              __worldCelebrations, __worldV6Debug.moduleStats()["progress-world"]
 *              (perArea, wanted), and the harness's window.__fixture
 *   lanterns   (row 2) the progress-world module's lanternLayout() (through
 *              __worldV6Debug.modules), __worldV6Debug.setWorldProgress, and in
 *              debugScene() the "ProgressLanternGlass" mesh (aState per
 *              instance) and the water meshes by name
 *              (complete(id), completed(), calls)
 *   harness    [data-dev-videos], [data-dev-video-seconds] (layout.tsx: how many
 *              test videos and how long, never which)
 *   the card   main section[data-side][data-show], except [aria-label="Place done"]:
 *              its h2, its tick strip (a span[aria-hidden] holding only <i>),
 *              the count beside the strip, its button "Watch lesson 1, title"
 *   the panel  main section[aria-labelledby="v4-panel-title"], its #v4-panel-title,
 *              its ol > li rows (button aria-label "Lesson N, title[, action item]"
 *              and "Watch lesson N, title"), the count line (the element before
 *              the ol), and the pond: a button outside the ol
 *   markers    main button[data-mode] (index = place), label = its last child
 *   timeline   main nav[aria-label="Places"] [aria-label$="lessons done"]
 *   lesson     the h1 outside `main`, iframe[title="Lesson video"],
 *              [role="progressbar"][aria-label="Lesson progress"], the words
 *              "Not recorded yet.", "Milestone" and "Done.", the "Next lesson"
 *              link (aria-disabled), the lines under the bar (p[role="status"]
 *              outside `main`), window.__fixture.watch[lessonId]
 *   the player (row 12) the frame's messages: "ready", "timeUpdate" with
 *              currentTime and duration, "playbackState" with state
 *   the text   (rows 13 to 16) outside `main`: elements whose class ends
 *              "__player" or "__frame" (the CSS module's names for .player and
 *              .frame), any element with a 16:9 aspect-ratio, the element
 *              holding the paragraph that is the sample's first line, the
 *              element holding the "Milestone" label, the innermost element
 *              saying "Not recorded yet.", and the text's ul, ol, li value,
 *              strong, br and a (href, target, rel)
 *   the block  (rows 21, 22) outside `main`: section[data-action-item] (its
 *              value is the state: empty, saved, completed), its input, its
 *              p[role="alert"], its link, its buttons by their words ("Save",
 *              "Complete lesson", "Complete the action", "Edit link"), the
 *              foot's "Done." and the "Next lesson" link, the "Mark watched
 *              (dev)" button, and window.__fixture.completed()
 *   the wait   (rows 17 to 20) window.__fixture.calls (getEmbed, by lesson),
 *              the placeholder [data-video-veil] outside `main` (data-gone,
 *              its computed opacity, visibility, pointer-events and its
 *              ::before animation-name, its box against the 16:9 box), the
 *              panel's rows by their aria-label number, and the frame's
 *              "ready" message (FAST)
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'course')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
/** How close (rail depth, 0..1) the camera must be to a place's stop to count as resting there. One scroll pixel is about 4e-5. */
const DEPTH_TOL = 6e-4
const LOAD_MS = 80000
const READY_MS = 70000
/** A first visit to a route compiles it on the dev server. */
const NAV_MS = 40000
/** Row 3 loads the page eight times. */
const ROW_MS = 360000
/** Where the player's frame speaks from. An origin, never an address: no video is named by it. */
const TELLA = 'https://www.tella.tv'
/** The player's "ready" after its frame is on the page. */
const PLAYER_READY_MS = 45000
/** Before a picture: the camera is at rest and the card or panel is up; this is for the labels and whatever the scene was still bringing in. */
const SETTLE_MS = 1800

// ── The course, as the plan states it (section 3, C1 to C5) ─────────────────
const NAMES = ['Introduction', 'Marketing Fundamentals', 'Video Ads I', 'Video Ads II', 'Static Ads', 'AI Ads + Content', 'Creative Strategy', 'How To Land Clients']
/** Lessons that count toward progress, per place (a7l19 is the pond row and does not). */
const COUNTING = [8, 11, 25, 17, 26, 22, 18, 13]
const TOTAL = 140
/** The action items: the 1-based row numbers in each place's panel. */
const ACTION_ROWS = [[], [], [25], [], [8, 12, 22, 23], [3, 10, 17, 19], [], []]
/** The Ad Bounty lesson: the pond's button in place 7, outside the lesson count. */
const POND = { place: 6, id: 'a7l19', title: 'How To Win On The Ad Bounty Program' }

// ── The lesson lanterns, as the plan states them (row 2) ────────────────────
/**
 * Where each place's walk starts: the trail point by its landmark, the plan's
 * numbers typed here (progress-world.ts walks() has them too). The last place's
 * lanterns run up the causeway from the dock to the arch, so its walk starts
 * at the dock.
 */
const WALK_START = [
  [1300, 4170], // the signpost
  [440, 2720], // Base Camp, below the lookout's knoll
  [6, 1640], // the pool's east shore, where the ride down the falls sets you down
  [404.75, 1235.36], // the bench by the Trail Hut, where the ladder comes over its lip (round 2)
  [1350, -440], // the jetty's foot
  [-700, -1110], // in front of the Great Tree
  [-1980, -1508], // the terrace by the observatory
  [-2043, -4044], // the dock's head, where the airship sets you down
]
/**
 * A place's first lantern stands within FIRST_NEAR of its walk's start. Static
 * Ads within FIRST_NEAR_STATIC: the path's first 120 or so units from the
 * jetty's foot run under the lake's visible water until item 15c moves the
 * shore, and no lantern stands in water.
 */
const FIRST_NEAR = 35
const FIRST_NEAR_STATIC = 150
/** Every step between a place's lanterns, along the room its walk has, is within this of the place's spacing. */
const SPACING_TOL = 0.5
/** A lantern stands this far from the trail's centre line (its piece's offset) give or take this. */
const OFFSET_TOL = 1
/** No water drawn within this of a lantern's foot. */
const WATER_GAP = 1.5
/** The water meshes WATER_NEAR reads (water.ts, and light.ts's MirrorLake). */
const WATER_MESHES = ['Sea', 'MirrorLake', 'Pool', 'River', 'Stream', 'Brook', 'GlowStream', 'UpperTarn']
/** The Trail Hut (layout TRAIL_HUT, its bench at 300) and the ladder's top on the bench: Video Ads II's lanterns stand from there on, on the bench or higher. */
const HUT = { x: 548, y: 300, z: 1234 }
const LADDER_TOP_X = 404
/** Lovro's test at 6:16 in the Loom lights Video Ads II's 7 on the bench within this of the hut. */
const HUT_NEAR = 220
/**
 * The 30% cache (checkpoint.ts CHECKPOINT) and its park camera (CHECKPOINT.park:
 * position, compass bearing, pitch below the horizon, vertical lens), the view
 * the discount panel opens on. Video Ads II's walk ends where the trail comes
 * into that view (round 3), its last lantern just under the frame's bottom
 * edge: within CACHE_NEAR of the cache, none past it, none in the frame at
 * PARK_ASPECT (3428x1230, the widest screen the review pictures take).
 */
const CACHE = { x: 1472, z: 692 }
const PARK = { x: 1436, y: 690, z: 862, bearing: 4, pitch: 4, fov: 40 }
const PARK_ASPECT = 3428 / 1230
const CACHE_NEAR = 120
/** No lantern on land stands on ground steeper than this (rise over run over STEEP_E, the terrain as drawn; progress-world.ts STEEP 1.5). */
const STEEP = 1.5
const STEEP_E = 2
const STEEP_TOL = 0.1

// ── The course, as the data files hold it ───────────────────────────────────
const CATALOG = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'supabase', 'catalog', 'course_catalog.json'), 'utf8'))
const LENGTHS = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'src', 'app', 'dev', 'world-app', 'course-lengths.fixture.json'), 'utf8'))
/**
 * Rows 13 to 16: the made-up text ?text=sample puts on a5l22 and a5l08
 * (courseCatalog.ts, THE LESSONS' TEXT). Its first paragraph, its https link
 * and its javascript: link are read from it here.
 */
const SAMPLE = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'src', 'app', 'dev', 'world-app', 'course-sample-text.fixture.json'), 'utf8'))
const SAMPLE_TEXT = SAMPLE.lessons.a5l22.text
const SAMPLE_FIRST = SAMPLE_TEXT.split('\n')[0]
const [, SAMPLE_LINK, SAMPLE_HREF] = /\[([^\]]+)\]\((https:[^)\s]+)\)/.exec(SAMPLE_TEXT)
const [, SAMPLE_SCRIPT] = /\[([^\]]+)\]\(javascript:/.exec(SAMPLE_TEXT)
/** Per place, in route order: the lessons that count and the rows that do not, in the JSON's order. */
const PLACES = CATALOG.areas.map((a) => {
  const rows = CATALOG.lessons.filter((l) => l.area === a.id)
  return { id: a.id, name: a.name, counting: rows.filter((l) => l.counts !== false), outside: rows.filter((l) => l.counts === false) }
})
const lessonOf = (id) => CATALOG.lessons.find((l) => l.id === id) ?? null
/** Whole minutes, the way the map and the lesson page round them. */
const minutesOf = (id) => (LENGTHS[id] > 0 ? Math.max(1, Math.round(LENGTHS[id] / 60)) : null)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const f = (n, d = 4) => (typeof n === 'number' ? n.toFixed(d) : String(n))
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
/** A string as a pattern that matches it and nothing else (for SAYS). */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** Nothing shaped like a video id or a Tella address leaves this script. */
const scrub = (s) =>
  String(s)
    .replace(/https?:\/\/[^\s"'<>)]*tella[^\s"'<>)]*/gi, '<a Tella address>')
    .replace(/vid_[a-z0-9]+/gi, 'vid_<hidden>')
const say = (line) => console.log(scrub(line))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 300 ? `${s.slice(0, 300)}…` : s
}
/** Every page of this script is the course: ?catalog=course goes on each address. */
const url = (sub, params = {}) => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', ...params }).toString()}`
const shotName = (k, what) => `place-${k + 1}-${slug(NAMES[k])}-${what}`

/** Everything the run saw, over every page it opened (the MEASURED line). */
const tally = { pages: 0, apiStudent: [], api: [], pageErrors: [], consoleErrors: [] }
const results = []

// ── Functions that run in the page ──────────────────────────────────────────

/** What is on screen, read from the DOM and the map's hooks. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const shown = (el) => (el && el.dataset.show !== undefined ? el : null)
  const card = shown(document.querySelector('main section[data-side]:not([aria-label="Place done"])'))
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  const tl = document.querySelector('main nav[aria-label="Places"] [aria-label$="lessons done"]')
  const h1 = [...document.querySelectorAll('h1')].find((h) => !h.closest('main')) ?? null
  // The words on the page outside the map: the lesson page.
  let outside = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    outside += ` ${n.textContent}`
  }
  return {
    path: location.pathname,
    y: Math.round(window.scrollY),
    card: card ? { title: norm(card.querySelector('h2')?.textContent), text: norm(card.textContent) } : null,
    panel: panel ? norm(panel.querySelector('#v4-panel-title')?.textContent) : null,
    count: tl?.getAttribute('aria-label') ?? null,
    lesson: h1 ? norm(h1.textContent) : null,
    outside: norm(outside),
    frames: [...document.querySelectorAll('iframe')].filter((x) => !x.closest('main, nextjs-portal')).length,
    celebrations: typeof window.__worldCelebrations === 'number' ? window.__worldCelebrations : null,
    progress: window.__worldProgress?.() ?? null,
    watched: window.__fixture ? window.__fixture.completed().length : null,
  }
}

/** The student's card at place k: its name, its count, its tick strip, and where the strip sits inside it. */
const CARD = (k) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    const b = el.getBoundingClientRect()
    return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, w: Math.round(b.width * 10) / 10 }
  }
  const card = document.querySelector('main section[data-side][data-show]:not([aria-label="Place done"])')
  if (!card) return null
  // One <i> per lesson and nothing else: the tick strip.
  const strip = [...card.querySelectorAll('span[aria-hidden="true"]')].find((el) => el.children.length > 0 && [...el.children].every((c) => c.tagName === 'I')) ?? null
  const label = document.querySelectorAll('main button[data-mode]')[k]
  return {
    title: norm(card.querySelector('h2')?.textContent),
    count: strip?.nextElementSibling ? norm(strip.nextElementSibling.textContent) : null,
    ticks: strip ? strip.children.length : 0,
    watch: card.querySelector('button[aria-label^="Watch lesson "]')?.getAttribute('aria-label') ?? null,
    box: box(card),
    strip: strip ? box(strip) : null,
    lastTick: strip?.lastElementChild ? box(strip.lastElementChild) : null,
    label: label ? norm(label.lastElementChild?.textContent) : null,
  }
}

/** The open place panel: its count line, its rows, and the buttons outside the list. */
const READ_PANEL = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  if (!panel) return null
  const ol = panel.querySelector('ol')
  const rows = []
  let fold = null
  for (const li of ol ? [...ol.children] : []) {
    const foldButton = li.querySelector('button[data-state="fold"]')
    if (foldButton) {
      fold = norm(foldButton.textContent)
      continue
    }
    const button = li.querySelector('button[aria-label]')
    const label = button?.getAttribute('aria-label') ?? ''
    let kind = 'unknown'
    let n = null
    let title = null
    let m = /^Watch lesson (\d+), (.*)$/.exec(label)
    if (m) {
      kind = 'next'
      n = Number(m[1])
      title = m[2]
    } else if ((m = /^Lesson (\d+), (.*?)(, watched|, action item)?$/.exec(label))) {
      n = Number(m[1])
      title = m[2]
      kind = m[3] === ', watched' ? 'done' : m[3] === ', action item' ? 'action' : 'todo'
    }
    // What is left of the row once its number, its title and the Watch button's word are taken out: the minutes, "Action", or nothing.
    let tail = norm(li.textContent)
    if (n !== null && tail.startsWith(String(n))) tail = tail.slice(String(n).length)
    if (title && tail.includes(title)) tail = tail.replace(title, '')
    tail = norm(norm(tail).replace(/Watch$/, ''))
    rows.push({ n, kind, title, tail })
  }
  return {
    title: norm(panel.querySelector('#v4-panel-title')?.textContent),
    count: ol?.previousElementSibling ? norm(ol.previousElementSibling.textContent) : null,
    fold,
    rows,
    // After the list: the pond's row, when the place has one.
    after: [...panel.querySelectorAll('button')].filter((b) => ol && !ol.contains(b) && (ol.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).map((b) => norm(b.textContent)),
  }
}

/** The lanterns the map laid out, per place, and how many it was asked for (progress-world.ts, stats()). */
const LANTERNS = () => {
  const sc = window.__worldV6Debug
  const st = sc && typeof sc.moduleStats === 'function' ? sc.moduleStats()['progress-world'] : null
  if (!st || typeof st !== 'object') return null
  return { perArea: st.perArea ?? null, wanted: st.wanted ?? null, lessonLanterns: st.lessonLanterns ?? null, placeLamps: st.placeLamps ?? null, instances: st.instances ?? null }
}

/**
 * Row 2: where the lesson lanterns stand, as progress-world.ts reports it
 * (lanternLayout(): each place's walk, and every lesson lantern with its
 * instance index and how far along its walk's room it stands).
 */
const LANTERN_LAYOUT = () => {
  const sc = window.__worldV6Debug
  const mod = sc?.modules?.find((m) => m.name === 'progress-world')?.module
  return mod && typeof mod.lanternLayout === 'function' ? mod.lanternLayout() : null
}

/**
 * Row 2: set the student's progress on the scene and read back how lit every
 * lantern is (the glass's aState per instance: 0 dark, 1 lit, 2 the next one).
 */
const SET_AND_READ = (p) => {
  const sc = window.__worldV6Debug
  sc.setWorldProgress(p)
  const scene = sc.debugScene ? sc.debugScene() : sc.scene
  let glass = null
  scene.traverse((o) => {
    if (o.name === 'ProgressLanternGlass') glass = o
  })
  return glass ? Array.from(glass.geometry.getAttribute('aState').array.slice(0, glass.count)) : null
}

/**
 * Row 2: water drawn at or near each point, read off the water meshes
 * themselves (in world space, every triangle): for each point, the first
 * water triangle within `margin` of it (in plan) whose surface at its nearest
 * point stands above `ground`, the height the lantern stands on. A lantern
 * on a bank above a river is dry; one at the lake's edge with the mirror
 * over the ground beside it is not. Returns the hits and the meshes it found.
 */
const WATER_NEAR = ({ pts, margin, names }) => {
  const sc = window.__worldV6Debug
  const scene = sc.debugScene ? sc.debugScene() : sc.scene
  const meshes = []
  scene.traverse((o) => {
    if (o.isMesh && names.includes(o.name)) meshes.push(o)
  })
  const sets = meshes.map((m) => {
    m.updateMatrixWorld(true)
    const pos = m.geometry.getAttribute('position')
    const idx = m.geometry.getIndex()
    const n = idx ? idx.count : pos.count
    const e = m.matrixWorld.elements
    const arr = new Float64Array(n * 3)
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let k = 0; k < n; k++) {
      const i = idx ? idx.getX(k) : k
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      arr[k * 3] = wx
      arr[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
      arr[k * 3 + 2] = wz
      minX = Math.min(minX, wx)
      maxX = Math.max(maxX, wx)
      minZ = Math.min(minZ, wz)
      maxZ = Math.max(maxZ, wz)
    }
    return { name: m.name, arr, tris: Math.floor(n / 3), minX, maxX, minZ, maxZ }
  })
  /** The nearest point of triangle abc to p, in plan, as barycentric weights and its distance. */
  const nearest = (px, pz, ax, az, bx, bz, cx, cz) => {
    const abx = bx - ax, abz = bz - az, acx = cx - ax, acz = cz - az
    const apx = px - ax, apz = pz - az
    const d1 = abx * apx + abz * apz, d2 = acx * apx + acz * apz
    if (d1 <= 0 && d2 <= 0) return [1, 0, 0]
    const bpx = px - bx, bpz = pz - bz
    const d3 = abx * bpx + abz * bpz, d4 = acx * bpx + acz * bpz
    if (d3 >= 0 && d4 <= d3) return [0, 1, 0]
    const vc = d1 * d4 - d3 * d2
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3)
      return [1 - v, v, 0]
    }
    const cpx = px - cx, cpz = pz - cz
    const d5 = abx * cpx + abz * cpz, d6 = acx * cpx + acz * cpz
    if (d6 >= 0 && d5 <= d6) return [0, 0, 1]
    const vb = d5 * d2 - d1 * d6
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6)
      return [1 - w, 0, w]
    }
    const va = d3 * d6 - d5 * d4
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
      return [0, 1 - w, w]
    }
    const den = 1 / (va + vb + vc)
    const v = vb * den
    const w = vc * den
    return [1 - v - w, v, w]
  }
  const hits = pts.map((p) => {
    for (const t of sets) {
      if (p.x < t.minX - margin || p.x > t.maxX + margin || p.z < t.minZ - margin || p.z > t.maxZ + margin) continue
      const a = t.arr
      for (let k = 0; k < t.tris; k++) {
        const o = k * 9
        const ax = a[o], ay = a[o + 1], az = a[o + 2]
        const bx = a[o + 3], by = a[o + 4], bz = a[o + 5]
        const cx = a[o + 6], cy = a[o + 7], cz = a[o + 8]
        if (p.x < Math.min(ax, bx, cx) - margin || p.x > Math.max(ax, bx, cx) + margin || p.z < Math.min(az, bz, cz) - margin || p.z > Math.max(az, bz, cz) + margin) continue
        // A triangle seen edge on from above (a waterfall's sheet) covers no ground.
        if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-6) continue
        const [wa, wb, wc] = nearest(p.x, p.z, ax, az, bx, bz, cx, cz)
        const d = Math.hypot(ax * wa + bx * wb + cx * wc - p.x, az * wa + bz * wb + cz * wc - p.z)
        if (d > margin) continue
        const y = ay * wa + by * wb + cy * wc
        if (y > p.ground) return { name: t.name, d, water: y, ground: p.ground }
      }
    }
    return null
  })
  return { hits, meshes: sets.map((t) => `${t.name} ${t.tris}`) }
}

/**
 * Row 2: for each point, whether the object named `name` (every mesh under it,
 * as drawn) stands between the camera `cam` and the point. Null when there is
 * no such object.
 */
const HIDDEN_BY = ({ name, cam, pts }) => {
  const sc = window.__worldV6Debug
  const scene = sc.debugScene ? sc.debugScene() : sc.scene
  const obj = scene.getObjectByName(name)
  if (!obj) return null
  obj.updateMatrixWorld(true)
  const tris = []
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible) return
    const pos = o.geometry.getAttribute('position')
    const idx = o.geometry.getIndex()
    const n = idx ? idx.count : pos.count
    const e = o.matrixWorld.elements
    const w = (i) => {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]
    }
    for (let k = 0; k + 2 < n; k += 3) tris.push([w(idx ? idx.getX(k) : k), w(idx ? idx.getX(k + 1) : k + 1), w(idx ? idx.getX(k + 2) : k + 2)])
  })
  // Moller-Trumbore on the segment from the camera to the point.
  const hit = (p) => {
    const d = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]]
    for (const [a, b, c] of tris) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
      if (Math.abs(det) < 1e-9) continue
      const s = [cam[0] - a[0], cam[1] - a[1], cam[2] - a[2]]
      const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det
      if (u < 0 || u > 1) continue
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det
      if (v < 0 || u + v > 1) continue
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det
      if (t > 1e-4 && t < 0.999) return true
    }
    return false
  }
  return pts.map(hit)
}

/**
 * Row 2: the ground as drawn at each point (x, z): the highest terrain
 * triangle over it, in world space, of the terrain meshes the camera draws
 * ("Terrain", "Terrain:falls", "Terrain:patchN"; not surfaces.ts's coarse
 * "Terrain:mirror", which only the Mirror Lake's reflection draws), or null
 * where none is. For the lanterns on the rock beside the ladder: the rock over
 * a post's top, and under its glass. Returns the heights and the meshes read.
 */
const TERRAIN_AT = (pts) => {
  const sc = window.__worldV6Debug
  const scene = sc.debugScene ? sc.debugScene() : sc.scene
  const meshes = []
  scene.traverse((o) => {
    if (o.isMesh && /^Terrain(:falls|:patch\d+)?$/.test(o.name)) meshes.push(o)
  })
  const top = pts.map(() => null)
  for (const m of meshes) {
    m.updateMatrixWorld(true)
    const pos = m.geometry.getAttribute('position')
    const idx = m.geometry.getIndex()
    const n = idx ? idx.count : pos.count
    const e = m.matrixWorld.elements
    const w = (i) => {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]
    }
    for (let k = 0; k + 2 < n; k += 3) {
      const A = w(idx ? idx.getX(k) : k)
      const B = w(idx ? idx.getX(k + 1) : k + 1)
      const C = w(idx ? idx.getX(k + 2) : k + 2)
      const minX = Math.min(A[0], B[0], C[0])
      const maxX = Math.max(A[0], B[0], C[0])
      const minZ = Math.min(A[2], B[2], C[2])
      const maxZ = Math.max(A[2], B[2], C[2])
      for (let p = 0; p < pts.length; p++) {
        const { x, z } = pts[p]
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue
        const den = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2])
        if (Math.abs(den) < 1e-9) continue
        const a = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den
        const b = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den
        const c = 1 - a - b
        if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue
        const y = a * A[1] + b * B[1] + c * C[1]
        if (top[p] === null || y > top[p]) top[p] = y
      }
    }
  }
  return { heights: top, meshes: meshes.map((m) => m.name) }
}

/**
 * Row 12, installed before the page's own scripts (tella-watch.mjs's probe,
 * the two parts this row needs): what the player's frame says, and every
 * status line the page ever shows outside the map, kept as it is added so a
 * line that came and went is still seen. The lines under the progress bar are
 * among them; so is the host's "Loading the world…".
 */
const PROBE = (tellaOrigin) => {
  if (window !== window.top) return
  window.__probe = { msgs: [], lines: [] }
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
  new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue
        const lines = node.matches('p[role="status"]') ? [node] : [...node.querySelectorAll('p[role="status"]')]
        for (const p of lines) {
          const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text !== '' && !p.closest('main')) window.__probe.lines.push(text)
        }
      }
    }
  }).observe(document, { childList: true, subtree: true })
}

/**
 * Rows 17 to 20, installed before the page's own scripts: when a panel row was
 * clicked, when the lesson's frame went into the page, when its player first
 * said anything and when it said "ready", and what the app's placeholder over
 * the frame looked like at each of those moments. All on the page's own clock
 * (performance.now). The frame's address is never read. reset() forgets one
 * click so the page can time a second.
 *
 * "First said anything" because the real player says playbackState "idle" in
 * the same millisecond just before "ready" (measured 2026-10-14, 3 loads of
 * 3), and the placeholder goes at the player's first word.
 */
const FAST = (tellaOrigin) => {
  if (window !== window.top) return
  const veil = () => {
    const v = [...document.querySelectorAll('[data-video-veil]')].find((x) => !x.closest('main'))
    if (!v) return null
    const cs = getComputedStyle(v)
    const box = v.parentElement
    const frame = box.querySelector('iframe[title="Lesson video"]')
    return {
      gone: v.dataset.gone !== undefined,
      opacity: Number(cs.opacity),
      visibility: cs.visibility,
      text: (v.textContent ?? '').replace(/\s+/g, ' ').trim(),
      // The 16:9 box, edge to edge (inside its 1 px border).
      covers: v.offsetWidth > 0 && Math.abs(v.offsetWidth - box.clientWidth) <= 1 && Math.abs(v.offsetHeight - box.clientHeight) <= 1,
      // After the frame in the same box, both absolutely placed: drawn over it.
      overFrame: !!frame && frame.parentElement === box && (frame.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      takesClicks: cs.pointerEvents !== 'none',
      pulse: getComputedStyle(v, '::before').animationName,
    }
  }
  const fresh = () => ({ click: null, heading: null, frame: null, first: null, firstSaid: null, ready: null, veilAtFrame: null, veilAtFirst: null, veilAtReady: null })
  window.__fast = { ...fresh(), veil, reset: () => Object.assign(window.__fast, fresh()) }
  document.addEventListener(
    'click',
    (e) => {
      if (window.__fast.click === null && e.target instanceof Element && e.target.closest('main section[aria-labelledby="v4-panel-title"] ol')) window.__fast.click = performance.now()
    },
    true,
  )
  window.addEventListener('message', (e) => {
    if (e.origin !== tellaOrigin || window.__fast.click === null || window.__fast.ready !== null) return
    let d = e.data
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d)
      } catch {
        return
      }
    }
    if (!d || typeof d !== 'object') return
    // Registered before the page's own listener, so this sees the placeholder as it was when each word arrived.
    if (window.__fast.first === null && ['ready', 'playbackState', 'timeUpdate'].includes(d.type)) {
      window.__fast.first = performance.now()
      window.__fast.firstSaid = typeof d.state === 'string' ? `${d.type} ${d.state}` : String(d.type)
      window.__fast.veilAtFirst = veil()
    }
    if (d.type === 'ready') {
      window.__fast.ready = performance.now()
      window.__fast.veilAtReady = veil()
    }
  })
  new MutationObserver(() => {
    if (window.__fast.click === null) return
    // The lesson page's heading: the route change is done (its request to the dev server included).
    if (window.__fast.heading === null && [...document.querySelectorAll('h1')].some((h) => !h.closest('main'))) window.__fast.heading = performance.now()
    if (window.__fast.frame !== null) return
    if ([...document.querySelectorAll('iframe[title="Lesson video"]')].some((x) => !x.closest('main'))) {
      window.__fast.frame = performance.now()
      window.__fast.veilAtFrame = veil()
    }
  }).observe(document, { childList: true, subtree: true })
}

/** The stand-in server's getEmbed calls for one lesson, or for every lesson. */
const ASKED = (lessonId) => (window.__fixture?.calls ?? []).filter((c) => c.call === 'getEmbed' && (lessonId === null || c.lessonId === lessonId)).map((c) => c.lessonId)

/** Post one command to the lesson's frame, the way the measured player takes them. */
const SEND = ({ message, tellaOrigin }) => {
  const frame = [...document.querySelectorAll('iframe[title="Lesson video"]')].find((x) => !x.closest('main'))
  if (!frame || !frame.contentWindow) return false
  frame.contentWindow.postMessage(message, tellaOrigin)
  return true
}

/**
 * The END of the video at or after message `i`: a "stopped" or a "paused" in
 * the last 1.5 s, after a position report from there (the real player ends on
 * either word; tella-watch.mjs, waitStopped). Returns the message, or null.
 */
const ENDED = ({ i, end }) => {
  let near = false
  for (const m of window.__probe.msgs.slice(i)) {
    if (m.type === 'timeUpdate') near = m.t >= end
    else if (m.type === 'playbackState' && (m.state === 'stopped' || m.state === 'paused') && near && (m.t === null || m.t >= end)) return m
  }
  return null
}

/** The lesson page once the video has been played: its own done state, and what the stand-in server holds for `lessonId`. */
const WATCHED = ({ lessonId, from }) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const outside = (el) => !el.closest('main, nextjs-portal')
  const bar = document.querySelector('[role="progressbar"][aria-label="Lesson progress"]')
  const next = [...document.querySelectorAll('a')].filter(outside).find((a) => /Next lesson/.test(a.textContent)) ?? null
  const fx = window.__fixture ?? null
  let words = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    words += ` ${n.textContent}`
  }
  const reports = window.__probe.msgs.slice(from).filter((m) => m.type === 'timeUpdate')
  return {
    completed: fx ? fx.completed().includes(lessonId) : null,
    saysDone: /(^| )Done\.( |$)/.test(norm(words)),
    next: next ? { disabled: next.getAttribute('aria-disabled'), href: next.getAttribute('href') } : null,
    linesNow: [...document.querySelectorAll('p[role="status"]')].filter(outside).map((p) => norm(p.textContent)).filter((t) => t !== ''),
    linesEver: [...new Set(window.__probe.lines)],
    bar: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
    row: fx && fx.watch ? (fx.watch[lessonId] ?? null) : null,
    calls: fx && fx.calls ? fx.calls.filter((c) => c.lessonId === lessonId && c.call !== 'getEmbed') : [],
    reports: reports.length,
    first: reports[0] ?? null,
    last: reports.at(-1) ?? null,
  }
}

/**
 * Rows 13 to 16: the lesson page under the title, measured. The player is any
 * element whose class is the player's or its frame's (world-ui.module.css
 * .player and .frame, as the CSS module names them: "…__player", "…__frame"),
 * the lesson's text is the element holding the paragraph that is `first`, and
 * the Milestone box is the element holding the "Milestone" label. Every box is
 * in page pixels.
 */
const LAYOUT = (first) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const outside = (el) => !el.closest('main, nextjs-portal')
  const box = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10 }
  }
  const all = [...document.querySelectorAll('body *')].filter(outside)
  const ofClass = (re) => all.filter((el) => [...el.classList].some((c) => re.test(c)))
  const h1 = all.find((el) => el.tagName === 'H1') ?? null
  const firstP = all.find((el) => el.tagName === 'P' && norm(el.textContent) === first) ?? null
  const text = firstP?.parentElement ?? null
  const label = all.find((el) => el.tagName === 'P' && norm(el.textContent) === 'Milestone') ?? null
  const milestone = label?.parentElement ?? null
  const player = ofClass(/__player$/)
  // The innermost elements that say it, so a wrapper is not counted twice.
  const said = all.filter((el) => norm(el.textContent) === 'Not recorded yet.' && ![...el.children].some((c) => norm(c.textContent) === 'Not recorded yet.'))
  let words = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    words += ` ${n.textContent}`
  }
  return {
    heading: h1 ? norm(h1.textContent) : null,
    player: player.length,
    playerBox: box(player[0]),
    frames: ofClass(/__frame$/).length,
    iframes: all.filter((el) => el.tagName === 'IFRAME').length,
    sixteenByNine: all.filter((el) => getComputedStyle(el).aspectRatio.replace(/\s/g, '') === '16/9').length,
    bar: !!document.querySelector('[role="progressbar"][aria-label="Lesson progress"]'),
    milestone: box(milestone),
    text: box(text),
    shape: text
      ? {
          bullets: [...text.querySelectorAll('ul > li')].length,
          numbers: [...text.querySelectorAll('ol > li')].map((li) => li.value),
          olStart: text.querySelector('ol')?.start ?? null,
          bold: text.querySelectorAll('strong').length,
          breaks: text.querySelectorAll('p br').length,
          // The space between each block and the one before it, in px.
          gaps: [...text.children].slice(1).map((el) => Math.round(el.getBoundingClientRect().top - el.previousElementSibling.getBoundingClientRect().bottom)),
        }
      : null,
    notRecorded: said.map((el) => ({ tag: el.tagName, ...box(el) })),
    words: norm(words),
    asked: (window.__fixture?.calls ?? []).length,
  }
}

/** Row 15: the links inside the lesson's text, and whether `script` (the javascript: link's label) is inside any link. */
const LINKS = ({ first, script }) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const outside = (el) => !el.closest('main, nextjs-portal')
  const firstP = [...document.querySelectorAll('p')].filter(outside).find((p) => norm(p.textContent) === first)
  const text = firstP?.parentElement ?? null
  const holders = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && outside(n.parentElement) && n.textContent.includes(script)) holders.push(n.parentElement)
  }
  return {
    links: text ? [...text.querySelectorAll('a')].map((a) => ({ text: norm(a.textContent), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') })) : null,
    scriptShown: holders.length > 0,
    scriptInALink: holders.some((el) => el.closest('a') !== null),
    scriptHrefs: [...document.querySelectorAll('a[href]')].filter(outside).filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length,
  }
}

/** Do the words on the page (scripts and styles left out) match the pattern? */
const SAYS = (source) => {
  let text = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('script, style, noscript, template')) continue
    text += ` ${n.textContent}`
  }
  return new RegExp(source).test(text.replace(/\s+/g, ' '))
}

/**
 * Rows 21 and 22: the action item's block and the page's foot, measured.
 * `first` is the sample text's first line (the text is the element holding
 * that paragraph); `id` the lesson.
 */
const ACTION = ({ first, id }) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const outside = (el) => !el.closest('main, nextjs-portal')
  const box = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10 }
  }
  const block = [...document.querySelectorAll('section[data-action-item]')].find(outside) ?? null
  const firstP = [...document.querySelectorAll('p')].filter(outside).find((p) => norm(p.textContent) === first) ?? null
  const label = [...document.querySelectorAll('p')].filter(outside).find((p) => norm(p.textContent) === 'Milestone') ?? null
  const button = (re) => (block ? [...block.querySelectorAll('button')].find((b) => re.test(norm(b.textContent))) ?? null : null)
  const input = block?.querySelector('input') ?? null
  const alert = block?.querySelector('p[role="alert"]') ?? null
  const link = block?.querySelector('a[href]') ?? null
  const complete = button(/^Complete (lesson|the action)$/)
  const next = [...document.querySelectorAll('a')].filter(outside).find((a) => /Next lesson/.test(a.textContent)) ?? null
  let words = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    words += ` ${n.textContent}`
  }
  const at = document.activeElement
  return {
    state: block?.dataset.actionItem ?? null,
    text: block ? norm(block.textContent) : null,
    input: input ? { value: input.value, invalid: input.getAttribute('aria-invalid'), name: input.getAttribute('aria-labelledby') ? norm(document.getElementById(input.getAttribute('aria-labelledby'))?.textContent) : null } : null,
    alert: alert ? norm(alert.textContent) : null,
    link: link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel') } : null,
    complete: complete ? norm(complete.textContent) : null,
    edit: !!button(/^Edit link$/),
    focus: at && block?.contains(at) ? norm(at.textContent) || at.tagName : at ? at.tagName : null,
    saysDone: /(^| )Done\.( |$)/.test(norm(words)),
    next: next ? { disabled: next.getAttribute('aria-disabled'), href: next.getAttribute('href') } : null,
    done: window.__fixture ? window.__fixture.completed().includes(id) : null,
    boxes: { milestone: box(label?.parentElement ?? null), text: box(firstP?.parentElement ?? null), block: box(block), player: box([...document.querySelectorAll('body *')].filter(outside).find((el) => [...el.classList].some((c) => /__player$/.test(c))) ?? null) },
  }
}

/** Put `value` in the block's field the way a person does: click it, select what is there, type over it. */
async function typeLink(page, value, what) {
  const handle = await page.evaluateHandle(() => [...document.querySelectorAll('section[data-action-item] input')].find((x) => !x.closest('main')) ?? null)
  const input = handle.asElement()
  if (!input) {
    await handle.dispose()
    throw new Error(`${what}: the block has no field`)
  }
  await input.click()
  await page.evaluate((el) => el.select(), input)
  await input.dispose()
  if (value === '') await page.keyboard.press('Backspace')
  else await page.keyboard.type(value, { delay: 2 })
}

/** Click the block's button whose words match `source` (a pattern). */
async function pressBlockButton(page, source, what) {
  return click(page, (src) => {
    const re = new RegExp(src)
    const block = [...document.querySelectorAll('section[data-action-item]')].find((x) => !x.closest('main'))
    return block ? ([...block.querySelectorAll('button')].find((b) => re.test(b.textContent.replace(/\s+/g, ' ').trim())) ?? null) : null
  }, source, { what })
}

/** A Discord message link of the right shape: made-up ids. */
const GOOD_LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
/** A thread's own link: two ids. The old app refused it, and so does the database. */
const THREAD_LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002'
/** The old route's words for a wrong link, typed here from it. */
const OLD_LINK_ERROR = 'That doesn\'t look like a Discord message link. Right-click the message in #ad-review and click "Copy Message Link."'

/** What a row clicks. Each returns one element or null. */
const FIND = {
  marker: (k) => {
    const b = document.querySelectorAll('main button[data-mode]')[k]
    return b ? (b.dataset.mode === 'text' ? b.lastElementChild : b) : null
  },
  fold: () => document.querySelector('main section[aria-labelledby="v4-panel-title"] button[data-state="fold"]'),
  pond: (title) =>
    [...document.querySelectorAll('main section[aria-labelledby="v4-panel-title"] button')].find(
      (b) => !b.closest('ol') && (b.textContent ?? '').replace(/\s+/g, ' ').trim() === title,
    ) ?? null,
}

// ── Driving the page (v6-app.mjs's way) ─────────────────────────────────────

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

async function openPage(ctx, row, urlPath, { probe = false, fast = false } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(60000)
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 })
  if (probe) await page.evaluateOnNewDocument(PROBE, TELLA)
  if (fast) await page.evaluateOnNewDocument(FAST, TELLA)
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
    // This app's own routes only, and the path only: an address on Tella's side can hold a video id.
    if (u.origin !== ORIGIN || !u.pathname.startsWith('/api/')) return
    const rec = { row: row.id, method: req.method(), path: u.pathname }
    row.api.push(rec)
    tally.api.push(rec)
    if (u.pathname.startsWith('/api/student/')) tally.apiStudent.push(rec)
  })
  // Headless Chrome pauses a muted video in a hidden tab: the page under test stays in front.
  await page.bringToFront()
  await page.goto(`${ORIGIN}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: LOAD_MS })
  return page
}

async function ready(page, what) {
  await waitFor(page, () => window.__worldReady === true || typeof window.__worldError === 'string', {
    timeout: READY_MS,
    poll: 200,
    what: `${what}: the map never reported ready`,
  })
  const err = await page.evaluate(() => window.__worldError ?? null)
  if (err) throw new Error(`${what}: the scene failed: ${err}`)
  await page.evaluate(() => document.fonts.ready.then(() => true))
}

/** Wait until the camera has stopped at place k (0-based): its depth is the stop's and has not changed, nor has the scroll, for three reads. */
async function restAt(page, k, what, timeout = 25000) {
  const id = `a${k + 1}`
  const t0 = Date.now()
  let last = null
  let prev = null
  let steady = 0
  while (Date.now() - t0 < timeout) {
    try {
      last = await page.evaluate(
        (pid) => ({
          d: typeof window.__worldDepth === 'number' ? window.__worldDepth : null,
          t: window.__worldDepthFor ? window.__worldDepthFor(pid) : null,
          y: Math.round(window.scrollY),
        }),
        id,
      )
    } catch {
      last = null
    }
    const there = last && last.d !== null && last.t !== null && Math.abs(last.d - last.t) < DEPTH_TOL
    if (there && prev && prev.d !== null && Math.abs(prev.d - last.d) < 1e-6 && prev.y === last.y) steady++
    else steady = 0
    if (steady >= 3) return { ...last, ms: Date.now() - t0 }
    prev = last
    await sleep(120)
  }
  throw new Error(
    `${what}: the camera did not come to rest at place ${k + 1} within ${timeout} ms (depth ${f(last?.d)}, the place is at ${f(last?.t)}, scrollY ${last?.y})`,
  )
}

/** Put the page scroll on place k's stop, the way the timeline does, and wait for the camera. */
async function scrollToPlace(page, k, what) {
  await page.evaluate((pid) => window.scrollTo(0, Math.round(window.__worldScrollFor(window.__worldDepthFor(pid)))), `a${k + 1}`)
  return restAt(page, k, what)
}

async function waitCard(page, what, timeout = 15000) {
  await waitFor(page, () => !!document.querySelector('main section[data-side][data-show]:not([aria-label="Place done"])'), {
    timeout,
    what: `${what}: the card did not show`,
  })
  await sleep(400) // its 200 ms fade
}

const waitPath = (page, pathname, what, timeout = NAV_MS) =>
  waitFor(page, (p) => location.pathname === p, { arg: pathname, timeout, what: `${what}: the address did not become ${pathname}` })

/** The panel of place k is open and the camera has arrived. */
async function waitPanel(page, k, what, timeout = 40000) {
  await waitFor(
    page,
    (name) => {
      const p = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
      if (!p || (p.querySelector('#v4-panel-title')?.textContent ?? '').trim() !== name) return false
      const fr = window.__worldFrame
      return !fr || fr.parkProgress >= 0.999
    },
    { arg: NAMES[k], timeout, what: `${what}: the panel of place ${k + 1} (${NAMES[k]}) did not open` },
  )
  await sleep(300)
}

const waitNoPanel = (page, what, timeout = 25000) =>
  waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"]') && document.body.style.overflow !== 'hidden', {
    timeout,
    what: `${what}: the place did not close`,
  })

const waitLesson = (page, title, what, timeout = NAV_MS) =>
  waitFor(
    page,
    (t) => {
      const h = [...document.querySelectorAll('h1')].find((x) => !x.closest('main'))
      return !!h && h.textContent.replace(/\s+/g, ' ').trim() === t
    },
    { arg: title, timeout, what: `${what}: the lesson page "${title}" did not show` },
  )

/**
 * Click what `find` returns. A real mouse click when the element is on screen
 * with nothing over it; a DOM click otherwise (a label the card has replaced).
 * Returns which it was. scroll 'box' first brings the element into view inside
 * the nearest box that scrolls by itself (the panel's list). It never scrolls
 * the page: on the map the page scroll is the camera.
 */
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

/** Travel to place k, click its label, wait for the address and the panel. */
async function openPlace(page, k, what) {
  await scrollToPlace(page, k, what)
  await sleep(450) // the labels are laid out once the scroll rests
  const via = await click(page, FIND.marker, k, { what: `${what}: the label of place ${k + 1}` })
  await waitPath(page, `${APP}/a${k + 1}`, what)
  await waitPanel(page, k, what)
  return via
}

/**
 * Rows 17 to 20: openPlace without the mouse. The label is clicked through
 * the DOM and the pointer is parked in the header's corner first, so it rests
 * on no row of the panel that opens; a row is reached only when a row says so.
 */
async function openPlaceQuietly(page, k, what) {
  await scrollToPlace(page, k, what)
  await sleep(450) // the labels are laid out once the scroll rests
  await page.mouse.move(4, 4)
  const clicked = await page.evaluate((kk) => {
    const b = document.querySelectorAll('main button[data-mode]')[kk]
    const el = b ? (b.dataset.mode === 'text' ? b.lastElementChild : b) : null
    if (!el) return false
    el.click()
    return true
  }, k)
  if (!clicked) throw new Error(`${what}: the label of place ${k + 1} is not on the page`)
  await waitPath(page, `${APP}/a${k + 1}`, what)
  await waitPanel(page, k, what)
}

/** The middle of lesson row n (1-based) of the open panel, brought into view inside the panel's list first. Never scrolls the page. */
async function rowPoint(page, n, what) {
  const at = await page.evaluate((i) => {
    const ol = document.querySelector('main section[aria-labelledby="v4-panel-title"] ol')
    const li = ol
      ? ([...ol.children].find((x) => Number(/^(?:Watch lesson|Lesson) (\d+),/.exec(x.querySelector('button[aria-label]')?.getAttribute('aria-label') ?? '')?.[1]) === i) ?? null)
      : null
    if (!li) return null
    for (let box = li.parentElement; box && box !== document.body; box = box.parentElement) {
      const overflowY = getComputedStyle(box).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight + 1) {
        const a = li.getBoundingClientRect()
        const f = box.getBoundingClientRect()
        box.scrollTop += a.top + a.height / 2 - (f.top + f.height / 2)
        break
      }
    }
    const b = li.querySelector('button').getBoundingClientRect()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
  }, n)
  if (!at) throw new Error(`${what}: no lesson row ${n} in the open panel`)
  return at
}

/** Give lesson row n (1-based) of the open panel the keyboard focus. */
const FOCUS_ROW = (i) => {
  const ol = document.querySelector('main section[aria-labelledby="v4-panel-title"] ol')
  const li = ol ? [...ol.children].find((x) => Number(/^(?:Watch lesson|Lesson) (\d+),/.exec(x.querySelector('button[aria-label]')?.getAttribute('aria-label') ?? '')?.[1]) === i) : null
  const b = li?.querySelector('button')
  if (!b) return false
  b.focus()
  return document.activeElement === b
}

/** Does the harness have its two test videos (layout.tsx: how many, never which)? */
const hasTestVideos = (page) => page.evaluate(() => document.querySelector('[data-dev-videos]')?.getAttribute('data-dev-videos') === '2')
const NO_TEST_VIDEOS = 'the harness has no test video ([data-dev-videos] is not "2": DEV_TELLA_VIDEO_ID and DEV_TELLA_VIDEO_ID_2 are not both set), so no lesson frame can mount here.'

/** A lesson that has a video in course mode (courseCatalog.ts: a watch lesson with a length). */
const hasVideoInJson = (id) => lessonOf(id)?.type === 'watch' && LENGTHS[id] > 0

/** The frame went into the page after the click: both stamps, page clock. */
const FRAME_UP = () => window.__fast.click !== null && window.__fast.frame !== null && { click: window.__fast.click, heading: window.__fast.heading, frame: window.__fast.frame }

/** "312 ms from the click (the route change to the lesson page 260 ms, then 52 ms to the frame)". */
const split = (t) =>
  `${Math.round(t.frame - t.click)} ms from the click (the route change to the lesson page ${t.heading === null ? '?' : Math.round(t.heading - t.click)} ms, then ${t.heading === null ? '?' : Math.round(t.frame - t.heading)} ms to the frame)`

async function closePlace(page, what) {
  await page.keyboard.press('Escape')
  await waitPath(page, APP, what)
  await waitNoPanel(page, what)
}

/** The panel's rows, with the folded "Lessons 1 to N watched" row opened first. */
async function readPanel(page, what) {
  let p = await page.evaluate(READ_PANEL)
  if (!p) throw new Error(`${what}: no panel to read`)
  if (p.fold) {
    await click(page, FIND.fold, null, { what: `${what}: the folded rows` })
    await waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"] button[data-state="fold"]'), {
      timeout: 5000,
      what: `${what}: the watched rows did not unfold`,
    })
    p = await page.evaluate(READ_PANEL)
  }
  return p
}

/**
 * Put the pretend student at place k: every counting lesson of the places
 * before it is marked watched. Called right after the page starts loading,
 * before the map is live, so the map takes it as where the student already
 * was and plays no done moment.
 */
async function standAt(page, k, what) {
  const ids = PLACES.slice(0, k).flatMap((p) => p.counting.map((l) => l.id))
  await waitFor(page, () => typeof window.__fixture?.complete === 'function', { timeout: LOAD_MS, poll: 60, what: `${what}: window.__fixture did not appear` })
  const mapWasLive = await page.evaluate((list) => {
    const live = window.__worldReady === true
    for (const id of list) window.__fixture.complete(id)
    return live
  }, ids)
  return { marked: ids.length, mapWasLive }
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  return path.relative(HERE, file)
}

// ── Rows ────────────────────────────────────────────────────────────────────

function printRow(rec) {
  const parts = rec.checks.map((c) => `${c.ok ? 'ok' : 'NOT OK'} ${c.label}: ${show(c.got)}`)
  if (rec.notCovered) parts.unshift(rec.notCovered)
  if (rec.error) parts.push(`STOPPED: ${rec.error}`)
  if (Object.keys(rec.values).length) parts.push(`also: ${show(rec.values)}`)
  say(`${rec.pass ? 'PASS' : rec.notCovered ? 'NOT COVERED' : 'FAIL'}  ${String(rec.id).padStart(2)}  ${rec.name}: ${parts.join(' | ')}`)
}

let browser = null

async function runRow(id, name, fn) {
  if (ONLY && !ONLY.has(String(id))) return
  const rec = { id, name, pass: false, notCovered: null, checks: [], values: {}, error: null, ms: 0 }
  const t0 = Date.now()
  const ctx = await browser.createBrowserContext()
  let page = null
  const row = {
    id,
    api: [],
    pageErrors: [],
    values: rec.values,
    check(label, ok, got) {
      rec.checks.push({ label, ok: !!ok, got })
      return !!ok
    },
    /** The row could not be run here, for a reason outside the code under test. Not a pass and not a failure. */
    notCovered(why) {
      rec.notCovered = why
    },
    /** One page at a time: a page behind another is hidden, and a hidden map pauses itself. */
    async open(urlPath, opts) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, urlPath, opts)
      return page
    },
    shot: (name) => shot(page, name),
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
        rec.values.failedShot = await shot(page, `${String(id).padStart(2, '0')}-STOPPED`)
        rec.values.at = await page.evaluate(() => location.pathname + location.search)
      } catch {
        // the page is gone
      }
    }
  } finally {
    clearTimeout(timer)
    await ctx.close().catch(() => {})
  }
  rec.ms = Date.now() - t0
  // A row that stopped on an error is a failure whatever else it said.
  if (rec.error) rec.notCovered = null
  rec.pass = !rec.error && !rec.notCovered && rec.checks.length > 0 && rec.checks.every((c) => c.ok)
  results.push(rec)
  printRow(rec)
}

/**
 * Before the rows: load the three routes once with an empty catalog (no 3D),
 * so the dev server has compiled them and no row's first navigation waits on a
 * compile. Returns null when the harness renders, or why it does not.
 */
async function warmUp() {
  const ctx = await browser.createBrowserContext()
  const row = { id: 'warm-up', api: [], pageErrors: [] }
  const t0 = Date.now()
  let page = null
  try {
    for (const sub of ['', '/a1', '/a1/a1l01']) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, `${APP}${sub}?catalog=empty`)
      await waitFor(page, SAYS, {
        arg: 'There are no lessons here yet\\.',
        timeout: LOAD_MS,
        poll: 250,
        what: `${APP}${sub}?catalog=empty did not show the empty-catalog card`,
      })
    }
    say(`warm-up: the three routes render (${Date.now() - t0} ms)`)
    return null
  } catch (e) {
    let seen = ''
    try {
      seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    } catch {
      // no page
    }
    const errs = row.pageErrors.map((x) => x.message).slice(0, 2).join(' || ')
    return `${String(e?.message ?? e)}${seen ? `; the page says: ${seen}` : ''}${errs ? `; page errors: ${errs}` : ''}`
  } finally {
    await ctx.close().catch(() => {})
  }
}

const ROWS = [
  [1, 'The map takes the real counts'],
  [2, 'Every lesson has a lantern'],
  [3, "Each place's card"],
  [4, "Each place's panel"],
  [5, 'Action items'],
  [6, 'The pond'],
  [7, 'The total'],
  [8, '26 ticks fit'],
  [9, 'A lesson page with a video'],
  [10, 'A lesson page without a video'],
  [11, "An action item's page"],
  [12, 'A course lesson watched to its end'],
  [13, "A lesson with no video: its text in the video's place"],
  [14, 'A lesson with a video and a text: the player, the Milestone box, the text'],
  [15, "The links in a lesson's text"],
  [16, 'A watch lesson with no video and no text'],
  [17, "A row's video is asked for when the pointer reaches it, once, and the click puts the frame up at once"],
  [18, 'The placeholder over the video until its player is ready'],
  [19, 'A lesson without a video is never asked for'],
  [20, 'With the server taking 1.5 s, a hovered row still opens at once'],
  [21, 'A setup action item: paste the Discord link, save it, complete the lesson'],
  [22, 'An action item with a video: the link under the text, and both halves to finish it'],
]
const nameOf = (id) => ROWS.find((r) => r[0] === id)[1]

const LOOK_AT = [...NAMES.map((_, k) => `${shotName(k, 'parked')}.png`), `${shotName(2, 'panel')}.png`, `${shotName(4, 'panel')}.png`]
const GAPS = [
  [
    'G1',
    'How the 8 stops look with the real names',
    `not a script verdict. A person looks at the ten pictures in shots/v6/course/, one by one, and writes down what was seen: ${LOOK_AT.join(', ')}.`,
  ],
  ['G2', 'The default page is unchanged', 'another script proves it: `node world-tests/v6-app.mjs` must still end PASS 20  FAIL 0  NOT COVERED 3.'],
  ['G3', 'Lanterns in uncleared ground cover (C12)', 'a residual for the eye, on the same ten pictures. Not a failure.'],
  ['G4', 'The real login, the real server', 'gap by design: /ship.'],
  [
    'G5',
    "How a lesson's text looks",
    'not a script verdict. A person looks at the two pictures rows 13 and 14 take in shots/v6/course/ (lesson-a5l22-text-no-video.png, lesson-a5l08-video-milestone-text.png): the type, the lists, the bold, the link.',
  ],
  [
    'G6',
    "How an action item's Discord block looks",
    'not a script verdict. A person looks at the pictures row 21 takes in shots/v6/course/: lesson-a5l22-action-empty.png, lesson-a5l22-action-error.png, lesson-a5l22-action-saved.png, lesson-a5l22-action-done.png.',
  ],
]

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // The last two are for row 12: a `play` command with no click behind it, and no sound.
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  protocolTimeout: 85000,
})

let down = null
try {
  down = await warmUp()
  if (down) {
    say(`HARNESS DOWN: ${down}`)
    for (const [id, name] of ROWS) {
      if (ONLY && !ONLY.has(String(id))) continue
      const rec = { id, name, pass: false, checks: [], values: {}, error: 'not run, the harness did not render', ms: 0 }
      results.push(rec)
      printRow(rec)
    }
  } else {
    // 1 ── The map takes the real counts
    await runRow(1, nameOf(1), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 1')
      const s = await page.evaluate(SNAP)
      const inFile = PLACES.map((p) => p.counting.length)
      r.check(`course_catalog.json holds the plan's course (${COUNTING.join(',')} counting lessons, the 8 names)`, same(inFile, COUNTING) && same(PLACES.map((p) => p.name), NAMES), {
        counting: inFile,
        rows: CATALOG.lessons.length,
      })
      r.check(`__worldProgress().lessons is ${COUNTING.join(',')}`, same(s.progress?.lessons, COUNTING), s.progress?.lessons ?? null)
      r.values.done = s.progress?.done ?? null
      r.values.timeline = s.count
    })

    // 2 ── Every lesson has a lantern
    await runRow(2, nameOf(2), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 2')
      const want = COUNTING.join(',')
      // The scene lays the lanterns out again once it has the page's counts.
      await waitFor(page, (w) => window.__worldV6Debug?.moduleStats?.()['progress-world']?.wanted === w, { arg: want, timeout: 15000, poll: 250, soft: true, what: 'row 2: the layout' })
      const st = await page.evaluate(LANTERNS)
      r.check('the map was asked for one lantern per lesson (wanted)', st?.wanted === want, st?.wanted ?? null)
      const all = r.check('every place put down as many (perArea equals wanted)', !!st && st.perArea === st.wanted, st ? `perArea ${st.perArea}; wanted ${st.wanted}` : null)
      r.values.lanterns = st
      const lay = await page.evaluate(LANTERN_LAYOUT)
      const reported = r.check(
        'the map says where its lesson lanterns stand (lanternLayout(), 8 places)',
        !!lay && Array.isArray(lay.lanterns) && Array.isArray(lay.places) && lay.places.length === NAMES.length,
        lay ? `${lay.lanterns?.length} lanterns, ${lay.places?.length} places` : null,
      )
      if (reported) {
        const at = (l) => `place ${l.area + 1} lesson ${l.lesson + 1} at (${f(l.x, 0)}, ${f(l.z, 0)})`
        const byPlace = NAMES.map((_, k) => lay.lanterns.filter((l) => l.area === k).sort((a, b) => a.u - b.u))
        r.values.places = lay.places.map((p, k) => ({
          place: `${k + 1} ${NAMES[k]}`,
          lanterns: byPlace[k].length,
          spacing: p.spacing,
          room: p.room,
          sides: p.sides,
          firstFromStart: byPlace[k].length ? Math.round(Math.hypot(byPlace[k][0].x - WALK_START[k][0], byPlace[k][0].z - WALK_START[k][1])) : null,
        }))
        r.check(
          `one lantern per lesson in every place (${want}), numbered from its landmark on`,
          byPlace.every((ls, k) => ls.length === COUNTING[k] && ls.every((l, j) => l.lesson === j)),
          byPlace.map((ls) => ls.length).join(','),
        )

        // Dry ground, judged against the water as it is drawn.
        const water = await page.evaluate(WATER_NEAR, { pts: lay.lanterns.map((l) => ({ x: l.x, z: l.z, ground: l.y + 0.3 })), margin: WATER_GAP, names: WATER_MESHES })
        const wet = water.hits.map((h, i) => (h ? `${at(lay.lanterns[i])}: ${h.name} ${f(h.d, 1)} away, its surface ${f(h.water, 1)} over the ground at ${f(h.ground, 1)}` : null)).filter(Boolean)
        r.values.waterMeshes = water.meshes
        r.check(`every water mesh is there to judge by (${WATER_MESHES.length})`, WATER_MESHES.every((n) => water.meshes.some((m) => m.startsWith(`${n} `))), water.meshes)
        r.check(`every lantern on dry ground: no water drawn within ${WATER_GAP} of its foot`, wet.length === 0, wet.length ? wet.slice(0, 6) : 'none')

        // Evenly spaced along the walk, the first by the landmark, a constant way from the trail.
        const uneven = []
        const packed = []
        const offTrail = []
        byPlace.forEach((ls, k) => {
          const p = lay.places[k]
          if (!ls.length) return
          if (Math.abs(ls[0].u - p.first) > SPACING_TOL) uneven.push(`place ${k + 1}: the first stands ${f(ls[0].u, 1)} into its walk's room, not at its first room ${f(p.first, 1)}`)
          for (let j = 1; j < ls.length; j++) {
            const du = ls[j].u - ls[j - 1].u
            if (Math.abs(du - p.spacing) > SPACING_TOL) uneven.push(`place ${k + 1}: lessons ${j} to ${j + 1} are ${f(du, 1)} apart along the walk, its spacing ${f(p.spacing, 1)}`)
            const d3 = Math.hypot(ls[j].x - ls[j - 1].x, ls[j].y - ls[j - 1].y, ls[j].z - ls[j - 1].z)
            if (d3 < 0.6 * p.spacing) packed.push(`place ${k + 1}: lessons ${j} and ${j + 1} stand ${f(d3, 1)} apart, its spacing ${f(p.spacing, 1)}`)
          }
          const tail = p.room - ls[ls.length - 1].u
          const wantTail = p.toEnd ? 0 : p.spacing
          if (Math.abs(tail - wantTail) > SPACING_TOL) uneven.push(`place ${k + 1}: the last stands ${f(tail, 1)} short of its walk's end, not ${f(wantTail, 1)}`)
          for (const l of ls) {
            const want = p.offsets[l.piece]
            if (Math.abs(l.trail - want) > OFFSET_TOL) offTrail.push(`${at(l)}: ${f(l.trail, 1)} from the trail's middle, not ${want}`)
          }
        })
        r.check(`each place's lanterns evenly spaced along its walk (every step within ${SPACING_TOL} of its spacing; the last one spacing short of the next place, at its walk's end for Video Ads II and at the arch for the last)`, uneven.length === 0, uneven.length ? uneven.slice(0, 6) : lay.places.map((p, k) => `${k + 1}: ${f(p.spacing, 1)}`).join(', '))
        r.check('no two lanterns of a place closer than 0.6 of its spacing', packed.length === 0, packed.length ? packed.slice(0, 6) : 'none')
        r.check(`every lantern its piece's offset from the trail's middle (within ${OFFSET_TOL})`, offTrail.length === 0, offTrail.length ? offTrail.slice(0, 6) : 'none')

        const starts = lay.places.map((p, k) => (p.start ? Math.hypot(p.start[0] - WALK_START[k][0], p.start[1] - WALK_START[k][1]) : Infinity))
        r.check('each walk starts at its landmark\'s trail point (WALK_START)', starts.every((d) => d < 1), starts.map((d) => f(d, 1)).join(', '))
        const far = byPlace
          .map((ls, k) => {
            const limit = k === 4 ? FIRST_NEAR_STATIC : FIRST_NEAR
            const d = ls.length ? Math.hypot(ls[0].x - WALK_START[k][0], ls[0].z - WALK_START[k][1]) : Infinity
            const nearest = ls.every((l) => Math.hypot(l.x - WALK_START[k][0], l.z - WALK_START[k][1]) >= d - 1e-6)
            return d <= limit && nearest ? null : `place ${k + 1} ${NAMES[k]}: the first stands ${f(d, 1)} from its walk's start (at most ${limit})${nearest ? '' : ', and another stands nearer'}`
          })
          .filter(Boolean)
        r.check(`each place's first lantern is the nearest to its landmark's trail point, within ${FIRST_NEAR} (Static Ads ${FIRST_NEAR_STATIC})`, far.length === 0, far.length ? far : r.values.places.map((p) => p.firstFromStart).join(', '))
        // Video Ads I's last ones hang on the rock beside the ladder: the rock over each post's top, under its glass's back.
        const onRock = byPlace[2].filter((l) => l.wall)
        const rock = onRock.length ? await page.evaluate(TERRAIN_AT, onRock.flatMap((l) => [{ x: l.wall.post[0], z: l.wall.post[2] }, { x: l.wall.back[0], z: l.wall.back[2] }])) : null
        const showing = []
        onRock.forEach((l, i) => {
          const over = rock?.heights?.[i * 2]
          const under = rock?.heights?.[i * 2 + 1]
          if (!(typeof over === 'number' && over >= l.wall.post[1])) showing.push(`${at(l)}: its post's top at ${f(l.wall.post[1], 1)} stands out of the rock (the rock there at ${f(over, 1)})`)
          if (!(typeof under === 'number' && under <= l.wall.back[1])) showing.push(`${at(l)}: its glass's foot at ${f(l.wall.back[1], 1)} is in the rock (the rock there at ${f(under, 1)})`)
        })
        r.check(
          'Video Ads I\'s lanterns on the ladder hang from the rock beside it: each post in the rock to its top, each glass clear of it (the terrain as drawn)',
          onRock.length > 0 && showing.length === 0,
          showing.length ? showing.slice(0, 6) : `${onRock.length} on the rock, beside the ladder by ${onRock.map((l) => f(l.trail, 1)).join(', ')}; meshes ${rock?.meshes?.join(', ')}`,
        )
        const va2 = byPlace[3]
        const behind = va2.filter((l) => !(l.x > LADDER_TOP_X && l.y >= HUT.y - 5)).map(at)
        const onBench = byPlace[2].filter((l) => l.y >= HUT.y - 5).map(at)
        r.check(
          `all ${COUNTING[3]} of Video Ads II's lanterns stand from the ladder's top on (on the bench by the hut or higher), and none of Video Ads I's on that bench`,
          va2.length === COUNTING[3] && behind.length === 0 && onBench.length === 0,
          behind.length || onBench.length ? [...behind, ...onBench.map((s) => `Video Ads I's on the bench: ${s}`)] : `${va2.length} from the ladder's top on`,
        )
        const lastVa2 = va2[va2.length - 1]
        const pastCache = va2.filter((l) => l.z < CACHE.z).map(at)
        const toCache = lastVa2 ? Math.hypot(lastVa2.x - CACHE.x, lastVa2.z - CACHE.z) : Infinity
        // Round 3: none of its lanterns shows in the cache's park view (the post, foot to top, projected into
        // that camera's frame at the widest screen the review takes), and the run still reaches the cache.
        const b = (PARK.bearing * Math.PI) / 180
        const pt = (PARK.pitch * Math.PI) / 180
        const fwd = [Math.sin(b) * Math.cos(pt), -Math.sin(pt), -Math.cos(b) * Math.cos(pt)]
        const right = [Math.cos(b), 0, Math.sin(b)]
        const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
        const tanV = Math.tan(((PARK.fov / 2) * Math.PI) / 180)
        /** Where (x, y, z) lands in the park frame: [-1, 1] across and up is inside it; null behind the camera. */
        const inFrame = (x, y, z) => {
          const v = [x - PARK.x, y - PARK.y, z - PARK.z]
          const d = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2]
          if (d <= 0.1) return null
          return [(v[0] * right[0] + v[1] * right[1] + v[2] * right[2]) / (d * tanV * PARK_ASPECT), (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / (d * tanV)]
        }
        const showing2 = []
        let nearestEdge = -Infinity
        for (const l of va2) {
          for (const dy of [0, 4, 8, 10]) {
            const q = inFrame(l.x, l.y + dy, l.z)
            if (!q) continue
            if (Math.abs(q[0]) <= 1) nearestEdge = Math.max(nearestEdge, q[1])
            if (Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1) {
              showing2.push(`${at(l)}: ${dy ? `${dy} over its foot` : 'its foot'} at (${f(q[0], 2)}, ${f(q[1], 2)}) in the frame`)
              break
            }
          }
        }
        r.check(
          `none of Video Ads II's lanterns shows in the 30% cache's park view (the discount panel's view, ${PARK_ASPECT.toFixed(2)} wide); its last within ${CACHE_NEAR} of the cache, none past it`,
          va2.length > 0 && showing2.length === 0 && toCache <= CACHE_NEAR && pastCache.length === 0,
          showing2.length || pastCache.length || !lastVa2 ? [...showing2, ...pastCache.map((s) => `past the cache: ${s}`)] : `the nearest comes to ${f(nearestEdge, 2)} of the frame's height (its bottom edge is -1); the last ${f(toCache, 0)} from the cache`,
        )
        // Round 3: none on a face. The ground under every lantern on land, as drawn, no steeper than STEEP.
        const onLand = lay.lanterns.filter((l) => !l.wall && lay.places[l.area]?.pieces?.[l.piece]?.ground === 'land')
        const slopes = onLand.length ? await page.evaluate(TERRAIN_AT, onLand.flatMap((l) => [{ x: l.x, z: l.z }, { x: l.x + STEEP_E, z: l.z }, { x: l.x, z: l.z + STEEP_E }])) : null
        const steep = []
        let steepest = 0
        onLand.forEach((l, i) => {
          const [h, hx, hz] = [0, 1, 2].map((d) => slopes?.heights?.[i * 3 + d])
          if (![h, hx, hz].every((v) => typeof v === 'number')) return steep.push(`${at(l)}: no drawn ground under it`)
          const s = Math.hypot(hx - h, hz - h) / STEEP_E
          steepest = Math.max(steepest, s)
          if (s > STEEP + STEEP_TOL) steep.push(`${at(l)}: its ground rises ${f(s, 2)} per unit`)
        })
        r.check(
          `every lantern on land stands on ground no steeper than ${STEEP} (the terrain as drawn, over ${STEEP_E})`,
          onLand.length > 0 && steep.length === 0,
          steep.length ? steep.slice(0, 6) : `${onLand.length} on land, the steepest ${f(steepest, 2)}`,
        )

        // Watching k lessons lights the first k from the landmark on; the next one pulses in the current place.
        const lighting = (label, p) => {
          return page.evaluate(SET_AND_READ, p).then((states) => {
            const wrong = []
            byPlace.forEach((ls, k) => {
              ls.forEach((l, rank) => {
                const want = rank < p.done[k] ? 1 : k === p.current && rank === p.done[k] ? 2 : 0
                const got = states ? states[l.i] : null
                if (got !== want) wrong.push(`${at(l)}: state ${got}, wants ${want}`)
              })
            })
            r.check(`${label}: every place's first k lit from its landmark on, the next one pulsing in the current place`, !!states && wrong.length === 0, wrong.length ? wrong.slice(0, 6) : `done ${p.done.join(',')}`)
            return states
          })
        }
        const someDone = [3, 5, 7, 7, 9, 4, 6, 2]
        await lighting('some of every place watched, the student in Video Ads II with 7', { lessons: COUNTING, done: someDone, current: 3, next: someDone[3] + 1 })
        // Lovro's own test at 6:16 in the Loom: 3 of Video Ads I and 7 of Video Ads II watched, nothing else.
        const loomDone = [0, 0, 3, 7, 0, 0, 0, 0]
        const states = await lighting('Lovro\'s test in the Loom (3 of Video Ads I, 7 of Video Ads II)', { lessons: COUNTING, done: loomDone, current: 3, next: loomDone[3] + 1 })
        const litVa2 = states ? va2.filter((l) => states[l.i] === 1) : []
        const litVa1 = states ? byPlace[2].filter((l) => states[l.i] === 1) : []
        const hutD = (l) => Math.hypot(l.x - HUT.x, l.z - HUT.z)
        r.check(
          `Lovro's test lights Video Ads II's 7 on the bench within ${HUT_NEAR} of the hut, and Video Ads I's 3 down by the river, none of them on the bench`,
          litVa2.length === 7 && litVa2.every((l) => l.y >= HUT.y - 5 && hutD(l) <= HUT_NEAR) && litVa1.length === 3 && litVa1.every((l) => l.y < HUT.y - 100),
          `Video Ads II: ${litVa2.map((l) => `${at(l)} ${f(hutD(l), 0)} from the hut`).join('; ')}. Video Ads I: ${litVa1.map(at).join('; ')}`,
        )
        await lighting('nothing watched', { lessons: COUNTING, done: COUNTING.map(() => 0), current: 0, next: 1 })
        await lighting('everything watched', { lessons: COUNTING, done: COUNTING.slice(), current: 8, next: 0 })

        // Round 3: from the hut's stop and from its parked view (Lovro's at 6:02 and 6:17), no Video Ads II
        // lantern's glass hides behind the hut (from the parked view the hut's eave hides 18 units of the bench
        // west of it, and at 39 apart one lantern stood there).
        const glassPts = (l) => (Array.isArray(l.glass) ? [[0, 0, 0], [-0.6, -0.75, 0], [0.6, -0.75, 0], [-0.6, 0.75, 0], [0.6, 0.75, 0], [0, -0.75, -0.6], [0, 0.75, 0.6]].map(([dx, dy, dz]) => [l.glass[0] + dx, l.glass[1] + dy, l.glass[2] + dz]) : [])
        const near = va2.filter((l) => Array.isArray(l.glass) && Math.hypot(l.x - HUT.x, l.z - HUT.z) < 300)
        const hutViews = []
        await scrollToPlace(page, 3, 'row 2, the hut\'s stop')
        hutViews.push({ view: 'the stop', cam: await page.evaluate(() => { const c = window.__worldV6Debug.cameraPose(); return [c.x, c.y, c.z] }) })
        await openPlaceQuietly(page, 3, 'row 2, the hut parked')
        hutViews.push({ view: 'parked', cam: await page.evaluate(() => { const c = window.__worldV6Debug.cameraPose(); return [c.x, c.y, c.z] }) })
        const behindHut = []
        for (const hv of hutViews) {
          const hits = await page.evaluate(HIDDEN_BY, { name: 'LM_TrailHut', cam: hv.cam, pts: near.flatMap(glassPts) })
          if (!hits) {
            behindHut.push(`${hv.view}: no LM_TrailHut in the scene`)
            continue
          }
          near.forEach((l, i) => {
            const n = hits.slice(i * 7, i * 7 + 7).filter(Boolean).length
            if (n) behindHut.push(`${hv.view}: ${at(l)}, ${n} of 7 points of its glass behind the hut`)
          })
        }
        r.check(
          'no Video Ads II lantern\'s glass is hidden behind the Trail Hut from its stop or its parked view',
          near.length > 0 && behindHut.length === 0,
          behindHut.length ? behindHut.slice(0, 6) : `${near.length} lanterns within 300 of the hut, clear from ${hutViews.map((h) => `${h.view} (${h.cam.map((v) => f(v, 0)).join(', ')})`).join(' and ')}`,
        )
      }
      if (!st || all) return
      // A place is short. Say which, and take its picture with every lantern lit.
      const got = String(st.perArea).split(',').map(Number)
      const asked = String(st.wanted).split(',').map(Number)
      const short = asked.map((n, k) => ({ k, asked: n, got: got[k] })).filter((x) => x.got !== x.asked)
      r.values.short = short.map((x) => `place ${x.k + 1} ${NAMES[x.k]}: ${x.got} lanterns for ${x.asked} lessons`)
      const lit = await r.open(url('', { p: 'all', arrive: 0, poster: 'off' }))
      await ready(lit, 'row 2, every lantern lit')
      r.values.shots = []
      for (const x of short) {
        await scrollToPlace(lit, x.k, `row 2, place ${x.k + 1}`)
        await sleep(SETTLE_MS)
        r.values.shots.push(await r.shot(`lanterns-short-place-${x.k + 1}-${slug(NAMES[x.k])}-all-lit`))
      }
      r.values.litPage = await lit.evaluate(LANTERNS)
    })

    // 3 ── Each place's card
    await runRow(3, nameOf(3), async (r) => {
      r.values.shots = []
      r.values.cards = []
      for (let k = 0; k < NAMES.length; k++) {
        const what = `row 3, place ${k + 1}`
        const page = await r.open(url('', { arrive: 0, poster: 'off' }))
        const stood = await standAt(page, k, what)
        await ready(page, what)
        await scrollToPlace(page, k, what)
        await waitCard(page, what)
        await sleep(SETTLE_MS)
        const c = await page.evaluate(CARD, k)
        const s = await page.evaluate(SNAP)
        const n = COUNTING[k]
        // Nothing watched in the place: "25 lessons", with the minutes after it when every lesson has a length.
        const countOk = new RegExp(`^${n} lessons( · \\d+ min)?$`).test(c?.count ?? '')
        r.check(`place ${k + 1}: the card says ${NAMES[k]} and ${n} lessons`, !!c && c.title === NAMES[k] && countOk && c.ticks === n, c ? `"${c.title}", "${c.count}", ${c.ticks} ticks` : null)
        r.values.cards.push({ place: k + 1, watch: c?.watch ?? null, label: c?.label ?? null, watchedBefore: stood.marked, doneMoments: s.celebrations, mapWasLive: stood.mapWasLive })
        r.values.shots.push(await r.shot(shotName(k, 'parked')))
      }
    })

    // 4 ── Each place's panel
    await runRow(4, nameOf(4), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 4')
      r.values.shots = []
      r.values.counts = []
      let titles = 0
      let wrong = []
      for (let k = 0; k < NAMES.length; k++) {
        const what = `row 4, place ${k + 1}`
        await openPlace(page, k, what)
        const p = await readPanel(page, what)
        const want = PLACES[k].counting.map((l) => l.title)
        const got = p.rows.map((x) => x.title)
        const numbered = p.rows.every((x, i) => x.n === i + 1)
        r.check(
          `place ${k + 1}: ${COUNTING[k]} rows, the first and the last carry the JSON's titles`,
          p.rows.length === COUNTING[k] && numbered && got[0] === want[0] && got.at(-1) === want.at(-1),
          `${p.rows.length} rows; 1 "${got[0]}"; ${p.rows.length} "${got.at(-1)}"`,
        )
        titles += got.filter((t, i) => t === want[i]).length
        wrong = wrong.concat(want.map((t, i) => (got[i] === t ? null : `${PLACES[k].counting[i].id}: "${got[i]}"`)).filter(Boolean))
        r.values.counts.push(p.count)
        if (k === 2 || k === 4) {
          await sleep(SETTLE_MS)
          r.values.shots.push(await r.shot(shotName(k, 'panel')))
        }
        await closePlace(page, what)
      }
      r.check(`every row of every panel carries the JSON's title, in the JSON's order (${TOTAL})`, titles === TOTAL && wrong.length === 0, wrong.length ? wrong.slice(0, 5) : `${titles} of ${TOTAL}`)
    })

    // 5 ── Action items
    await runRow(5, nameOf(5), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 5')
      const seen = []
      for (let k = 0; k < NAMES.length; k++) {
        const what = `row 5, place ${k + 1}`
        await openPlace(page, k, what)
        const p = await readPanel(page, what)
        // A row is an action item when the panel says so twice: in its name for a screen reader, and in the word where the minutes go.
        seen.push({ named: p.rows.filter((x) => x.kind === 'action').map((x) => x.n), worded: p.rows.filter((x) => x.tail === 'Action').map((x) => x.n) })
        await closePlace(page, what)
      }
      for (const k of [2, 4, 5]) {
        r.check(
          `place ${k + 1}: ${ACTION_ROWS[k].length === 1 ? 'row' : 'rows'} ${ACTION_ROWS[k].join(', ')} read "Action"`,
          same(seen[k].worded, ACTION_ROWS[k]) && same(seen[k].named, ACTION_ROWS[k]),
          seen[k].worded,
        )
      }
      const others = [0, 1, 3, 6, 7]
      r.check(
        'no other place has an action row',
        others.every((k) => seen[k].worded.length === 0 && seen[k].named.length === 0),
        others.map((k) => `place ${k + 1}: ${seen[k].worded.length}`).join(', '),
      )
      // The briefs behind them, in the data file: an action item is a lesson that has one.
      const inFile = PLACES.map((p) => p.counting.map((l, i) => (l.action_brief ? i + 1 : 0)).filter(Boolean))
      r.values.inTheJson = inFile.map((rows, k) => (rows.length ? `place ${k + 1}: ${rows.join(', ')}` : null)).filter(Boolean)
    })

    // 6 ── The pond
    await runRow(6, nameOf(6), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 6')
      const k = POND.place
      r.values.open = await openPlace(page, k, 'row 6')
      const p = await readPanel(page, 'row 6')
      const inFile = lessonOf(POND.id)
      r.check(
        `course_catalog.json: ${POND.id} is "${POND.title}" and does not count`,
        !!inFile && inFile.title === POND.title && inFile.counts === false && inFile.area === PLACES[k].id,
        inFile ? { title: inFile.title, counts: inFile.counts ?? true, area: inFile.area } : null,
      )
      r.check(`place ${k + 1}: a button after the list holds "${POND.title}"`, p.after.includes(POND.title), p.after)
      r.check(`it is not one of the ${COUNTING[k]} rows`, p.rows.length === COUNTING[k] && !p.rows.some((x) => x.title === POND.title), `${p.rows.length} rows`)
      r.values.click = await click(page, FIND.pond, POND.title, { what: 'row 6: the pond button', scroll: 'box' })
      await waitPath(page, `${APP}/${PLACES[k].id}/${POND.id}`, 'row 6')
      await waitLesson(page, POND.title, 'row 6')
      await sleep(600)
      const s = await page.evaluate(SNAP)
      r.check(`it opens ${APP}/${PLACES[k].id}/${POND.id}`, s.path === `${APP}/${PLACES[k].id}/${POND.id}` && s.lesson === POND.title, { path: s.path, heading: s.lesson })
      r.values.page = s.outside.slice(0, 160)
    })

    // 7 ── The total
    await runRow(7, nameOf(7), async (r) => {
      const page = await r.open(url('', { p: 'all', arrive: 1, poster: 'off' }))
      await ready(page, 'row 7')
      const rest = await restAt(page, NAMES.length - 1, 'row 7')
      await waitCard(page, 'row 7')
      await sleep(600)
      const s = await page.evaluate(SNAP)
      r.check(`the card reads "${TOTAL} of ${TOTAL}"`, !!s.card && s.card.text.includes(`${TOTAL} of ${TOTAL} lessons`), s.card?.text ?? null)
      r.check(`the timeline counts ${TOTAL} of ${TOTAL}`, s.count === `${TOTAL} of ${TOTAL} lessons done`, s.count)
      r.values.card = s.card?.title ?? null
      r.values.done = s.progress?.done ?? null
      r.values.rest = `depth ${f(rest.d)}, the stop is at ${f(rest.t)}`
    })

    // 8 ── 26 ticks fit
    await runRow(8, nameOf(8), async (r) => {
      const k = 4
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      r.values.stood = await standAt(page, k, 'row 8')
      await ready(page, 'row 8')
      await scrollToPlace(page, k, 'row 8')
      await waitCard(page, 'row 8')
      await sleep(600)
      const c = await page.evaluate(CARD, k)
      r.check(`place ${k + 1}'s card has ${COUNTING[k]} ticks`, c?.title === NAMES[k] && c?.ticks === COUNTING[k], c ? `"${c.title}", ${c.ticks} ticks` : null)
      r.check(
        "the tick strip's right edge is inside the card's box",
        !!c && !!c.strip && !!c.lastTick && c.strip.l >= c.box.l && c.strip.r <= c.box.r && c.lastTick.r <= c.box.r,
        c && c.strip && c.lastTick
          ? `strip ${c.strip.l} to ${c.strip.r} (${c.strip.w} px), last tick ends at ${c.lastTick.r}; card ${c.box.l} to ${c.box.r} (${c.box.w} px); ${Math.round((c.box.r - c.strip.r) * 10) / 10} px to spare`
          : null,
      )
    })

    // 9 ── A lesson page with a video
    await runRow(9, nameOf(9), async (r) => {
      const id = 'a1l01'
      const title = lessonOf(id).title
      const page = await r.open(url(`/a1/${id}`, { arrive: 0, poster: 'off' }))
      await waitLesson(page, title, 'row 9', LOAD_MS)
      const videos = await page.evaluate(() => document.querySelector('[data-dev-videos]')?.getAttribute('data-dev-videos') ?? null)
      // Whether the frame is there, and nothing about it: its address holds the video's id.
      const frame = await waitFor(page, () => [...document.querySelectorAll('iframe[title="Lesson video"]')].some((x) => !x.closest('main')), {
        timeout: 20000,
        soft: true,
        what: 'row 9: the frame',
      })
      await sleep(500)
      const s = await page.evaluate(SNAP)
      const asked = await page.evaluate(
        (lessonId) => ({
          bar: !!document.querySelector('[role="progressbar"][aria-label="Lesson progress"]'),
          embed: (window.__fixture?.calls ?? []).filter((c) => c.call === 'getEmbed' && c.lessonId === lessonId).map((c) => c.ok),
        }),
        id,
      )
      r.check('the dev environment has its two test videos', videos === '2', videos === null ? 'none: DEV_TELLA_VIDEO_ID and DEV_TELLA_VIDEO_ID_2 are not both set' : videos)
      r.check(`the heading is "${title}"`, s.lesson === title && s.path === `${APP}/a1/${id}`, { heading: s.lesson, path: s.path })
      r.check('the player frame mounts', !!frame && asked.bar, { frame: !!frame, progressLine: asked.bar, addressAnswers: asked.embed })
      r.values.lengthInTheFile = `${LENGTHS[id] ?? null} s`
      r.values.eyebrowShowsIt = minutesOf(id) !== null && s.outside.includes(`${minutesOf(id)} min`)
      r.values.page = s.outside.slice(0, 120)
    })

    // 10 ── A lesson page without a video
    await runRow(10, nameOf(10), async (r) => {
      const id = 'a7l01'
      const title = lessonOf(id).title
      const page = await r.open(url(`/a7/${id}`, { arrive: 0, poster: 'off' }))
      await waitLesson(page, title, 'row 10', LOAD_MS)
      await waitFor(page, SAYS, { arg: 'Not recorded yet\\.', timeout: 10000, soft: true, what: 'row 10: the not-recorded state' })
      await sleep(1500) // long enough for a frame to have mounted, had the page asked for one
      const s = await page.evaluate(SNAP)
      const asked = await page.evaluate((lessonId) => (window.__fixture?.calls ?? []).filter((c) => c.lessonId === lessonId).length, id)
      r.check(`course-lengths.fixture.json has no length for ${id}`, LENGTHS[id] === undefined, LENGTHS[id] ?? 'none')
      r.check(`the heading is "${title}"`, s.lesson === title && s.path === `${APP}/a7/${id}`, { heading: s.lesson, path: s.path })
      r.check('the page says "Not recorded yet." and has no player', /Not recorded yet\./.test(s.outside) && s.frames === 0, { said: /Not recorded yet\./.test(s.outside), frames: s.frames })
      r.values.callsToTheStandInServer = asked
      r.values.page = s.outside.slice(0, 120)
    })

    // 11 ── An action item's page
    await runRow(11, nameOf(11), async (r) => {
      const id = 'a5l22'
      const lesson = lessonOf(id)
      const page = await r.open(url(`/a5/${id}`, { arrive: 0, poster: 'off' }))
      await waitLesson(page, lesson.title, 'row 11', LOAD_MS)
      await sleep(500)
      const s = await page.evaluate(SNAP)
      r.check(`the heading is "${lesson.title}"`, s.lesson === lesson.title && s.path === `${APP}/a5/${id}`, { heading: s.lesson, path: s.path })
      r.check('the page shows the "Milestone" box', /Milestone/.test(s.outside), /Milestone/.test(s.outside))
      r.check("with the JSON's brief, word for word", !!lesson.action_brief && s.outside.includes(norm(lesson.action_brief)), `${norm(lesson.action_brief).slice(0, 70)}…`)
      r.values.type = lesson.type
      r.values.page = s.outside.slice(0, 140)
    })

    // 12 ── A course lesson watched to its end
    await runRow(12, nameOf(12), async (r) => {
      const id = 'a1l01'
      const title = lessonOf(id).title
      const nextId = PLACES[0].counting[1].id
      const page = await r.open(url(`/a1/${id}`, { arrive: 0, poster: 'off' }), { probe: true })
      await waitLesson(page, title, 'row 12', LOAD_MS)
      const harness = await page.evaluate(() => {
        const el = document.querySelector('[data-dev-videos]')
        return { videos: el?.getAttribute('data-dev-videos') ?? null, seconds: Number(el?.getAttribute('data-dev-video-seconds')) || null }
      })
      const frame = await waitFor(page, () => [...document.querySelectorAll('iframe[title="Lesson video"]')].some((x) => !x.closest('main')), {
        timeout: 20000,
        soft: true,
        what: 'row 12: the frame',
      })
      if (!frame) {
        // No video to play is the harness's state, not the page's fault. Whether the frame mounts when there is one is row 9's.
        r.notCovered(
          `the page has no test video to play: the lesson's frame did not mount (the harness says ${harness.videos === null ? 'nothing, no [data-dev-videos]: DEV_TELLA_VIDEO_ID and DEV_TELLA_VIDEO_ID_2 are not both set' : `data-dev-videos="${harness.videos}"`}).`,
        )
        return
      }
      const clip = harness.seconds
      if (!clip) throw new Error('row 12: the frame mounted but the harness does not say how long the test video is ([data-dev-video-seconds])')
      await waitFor(page, () => window.__probe.msgs.some((m) => m.type === 'ready'), { timeout: PLAYER_READY_MS, what: 'row 12: the player never said "ready"' })
      const from = await page.evaluate(() => window.__probe.msgs.length)
      const t0 = Date.now()
      if (!(await page.evaluate(SEND, { message: { type: 'play' }, tellaOrigin: TELLA }))) throw new Error('row 12: there is no lesson frame to send "play" to')
      await waitFor(page, (i) => window.__probe.msgs.slice(i).some((m) => m.type === 'timeUpdate'), { arg: from, timeout: 20000, what: 'row 12: the player reported no position after "play"' })
      // Normal speed: the clip's own length on the clock, and room for a slow start.
      const ended = await waitFor(page, ENDED, {
        arg: { i: from, end: clip - 1.5 },
        timeout: clip * 1000 + 45000,
        poll: 200,
        what: `row 12: the player never reached the end of the ${clip} s clip (neither "stopped" nor "paused" in its last 1.5 s)`,
      })
      await waitFor(page, (lessonId) => window.__fixture?.completed().includes(lessonId), { arg: id, timeout: 20000, soft: true, what: 'row 12: done' })
      const clock = (Date.now() - t0) / 1000
      await sleep(700) // the "Done." line and the link
      const s = await page.evaluate(WATCHED, { lessonId: id, from })
      const speed = s.first && s.last && s.last.at > s.first.at ? (s.last.t - s.first.t) / ((s.last.at - s.first.at) / 1000) : null
      const beats = s.calls.filter((c) => c.call === 'heartbeat')
      const claims = s.calls.filter((c) => c.call === 'claim')
      const short = /finished but didn.t register/
      r.check(
        `the ${clip} s clip played to its end at normal speed`,
        !!ended && speed !== null && speed > 0.9 && speed < 1.1,
        `"${ended.state}" at ${f(ended.t, 2)} s; ${s.reports} position reports from ${f(s.first?.t, 2)} to ${f(s.last?.t, 2)} s, ${f(speed, 3)} video s per clock s; ${f(clock, 1)} clock s from "play"`,
      )
      r.check('the lesson is done on the page', s.completed === true && s.saysDone, { inTheDoneSet: s.completed, saysDone: s.saysDone })
      r.check(`"Next lesson" is lit and leads to ${nextId}`, s.next?.disabled === 'false' && s.next?.href === `${APP}/a1/${nextId}`, s.next)
      r.check(
        'no "finished but didn\'t register" line, at the end or at any moment before it',
        !s.linesNow.some((t) => short.test(t)) && !s.linesEver.some((t) => short.test(t)),
        { underTheBarNow: s.linesNow, statusLinesEver: s.linesEver },
      )
      r.values.heldTo = `stand-in server ${s.row?.reported_duration_seconds ?? null} s (the clip), catalog row ${LENGTHS[id] ?? null} s (the lesson)`
      r.values.watchRow = s.row ? `furthest ${f(s.row.max_position_seconds, 2)} s, really watched ${f(s.row.watched_seconds, 2)} s, 95% point ${s.row.threshold_met_at ? 'met' : 'NOT met'}` : null
      r.values.claims = claims.map((c) => `${c.completed ? 'completed' : c.reason} at ${f(c.playedRatio * 100, 1)}% played`)
      // The page's own progress line divides by the catalog's length, so it ends far from full here.
      r.values.progressLine = `aria-valuenow ${s.bar}`
      r.values.heartbeats = beats.map((c) => `${f(c.position, 1)} s +${f(c.credited, 1)}${c.force ? ' forced' : ''}${c.accepted ? '' : ' REFUSED'}${c.met ? ' met' : ''}`)
    })

    // 13 ── A lesson with no video: its text in the video's place
    await runRow(13, nameOf(13), async (r) => {
      const id = 'a5l22'
      const lesson = lessonOf(id)
      const page = await r.open(url(`/a5/${id}`, { text: 'sample', arrive: 0, poster: 'off' }))
      await waitLesson(page, lesson.title, 'row 13', LOAD_MS)
      await waitFor(page, SAYS, { arg: escapeRe(SAMPLE_FIRST), timeout: 10000, soft: true, what: 'row 13: the text' })
      await sleep(1500) // long enough for a player to have mounted, had the page put one up
      const m = await page.evaluate(LAYOUT, SAMPLE_FIRST)
      r.check(`course_catalog.json: ${id} is a setup lesson with a brief and no length`, lesson.type === 'setup' && !!lesson.action_brief && LENGTHS[id] === undefined, { type: lesson.type, length: LENGTHS[id] ?? 'none' })
      r.check(`the heading is "${lesson.title}"`, m.heading === lesson.title, m.heading)
      r.check(
        "no player: no element of the player's or the frame's class, no iframe, no 16:9 box, no progress line",
        m.player === 0 && m.frames === 0 && m.iframes === 0 && m.sixteenByNine === 0 && !m.bar,
        { player: m.player, frames: m.frames, iframes: m.iframes, sixteenByNine: m.sixteenByNine, progressLine: m.bar },
      )
      const gap = m.milestone && m.text ? Math.round((m.text.top - m.milestone.bottom) * 10) / 10 : null
      r.check(
        "the Milestone box, then the text, its top within 80 px of the box's bottom",
        gap !== null && gap >= 0 && gap <= 80,
        m.milestone && m.text ? `Milestone ${m.milestone.top} to ${m.milestone.bottom}, text from ${m.text.top} (${m.text.h} px tall): ${gap} px apart` : { milestone: m.milestone, text: m.text },
      )
      r.check(
        'the text is drawn as written: 3 bullets, a numbered list 3, 4, 5, bold, one line break',
        !!m.shape && m.shape.bullets === 3 && same(m.shape.numbers, [3, 4, 5]) && m.shape.olStart === 3 && m.shape.bold >= 2 && m.shape.breaks === 1,
        m.shape,
      )
      r.check('its blocks are apart: at least 8 px between each block and the next', !!m.shape && m.shape.gaps.length === 4 && m.shape.gaps.every((g) => g >= 8), m.shape?.gaps ?? null)
      r.check('no filler line and no "Not recorded yet."', !/Nothing to watch here/.test(m.words) && m.notRecorded.length === 0, m.words.slice(0, 160))
      r.check('the stand-in server was asked for nothing', m.asked === 0, `${m.asked} calls`)
      r.values.shot = await r.shot('lesson-a5l22-text-no-video')
      // The same lesson without ?text=sample: the sample is nowhere.
      const plain = await r.open(url(`/a5/${id}`, { arrive: 0, poster: 'off' }))
      await waitLesson(plain, lesson.title, 'row 13, without ?text=sample', LOAD_MS)
      await sleep(800)
      const p = await plain.evaluate(LAYOUT, SAMPLE_FIRST)
      r.check('without ?text=sample the sample text is not on the page', p.text === null && !p.words.includes(SAMPLE_FIRST), p.words.slice(0, 160))
    })

    // 14 ── A lesson with a video and a text: the player, the Milestone box, the text
    await runRow(14, nameOf(14), async (r) => {
      const id = 'a5l08'
      const lesson = lessonOf(id)
      const page = await r.open(url(`/a5/${id}`, { text: 'sample', arrive: 0, poster: 'off' }))
      await waitLesson(page, lesson.title, 'row 14', LOAD_MS)
      // Whether the frame is there, and nothing about it: its address holds the video's id.
      const frame = await waitFor(page, () => [...document.querySelectorAll('iframe[title="Lesson video"]')].some((x) => !x.closest('main')), {
        timeout: 20000,
        soft: true,
        what: 'row 14: the frame',
      })
      await sleep(500)
      const m = await page.evaluate(LAYOUT, SAMPLE_FIRST)
      r.check(`course_catalog.json: ${id} is a watch lesson with a brief and a length`, lesson.type === 'watch' && !!lesson.action_brief && LENGTHS[id] > 0, { type: lesson.type, length: LENGTHS[id] ?? 'none' })
      r.check(`the heading is "${lesson.title}"`, m.heading === lesson.title, m.heading)
      r.check('the player is on the page: one player, its 16:9 frame, the video frame, the progress line', m.player === 1 && m.sixteenByNine === 1 && !!frame && m.iframes === 1 && m.bar, {
        player: m.player,
        sixteenByNine: m.sixteenByNine,
        iframe: !!frame,
        progressLine: m.bar,
      })
      const inOrder = !!m.playerBox && !!m.milestone && !!m.text && m.playerBox.bottom <= m.milestone.top && m.milestone.bottom <= m.text.top
      r.check(
        'in this order, top to bottom: the player, the Milestone box, the text',
        inOrder,
        m.playerBox && m.milestone && m.text
          ? `player ${m.playerBox.top} to ${m.playerBox.bottom}, Milestone ${m.milestone.top} to ${m.milestone.bottom}, text ${m.text.top} to ${m.text.bottom}`
          : { player: m.playerBox, milestone: m.milestone, text: m.text },
      )
      r.check('no "Not recorded yet." under it', m.notRecorded.length === 0, m.notRecorded)
      await sleep(2500) // for the picture: the player's own first frame
      r.values.shot = await r.shot('lesson-a5l08-video-milestone-text')
    })

    // 15 ── The links in a lesson's text
    await runRow(15, nameOf(15), async (r) => {
      const id = 'a5l22'
      const page = await r.open(url(`/a5/${id}`, { text: 'sample', arrive: 0, poster: 'off' }))
      await waitLesson(page, lessonOf(id).title, 'row 15', LOAD_MS)
      await waitFor(page, SAYS, { arg: escapeRe(SAMPLE_FIRST), timeout: 10000, soft: true, what: 'row 15: the text' })
      await sleep(500)
      const l = await page.evaluate(LINKS, { first: SAMPLE_FIRST, script: SAMPLE_SCRIPT })
      const link = l.links?.find((a) => a.text === SAMPLE_LINK) ?? null
      r.check(`the https link "${SAMPLE_LINK}" is a link to its address`, !!link && link.href === SAMPLE_HREF, l.links)
      r.check('it opens in a new tab with no opener: target _blank, rel holds noopener', !!link && link.target === '_blank' && /\bnoopener\b/.test(link.rel ?? ''), link ? { target: link.target, rel: link.rel } : null)
      r.check('it is the only link in the text', l.links?.length === 1, l.links?.length ?? null)
      r.check(
        `the javascript: link "${SAMPLE_SCRIPT}" is shown as its label and is not a link`,
        l.scriptShown && !l.scriptInALink && l.scriptHrefs === 0,
        { shown: l.scriptShown, insideALink: l.scriptInALink, javascriptHrefsOnThePage: l.scriptHrefs },
      )
    })

    // 16 ── A watch lesson with no video and no text
    await runRow(16, nameOf(16), async (r) => {
      const id = 'a7l01'
      const lesson = lessonOf(id)
      const page = await r.open(url(`/a7/${id}`, { text: 'sample', arrive: 0, poster: 'off' }))
      await waitLesson(page, lesson.title, 'row 16', LOAD_MS)
      await waitFor(page, SAYS, { arg: 'Not recorded yet\\.', timeout: 10000, soft: true, what: 'row 16: the line' })
      await sleep(1500) // long enough for a player to have mounted, had the page put one up
      const m = await page.evaluate(LAYOUT, SAMPLE_FIRST)
      r.check(`course_catalog.json: ${id} is a watch lesson with no length, and the sample has no text for it`, lesson.type === 'watch' && LENGTHS[id] === undefined && SAMPLE.lessons[id] === undefined, { type: lesson.type, length: LENGTHS[id] ?? 'none' })
      r.check(`the heading is "${lesson.title}"`, m.heading === lesson.title, m.heading)
      const line = m.notRecorded.length === 1 ? m.notRecorded[0] : null
      r.check('"Not recorded yet." once, on one short line (a paragraph under 30 px tall)', !!line && line.tag === 'P' && line.h > 0 && line.h < 30, m.notRecorded)
      r.check(
        "no box: no element of the player's or the frame's class, no iframe, no 16:9 box",
        m.player === 0 && m.frames === 0 && m.iframes === 0 && m.sixteenByNine === 0 && !m.bar,
        { player: m.player, frames: m.frames, iframes: m.iframes, sixteenByNine: m.sixteenByNine },
      )
      r.check('no text', m.text === null, m.text)
      r.check('the stand-in server was asked for nothing', m.asked === 0, `${m.asked} calls`)
    })

    // 17 ── A row's video is asked for when the pointer reaches it, once, and the click puts the frame up at once
    await runRow(17, nameOf(17), async (r) => {
      const id = 'a1l03'
      const page = await r.open(url('', { arrive: 0, poster: 'off' }), { fast: true })
      await ready(page, 'row 17')
      if (!(await hasTestVideos(page))) return r.notCovered(NO_TEST_VIDEOS)
      await openPlaceQuietly(page, 0, 'row 17')
      const before = (await page.evaluate(ASKED, id)).length
      const at = await rowPoint(page, 3, 'row 17')
      await page.mouse.move(at.x, at.y)
      await sleep(900)
      // Out and back in: the second visit finds the address kept.
      await page.mouse.move(4, 4)
      await sleep(200)
      await page.mouse.move(at.x, at.y)
      await sleep(600)
      const hovered = (await page.evaluate(ASKED, id)).length
      r.check(
        `hovering row 3 (${id}) asks the stand-in server for its video exactly once, before any click`,
        before === 0 && hovered === 1,
        `${before} calls before the pointer reached the row, ${hovered} after it (the pointer left and came back once)`,
      )
      await page.mouse.click(at.x, at.y)
      const t = await waitFor(page, FRAME_UP, { timeout: 20000, what: 'row 17: the frame after the click' })
      const ms = Math.round(t.frame - t.click)
      r.check('the click then puts the lesson frame in the page within 300 ms', ms <= 300, split(t))
      const heard = await waitFor(page, () => window.__fast.ready, { timeout: PLAYER_READY_MS, soft: true, what: 'row 17: "ready"' })
      await sleep(500)
      const all = (await page.evaluate(ASKED, id)).length
      r.check('with no second ask: still one call for it once the lesson page is up and its player has said "ready"', all === 1 && !!heard, `${all} calls; "ready" ${heard ? `${Math.round(heard - t.click)} ms after the click` : 'never heard'}`)
    })

    // 18 ── The placeholder over the video until its player is ready
    await runRow(18, nameOf(18), async (r) => {
      const id = 'a1l04'
      // 1.5 s for the address, and no wait on the row before the click: the placeholder's whole life, slowed down enough to look at.
      const page = await r.open(url('', { arrive: 0, poster: 'off', latency: 1500 }), { fast: true })
      await ready(page, 'row 18')
      if (!(await hasTestVideos(page))) return r.notCovered(NO_TEST_VIDEOS)
      await openPlaceQuietly(page, 0, 'row 18')
      const at = await rowPoint(page, 4, 'row 18')
      await page.mouse.click(at.x, at.y)
      await waitLesson(page, lessonOf(id).title, 'row 18')
      await sleep(450)
      const early = await page.evaluate(() => ({ veil: window.__fast.veil(), frame: window.__fast.frame !== null, sinceClick: Math.round(performance.now() - window.__fast.click) }))
      r.values.shot = await r.shot('lesson-video-placeholder')
      r.check(
        'while the address is on its way: the placeholder fills the 16:9 box, shown, saying "Loading video…", and no frame yet',
        !!early.veil && !early.veil.gone && early.veil.opacity === 1 && early.veil.visibility === 'visible' && early.veil.covers && early.veil.text === 'Loading video…' && !early.frame,
        early,
      )
      r.check('it never takes a click (pointer-events: none)', !!early.veil && !early.veil.takesClicks, early.veil?.takesClicks ?? null)
      const pulse = early.veil?.pulse ?? null
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
      const still = await page.evaluate(() => window.__fast.veil()?.pulse ?? null)
      await page.emulateMediaFeatures([])
      r.check('it pulses, and not under prefers-reduced-motion', !!pulse && pulse !== 'none' && still === 'none', { pulse, reducedMotion: still })
      const t = await waitFor(
        page,
        () =>
          window.__fast.frame !== null &&
          window.__fast.ready !== null && {
            click: window.__fast.click,
            frame: window.__fast.frame,
            first: window.__fast.first,
            firstSaid: window.__fast.firstSaid,
            ready: window.__fast.ready,
            atFrame: window.__fast.veilAtFrame,
            atFirst: window.__fast.veilAtFirst,
          },
        { timeout: PLAYER_READY_MS, what: 'row 18: the frame and its "ready"' },
      )
      const shown = (v) => !!v && !v.gone && v.opacity === 1 && v.visibility === 'visible' && v.covers
      r.check(
        "the frame goes in under it, and it stays shown over the frame until the player's first word (\"ready\", or the \"idle\" the real player says in the same millisecond before it)",
        t.frame < t.first && shown(t.atFrame) && t.atFrame.overFrame && shown(t.atFirst) && t.atFirst.overFrame && t.ready - t.first < 50,
        {
          frameAfterClick: Math.round(t.frame - t.click),
          firstWord: `${t.firstSaid}, ${Math.round(t.first - t.click)} ms after the click`,
          readyAfterIt: `${Math.round(t.ready - t.first)} ms`,
          atFrame: { shown: shown(t.atFrame), overFrame: t.atFrame?.overFrame },
          atFirstWord: { shown: shown(t.atFirst), overFrame: t.atFirst?.overFrame },
        },
      )
      await sleep(800) // its 300 ms fade, and room
      const late = await page.evaluate(() => window.__fast.veil())
      r.check('after "ready" it is gone: faded to opacity 0, then hidden', !!late && late.gone && late.opacity === 0 && late.visibility === 'hidden', late)
    })

    // 19 ── A lesson without a video is never asked for
    await runRow(19, nameOf(19), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off' }))
      await ready(page, 'row 19')
      await sleep(1500) // a card or a place that would ask on its own has asked by now
      const onLoad = await page.evaluate(ASKED, null)
      r.check(
        "the map's first load asks for no place's lessons: at most the card's next lesson (a1l01)",
        onLoad.length <= 1 && onLoad.every((x) => x === 'a1l01'),
        onLoad,
      )
      const noVideo = 'a3l11'
      const withVideo = 'a3l10'
      await openPlaceQuietly(page, 2, 'row 19, place 3')
      const p11 = await rowPoint(page, 11, 'row 19')
      await page.mouse.move(p11.x, p11.y)
      await sleep(600)
      const focused = await page.evaluate(FOCUS_ROW, 11)
      await sleep(600)
      const none = (await page.evaluate(ASKED, noVideo)).length
      const p10 = await rowPoint(page, 10, 'row 19')
      await page.mouse.move(p10.x, p10.y)
      await sleep(600)
      const one = (await page.evaluate(ASKED, withVideo)).length
      r.check(`course_catalog.json: ${noVideo} is a watch lesson with no video, ${withVideo} has one`, !hasVideoInJson(noVideo) && hasVideoInJson(withVideo), { [noVideo]: hasVideoInJson(noVideo), [withVideo]: hasVideoInJson(withVideo) })
      r.check(`row 11 (${noVideo}, no video): reached by the pointer and by the keyboard, never asked for`, none === 0 && focused, `${none} calls; focused ${focused}`)
      r.check(`row 10 beside it (${withVideo}, a video): reached by the pointer, asked for once`, one === 1, `${one} calls`)
      await closePlace(page, 'row 19')
      await openPlaceQuietly(page, 6, 'row 19, place 7')
      for (const n of [1, 2, 3]) {
        const p = await rowPoint(page, n, 'row 19, place 7')
        await page.mouse.move(p.x, p.y)
        await sleep(300)
      }
      await page.evaluate(FOCUS_ROW, 1)
      await sleep(500)
      const all = await page.evaluate(ASKED, null)
      const a7 = all.filter((x) => x.startsWith('a7'))
      r.check('place 7, where no lesson has a video: opening it and reaching rows 1 to 3 asks for nothing', a7.length === 0, a7)
      r.check('every lesson the stand-in server was asked about in this run has a video', all.length > 0 && all.every(hasVideoInJson), all)
    })

    // 20 ── With the server taking 1.5 s, a hovered row still opens at once
    await runRow(20, nameOf(20), async (r) => {
      const page = await r.open(url('', { arrive: 0, poster: 'off', latency: 1500 }), { fast: true })
      await ready(page, 'row 20')
      if (!(await hasTestVideos(page))) return r.notCovered(NO_TEST_VIDEOS)
      await openPlaceQuietly(page, 0, 'row 20')
      // The control: row 5 clicked with no wait on it waits out the stand-in's 1.5 s.
      const c = await rowPoint(page, 5, 'row 20')
      await page.mouse.click(c.x, c.y)
      const cold = await waitFor(page, FRAME_UP, { timeout: 20000, what: 'row 20: the frame of row 5' })
      const coldMs = Math.round(cold.frame - cold.click)
      await page.keyboard.press('Escape')
      await waitPath(page, `${APP}/a1`, 'row 20')
      await waitPanel(page, 0, 'row 20')
      await waitFor(page, () => ![...document.querySelectorAll('iframe[title="Lesson video"]')].some((x) => !x.closest('main')), { timeout: 10000, what: 'row 20: the lesson page closed' })
      await page.mouse.move(4, 4)
      await page.evaluate(() => window.__fast.reset())
      const id = 'a1l03'
      const at = await rowPoint(page, 3, 'row 20')
      await page.mouse.move(at.x, at.y)
      await sleep(2200)
      const asked = (await page.evaluate(ASKED, id)).length
      await page.mouse.click(at.x, at.y)
      const warm = await waitFor(page, FRAME_UP, { timeout: 20000, what: 'row 20: the frame of row 3' })
      const ms = Math.round(warm.frame - warm.click)
      await sleep(400)
      const all = (await page.evaluate(ASKED, id)).length
      r.check('the stand-in really takes 1.5 s: row 5, clicked with no wait on it, has its frame 1400 ms or more after the click', coldMs >= 1400, `${coldMs} ms`)
      r.check('row 3, with the pointer on it 2.2 s first: its frame is in the page within 300 ms of the click', asked === 1 && ms <= 300, `${split(warm)}; asked ${asked} time before it`)
      r.check('and it was asked for once in all', all === 1, `${all} calls`)
    })

    // 21 ── A setup action item: paste the Discord link, save it, complete the lesson
    await runRow(21, nameOf(21), async (r) => {
      const id = 'a5l22'
      const lesson = lessonOf(id)
      const place = PLACES[4].counting
      const nextId = place[place.findIndex((l) => l.id === id) + 1].id
      const arg = { first: SAMPLE_FIRST, id }
      const page = await r.open(url(`/a5/${id}`, { text: 'sample', arrive: 0, poster: 'off' }))
      await waitLesson(page, lesson.title, 'row 21', LOAD_MS)
      await waitFor(page, () => [...document.querySelectorAll('section[data-action-item]')].some((x) => !x.closest('main')), { timeout: 10000, what: 'row 21: the action item block' })
      await sleep(500)
      const empty = await page.evaluate(ACTION, arg)
      r.check(`course_catalog.json: ${id} is a setup lesson with a brief and no length`, lesson.type === 'setup' && !!lesson.action_brief && LENGTHS[id] === undefined, { type: lesson.type, length: LENGTHS[id] ?? 'none' })
      const b = empty.boxes
      r.check(
        'the block sits under the text, which sits under the Milestone box',
        !!b.milestone && !!b.text && !!b.block && b.milestone.bottom <= b.text.top && b.text.bottom <= b.block.top,
        b,
      )
      r.check(
        'empty: a field named "Discord link" and Save, no complete button, the lesson not done, "Next lesson" off',
        empty.state === 'empty' && empty.input?.name === 'Discord link' && empty.input?.value === '' && /\bSave\b/.test(empty.text) && empty.complete === null && !empty.saysDone && empty.next?.disabled === 'true' && empty.done === false,
        { state: empty.state, input: empty.input, complete: empty.complete, next: empty.next, done: empty.done },
      )
      r.values.shots = [await r.shot('lesson-a5l22-action-empty')]

      // A thread's own link, saved with Enter in the field.
      await typeLink(page, THREAD_LINK, 'row 21')
      await page.keyboard.press('Enter')
      await waitFor(page, () => [...document.querySelectorAll('section[data-action-item] p[role="alert"]')].some((x) => !x.closest('main')), { timeout: 5000, what: 'row 21: the error line' })
      await sleep(200)
      const wrong = await page.evaluate(ACTION, arg)
      r.check(
        "a thread's own link (two ids), Enter: refused with the old app's words, the field marked invalid, nothing saved",
        wrong.alert === OLD_LINK_ERROR && wrong.input?.invalid === 'true' && wrong.state === 'empty' && wrong.link === null && wrong.done === false,
        { alert: wrong.alert, invalid: wrong.input?.invalid, state: wrong.state },
      )
      r.values.shots.push(await r.shot('lesson-a5l22-action-error'))

      // A message link, saved with Enter.
      await typeLink(page, GOOD_LINK, 'row 21')
      await page.keyboard.press('Enter')
      await waitFor(page, () => [...document.querySelectorAll('section[data-action-item]')].some((x) => !x.closest('main') && x.dataset.actionItem === 'saved'), { timeout: 5000, what: 'row 21: the saved state' })
      await sleep(300)
      const saved = await page.evaluate(ACTION, arg)
      r.check(
        'a message link, Enter: saved and shown, opening Discord in a new tab with no opener, the error gone',
        saved.state === 'saved' && saved.link?.href === GOOD_LINK && saved.link?.target === '_blank' && /\bnoopener\b/.test(saved.link?.rel ?? '') && saved.alert === null && saved.input === null && saved.edit,
        { state: saved.state, link: saved.link, alert: saved.alert, edit: saved.edit },
      )
      r.check(
        'then "Complete lesson" is there and has the keyboard; the lesson is not done yet',
        saved.complete === 'Complete lesson' && saved.focus === 'Complete lesson' && !saved.saysDone && saved.next?.disabled === 'true' && saved.done === false,
        { complete: saved.complete, focus: saved.focus, next: saved.next, done: saved.done },
      )
      r.values.shots.push(await r.shot('lesson-a5l22-action-saved'))

      // Complete, from the keyboard: the button has the focus.
      await page.keyboard.press('Enter')
      await waitFor(page, () => [...document.querySelectorAll('section[data-action-item]')].some((x) => !x.closest('main') && x.dataset.actionItem === 'completed'), { timeout: 5000, what: 'row 21: the completed state' })
      await sleep(400)
      const done = await page.evaluate(ACTION, arg)
      const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
      r.check(
        `completed: "Completed on ${today}.", the link still there and editable, no complete button`,
        done.state === 'completed' && done.text.includes(`Completed on ${today}.`) && done.link?.href === GOOD_LINK && done.edit && done.complete === null,
        done.text,
      )
      r.check('the lesson is done: in the done set, and "Done." in the foot', done.done === true && done.saysDone, { done: done.done, saysDone: done.saysDone })
      r.check(`"Next lesson" is lit and leads to ${nextId}`, done.next?.disabled === 'false' && done.next?.href === `${APP}/a5/${nextId}`, done.next)
      r.check('the keyboard is on the completed line (the button it was on is gone)', /^Completed on/.test(done.focus ?? ''), done.focus)
      r.check('no request to /api in the whole row', r.api.length === 0, r.api.map((x) => `${x.method} ${x.path}`).slice(0, 3))
      r.values.shots.push(await r.shot('lesson-a5l22-action-done'))
    })

    // 22 ── An action item with a video: the link under the text, and both halves to finish it
    await runRow(22, nameOf(22), async (r) => {
      const id = 'a5l08'
      const lesson = lessonOf(id)
      const place = PLACES[4].counting
      const nextId = place[place.findIndex((l) => l.id === id) + 1].id
      const arg = { first: SAMPLE_FIRST, id }
      const at = url(`/a5/${id}`, { text: 'sample', arrive: 0, poster: 'off' })
      const markWatched = () => [...document.querySelectorAll('button')].find((x) => !x.closest('main') && /Mark watched \(dev\)/.test(x.textContent)) ?? null
      const inState = (state) => [...document.querySelectorAll('section[data-action-item]')].some((x) => !x.closest('main') && x.dataset.actionItem === state)
      const openIt = async (what) => {
        const p = await r.open(at)
        await waitLesson(p, lesson.title, what, LOAD_MS)
        await waitFor(p, () => [...document.querySelectorAll('section[data-action-item]')].some((x) => !x.closest('main')), { timeout: 10000, what: `${what}: the action item block` })
        await sleep(500)
        return p
      }

      // First order: the video, then the link and the button.
      let page = await openIt('row 22')
      const first = await page.evaluate(ACTION, arg)
      r.check(`course_catalog.json: ${id} is a watch lesson with a brief and a length`, lesson.type === 'watch' && !!lesson.action_brief && LENGTHS[id] > 0, { type: lesson.type, length: LENGTHS[id] ?? 'none' })
      const b = first.boxes
      r.check(
        'the block sits under the text, the text under the Milestone box, and the player (when it is up) above them',
        !!b.milestone && !!b.text && !!b.block && b.milestone.bottom <= b.text.top && b.text.bottom <= b.block.top && (!b.player || b.player.bottom <= b.milestone.top),
        b,
      )
      r.check('before a link is saved: the field and Save, and no complete button', first.state === 'empty' && !!first.input && first.complete === null, { state: first.state, complete: first.complete })
      await click(page, markWatched, null, { what: 'row 22: "Mark watched (dev)"' })
      await sleep(500)
      const watchedOnly = await page.evaluate(ACTION, arg)
      r.check(
        'the video watched with no link: the lesson is not done, "Next lesson" stays off, still no complete button',
        watchedOnly.done === false && !watchedOnly.saysDone && watchedOnly.next?.disabled === 'true' && watchedOnly.state === 'empty' && watchedOnly.complete === null,
        { done: watchedOnly.done, saysDone: watchedOnly.saysDone, next: watchedOnly.next, state: watchedOnly.state },
      )
      await typeLink(page, GOOD_LINK, 'row 22')
      await pressBlockButton(page, '^Save$', 'row 22: Save')
      await waitFor(page, inState, { arg: 'saved', timeout: 5000, what: 'row 22: the saved state' })
      await sleep(300)
      const saved = await page.evaluate(ACTION, arg)
      r.check(
        'Save works: the link saved and shown, and the button reads "Complete lesson" (the video is watched)',
        saved.state === 'saved' && saved.link?.href === GOOD_LINK && saved.complete === 'Complete lesson' && saved.done === false,
        { state: saved.state, link: saved.link?.href, complete: saved.complete },
      )
      await pressBlockButton(page, '^Complete lesson$', 'row 22: Complete lesson')
      await waitFor(page, inState, { arg: 'completed', timeout: 5000, what: 'row 22: the completed state' })
      await sleep(400)
      const both = await page.evaluate(ACTION, arg)
      r.check(
        `both halves: done, "Done.", "Next lesson" lit and leading to ${nextId}`,
        both.done === true && both.saysDone && both.next?.disabled === 'false' && both.next?.href === `${APP}/a5/${nextId}` && /Completed on/.test(both.text) && !/Watch the video/.test(both.text),
        { done: both.done, next: both.next, text: both.text },
      )

      // Second order, on a fresh page: the link and the button, then the video.
      page = await openIt('row 22, the other order')
      await typeLink(page, GOOD_LINK, 'row 22, the other order')
      await pressBlockButton(page, '^Save$', 'row 22, the other order: Save')
      await waitFor(page, inState, { arg: 'saved', timeout: 5000, what: 'row 22, the other order: the saved state' })
      await sleep(300)
      const before = await page.evaluate(ACTION, arg)
      r.check(
        'the complete button is there before the video is watched (the old app: the link first, the video not required), reading "Complete the action"',
        before.complete === 'Complete the action',
        before.complete,
      )
      await pressBlockButton(page, '^Complete the action$', 'row 22: Complete the action')
      await waitFor(page, inState, { arg: 'completed', timeout: 5000, what: 'row 22, the other order: the completed state' })
      await sleep(400)
      const actionOnly = await page.evaluate(ACTION, arg)
      r.check(
        'the button alone: "Action completed on <date>. Watch the video to finish the lesson.", not done, "Next lesson" off',
        /Action completed on [^.]+\. Watch the video to finish the lesson\./.test(actionOnly.text) && actionOnly.done === false && !actionOnly.saysDone && actionOnly.next?.disabled === 'true',
        { text: actionOnly.text, done: actionOnly.done, next: actionOnly.next },
      )
      await click(page, markWatched, null, { what: 'row 22, the other order: "Mark watched (dev)"' })
      await waitFor(page, (lessonId) => window.__fixture?.completed().includes(lessonId), { arg: id, timeout: 5000, soft: true, what: 'row 22: done' })
      await sleep(400)
      const finished = await page.evaluate(ACTION, arg)
      r.check(
        'then the video watched: done, "Done.", "Next lesson" lit, the waiting line gone',
        finished.done === true && finished.saysDone && finished.next?.disabled === 'false' && /Completed on/.test(finished.text) && !/Watch the video/.test(finished.text),
        { done: finished.done, next: finished.next, text: finished.text },
      )
      r.check('no request to /api in the whole row', r.api.length === 0, r.api.map((x) => `${x.method} ${x.path}`).slice(0, 3))
    })
  }
} finally {
  await browser.close().catch(() => {})
}

for (const [id, name, why] of GAPS) say(`NOT COVERED  ${id}  ${name}: ${why}`)

// Not a row of the table: what every page above did besides, for whoever reads the run.
const measured = {
  pagesOpened: tally.pages,
  pageErrors: tally.pageErrors.length,
  requestsToApiStudent: tally.apiStudent.length,
  otherApiRequests: tally.api.length - tally.apiStudent.length,
  consoleErrors: tally.consoleErrors.length,
}
say(`MEASURED  ${show(measured)}`)
for (const line of [...new Set([...tally.pageErrors, ...tally.consoleErrors].map((x) => `row ${x.row}: ${x.message}`))].slice(0, 4)) say(`MEASURED  ${line}`)

const passed = results.filter((x) => x.pass).length
/** Rows that could not be run here (row 12 with no test video): counted with the gaps, never with the failures. */
const skipped = results.filter((x) => !x.pass && x.notCovered).length
const failed = results.length - passed - skipped
fs.writeFileSync(
  path.join(OUT, 'results.json'),
  scrub(JSON.stringify({ at: new Date().toISOString(), base: `${ORIGIN}${APP}?catalog=course`, only: onlyArg, results, tally, notCovered: GAPS.map(([id, name, why]) => ({ id, name, why })) }, null, 1)),
)
if (ONLY) say(`partial run: rows ${[...ONLY].join(', ')} only`)
say(`PASS ${passed}  FAIL ${failed}  NOT COVERED ${GAPS.length + skipped}`)
if (failed) process.exitCode = 1
