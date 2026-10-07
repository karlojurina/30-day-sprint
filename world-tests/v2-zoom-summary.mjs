/**
 * Summary pass over v2-zoom-verify.mjs output. No scene rendering: it reads
 * zoom-<vp>.json and the saved mask PNGs.
 *
 *   node world-tests/v2-zoom-summary.mjs            # all viewports present
 *
 * CHROME OCCLUSION. <build>-<vp>-<area>-mask-vis.png was captured with every
 * DOM element drawn over the magenta landmark. An opaque panel, its fade past
 * ~40% alpha, the dock, a label or a pin turns magenta pixels non-magenta;
 * the .shade legibility gradient (<= 0.36 alpha where landmarks sit) does
 * not. So chromeHidden = 1 - (strict magenta in the PNG) / (visible pixels
 * the canvas read back). The raw diff in zoom-<vp>.json (chromeCoverPct)
 * counts the shade too.
 *
 * Writes zoom-summary.json next to the inputs and prints one table.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'zoom')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VPS = ['split', 'ultra', 'laptop'].filter((v) => fs.existsSync(path.join(DIR, `zoom-${v}.json`)))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')

async function magenta(file, panelRight) {
  if (!fs.existsSync(file)) return null
  const b64 = fs.readFileSync(file).toString('base64')
  return page.evaluate(async (b64, pr) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64 })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let n = 0, left = 0, minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4
      if (d[i] > 150 && d[i + 1] < 100 && d[i + 2] > 150) {
        n++
        if (pr != null && x < pr) left++
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    return { n, left, h: c.height, w: c.width, heightPct: n ? (100 * (maxY - minY + 1)) / c.height : 0, minX, maxX, minY, maxY }
  }, b64, panelRight ?? null)
}

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)

/**
 * Snap re-check on SPEED (step / scene dt). The frame gate makes a few 0.017 s
 * frames at each shot hold, so raw per-frame steps can look like spikes when
 * the motion is smooth. A snap here = a frame whose speed is > 2.5x both
 * neighbours' and > 40 units/s, or whose turn rate is > 2.5x both and > 10 deg/s.
 */
function speedSnaps(steps) {
  if (!steps || steps.length < 3) return { snaps: [], maxSpeed: 0 }
  const sp = [], tr = []
  for (let i = 0; i < steps.length; i++) {
    const dt = i ? steps[i].clock - steps[i - 1].clock : null
    sp.push(dt > 0 ? steps[i].step / dt : null)
    tr.push(dt > 0 ? steps[i].turn / dt : null)
  }
  const snaps = []
  for (let i = 1; i < steps.length - 1; i++) {
    if (sp[i] == null || sp[i - 1] == null || sp[i + 1] == null) continue
    const nb = Math.max(sp[i - 1], sp[i + 1])
    const nbT = Math.max(tr[i - 1], tr[i + 1])
    if ((sp[i] > 40 && sp[i] > 2.5 * nb) || (tr[i] > 10 && tr[i] > 2.5 * nbT)) snaps.push({ clock: steps[i].clock, speed: r1(sp[i]), neighbours: r1(nb), turnRate: r1(tr[i]), turnNeighbours: r1(nbT) })
  }
  return { snaps, maxSpeed: r1(Math.max(0, ...sp.filter((x) => x != null))) }
}
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null }
const out = {}
for (const vp of VPS) {
  const R = JSON.parse(fs.readFileSync(path.join(DIR, `zoom-${vp}.json`), 'utf8'))
  const rows = []
  for (const who of ['v2', 'codex']) {
    for (const a of R[who]?.areas ?? []) {
      const pr = who === 'v2' ? a.panelRight : a.panel?.right
      const m = await magenta(path.join(DIR, `${who}-${vp}-${a.id}-mask-vis.png`), pr)
      const shownPx = m ? m.n : null
      rows.push({
        who, id: a.id,
        distBefore: a.distBefore, distAfter: a.distAfter, distCutPct: a.distCutPct, camMove: a.camMove, camTurnDeg: a.camTurnDeg,
        pitchAfterDeg: a.pitchAfterDeg,
        visHBefore: a.visHeightPctBefore, visHAfter: a.visHeightPctAfter, visWAfter: a.visWidthPctAfter,
        fullHAfter: a.heightPctAfter,
        shownHAfter: m ? r1(m.heightPct) : null,
        hidden3DPct: a.hiddenBy3DPct, blockers: a.blockers ?? null,
        chromeHiddenPct: a.visPixels ? r1(100 * (1 - shownPx / a.visPixels)) : null,
        rawChromeDiffPct: a.chromeCoverPct,
        underPanelPct: a.underPanelPct, inPanelFadePct: a.inPanelFadePct ?? null,
        visX: a.visSilhouette ? [a.visSilhouette.minX, a.visSilhouette.maxX] : null,
        visY: a.visSilhouette ? [a.visSilhouette.minY, a.visSilhouette.maxY] : null,
        panelRight: pr ?? null,
        flight: who === 'v2' ? { T: a.flight?.TmedianS, arrive: a.flight?.arrivalSceneMs, snapsIn: a.flight?.motionIn?.snaps?.length, snapsOut: a.flight?.motionOut?.snaps?.length, rawSnapsIn: a.flight?.motionIn?.snaps, speedIn: speedSnaps(a.flight?.motionIn?.steps), speedOut: speedSnaps(a.flight?.motionOut?.steps), maxDp: r1(1000 * (a.flight?.motionIn?.maxDp ?? 0)) / 1000, pRev: a.flight?.motionIn?.pReversals, pJumps: a.flight?.motionIn?.pJumps?.length } : { settle90: a.settle10pctSceneMs, settle99: a.settle1pctSceneMs },
        unpark: a.unpark ? { scrollExact: a.unpark.scrollExact, camUnits: a.unpark.cameraReturn?.units, camDeg: a.unpark.cameraReturn?.deg } : null,
        depthFor: a.depthFor ?? null, depth: a.depth, atStop: a.atStop ?? false,
        visibleAtRailPct: a.visibleAtRailPct ?? null,
        rail: a.rail ? { chromeHiddenPct: a.rail.chromeHiddenPct, inNextOrDockPct: a.rail.inNextOrDockPct, inNextPct: a.rail.inNextPct, inDockPct: a.rail.inDockPct, visBBox: a.rail.visBBox, over: a.rail.over } : null,
        agHiddenPct: a.aboveGround?.hiddenPct ?? null, agBuriedPct: a.aboveGround?.buriedPct ?? null, agBlockers: a.aboveGround?.blockers ?? null,
        offFramePct: a.aboveGround?.offFrame?.offPct ?? null, offFrame: a.aboveGround?.offFrame ?? null,
        settle: a.settle ?? null,
      })
    }
  }
  const astraBar = median(rows.filter((r) => r.who === 'codex').map((r) => r.visHAfter))
  const bar = Math.max(22, astraBar ?? 0)
  for (const r of rows.filter((x) => x.who === 'v2')) {
    const c = rows.find((x) => x.who === 'codex' && x.id === r.id)
    r.astraVisHAfter = c ? c.visHAfter : null
    r.astraDistCutPct = c ? c.distCutPct : null
    r.pass = {
      height: r.visHAfter >= bar,
      distance: r.distCutPct >= 55,
      fullyVisible: (r.hidden3DPct ?? 100) <= 2 && (r.chromeHiddenPct ?? 100) <= 2,
      clearOfPanel: (r.underPanelPct ?? 100) === 0 && r.visX && r.visX[0] >= (r.panelRight ?? 420),
      fullyVisibleAboveGround: r.agHiddenPct != null ? r.agHiddenPct <= 2 && (r.chromeHiddenPct ?? 100) <= 2 : null,
      railClearOfNextDock: r.rail ? (r.rail.inNextOrDockPct ?? 100) <= 1 : null,
    }
  }
  out[vp] = { astraMedianVisH: astraBar, heightBar: bar, source: R.sourceAtStart, sourceChanged: JSON.stringify(R.sourceAtStart) !== JSON.stringify(R.sourceAtEnd), errors: { v2: R.v2?.errors ?? [], codex: R.codex?.errors ?? [], api: R.v2?.api ?? [] }, rows }
  console.log(`\n== ${vp}  Astra median visible height ${astraBar}%  -> bar ${bar}%  (source changed during run: ${out[vp].sourceChanged})`)
  console.log('who   id  dist b->a (cut%)   move/turn   visH b->a  shownH  W%   hid3D chromeHid underPanel  x-range      pass(h,d,vis,panel)')
  for (const r of rows) {
    const p = r.pass ? `${+r.pass.height}${+r.pass.distance}${+r.pass.fullyVisible}${+r.pass.clearOfPanel}` : ''
    if (r.who === 'v2') console.log(`      ${r.id} rail: chromeHid ${r.rail?.chromeHiddenPct}% next/dock ${r.rail?.inNextOrDockPct}% visAtRail ${r.visibleAtRailPct}% | AG hidden ${r.agHiddenPct}% buried ${r.agBuriedPct}% blockers ${JSON.stringify(r.agBlockers)} | offFrame ${r.offFramePct}% | s90 ${r.settle?.s90SceneMs} s99 ${r.settle?.s99SceneMs} done@300 ${r.settle?.distDonePctAt300}% @700 ${r.settle?.distDonePctAt700}% | pitch ${r.pitchAfterDeg} | depth ${r.depth}/${r.depthFor}`)
    console.log(`${r.who.padEnd(5)} ${r.id}  ${String(r.distBefore).padStart(6)}->${String(r.distAfter).padEnd(6)} (${String(r.distCutPct).padStart(5)})  ${String(r.camMove).padStart(6)}/${String(r.camTurnDeg).padEnd(5)} ${String(r.visHBefore).padStart(5)}->${String(r.visHAfter).padEnd(5)} ${String(r.shownHAfter).padStart(5)} ${String(r.visWAfter).padStart(5)} ${String(r.hidden3DPct).padStart(5)} ${String(r.chromeHiddenPct).padStart(6)} ${String(r.underPanelPct).padStart(6)}   ${JSON.stringify(r.visX).padEnd(12)} ${p}`)
  }
}
fs.writeFileSync(path.join(DIR, 'zoom-summary.json'), JSON.stringify(out, null, 2))
await browser.close()
