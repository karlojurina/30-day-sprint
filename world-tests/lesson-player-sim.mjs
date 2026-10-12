/**
 * Tella player, Work Item 3: the lesson player's own logic, run in a real
 * browser against a stand-in player and a stand-in server.
 * (_admin/prds/tella-player/tella_player_prd.md, section 12.)
 *
 *   node world-tests/lesson-player-sim.mjs            every section, about 5 minutes
 *   node world-tests/lesson-player-sim.mjs S3 S5      only the sections named
 *
 * Run it from the app root (30-day-sprint). Nothing has to be running: no dev
 * server, no database, no login.
 *
 * WHAT IT PROVES. The code under test is the real source, read from src/ on
 * every run and never retyped: LessonPlayer.tsx, tella-player.ts,
 * watch-heartbeat.ts, tella.ts, lesson-transport.ts and call-gate.ts. It is
 * loaded into headless Chrome with React's development build and driven
 * through whole visits to a lesson: watched through, skipped then watched at
 * 2.5x, a completion claim that is refused, held back, failed or slow (D11,
 * D17), a resumed lesson, a video that says nothing or whose frame never
 * loads (D12, D13), the other messages, a change of lesson, the real
 * transport's two requests, a lesson that ends without reaching its 95%
 * point, told from the position whatever word the player ends on, and an
 * end heartbeat that fails (D14, D17), a lesson that the
 * catalog disowns for a moment while it plays (D19), and a page whose main
 * thread is held up while the video plays on (D16). A real browser
 * supplies the things a Node test cannot: real frames, real `postMessage`
 * origins and sources, real timers, React's effects and StrictMode.
 *
 * WHAT IT DOES NOT PROVE: anything about what Tella really sends or obeys.
 * The frame is a stand-in written here from the PRD's contract (section 8)
 * and its measurements (section 11). If that contract is wrong about the real
 * player (a field name, the shape of a command, when "ready" comes), every
 * check below still passes. Only a run against a real Tella video can settle
 * that, and that is Work Item 4. The server is a stand-in too: the heartbeat
 * arithmetic below is a copy of the SQL function's, made for this file.
 *
 * NO NETWORK. Every request the page makes is answered from this file, the
 * frame on https://www.tella.tv included, and Chrome is started with a rule
 * that fails every DNS lookup, so a request this file did not answer has
 * nowhere to go. The last check fails if the page asked for anything else.
 * The video id below is made up. A real one is never written in this
 * repository.
 *
 * It uses only what is already installed: puppeteer-core from
 * world-tests/node_modules, the app's own typescript, and React from the
 * app's node_modules. Chrome is the system one, as in the other scripts here.
 * While it runs, Chrome's profile is in world-tests/shots/ (ignored by git)
 * and is removed at the end. One run at a time.
 *
 * One line per check, a totals line, exit code 1 if any check fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(HERE, '..')
/**
 * Chrome's profile for the run. Left to itself puppeteer makes one in the
 * system's temporary folder and deletes it after Chrome exits. This script
 * leaves as soon as it has printed its totals (see the last lines), which
 * would cut that deletion short, so the profile is kept where it can be seen
 * and is removed here.
 */
const PROFILE = path.join(HERE, 'shots', 'lesson-player-sim-profile')
const ts = createRequire(import.meta.url)('typescript')

const PAGE_ORIGIN = 'https://app.test'
const FAKE_ID = 'vid_testaaaaaaaaaaaa01'
const EMBED = `https://www.tella.tv/video/${FAKE_ID}/embed?title=0&b=0&wt=0&a=0&o=1`
/** The stand-in video's length, in seconds. Short, so a whole watch fits in a test. */
const D = 20
const NO_LOAD = "This video didn't load. Refresh the page. If it keeps happening, tell the team."
const notCounted = (n) => `Not marked as watched yet. You've watched ${n}% of this lesson and it needs 80%. Skipped parts don't count.`

// ── The bundle: the real sources, a few stand-ins, and the harness ───
const read = (rel) => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8')
const real = (rel) => ts.transpileModule(read(rel), {
  fileName: rel,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
/** A function from this file, as the body of a module in the page. */
const inPage = (fn, ...args) => `(${fn.toString()})(require, module, exports, ${args.map((a) => JSON.stringify(a)).join(', ')});`

/** Stands in for @/contexts/StudentContext: the hook, over a context the harness provides. */
function studentContextStandIn(require, module, exports) {
  const React = require('react')
  const Ctx = React.createContext(null)
  function useStudent() {
    return React.useContext(Ctx)
  }
  exports.StudentCtx = Ctx
  exports.useStudent = useStudent
}

/** Stands in for @/lib/supabase-browser: a session token, and a client whose rpc is the stand-in server. */
function supabaseStandIn(require, module, exports) {
  window.__supabase = { clients: 0, rpc: [] }
  exports.createClient = () => {
    window.__supabase.clients++
    return {
      rpc: async (fn, args) => {
        window.__supabase.rpc.push({ fn, args })
        return { data: window.__h.server.beat(args), error: null }
      },
    }
  }
  exports.getAccessToken = async () => 'test-session-token'
}

/** Runs before anything else in the page: counts live message listeners, records every timer, and times the frame. */
function prelude() {
  // When the frame was put on the page, and when (if ever) its `load` fired.
  window.__frame = { addedAt: null, loadedAt: null }
  new MutationObserver(() => {
    if (window.__frame.addedAt === null && document.querySelector('iframe')) window.__frame.addedAt = Math.round(performance.now())
  }).observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('load', (e) => {
    if (e.target && e.target.tagName === 'IFRAME' && window.__frame.loadedAt === null) window.__frame.loadedAt = Math.round(performance.now())
  }, true)

  window.__listeners = { live: 0, added: 0 }
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  const liveListeners = new Set()
  window.addEventListener = (type, fn, options) => {
    if (type === 'message' && !liveListeners.has(fn)) {
      liveListeners.add(fn)
      window.__listeners.added++
      window.__listeners.live = liveListeners.size
    }
    return add(type, fn, options)
  }
  window.removeEventListener = (type, fn, options) => {
    if (type === 'message') {
      liveListeners.delete(fn)
      window.__listeners.live = liveListeners.size
    }
    return remove(type, fn, options)
  }

  // Every timer the page's own code sets, with how it ended. The harness uses
  // the untouched setTimeout, so what is recorded is the component's.
  const set = window.setTimeout.bind(window)
  const clear = window.clearTimeout.bind(window)
  window.__rawSetTimeout = set
  window.__timers = []
  window.setTimeout = (fn, ms, ...rest) => {
    const rec = { delay: Math.round(ms ?? 0), setAt: Math.round(performance.now()), state: 'live' }
    rec.id = set(() => {
      rec.state = 'fired'
      rec.firedAt = Math.round(performance.now())
      fn(...rest)
    }, ms)
    window.__timers.push(rec)
    return rec.id
  }
  window.clearTimeout = (id) => {
    const rec = window.__timers.find((r) => r.id === id && r.state === 'live')
    if (rec) {
      rec.state = 'cleared'
      rec.clearedAt = Math.round(performance.now())
    }
    return clear(id)
  }
}

/** The harness: a stand-in server, a transport over it, a student context, and mount/unmount. */
function harness(require, module, exports, D, EMBED) {
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { LessonPlayer } = require('@/components/world/LessonPlayer')
  const { StudentCtx } = require('@/contexts/StudentContext')
  const h = React.createElement
  const wait = (ms) => new Promise((r) => window.__rawSetTimeout(r, ms))

  const log = []
  const note = (kind, data) => log.push({ at: Math.round(performance.now()), kind, ...(data || {}) })
  window.addEventListener('et:achievements-changed', () => note('achievements-event'))
  window.addEventListener('error', (e) => note('window-error', { message: String(e.message) }))
  window.addEventListener('unhandledrejection', (e) => note('unhandled-rejection', { message: String(e.reason) }))
  const consoleError = console.error
  console.error = (...a) => {
    note('console-error', { message: a.map(String).join(' ').slice(0, 400) })
    consoleError(...a)
  }

  // The server. `beat` is record_lesson_heartbeat's arithmetic (v100): the
  // 5 s rate limit unless forced or crossing, min(delta, elapsed * 2.5, 60),
  // the crossing at 95% of the catalog length. `judge` is judgeWatch's.
  const server = {
    rows: new Map(),
    floor: 0.8,
    embed: { ok: true, embedUrl: EMBED },
    /** The catalog's length for the lesson: what the 95% point and the played floor are measured against. */
    duration: D,
    /** How many claims fail as a request, counted down. */
    claimFails: 0,
    /** How many forced heartbeats fail as a call, counted down. */
    failForcedBeats: 0,
    /** How long each claim's answer takes, first claim first. Empty = at once. */
    claimDelaysMs: [],
    beat(a) {
      const now = Date.now()
      const prev = server.rows.get(a.p_lesson_id)
      const pos = Math.min(Math.max(0, a.p_position_seconds), server.duration)
      let elapsed = null
      let delta
      let newMax
      if (prev) {
        elapsed = (now - prev.last) / 1000
        delta = Math.max(0, Math.min(a.p_delta_seconds, elapsed * 2.5, 60))
        newMax = Math.max(prev.max, pos)
      } else {
        delta = Math.max(0, Math.min(a.p_delta_seconds, 60))
        newMax = pos
      }
      const hadThresh = Boolean(prev && prev.thresh)
      const crosses = !hadThresh && newMax >= 0.95 * server.duration
      if (prev && elapsed < 5 && !a.p_force && !crosses) {
        return { accepted: false, reason: 'rate_limited', max_position_seconds: prev.max, watched_seconds: prev.watched, threshold_met: hadThresh, threshold_crossed: false }
      }
      const row = {
        max: newMax, lastPos: pos, watched: (prev ? prev.watched : 0) + delta, last: now,
        thresh: hadThresh ? prev.thresh : (crosses ? now : null), count: (prev ? prev.count : 0) + 1,
      }
      server.rows.set(a.p_lesson_id, row)
      return { accepted: true, max_position_seconds: row.max, last_position_seconds: pos, watched_seconds: row.watched, duration_seconds: a.p_reported_duration, threshold_met: Boolean(row.thresh), threshold_crossed: Boolean(row.thresh) && !hadThresh }
    },
    judge(id) {
      const row = server.rows.get(id)
      if (!row) return { completed: false, reason: 'no_watch_row', playedRatio: 0, playedFloor: server.floor }
      const playedRatio = Number((row.watched / server.duration).toFixed(4))
      if (!row.thresh) return { completed: false, reason: 'position_short', playedRatio, playedFloor: server.floor }
      if (playedRatio < server.floor - 1e-9) return { completed: false, reason: 'played_short', playedRatio, playedFloor: server.floor }
      return { completed: true, newAchievements: ['first_lesson'] }
    },
  }
  function makeTransport() {
    return {
      getEmbed: async (id) => {
        note('getEmbed', { id })
        return server.embed
      },
      heartbeat: async (args) => {
        if (args.p_force && server.failForcedBeats > 0) {
          server.failForcedBeats--
          note('beat-failed', { pos: Number(args.p_position_seconds.toFixed(2)), delta: Number(args.p_delta_seconds.toFixed(3)) })
          return { data: null, error: { message: 'the stand-in call failed' } }
        }
        const result = server.beat(args)
        note('beat', { pos: Number(args.p_position_seconds.toFixed(2)), delta: Number(args.p_delta_seconds.toFixed(3)), force: args.p_force, accepted: result.accepted, met: result.threshold_met, watched: Number(result.watched_seconds.toFixed(2)) })
        return { data: result, error: null }
      },
      claim: async (id) => {
        note('claim', { id })
        // Judged when the request arrives, as a server would, then answered late.
        const failed = server.claimFails > 0
        if (failed) server.claimFails--
        const answer = failed ? null : server.judge(id)
        const delay = server.claimDelaysMs.shift() || 0
        if (delay) await wait(delay)
        note('claim-answer', failed ? { failed: true } : answer)
        return answer
      },
    }
  }
  const stableTransport = makeTransport()

  // The student context. With `unstable`, nothing is memoised: the context
  // value, both functions and the transport are new on every render, which is
  // the harshest thing a provider can do to the player's effects.
  function Provider({ cfg, children }) {
    const [watch, setWatch] = React.useState(() => new Map(cfg.seedWatch || []))
    const [completed, setCompleted] = React.useState(() => new Set(cfg.seedCompleted || []))
    const patchWatchProgress = (lessonId, p) => setWatch((prev) => {
      const out = new Map(prev)
      const base = out.get(lessonId) || { lesson_id: lessonId, max_position_seconds: 0, last_position_seconds: 0, watched_seconds: 0, reported_duration_seconds: null, threshold_met_at: null, last_heartbeat_at: '' }
      out.set(lessonId, { ...base, ...p, max_position_seconds: Math.max(base.max_position_seconds, p.max_position_seconds || 0), watched_seconds: Math.max(base.watched_seconds, p.watched_seconds || 0), threshold_met_at: base.threshold_met_at || p.threshold_met_at || null })
      return out
    })
    const markWatched = (id) => {
      note('markWatched', { id })
      setCompleted((prev) => new Set(prev).add(id))
    }
    return h(StudentCtx.Provider, { value: { watchProgress: watch, completedLessonIds: completed, patchWatchProgress, markWatched } }, children)
  }
  function App({ cfg }) {
    const [lessonId, setLessonId] = React.useState(cfg.lessonId)
    const [recorded, setRecorded] = React.useState(cfg.recorded === undefined ? true : cfg.recorded)
    React.useEffect(() => {
      window.__setLesson = setLessonId
      window.__setRecorded = setRecorded
    }, [])
    const transport = cfg.realTransport ? undefined : (cfg.unstable ? makeTransport() : stableTransport)
    const onCompleted = (id, achievements) => note('onCompleted', { id, achievements })
    return h(Provider, { cfg }, h(LessonPlayer, {
      lessonId,
      durationSeconds: cfg.durationSeconds === undefined ? D : cfg.durationSeconds,
      recorded,
      transport, onCompleted, className: 'player',
    }))
  }

  let root = null
  window.__h = {
    log, server,
    mount(cfg) {
      if (cfg.server) Object.assign(server, cfg.server)
      for (const [id, row] of cfg.seedRows || []) server.rows.set(id, { ...row, last: Date.now() - 60_000, thresh: row.thresh ? Date.now() - 60_000 : null })
      root = createRoot(document.getElementById('root'))
      // StrictMode has to be the root's own child: React only double-runs the
      // effects of a tree that was mounted inside it.
      root.render(cfg.strict ? h(React.StrictMode, null, h(App, { cfg })) : h(App, { cfg }))
    },
    unmount() {
      root.unmount()
      root = null
    },
  }
}

/**
 * The stand-in for Tella's player, as the script of the frame. From the PRD's
 * contract: `ready`, `playbackState` and `timeUpdate` in; `play`, `pause` and
 * `seek` out; a position report every 250 ms while playing; at the end a last
 * report just short of the length, then "stopped" with `duration: 0`. A
 * "silent" one says nothing until it is told to, like a refused video.
 *
 * The real player was since measured ending a video with "paused" in place of
 * "stopped" (one run in four, on a replay), so this one can be told to do
 * that, and to say "stopped" or "paused" at a position of the test's choosing.
 */
function standInPlayer(D, mode, readyDelay) {
  let t = 0
  let rate = 1
  let playing = false
  let timer = null
  let last = 0
  // By default the position follows the clock, as a real video's does, so a
  // late timer reports a larger step. `steady` moves it by exactly 0.25 s
  // times the speed per report instead, for the sections whose arithmetic has
  // to come out the same on a busy machine.
  let steady = false
  // The word it ends on, and a position at which to say "paused" or "stopped" once.
  let lastWord = 'stopped'
  let haltAt = null
  const post = (m) => parent.postMessage(m, '*')
  window.__states = []
  const state = (s) => {
    window.__states.push(s)
    post({ type: 'playbackState', state: s, currentTime: t, duration: s === 'stopped' ? 0 : D })
  }
  window.__got = []
  function tick() {
    const now = performance.now()
    t += steady ? 0.25 * rate : ((now - last) / 1000) * rate
    last = now
    if (t >= D) {
      t = D
      post({ type: 'timeUpdate', currentTime: D - 0.05, duration: D })
      playing = false
      clearInterval(timer)
      state(lastWord)
      return
    }
    post({ type: 'timeUpdate', currentTime: t, duration: D })
    if (haltAt !== null && t >= haltAt.position) {
      const word = haltAt.word
      haltAt = null
      playing = false
      clearInterval(timer)
      state(word)
    }
  }
  function play() {
    if (playing) return
    playing = true
    last = performance.now()
    state('playing')
    timer = setInterval(tick, 250)
  }
  function pause() {
    if (!playing) return
    playing = false
    clearInterval(timer)
    state('paused')
  }
  addEventListener('message', (e) => {
    const m = e.data
    window.__got.push({ m, origin: e.origin })
    if (!m || typeof m !== 'object') return
    if (m.type === 'play') play()
    else if (m.type === 'pause') pause()
    else if (m.type === 'seek') t = m.time
  })
  window.__player = {
    play, pause, say: post,
    setRate: (r) => { rate = r },
    steady: () => { steady = true },
    /** The video will end on "paused", not "stopped". */
    endWithPause: () => { lastWord = 'paused' },
    /** Plays on and says `word` ("paused" or "stopped") on reaching `position`. */
    playUntil: (position, word) => {
      haltAt = { position, word }
      play()
    },
    /** Stops reporting without a word, as a player whose page has hung would. No "paused", so no forced heartbeat. */
    freeze: () => {
      playing = false
      clearInterval(timer)
    },
    /** The student drags the player's own scrub bar. */
    jump: (to) => {
      t = to
      state('stalled')
      if (playing) state('playing')
    },
  }
  if (mode !== 'silent') {
    setTimeout(() => {
      post({ type: 'ready' })
      state('idle')
    }, readyDelay)
  }
}

const modules = {
  react: read('node_modules/react/cjs/react.development.js'),
  'react/jsx-runtime': read('node_modules/react/cjs/react-jsx-runtime.development.js'),
  'react-dom': read('node_modules/react-dom/cjs/react-dom.development.js'),
  'react-dom/client': read('node_modules/react-dom/cjs/react-dom-client.development.js'),
  scheduler: read('node_modules/scheduler/cjs/scheduler.development.js'),
  '@/components/world/LessonPlayer': real('src/components/world/LessonPlayer.tsx'),
  '@/lib/world/tella-player': real('src/lib/world/tella-player.ts'),
  '@/lib/world/watch-heartbeat': real('src/lib/world/watch-heartbeat.ts'),
  '@/lib/world/tella': real('src/lib/world/tella.ts'),
  '@/lib/world/lesson-transport': real('src/lib/world/lesson-transport.ts'),
  '@/lib/call-gate': real('src/lib/call-gate.ts'),
  '@/contexts/StudentContext': inPage(studentContextStandIn),
  '@/lib/supabase-browser': inPage(supabaseStandIn),
  // A CSS module is an object of class names. This one answers with the name it was asked for.
  '@/components/world/world-ui.module.css': 'module.exports = { __esModule: true, default: new Proxy({}, { get: (_, k) => String(k) }) };',
  harness: inPage(harness, D, EMBED),
}
const BUNDLE = `
var process = { env: { NODE_ENV: 'development' } };
(${prelude.toString()})();
const __defs = {}; const __cache = {};
function __req(name) {
  if (name === './tella') name = '@/lib/world/tella';
  if (__cache[name]) return __cache[name].exports;
  if (!__defs[name]) throw new Error('module not in the bundle: ' + name);
  const module = { exports: {} }; __cache[name] = module;
  __defs[name](__req, module, module.exports);
  return module.exports;
}
${Object.entries(modules).map(([name, src]) => `__defs[${JSON.stringify(name)}] = function (require, module, exports) {\n${src}\n};`).join('\n')}
__req('harness');
`
const PAGE = '<!doctype html><meta charset="utf-8"><title>lesson player sim</title><body><div id="root"></div><script src="/bundle.js"></script></body>'
/**
 * The frame's document. With `holdLoadMs` it carries an image that is answered
 * that much later, so the player says "ready" well before the frame's `load`
 * fires, which is what the real player was measured to do in 20 loads of 21.
 */
const frameHtml = ({ mode = 'normal', readyDelay = 300, holdLoadMs = 0 } = {}) =>
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:14px sans-serif">stand-in player<script>(${standInPlayer.toString()})(${D}, ${JSON.stringify(mode)}, ${readyDelay});</script>${holdLoadMs ? '<img src="/held-back.png" alt="">' : ''}</body>`

// ── The runner ───────────────────────────────────────────────────────
let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => JSON.stringify(v)
const only = process.argv.slice(2)
const strays = []
let browser = null

/** A fresh page with the bundle loaded and every request answered here. */
async function open({ frame, api } = {}) {
  const page = await browser.newPage()
  const requests = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (url === `${PAGE_ORIGIN}/`) return req.respond({ status: 200, contentType: 'text/html', body: PAGE })
    if (url === `${PAGE_ORIGIN}/bundle.js`) return req.respond({ status: 200, contentType: 'application/javascript', body: BUNDLE })
    if (url.startsWith('https://www.tella.tv/video/')) {
      requests.push({ frame: true, url, referer: req.headers().referer ?? null })
      // "hang": never answered, like a host that cannot be reached. The frame's `load` never fires.
      if (frame?.mode === 'hang') return undefined
      return req.respond({ status: 200, contentType: 'text/html', body: frameHtml(frame) })
    }
    if (url === 'https://www.tella.tv/held-back.png') {
      // Answered late, and the page may be gone by then.
      setTimeout(() => req.respond({ status: 404, contentType: 'text/plain', body: '' }).catch(() => {}), frame?.holdLoadMs ?? 0)
      return undefined
    }
    if (url.startsWith(`${PAGE_ORIGIN}/api/`)) {
      const route = new URL(url).pathname
      requests.push({ route, method: req.method(), auth: req.headers().authorization ?? null, body: req.postData() ?? null })
      const answer = (api ?? {})[route]
      if (!answer) return req.respond({ status: 404, contentType: 'application/json', body: '{"error":"no such route in the sim"}' })
      return req.respond({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) })
    }
    if (url.endsWith('/favicon.ico')) return req.respond({ status: 204 })
    strays.push(url)
    return req.abort()
  })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message)))
  await page.goto(`${PAGE_ORIGIN}/`, { waitUntil: 'load' })

  const s = {
    page, requests,
    mount: (cfg) => page.evaluate((c) => window.__h.mount(c), cfg),
    unmount: () => page.evaluate(() => window.__h.unmount()),
    log: () => page.evaluate(() => window.__h.log),
    of: async (kind) => (await s.log()).filter((e) => e.kind === kind),
    text: () => page.evaluate(() => document.getElementById('root').innerText.trim()),
    row: (id) => page.evaluate((k) => {
      const r = window.__h.server.rows.get(k)
      return r ? { lastPos: r.lastPos, ratio: Number((r.watched / window.__h.server.duration).toFixed(3)), wouldComplete: window.__h.server.judge(k).completed } : null
    }, id),
    /** The timers the component set. The claim timer is at most 10 s; the no-load timer is exactly 12 s. */
    timers: async () => {
      const all = await page.evaluate(() => window.__timers)
      return { claim: all.filter((t) => t.delay > 0 && t.delay <= 10_000), noLoad: all.filter((t) => t.delay === 12_000), all }
    },
    dom: () => page.evaluate(() => {
      const f = document.querySelector('iframe')
      const bar = document.querySelector('[role=progressbar]')
      const statuses = [...document.querySelectorAll('[role=status]')].map((el) => ({ text: el.textContent, cls: el.className, tag: el.tagName, afterBar: el.previousElementSibling === bar }))
      return {
        iframe: f ? { src: f.getAttribute('src'), title: f.getAttribute('title'), referrerpolicy: f.getAttribute('referrerpolicy'), allow: f.getAttribute('allow'), allowfullscreen: f.hasAttribute('allowfullscreen'), loading: f.getAttribute('loading'), connected: f.isConnected } : null,
        iframes: document.querySelectorAll('iframe').length,
        bar: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
        statuses,
        listeners: window.__listeners.live,
        listenersAdded: window.__listeners.added,
      }
    }),
    /** The stand-in player's own window, to press its buttons. */
    frame: async () => {
      for (let i = 0; i < 60; i++) {
        const f = page.frames().find((x) => x.url().startsWith('https://www.tella.tv/'))
        if (f) return f
        await sleep(50)
      }
      throw new Error('the stand-in frame never appeared')
    },
    /** Waits until `test` is true, looking every 100 ms. Gives up after `ms` and says so. */
    until: async (test, ms = 5000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (await test()) return true
        await sleep(100)
      }
      return false
    },
    /** The page's own clock, the one the log and the timers are stamped with. */
    now: () => page.evaluate(() => performance.now()),
    /** When the frame was put on the page and when its `load` fired (null = it has not), on that clock. */
    frameTimes: () => page.evaluate(() => window.__frame),
    /** Errors, unhandled rejections and anything React wrote to console.error. */
    trouble: async () => [...(await s.log()).filter((e) => ['window-error', 'unhandled-rejection', 'console-error'].includes(e.kind)).map((e) => e.message), ...pageErrors],
    close: () => page.close(),
  }
  return s
}
/**
 * The claim timer is set from Date.now and this file's log is stamped from
 * performance.now. The two clocks may disagree by a few milliseconds.
 */
const CLOCKS_MS = 10
/** "When the 10 s end": not before, and within 400 ms after. */
const tenSeconds = (gap) => gap >= 10_000 - CLOCKS_MS && gap < 10_400
const noteLine = (dom) => dom.statuses.find((x) => x.text.startsWith('Not marked as watched yet.')) ?? null
const noLoadLine = (dom) => dom.statuses.find((x) => x.text === NO_LOAD) ?? null
const ENDED_SHORT = "This lesson finished but didn't register. Tell the team so we can fix it."
const endedLine = (dom) => dom.statuses.find((x) => x.text === ENDED_SHORT) ?? null
/** A stored row past the 95% point and not complete, as the page's context and the server both hold it. */
const stored = (id, { position, watched, met }) => ({
  seedRows: [[id, { max: position, lastPos: position, watched, thresh: met, count: 5 }]],
  seedWatch: [[id, { lesson_id: id, max_position_seconds: position, last_position_seconds: met ? position : 5, watched_seconds: watched, reported_duration_seconds: D, threshold_met_at: met ? '2026-10-12T10:00:00.000Z' : null, last_heartbeat_at: '2026-10-12T10:00:00.000Z' }]],
})

/**
 * The start of every D11 section: skip to 19.3 s and play. The first report
 * (19.55 s) is past 95% and claims. Two reports later the video ends, and the
 * heartbeat for that lands half a second after the claim, inside the 10 s.
 * Steady, so those positions are the same on a busy machine. (From 19.45 the
 * end would come with under 0.25 s of new position and of played time, which
 * the heartbeat treats as nothing new to say; whether it goes is then luck.)
 */
async function skipToTheEnd(s, f) {
  await sleep(700)
  await f.evaluate(() => { window.__player.steady(); window.__player.jump(19.3); window.__player.play() })
  await s.until(async () => (await s.of('beat')).some((b) => b.force && b.met))
  await sleep(300)
}

const sections = []
const section = (id, title, run) => sections.push({ id, title, run })

// ── S1 ───────────────────────────────────────────────────────────────
section('S1', 'watched through at 1x (StrictMode on; the context, its functions and the transport new on every render)', async () => {
  const s = await open({ frame: { readyDelay: 0 } })   // "ready" the instant the frame's script runs
  await s.mount({ lessonId: 'a2l01', strict: true, unstable: true })
  const f = await s.frame()
  await sleep(600)
  const d0 = await s.dom()
  ok(d0.iframe && d0.iframe.src === EMBED && d0.iframe.title === 'Lesson video' && d0.iframe.referrerpolicy === 'strict-origin-when-cross-origin'
     && d0.iframe.allow === 'autoplay; fullscreen; picture-in-picture' && d0.iframe.allowfullscreen && d0.iframe.loading === null,
     'the frame has the attributes of section 9 item 2 and no loading="lazy"', show(d0.iframe))
  ok(d0.listeners === 1, 'one message listener is live', `${d0.listeners} live, ${d0.listenersAdded} added in all`)
  const frames = s.requests.filter((r) => r.frame)
  ok(frames.length === 1 && frames[0].referer === `${PAGE_ORIGIN}/`, 'the frame was requested once and sent the page\'s origin as its referrer', show(frames.map((r) => r.referer)))
  await f.evaluate(() => window.__player.play())
  await sleep(21_500)
  const log = await s.log()
  const beats = log.filter((e) => e.kind === 'beat')
  const d1 = await s.dom()
  ok(d1.iframe !== null && noLoadLine(d1) === null, 'a "ready" sent the instant the frame ran was heard: no "didn\'t load" line after 21 s')
  ok(log.filter((e) => e.kind === 'getEmbed').length === 2, 'the address was asked for twice (StrictMode\'s double effect) and never again', `${log.filter((e) => e.kind === 'getEmbed').length} calls over ${beats.length} heartbeats`)
  ok(beats.length === 3 && beats[0].delta === 0 && beats[2].force === true, 'three heartbeats: the first report, one at 15 s, the end', show(beats.map((b) => [b.pos, b.delta, b.force])))
  ok(beats.length === 3 && beats[2].watched > 19 && beats[2].watched <= 20.1, 'the server was told about all of it', `watched ${beats[2]?.watched} of ${D}`)
  const count = (kind) => log.filter((e) => e.kind === kind).length
  ok(count('claim') === 1 && count('markWatched') === 1 && count('onCompleted') === 1 && count('achievements-event') === 1,
     'one claim, one markWatched, one onCompleted, one achievements event', show(['claim', 'markWatched', 'onCompleted', 'achievements-event'].map(count)))
  ok(show(log.find((e) => e.kind === 'onCompleted')?.achievements) === '["first_lesson"]', 'onCompleted carries the achievements the server named')
  ok(d1.bar >= 99 && d1.statuses.length === 0, 'the progress line is full and there is no line under it', `bar ${d1.bar}`)
  ok(d1.listeners === 1 && d1.listenersAdded === 1 && d1.iframes === 1, 'nothing re-attached while it played: one listener, added once, one frame', `${d1.listenersAdded} added`)
  ok((await f.evaluate(() => window.__got)).length === 0, 'no command was sent to a player with nothing to resume')
  ok((await s.timers()).claim.length === 0, 'no claim timer was ever set: nothing was held back')
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.unmount()
  await sleep(200)
  ok((await s.dom()).listeners === 0, 'unmount takes the listener off window')
  await s.close()
})

// ── S2 ───────────────────────────────────────────────────────────────
section('S2', 'skipped to the end first, then watched properly at 2.5x', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l02', strict: true, unstable: true })
  const f = await s.frame()
  await sleep(700)
  await f.evaluate(() => { window.__player.jump(19.3); window.__player.play() })
  await sleep(1800)
  let d = await s.dom()
  const first = (await s.of('claim-answer'))[0]
  ok(first && first.completed === false && first.reason === 'played_short', 'the claim after the skip is refused for too little played', show(first))
  const n = Math.floor((first?.playedRatio ?? 0) * 100)
  const line = noteLine(d)
  ok(line && line.text === notCounted(n) && line.afterBar && line.cls === 'barNote' && line.tag === 'P', 'the note is under the progress line, role="status", in the PRD\'s words', show(line))
  ok((await s.of('markWatched')).length === 0, 'and nothing is marked watched')
  // Back to the start, and all of it at the top speed: 20 s of video in 8 s of clock.
  await sleep(2000)
  await f.evaluate(() => { window.__player.jump(0); window.__player.setRate(2.5); window.__player.play() })
  await sleep(9000)
  const beats = await s.of('beat')
  const end = beats[beats.length - 1]
  ok(end && end.force && end.watched >= 19.5, 'at 2.5x, with a real browser\'s timers, every report was counted', `watched ${end?.watched} of ${D}; the end heartbeat carried ${end?.delta} s`)
  // The claim that follows is made at once or, if the last one was under 10 s ago, when that wait ends.
  await sleep(9500)
  d = await s.dom()
  const claims = await s.of('claim')
  const gaps = claims.slice(1).map((c, i) => c.at - claims[i].at)
  ok((await s.of('markWatched')).length === 1 && noteLine(d) === null, 'the lesson is then counted, once, and the note is gone', `${claims.length} claims`)
  ok(gaps.length >= 1 && gaps.every((g) => g >= 10_000 - CLOCKS_MS), 'no two claims were less than 10 s apart', `gaps ${gaps.join(', ')} ms`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

// ── S3: the claim that is held back (D11) ────────────────────────────
section('S3', 'D11: a claim held back by the 10 s wait is made when the wait ends', async () => {
  const s = await open()
  // 79.5% played and not yet at 95%. The first report past 95% claims and is
  // refused. The half second to the end brings it to 81.5%, and the heartbeat
  // at the end is half a second after that claim: inside the wait.
  await s.mount({ lessonId: 'a2l10', strict: true, unstable: true, ...stored('a2l10', { position: 18, watched: 15.9, met: false }) })
  const f = await s.frame()
  await skipToTheEnd(s, f)
  let log = await s.log()
  const claim1 = log.find((e) => e.kind === 'claim')
  const answer1 = log.find((e) => e.kind === 'claim-answer')
  ok(answer1 && answer1.reason === 'played_short' && answer1.playedRatio === 0.795 && noteLine(await s.dom())?.text === notCounted(79),
     'D11: the first claim is refused at 79.5%, and the note says 79%', show(answer1))
  const endBeat = log.filter((e) => e.kind === 'beat').find((b) => b.force && b.met)
  ok(endBeat && claim1 && endBeat.at - claim1.at > 0 && endBeat.at - claim1.at < 3000 && (await s.row('a2l10')).ratio === 0.815 && (await s.row('a2l10')).wouldComplete,
     'D11: the heartbeat at the end lands half a second later, inside the wait, and the server would now accept', `${endBeat && claim1 ? endBeat.at - claim1.at : '?'} ms after the claim; row at ${(await s.row('a2l10')).ratio}`)
  ok((await s.timers()).claim.length === 1 && (await s.timers()).claim[0].state === 'live', 'D11: that heartbeat set one timer, for the rest of the 10 s', show((await s.timers()).claim.map((t) => [t.delay, t.state])))
  // More heartbeats past 95% inside the wait: the student scrubs back and pauses, twice.
  for (let i = 0; i < 2; i++) {
    await f.evaluate(() => { window.__player.jump(18.5); window.__player.play() })
    await sleep(900)
    await f.evaluate(() => window.__player.pause())
    await sleep(500)
  }
  log = await s.log()
  const held = log.filter((e) => e.kind === 'beat' && e.accepted && e.met && e.at > claim1.at).length
  ok(held >= 3 && log.filter((e) => e.kind === 'claim').length === 1 && (await s.timers()).claim.length === 1,
     'D11: exactly one timer, however many heartbeats are held back, and no claim yet', `${held} heartbeats past 95% inside the wait, ${(await s.timers()).claim.length} timer, ${log.filter((e) => e.kind === 'claim').length} claim`)
  ok(noteLine(await s.dom())?.text === notCounted(79), 'D11: until then the note still shows the refusal')
  await sleep(Math.max(0, claim1.at + 10_600 - (await s.now())))
  log = await s.log()
  const claims = log.filter((e) => e.kind === 'claim')
  const timers = (await s.timers()).claim
  ok(claims.length === 2 && tenSeconds(claims[1].at - claims[0].at),
     'D11: the claim lands when the wait ends, with no new heartbeat to ask for it', `${claims.length === 2 ? claims[1].at - claims[0].at : '?'} ms after the first`)
  ok(log.filter((e) => e.kind === 'markWatched').length === 1 && noteLine(await s.dom()) === null && log.filter((e) => e.kind === 'achievements-event').length === 1,
     'D11: it is accepted: the lesson is counted once and the note is gone')
  ok(timers.length === 1 && timers[0].state === 'fired', 'D11: one timer was set in all, and it has fired', show(timers.map((t) => [t.delay, t.state])))
  // Complete now. Another heartbeat past 95% asks for nothing and sets nothing.
  await f.evaluate(() => { window.__player.jump(18.5); window.__player.play() })
  await sleep(900)
  await f.evaluate(() => window.__player.pause())
  await sleep(600)
  ok((await s.of('claim')).length === 2 && (await s.timers()).claim.length === 1, 'D11: a complete lesson is never claimed again and sets no timer', `${(await s.of('claim')).length} claims, ${(await s.timers()).claim.length} timer in all`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

section('S3', 'D11: a claim held back by an answer still on its way', async () => {
  // The first answer takes 3 s. The end heartbeat arrives while it is out.
  const s = await open()
  await s.mount({ lessonId: 'a2l11', server: { claimDelaysMs: [3000] }, ...stored('a2l11', { position: 18, watched: 15.9, met: false }) })
  const f = await s.frame()
  await skipToTheEnd(s, f)
  ok((await s.of('claim')).length === 1 && (await s.of('claim-answer')).length === 0 && (await s.timers()).claim.length === 1,
     'D11: with the first answer still out, the end heartbeat sets the one timer and sends no second request', `${(await s.of('claim')).length} claim, ${(await s.of('claim-answer')).length} answers, ${(await s.timers()).claim.length} timer`)
  await sleep(2500)
  ok(noteLine(await s.dom())?.text === notCounted(79), 'D11: the slow answer is the refusal at 79%')
  const claim1 = (await s.of('claim'))[0]
  await sleep(Math.max(0, claim1.at + 10_600 - (await s.now())))
  const claims = await s.of('claim')
  ok(claims.length === 2 && tenSeconds(claims[1].at - claims[0].at) && (await s.of('markWatched')).length === 1,
     'D11: the second request goes at the end of the 10 s and is accepted', `${claims.length === 2 ? claims[1].at - claims[0].at : '?'} ms after the first`)
  await s.close()
})

section('S3', 'D11: the 10 s end while the answer is still on its way', async () => {
  // The first answer takes 11 s, longer than the wait.
  const s = await open()
  await s.mount({ lessonId: 'a2l12', server: { claimDelaysMs: [11_000] }, ...stored('a2l12', { position: 18, watched: 15.9, met: false }) })
  const f = await s.frame()
  await skipToTheEnd(s, f)
  const claim1 = (await s.of('claim'))[0]
  await sleep(Math.max(0, claim1.at + 10_500 - (await s.now())))
  ok((await s.of('claim')).length === 1 && (await s.timers()).claim.length === 1 && (await s.timers()).claim[0].state === 'fired',
     'D11: the timer fires at 10 s with the answer still out, and no second request goes beside it', `${(await s.of('claim')).length} claim; timers ${show((await s.timers()).claim.map((t) => [t.delay, t.state]))}`)
  await sleep(1300)
  const log = await s.log()
  const claims = log.filter((e) => e.kind === 'claim')
  const answer1 = log.find((e) => e.kind === 'claim-answer')
  ok(claims.length === 2 && answer1 && claims[1].at >= answer1.at && claims[1].at - answer1.at < 200 && log.filter((e) => e.kind === 'markWatched').length === 1,
     'D11: the request that was owed is made the moment the answer lands, and is accepted', `${claims.length === 2 && answer1 ? claims[1].at - answer1.at : '?'} ms after the answer`)
  // While the answer was out and the 10 s were over, nothing may spin: a timer
  // that kept re-setting itself would show up as hundreds of these.
  const set = (await s.timers()).all.filter((t) => t.setAt > claim1.at + 9000)
  ok(set.length <= 3, 'D11: waiting for the slow answer sets no timer over and over', `${set.length} timers set after the 9th second`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

section('S3', 'D11: a lesson that completes ends the timer', async () => {
  // 82.5% played, and the first answer is a yes that takes 3 s. The end
  // heartbeat arrives while it is out and sets the timer; the yes ends it.
  const s = await open()
  await s.mount({ lessonId: 'a2l14', server: { claimDelaysMs: [3000] }, ...stored('a2l14', { position: 18, watched: 16.5, met: false }) })
  const f = await s.frame()
  await skipToTheEnd(s, f)
  const before = (await s.timers()).claim
  const claim1 = (await s.of('claim'))[0]
  await sleep(Math.max(0, claim1.at + 10_600 - (await s.now())))
  const after = (await s.timers()).claim
  ok(before.length === 1 && before[0].state === 'live' && after.length === 1 && after[0].state === 'cleared'
     && (await s.of('claim')).length === 1 && (await s.of('markWatched')).length === 1,
     'D11: the answer that completes the lesson clears the timer, and no second request is made', `before ${show(before.map((t) => t.state))}, after ${show(after.map((t) => t.state))}, ${(await s.of('claim')).length} claim`)
  await s.close()
})

section('S3', 'D11: leaving the page ends the timer', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l13', ...stored('a2l13', { position: 18, watched: 15.9, met: false }) })
  const f = await s.frame()
  await skipToTheEnd(s, f)
  const before = (await s.timers()).claim
  await s.unmount()
  await sleep(10_500)
  const after = (await s.timers()).claim
  ok(before.length === 1 && before[0].state === 'live' && after.length === 1 && after[0].state === 'cleared' && (await s.of('claim')).length === 1,
     'D11: unmount clears the timer, and nothing claims after the player is gone', `before ${show(before.map((t) => t.state))}, after ${show(after.map((t) => t.state))}, ${(await s.of('claim')).length} claim`)
  await s.close()
})

/**
 * The start of the D17 claim sections: the stored row is fully played but not
 * yet past 95%, and the lesson is played from 18.2 s to its end. The first
 * report (18.45 s) is short of 95%, so the only heartbeat past it is the one
 * at the end, and the claim it makes is the only one anything will ask for.
 */
async function playTheLastTwoSeconds(s, f) {
  await sleep(700)
  await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
  await s.until(async () => (await s.of('claim')).length === 1)
  await sleep(300)
}

section('S3', 'D17: a claim whose request fails is made again when the 10 s end', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l15', strict: true, unstable: true, server: { claimFails: 1 }, ...stored('a2l15', { position: 18, watched: 19, met: false }) })
  const f = await s.frame()
  await playTheLastTwoSeconds(s, f)
  let log = await s.log()
  const past = log.filter((e) => e.kind === 'beat' && e.met)
  ok(past.length === 1 && past[0].force && log.filter((e) => e.kind === 'claim').length === 1 && log.find((e) => e.kind === 'claim-answer')?.failed === true,
     'D17: the video ends, the heartbeat at the end is the only one past 95%, and the one claim it makes fails as a request', `${past.length} heartbeat past 95%, ${log.filter((e) => e.kind === 'claim').length} claim`)
  ok((await s.of('markWatched')).length === 0 && (await s.dom()).statuses.length === 0, 'D17: nothing is marked and there is nothing to say')
  const armed = (await s.timers()).claim
  ok(armed.length === 1 && armed[0].state === 'live' && armed[0].delay > 9000, 'D17: the failed request set the one timer, for the rest of the 10 s', show(armed.map((t) => [t.delay, t.state])))
  // Nothing else happens: the player is left alone.
  const claim1 = log.find((e) => e.kind === 'claim')
  await sleep(Math.max(0, claim1.at + 10_600 - (await s.now())))
  log = await s.log()
  const claims = log.filter((e) => e.kind === 'claim')
  ok(claims.length === 2 && tenSeconds(claims[1].at - claims[0].at) && log.filter((e) => e.kind === 'beat').length === 2,
     'D17: with nothing else happening, the claim is made again when the 10 s end', `${claims.length === 2 ? claims[1].at - claims[0].at : '?'} ms after the first; ${log.filter((e) => e.kind === 'beat').length} heartbeats in all`)
  ok(log.filter((e) => e.kind === 'markWatched').length === 1 && log.filter((e) => e.kind === 'onCompleted').length === 1, 'D17: and the lesson is counted')
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

section('S3', 'D17: a claim that keeps failing is not asked for ever', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l16', server: { claimFails: 99 }, ...stored('a2l16', { position: 18, watched: 19, met: false }) })
  const f = await s.frame()
  await playTheLastTwoSeconds(s, f)
  const claim1 = (await s.of('claim'))[0]
  await sleep(Math.max(0, claim1.at + 30_600 - (await s.now())))
  let claims = await s.of('claim')
  const gaps = claims.slice(1).map((c, i) => c.at - claims[i].at)
  ok(claims.length === 4 && gaps.every(tenSeconds), 'D17: a request that keeps failing is made three more times, 10 s apart', `${claims.length} requests; gaps ${gaps.join(', ')} ms`)
  await sleep(12_000)
  claims = await s.of('claim')
  const timers = (await s.timers()).claim
  ok(claims.length === 4 && timers.length === 3 && timers.every((t) => t.state === 'fired'), 'D17: and then it is left alone: no fifth request, no timer waiting', `${claims.length} requests, timers ${show(timers.map((t) => t.state))}`)
  // One heartbeat past 95%, and only one (the player then goes quiet without
  // pausing, so there is no second heartbeat to hold back and set the timer
  // that way). It asks, and the count starts again with it.
  await f.evaluate(() => { window.__player.jump(18.5); window.__player.play() })
  await s.until(async () => (await s.of('claim')).length === 5, 4000)
  await f.evaluate(() => window.__player.freeze())
  await sleep(600)
  const after = (await s.timers()).claim
  ok((await s.of('claim')).length === 5 && (await s.of('beat')).filter((b) => b.met).length === 2 && after.length === 4 && after[3].state === 'live',
     'D17: a later heartbeat past 95% still asks, and starts the count again: its failed request sets the timer', `${(await s.of('claim')).length} requests, timers ${show(after.map((t) => t.state))}`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

section('S3', 'D17: a claim that fails on opening the lesson, and opening a lesson claims once', async () => {
  {
    const s = await open()
    // The stored row is past 95% and fully played, and the lesson is not complete: the claim on mount. It fails.
    await s.mount({ lessonId: 'a2l03', strict: true, unstable: true, server: { claimFails: 1 }, ...stored('a2l03', { position: 19.9, watched: 19.8, met: true }) })
    const f = await s.frame()
    await sleep(900)
    ok((await s.of('claim')).length === 1 && (await s.timers()).claim.length === 1,
       'opening a lesson whose stored row is past 95% claims once; the request failed, so one timer is set', `${(await s.of('claim')).length} claim, ${(await s.timers()).claim.length} timer`)
    ok((await s.of('claim-answer'))[0]?.failed === true && (await s.of('markWatched')).length === 0 && noteLine(await s.dom()) === null, 'that request failed: nothing is marked and there is nothing to say')
    ok((await f.evaluate(() => window.__got)).length === 0, 'a lesson past 95% is not resumed: no seek was sent')
    // One heartbeat past 95% inside the wait, then the player is left alone.
    await f.evaluate(() => { window.__player.jump(2); window.__player.play() })
    await sleep(1200)
    await f.evaluate(() => window.__player.pause())
    await sleep(600)
    ok((await s.of('claim')).length === 1 && (await s.timers()).claim.length === 1, 'D11: a heartbeat past 95% inside the wait does not claim, and there is still one timer', `${(await s.timers()).claim.length} timer`)
    const claim1 = (await s.of('claim'))[0]
    await sleep(Math.max(0, claim1.at + 10_600 - (await s.now())))
    const claims = await s.of('claim')
    ok(claims.length === 2 && tenSeconds(claims[1].at - claims[0].at) && (await s.of('markWatched')).length === 1,
       'D17: the failed request is made again when the wait ends, and the lesson is counted', `${claims.length === 2 ? claims[1].at - claims[0].at : '?'} ms after the first`)
    ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // The same opening with a claim that is answered (a refusal): StrictMode runs the mount effect twice, and the second run must set no timer.
    const s = await open()
    await s.mount({ lessonId: 'a2l03', strict: true, unstable: true, ...stored('a2l03', { position: 19.9, watched: 10, met: true }) })
    await s.frame()
    await sleep(900)
    ok((await s.of('claim')).length === 1 && (await s.timers()).claim.length === 0 && noteLine(await s.dom())?.text === notCounted(50),
       'opening a lesson whose claim is refused claims once, shows the note, and StrictMode\'s second run sets no timer', `${(await s.of('claim')).length} claim, ${(await s.timers()).claim.length} timers`)
    await s.close()
  }
})

// ── S4 ───────────────────────────────────────────────────────────────
section('S4', 'resume where the student left off', async () => {
  const half = { seedRows: [['a2l04', { max: 12, lastPos: 12, watched: 12, thresh: false, count: 3 }]],
    seedWatch: [['a2l04', { lesson_id: 'a2l04', max_position_seconds: 12, last_position_seconds: 12, watched_seconds: 12, reported_duration_seconds: D, threshold_met_at: null, last_heartbeat_at: '2026-10-12T10:00:00.000Z' }]] }
  {
    const s = await open()
    await s.mount({ lessonId: 'a2l04', strict: true, unstable: true, ...half })
    const f = await s.frame()
    await sleep(900)
    const got = await f.evaluate(() => window.__got)
    ok(got.length === 1 && got[0].m.type === 'seek' && got[0].m.time === 12 && got[0].origin === PAGE_ORIGIN, 'one seek to the stored position, after "ready"', show(got))
    ok((await s.dom()).bar === 60, 'D13: before play, the progress line already shows the stored position (12 s of 20)', `bar ${(await s.dom()).bar}`)
    ok((await s.of('beat')).length === 0 && (await s.of('claim')).length === 0, 'opening it wrote nothing and claimed nothing')
    // Leave without pressing play: the stored position must survive.
    await s.unmount()
    await sleep(300)
    ok((await s.of('beat')).length === 0 && (await s.row('a2l04')).lastPos === 12, 'leaving without pressing play sends no heartbeat, so the resume point is still 12 s', `lastPos ${(await s.row('a2l04')).lastPos}`)
    await s.close()
  }
  {
    const s = await open()
    await s.mount({ lessonId: 'a2l04', seedWatch: half.seedWatch })
    const f = await s.frame()
    await sleep(900)
    await f.evaluate(() => window.__player.play())
    await sleep(700)
    const beats = await s.of('beat')
    ok(beats.length === 1 && beats[0].pos > 12 && beats[0].pos < 13 && beats[0].delta === 0, 'playing starts from there: the first heartbeat is just past 12 s and carries no played time', show(beats.map((b) => [b.pos, b.delta])))
    ok((await s.dom()).bar > 60, 'and the progress line moves on from the stored position', `bar ${(await s.dom()).bar}`)
    await s.close()
  }
  {
    // No length in the catalog: the one the player reported on the earlier visit is used.
    const s = await open()
    await s.mount({ lessonId: 'a2l04', durationSeconds: null, seedWatch: half.seedWatch })
    await s.frame()
    await sleep(600)
    ok((await s.dom()).bar === 60, 'D13: with no length in the catalog, the line starts from the length the player reported last time', `bar ${(await s.dom()).bar}`)
    await s.close()
  }
  for (const [what, cfg] of [
    ['never opened', {}],
    ['left 5 s in', { seedWatch: [['a2l04', { ...half.seedWatch[0][1], max_position_seconds: 5, last_position_seconds: 5, watched_seconds: 5 }]] }],
    ['past 95% and complete', { seedCompleted: ['a2l04'], seedWatch: stored('a2l04', { position: 19.9, watched: 19.9, met: true }).seedWatch }],
  ]) {
    const s = await open()
    await s.mount({ lessonId: 'a2l04', ...cfg })
    const f = await s.frame()
    await sleep(600)
    ok((await s.dom()).bar === 0 && (await f.evaluate(() => window.__got)).length === 0, `D13: a lesson with nothing to resume (${what}) starts its line at 0 and is sent no seek`, `bar ${(await s.dom()).bar}`)
    await s.close()
  }
})

// ── S5: the video that says nothing (D12) ────────────────────────────
section('S5', 'D12: a video that has not answered gets a line under it and stays on the page', async () => {
  const s = await open({ frame: { mode: 'silent' } })
  await s.mount({ lessonId: 'a2l05', strict: true, unstable: true })
  const f = await s.frame()
  // The 12 s run from the moment the frame is put on the page, which is when the timer is set.
  await s.until(async () => (await s.timers()).noLoad.length === 1)
  const mounted = (await s.timers()).noLoad[0]?.setAt ?? 0
  await sleep(Math.max(0, mounted + 10_500 - (await s.now())))
  let d = await s.dom()
  ok(d.iframe !== null && noLoadLine(d) === null, 'D12: 10.5 s after the frame is put on the page there is no line yet')
  await s.until(async () => noLoadLine(await s.dom()) !== null, 4000)
  d = await s.dom()
  const line = noLoadLine(d)
  const fired = (await s.timers()).noLoad[0]
  ok(line && line.cls === 'barNote' && line.tag === 'P' && fired?.state === 'fired' && fired.firedAt - fired.setAt >= 12_000 && fired.firedAt - fired.setAt < 12_300,
     'D12: the line appears at 12 s, role="status", in the PRD\'s words', `${fired?.firedAt - fired?.setAt} ms after the frame was put on the page; ${show(d.statuses)}`)
  ok(d.iframe && d.iframe.connected && d.iframe.src === EMBED && d.iframes === 1 && s.requests.filter((r) => r.frame).length === 1 && d.listeners === 1,
     'D12: the frame is still in the document, never reloaded, and still listened to', `${d.iframes} frame, requested ${s.requests.filter((r) => r.frame).length} time, ${d.listeners} listener`)
  ok((await s.of('beat')).length === 0 && (await s.of('claim')).length === 0, 'no heartbeat and no claim for a video that has not played')
  // 14 s: the player speaks at last. Not "ready": any message will do.
  await sleep(Math.max(0, mounted + 14_000 - (await s.now())))
  ok(noLoadLine(await s.dom()) !== null, 'D12: at 14 s the line is still there')
  await f.evaluate(() => window.__player.say({ type: 'playbackState', state: 'idle', currentTime: 0, duration: 20 }))
  await s.until(async () => noLoadLine(await s.dom()) === null, 2000)
  d = await s.dom()
  ok(noLoadLine(d) === null && d.iframe !== null, 'D12: a message at 14 s, and not a "ready", removes the line')
  await f.evaluate(() => { window.__player.say({ type: 'ready' }); window.__player.play() })
  await sleep(1300)
  d = await s.dom()
  ok((await s.of('beat')).length === 1 && d.bar > 0 && noLoadLine(d) === null, 'D12: the slow video then plays and is counted like any other', `${(await s.of('beat')).length} heartbeat, bar ${d.bar}`)
  const t = (await s.timers()).noLoad
  const times = await s.frameTimes()
  ok(t.length === 1 && t[0].state === 'fired' && times.addedAt !== null && Math.abs(t[0].setAt - times.addedAt) <= 50 && times.loadedAt !== null && t[0].setAt <= times.loadedAt,
     'D13: one 12 s timer was set, the moment the frame was put on the page and before its load', `set ${t[0]?.setAt - times.addedAt} ms from the frame going in; its load fired ${times.loadedAt - times.addedAt} ms after`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

section('S5', 'D12: the two sides of the 12 s', async () => {
  {
    // "ready" arrives late, but inside the 12 s.
    const s = await open({ frame: { readyDelay: 9000 } })
    await s.mount({ lessonId: 'a2l05', strict: true })
    await s.frame()
    await s.until(async () => (await s.timers()).noLoad.length === 1)
    await sleep(Math.max(0, ((await s.timers()).noLoad[0]?.setAt ?? 0) + 13_500 - (await s.now())))
    const t = (await s.timers()).noLoad
    ok(noLoadLine(await s.dom()) === null && t.length === 1 && t[0].state === 'cleared', 'D12: a "ready" 9 s after the frame is put on the page ends the timer: no line at 13.5 s', show(t.map((x) => x.state)))
    await s.close()
  }
  {
    // Silent to the end, then the student leaves.
    const s = await open({ frame: { mode: 'silent' } })
    await s.mount({ lessonId: 'a2l05' })
    await s.frame()
    await s.until(async () => noLoadLine(await s.dom()) !== null, 15_000)
    await sleep(1500)
    ok(noLoadLine(await s.dom()) !== null, 'D12: a video that never speaks keeps its line')
    await s.unmount()
    await sleep(300)
    ok((await s.of('beat')).length === 0 && (await s.dom()).listeners === 0, 'leaving it sends no heartbeat and takes the listener off window')
    await s.close()
  }
})

section('S5', 'D13: the 12 s do not wait for the frame\'s load', async () => {
  {
    // The frame's request is never answered, so its `load` never fires.
    const s = await open({ frame: { mode: 'hang' } })
    await s.mount({ lessonId: 'a2l05', strict: true, unstable: true })
    await s.until(async () => (await s.timers()).noLoad.length === 1)
    const mounted = (await s.timers()).noLoad[0]?.setAt ?? 0
    await sleep(Math.max(0, mounted + 10_500 - (await s.now())))
    const early = noLoadLine(await s.dom())
    await s.until(async () => noLoadLine(await s.dom()) !== null, 4000)
    const d = await s.dom()
    const fired = (await s.timers()).noLoad[0]
    const times = await s.frameTimes()
    ok(early === null && noLoadLine(d) !== null && fired?.state === 'fired' && fired.firedAt - fired.setAt >= 12_000 && fired.firedAt - fired.setAt < 12_300 && times.loadedAt === null,
       'D13: a frame whose load never fires still gets the line 12 s after it is put on the page', `${fired?.firedAt - fired?.setAt} ms; load fired: ${times.loadedAt !== null}`)
    ok(d.iframe && d.iframe.connected && d.iframes === 1 && s.requests.filter((r) => r.frame).length === 1 && (await s.of('beat')).length === 0 && (await s.of('claim')).length === 0,
       'D13: that frame stays in the document, asked for once, and nothing is written or claimed')
    ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // What the real player does: "ready" first, the frame's `load` seconds later.
    const s = await open({ frame: { readyDelay: 300, holdLoadMs: 2500 } })
    await s.mount({ lessonId: 'a2l05', strict: true })
    await s.until(async () => (await s.frameTimes()).loadedAt !== null, 8000)
    await sleep(500)
    const t = (await s.timers()).noLoad
    const times = await s.frameTimes()
    ok(t.length === 1 && t[0].state === 'cleared' && times.loadedAt !== null && t[0].clearedAt < times.loadedAt && noLoadLine(await s.dom()) === null,
       'D13: "ready" before the frame\'s load, as the real player does it: "ready" ends the timer and the late load starts nothing',
       `"ready" ended it ${t[0]?.clearedAt - t[0]?.setAt} ms in; the load fired ${times.loadedAt - times.addedAt} ms in; ${t.length} timer in all`)
    await s.close()
  }
})

// ── S6 ───────────────────────────────────────────────────────────────
section('S6', 'the other messages', async () => {
  const past = stored('a2l06', { position: 19.9, watched: 19.9, met: true })
  {
    const s = await open()
    await s.mount({ lessonId: 'a2l06', recorded: false, strict: true, seedWatch: past.seedWatch })
    await sleep(500)
    const kinds = (await s.log()).map((e) => e.kind)
    ok((await s.text()) === 'Not recorded yet.' && !kinds.some((k) => ['getEmbed', 'claim', 'beat'].includes(k)), 'recorded={false}: "Not recorded yet." and the server is asked for nothing', show(kinds))
    await s.close()
  }
  for (const [embed, want] of [
    [{ ok: false, kind: 'not-recorded' }, 'Not recorded yet.'],
    [{ ok: false, kind: 'blocked' }, 'Your membership is inactive, so this lesson is locked.'],
    [{ ok: false, kind: 'error', message: 'Video lookup failed' }, 'Video lookup failed'],
    [{ ok: false, kind: 'error' }, 'Could not load the video.'],
  ]) {
    const s = await open()
    await s.mount({ lessonId: 'a2l06', strict: true, server: { embed } })
    const early = await s.text()
    await sleep(400)
    ok((await s.text()) === want && (await s.dom()).iframe === null, `${embed.kind}${embed.message ? ' with a message' : ''}: "${want}"`, `first paint: "${early}"`)
    await s.close()
  }
  {
    const s = await open()
    await s.mount({ lessonId: 'a2l06', strict: true, seedCompleted: ['a2l06'], seedWatch: past.seedWatch })
    await sleep(700)
    ok((await s.of('claim')).length === 0, 'a lesson already complete is not claimed on mount')
    await s.close()
  }
})

// ── S7 ───────────────────────────────────────────────────────────────
section('S7', 'moving to another lesson while the player is mounted', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l07', unstable: true })
  const f = await s.frame()
  await sleep(700)
  await f.evaluate(() => window.__player.play())
  await sleep(1300)
  await s.page.evaluate(() => window.__setLesson('a2l08'))
  await sleep(900)
  const asked = (await s.of('getEmbed')).map((e) => e.id).join()
  ok(asked === 'a2l07,a2l08', 'the address is asked for again, for the new lesson', asked)
  const beats = await s.of('beat')
  const rows = await s.page.evaluate(() => [...window.__h.server.rows.keys()].join())
  ok(beats.length === 2 && beats[1].force === true && rows === 'a2l07', 'the old lesson\'s last position is written on the way out, to the old lesson', `${show(beats.map((b) => [b.pos, b.force]))} rows: ${rows}`)
  const d = await s.dom()
  ok(d.listeners === 1 && d.iframes === 1 && d.bar === 0, 'one listener, one frame, and the progress line starts again at 0', show({ listeners: d.listeners, frames: d.iframes, bar: d.bar }))
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

// ── S8 ───────────────────────────────────────────────────────────────
section('S8', 'no transport prop: the real one, against stand-in routes', async () => {
  {
    const s = await open({ api: {
      '/api/student/lesson-video': { status: 200, body: { embedUrl: EMBED, durationSeconds: D } },
      '/api/student/lesson-watched': { status: 200, body: { completed: false, reason: 'played_short', positionRatio: 0.99, playedRatio: 0.4321, playedFloor: 0.8 } },
    } })
    await s.mount({ lessonId: 'a2l09', realTransport: true })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.jump(19.3); window.__player.play() })
    await sleep(1800)
    const video = s.requests.filter((r) => r.route === '/api/student/lesson-video')
    const watched = s.requests.filter((r) => r.route === '/api/student/lesson-watched')
    ok(video.length === 1 && video[0].method === 'POST' && video[0].auth === 'Bearer test-session-token' && video[0].body === '{"lessonId":"a2l09"}',
       'POST /api/student/lesson-video with the session token and the lesson id', show(video[0]))
    ok(watched.length === 1 && watched[0].method === 'POST' && watched[0].auth === 'Bearer test-session-token' && watched[0].body === '{"lessonId":"a2l09"}',
       'POST /api/student/lesson-watched the same way, once', show(watched[0]))
    const sb = await s.page.evaluate(() => window.__supabase)
    ok(sb.clients === 1 && sb.rpc.length >= 1 && sb.rpc.every((c) => c.fn === 'record_lesson_heartbeat'), 'with no heartbeat on the transport, the heartbeat goes to the record_lesson_heartbeat RPC through one client', `${sb.clients} client, ${sb.rpc.length} calls`)
    ok(noteLine(await s.dom())?.text === notCounted(43), 'a refusal from the route becomes the note, 0.4321 shown as 43%', noteLine(await s.dom())?.text)
    await s.close()
  }
  for (const [answer, want] of [
    [{ status: 403, body: { error: 'Membership inactive' } }, 'Your membership is inactive, so this lesson is locked.'],
    [{ status: 404, body: { error: 'Lesson has no video', notRecorded: true } }, 'Not recorded yet.'],
    [{ status: 404, body: { error: 'Lesson not found' } }, 'Lesson not found'],
    [{ status: 500, body: { error: 'Video lookup failed' } }, 'Video lookup failed'],
    [{ status: 200, body: { durationSeconds: 20 } }, 'Could not load the video.'],
  ]) {
    const s = await open({ api: { '/api/student/lesson-video': answer } })
    await s.mount({ lessonId: 'a2l09', realTransport: true })
    await sleep(500)
    ok((await s.text()) === want, `lesson-video ${answer.status} ${show(answer.body)} -> "${want}"`, await s.text())
    await s.close()
  }
})

// ── S9: the end of the video (D14, D17) ──────────────────────────────
section('S9', 'D14: a lesson that ends and is still not past 95%', async () => {
  {
    // The catalog says 26 s. The video is 20 s: its end is at 77%.
    const s = await open()
    await s.mount({ lessonId: 'a2l20', strict: true, unstable: true, durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
    await sleep(1200)
    ok(endedLine(await s.dom()) === null, 'D14: while it plays there is no line')
    await s.until(async () => endedLine(await s.dom()) !== null, 4000)
    const d = await s.dom()
    const line = endedLine(d)
    const log = await s.log()
    const end = log.filter((e) => e.kind === 'beat').find((b) => b.force)
    ok(line && line.cls === 'barNote' && line.tag === 'P' && end && end.accepted && end.met === false,
       'D14: a lesson whose catalog length is 30% longer than its video shows the line at the end, role="status", in the PRD\'s words', show(d.statuses))
    ok(log.filter((e) => e.kind === 'claim').length === 0 && (await s.timers()).claim.length === 0 && noteLine(d) === null && d.iframe !== null,
       'D14: and no claim is made, no timer is set, and the frame stays', `${log.filter((e) => e.kind === 'claim').length} claims`)
    ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // The length is put right while the student is still there, and they play the end again.
    const s = await open()
    await s.mount({ lessonId: 'a2l21', durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
    await s.until(async () => endedLine(await s.dom()) !== null, 5000)
    const shown = endedLine(await s.dom()) !== null
    await s.page.evaluate(() => { window.__h.server.duration = 20 })
    await f.evaluate(() => { window.__player.jump(17); window.__player.play() })
    await s.until(async () => endedLine(await s.dom()) === null, 6000)
    ok(shown && endedLine(await s.dom()) === null, 'D14: a later answer that is past 95% takes the line away')
    await s.close()
  }
  {
    // The right length: the same two seconds, and the line never shows.
    const s = await open()
    await s.mount({ lessonId: 'a2l22', strict: true, ...stored('a2l22', { position: 18, watched: 19, met: false }) })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
    let seen = false
    await s.until(async () => { seen = seen || endedLine(await s.dom()) !== null; return (await s.of('markWatched')).length === 1 }, 6000)
    await sleep(500)
    ok(!seen && endedLine(await s.dom()) === null && (await s.of('markWatched')).length === 1, 'D14: a lesson with the right length never shows the line, and is counted')
    await s.close()
  }
  {
    // The end adds nothing new to the heartbeat just before it: no call is made for it, and the line still shows.
    const s = await open()
    await s.mount({ lessonId: 'a2l23', durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(19.6); window.__player.play() })
    await s.until(async () => endedLine(await s.dom()) !== null, 4000)
    const beats = await s.of('beat')
    ok(endedLine(await s.dom()) !== null && beats.length === 1 && !beats[0].force,
       'D14: when the end adds nothing to the heartbeat just before it, the line still shows, from that heartbeat\'s answer', `${beats.length} heartbeat, at ${beats[0]?.pos} s`)
    await s.close()
  }
})

section('S9', 'D14: the end is told from the position, not from the word the player uses', async () => {
  const states = (f) => f.evaluate(() => window.__states)
  {
    // The video ends on "paused" (as the real player was measured to, one run in four). The catalog is 30% too long.
    const s = await open()
    await s.mount({ lessonId: 'a2l50', strict: true, unstable: true, durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.endWithPause(); window.__player.jump(18.2); window.__player.play() })
    await s.until(async () => endedLine(await s.dom()) !== null, 5000)
    const said = await states(f)
    const end = (await s.of('beat')).find((b) => b.force)
    ok(endedLine(await s.dom()) !== null && said[said.length - 1] === 'paused' && !said.includes('stopped') && end && end.pos === 19.95 && end.met === false,
       'D14: a video that ends on "paused" at its last position, on a lesson whose catalog length is 30% too long, shows the line', `the player said ${said.join(', ')}; the end heartbeat was at ${end?.pos} s`)
    ok((await s.of('claim')).length === 0, 'D14: and no claim is made', `${(await s.of('claim')).length} claims`)
    ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // The same ending, on a lesson whose length is right.
    const s = await open()
    await s.mount({ lessonId: 'a2l51', strict: true, ...stored('a2l51', { position: 18, watched: 19, met: false }) })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.endWithPause(); window.__player.jump(18.2); window.__player.play() })
    let seen = false
    await s.until(async () => { seen = seen || endedLine(await s.dom()) !== null; return (await s.of('markWatched')).length === 1 }, 6000)
    await sleep(500)
    const said = await states(f)
    ok(!seen && endedLine(await s.dom()) === null && (await s.of('markWatched')).length === 1 && said[said.length - 1] === 'paused' && !said.includes('stopped'),
       'D14: the same ending on a lesson with the right length: counted, and never the line', `the player said ${said.join(', ')}`)
    await s.close()
  }
  {
    // The too-long lesson again, and four halts that are not the end, or are.
    const s = await open()
    await s.mount({ lessonId: 'a2l52', strict: true, unstable: true, durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    const forced = async () => (await s.of('beat')).filter((b) => b.force)
    const haltAt = async (position, word, count) => {
      await f.evaluate((p, w) => { window.__player.playUntil(p, w) }, position, word)
      await s.until(async () => (await forced()).length === count, 5000)
      await sleep(500)
      const beats = await forced()
      return { beat: beats[beats.length - 1], line: endedLine(await s.dom()) !== null, count: beats.length }
    }
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(5) })
    const mid = await haltAt(6, 'stopped', 1)
    ok(mid.count === 1 && mid.beat?.pos === 6 && mid.beat.accepted && !mid.beat.met && !mid.line,
       'D14: a "stopped" in the middle of the video forces a heartbeat and does not show the line', `heartbeat at ${mid.beat?.pos} s of a 20 s video`)
    const pause = await haltAt(7, 'paused', 2)
    ok(pause.count === 2 && pause.beat?.pos === 7 && !pause.line, 'D14: an ordinary pause in the middle does not show it either, as before', `heartbeat at ${pause.beat?.pos} s`)
    await f.evaluate(() => window.__player.jump(17.5))
    const early = await haltAt(18.25, 'paused', 3)
    ok(early.count === 3 && early.beat?.pos === 18.25 && !early.line, 'D14: a pause 1.75 s before the end is still an ordinary pause', `heartbeat at ${early.beat?.pos} s`)
    const late = await haltAt(18.75, 'stopped', 4)
    ok(late.count === 4 && late.beat?.pos === 18.75 && late.line, 'D14: a "stopped" or "paused" inside the last 1.5 s is the end: the line shows', `heartbeat at ${late.beat?.pos} s`)
    ok((await s.of('claim')).length === 0 && (await s.trouble()).length === 0, 'no claim, no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // Two messages that name one place while the last position reported is another. Neither is the end.
    const s = await open()
    await s.mount({ lessonId: 'a2l54', durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    const forced = async () => (await s.of('beat')).filter((b) => b.force)
    // Paused at 7 s, and then a "paused" that names 19.9 s: the scrub bar dragged to the end while paused, no position reported from there.
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(6); window.__player.playUntil(7, 'paused') })
    await s.until(async () => (await forced()).length === 1, 5000)
    await f.evaluate(() => window.__player.say({ type: 'playbackState', state: 'paused', currentTime: 19.9, duration: 20 }))
    await sleep(700)
    ok(endedLine(await s.dom()) === null && (await forced()).length === 1,
       'D14: a "paused" that names the end while the last position reported is 7 s is not the end: no line', `${(await forced()).length} forced heartbeat, at ${(await forced())[0]?.pos} s`)
    // Played to 19.25 s, and then a "stopped" that names 0 s.
    await f.evaluate(() => { window.__player.jump(18.5); window.__player.playUntil(19.25, 'paused') })
    await s.until(async () => (await forced()).length === 2, 5000)
    await s.until(async () => endedLine(await s.dom()) !== null, 3000)
    const shown = endedLine(await s.dom()) !== null
    ok(shown, 'D14: paused 0.75 s before the end, both positions agree: the line shows')
    await s.close()
  }
  {
    // A "stopped" that names 0 s while the last position reported is the end is not taken for the end.
    const s = await open()
    await s.mount({ lessonId: 'a2l55', durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.6); window.__player.play() })
    await s.until(async () => (await s.of('beat')).length === 1, 4000)
    await sleep(600)
    await f.evaluate(() => { window.__player.freeze(); window.__player.say({ type: 'playbackState', state: 'stopped', currentTime: 0, duration: 0 }) })
    await s.until(async () => (await s.of('beat')).some((b) => b.force), 3000)
    await sleep(500)
    ok(endedLine(await s.dom()) === null && (await s.of('beat')).some((b) => b.force),
       'D14: a "stopped" that names 0 s after positions near the end forces a heartbeat and is not taken for the end')
    await s.close()
  }
  {
    // A "paused" that carries no position at all, near the end: it is placed by the last position reported.
    const s = await open()
    await s.mount({ lessonId: 'a2l53', durationSeconds: 26, server: { duration: 26 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.6); window.__player.play() })
    await s.until(async () => (await s.of('beat')).length === 1, 4000)
    await f.evaluate(() => { window.__player.freeze(); window.__player.say({ type: 'playbackState', state: 'paused' }) })
    await s.until(async () => endedLine(await s.dom()) !== null, 3000)
    ok(endedLine(await s.dom()) !== null, 'D14: a "paused" with no position in it is placed by the last position reported')
    await s.close()
  }
})

section('S9', 'D14 and D17: the heartbeat at the end fails', async () => {
  {
    // The catalog is 30% too long AND the end heartbeat fails. No line on a failure; the retry 2 s later lands, and then the line.
    const s = await open()
    await s.mount({ lessonId: 'a2l24', strict: true, unstable: true, durationSeconds: 26, server: { duration: 26, failForcedBeats: 1 } })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
    await s.until(async () => (await s.of('beat-failed')).length === 1, 5000)
    const failed = (await s.of('beat-failed'))[0]
    await sleep(1200)
    ok(failed && endedLine(await s.dom()) === null && (await s.of('beat')).length === 1,
       'D14: a failed end heartbeat does not show the line', `failed at ${failed?.pos} s; ${(await s.of('beat')).length} heartbeat has landed`)
    await s.until(async () => (await s.of('beat')).length === 2, 4000)
    const retry = (await s.of('beat'))[1]
    await sleep(300)
    ok(retry && retry.force && retry.at - failed.at >= 2000 - CLOCKS_MS && retry.at - failed.at < 2400 && retry.pos === failed.pos && retry.delta === failed.delta,
       'D17: the failed end heartbeat is sent again 2 s later, with the same position and played seconds', `${retry ? retry.at - failed.at : '?'} ms later`)
    ok(endedLine(await s.dom()) !== null, 'D14: and when that one lands still short of 95%, the line shows')
    ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
    await s.close()
  }
  {
    // The right length, and the end heartbeat (the only one past 95%) fails.
    const s = await open()
    await s.mount({ lessonId: 'a2l25', strict: true, unstable: true, server: { failForcedBeats: 1 }, ...stored('a2l25', { position: 18, watched: 19, met: false }) })
    const f = await s.frame()
    await sleep(700)
    await f.evaluate(() => { window.__player.steady(); window.__player.jump(18.2); window.__player.play() })
    await s.until(async () => (await s.of('beat-failed')).length === 1, 5000)
    const failed = (await s.of('beat-failed'))[0]
    await sleep(1200)
    ok((await s.of('claim')).length === 0 && (await s.of('markWatched')).length === 0, 'D17: the heartbeat at the end fails: nothing is past 95% yet, and nothing is claimed')
    await s.until(async () => (await s.of('markWatched')).length === 1, 4000)
    const log = await s.log()
    const landed = log.filter((e) => e.kind === 'beat').find((b) => b.force)
    ok(landed && landed.met && landed.at - failed.at >= 2000 - CLOCKS_MS && landed.at - failed.at < 2400 && log.filter((e) => e.kind === 'markWatched').length === 1 && endedLine(await s.dom()) === null,
       'D17: it is sent again 2 s later with nothing else happening, and the lesson is counted', `${landed ? landed.at - failed.at : '?'} ms later`)
    await s.close()
  }
})

// ── S10: the catalog disowns a playing lesson for a moment (D19) ─────
section('S10', 'D19: `recorded` turns false and true again while the video plays', async () => {
  const s = await open()
  await s.mount({ lessonId: 'a2l30', strict: true, unstable: true })
  const f = await s.frame()
  await sleep(700)
  await f.evaluate(() => window.__player.play())
  await sleep(1300)
  await s.page.evaluate(() => { document.querySelector('iframe').__theSameOne = true })
  const before = { asked: (await s.of('getEmbed')).length, bar: (await s.dom()).bar }
  // A refresh of the student's data says the lesson has no video.
  await s.page.evaluate(() => window.__setRecorded(false))
  await sleep(600)
  const off = await s.page.evaluate(() => ({ same: document.querySelector('iframe')?.__theSameOne === true, text: document.getElementById('root').innerText }))
  ok(off.same && !off.text.includes('Not recorded yet.'), 'D19: with `recorded` false under a playing video, the frame stays and "Not recorded yet." is not shown')
  // The next refresh is healthy.
  await s.page.evaluate(() => window.__setRecorded(true))
  await sleep(900)
  const d = await s.dom()
  const on = await s.page.evaluate(() => document.querySelector('iframe')?.__theSameOne === true)
  ok(on && d.iframes === 1 && s.requests.filter((r) => r.frame).length === 1 && d.listeners === 1 && d.listenersAdded === 1,
     'D19: back to true, it is the same frame element, loaded once, with the one listener it always had', `${d.iframes} frame, requested ${s.requests.filter((r) => r.frame).length} time, ${d.listenersAdded} listener added in all`)
  ok((await s.of('getEmbed')).length === before.asked, 'D19: and the address was not asked for again', `${(await s.of('getEmbed')).length} asks`)
  ok(d.bar > before.bar, 'D19: position reports are still heard: the progress line has moved on', `bar ${before.bar} -> ${d.bar}`)
  const beatsBefore = (await s.of('beat')).length
  await f.evaluate(() => window.__player.pause())
  await sleep(600)
  const beats = await s.of('beat')
  ok(beats.length === beatsBefore + 1 && beats[beats.length - 1].force && beats[beats.length - 1].delta > 2,
     'D19: and a heartbeat still goes, carrying what was played through the flip', `delta ${beats[beats.length - 1]?.delta} s at ${beats[beats.length - 1]?.pos} s`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

// ── S11: a busy page (D16) ───────────────────────────────────────────
section('S11', 'D16: the page is busy for a second at a time while the video plays at 1.5x', async () => {
  // The frame is on another site, so it is another process: it goes on
  // playing and reporting while this page's main thread is held. The reports
  // pile up and are handled back to back when the page is free again, the
  // first with a 1 s gap behind it and the rest with none.
  const s = await open()
  await s.mount({ lessonId: 'a2l40', strict: true, unstable: true })
  const f = await s.frame()
  await sleep(700)
  await f.evaluate(() => { window.__player.setRate(1.5); window.__player.play() })
  const hold = () => s.page.evaluate(() => { const until = performance.now() + 1000; while (performance.now() < until) { /* busy */ } })
  await sleep(2000)
  await hold()
  await sleep(2500)
  await hold()
  await sleep(2500)
  await f.evaluate(() => window.__player.pause())
  await s.until(async () => (await s.of('beat')).some((b) => b.force), 4000)
  const beats = await s.of('beat')
  const first = beats[0]
  const last = beats[beats.length - 1]
  const played = last.pos - first.pos
  // Both figures are logged to two decimals, so they may differ by the rounding. One lost report would be 0.375 s.
  ok(beats.length === 2 && last.force && played > 12 && Math.abs(last.watched - played) <= 0.02,
     'D16: every report is played time, the ones handled back to back after a stall included', `credited ${last?.watched} s of the ${played.toFixed(2)} s played`)
  ok((await s.trouble()).length === 0, 'no error, no React warning', (await s.trouble()).join(' | ').slice(0, 300))
  await s.close()
})

// ── Run ──────────────────────────────────────────────────────────────
const chosen = sections.filter((x) => only.length === 0 || only.includes(x.id))
if (chosen.length === 0) {
  console.error(`no section named ${only.join(', ')}. There are: ${[...new Set(sections.map((x) => x.id))].join(', ')}`)
  process.exit(1)
}
const dropProfile = () => {
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    // Chrome can still be letting go of a file. The next run starts by removing it.
  }
}
dropProfile()
fs.mkdirSync(PROFILE, { recursive: true })
browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-default-apps', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
    '--disable-client-side-phishing-detection', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    // Every DNS lookup fails. The page's requests are answered above before
    // any lookup; anything else has nowhere to go.
    '--host-resolver-rules=MAP * ~NOTFOUND'],
})
try {
  for (const x of chosen) {
    console.log(`\n=== ${x.id}. ${x.title} ===`)
    try {
      await x.run()
    } catch (e) {
      ok(false, `${x.id} ran to its end`, String(e?.message ?? e).slice(0, 300))
    }
  }
} finally {
  await browser.close()
  dropProfile()
}
ok(strays.length === 0, 'the page asked for nothing this file did not answer', strays.join(', '))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}${only.length ? `   (only ${only.join(', ')})` : ''}`)
fails.forEach((f) => console.log('  - ' + f))
// Leave now, once the lines above are written out. Chrome's helper processes
// outlive it, and they hold the pipe puppeteer reads Chrome's output from, so
// without this Node waits for them: measured, 24 s after a 23 s run.
process.stdout.write('', () => process.exit(fails.length ? 1 : 0))
