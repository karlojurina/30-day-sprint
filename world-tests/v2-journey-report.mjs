/**
 * Turn the journey JSONs into checks. Reads what v2-journey.mjs wrote; renders
 * nothing. Prints a table and writes journey-report.json next to the inputs.
 *
 *   node world-tests/v2-journey-report.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'journey')
const load = (f) => (fs.existsSync(path.join(DIR, f)) ? JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) : null)

const out = { checks: [], lum: {} }
const add = (id, result, measured, evidence, extra = {}) => out.checks.push({ id, result, measured, evidence, ...extra })
const max = (a) => (a.length ? Math.max(...a) : null)
const min = (a) => (a.length ? Math.min(...a) : null)

for (const vp of ['split', 'ultra', 'laptop']) {
  const R = load(`v2-journey-${vp}.json`)
  if (!R) continue
  const F = [R.default, ...R.frames]
  const sweep = R.frames.filter((f) => f.idx !== null)
  const stops = Object.values(R.stops)
  const pre = `${vp}.`

  // Integrity of the run itself.
  const changed = Object.keys(R.hashesStart).filter((k) => JSON.stringify(R.hashesStart[k]) !== JSON.stringify(R.hashesEnd[k]))
  add(pre + 'run.sourceStable', changed.length || R.reacquired || R.navigations > 2 ? 'warn' : 'pass',
    `frames ${F.length} (default + ${sweep.length} sweep + ${stops.length} stops); v2 files changed during run: ${changed.join(', ') || 'none'}; scene re-acquired ${R.reacquired}x; navigations ${R.navigations}`,
    `v2-journey-${vp}.json hashesStart/hashesEnd`)
  add(pre + 'run.consoleAndApi', R.errors.length || R.api.length ? 'fail' : 'pass', `console errors ${R.errors.length}, /api/ requests ${R.api.length}${R.errors.length ? ': ' + R.errors.slice(0, 3).join(' | ') : ''}`, `v2-journey-${vp}.json errors/api`)

  // Camera vs terrain and objects.
  const clr = F.map((f) => f.cam.clearance)
  const worstClr = F.reduce((a, f) => (f.cam.clearance < a.cam.clearance ? f : a))
  add(pre + 'cam.clearance', min(clr) >= 8 ? 'pass' : min(clr) >= 2 ? 'warn' : 'fail', `min clearance above ground/sea ${min(clr)} u at depth ${worstClr.depth.toFixed(4)} (max ${max(clr)})`, worstClr.file)
  const nearMin = min(F.map((f) => f.cam.nearPlaneMinClearance))
  add(pre + 'cam.nearPlane', nearMin >= 1 ? 'pass' : 'fail', `min near-plane corner clearance ${nearMin} u`, `v2-journey-${vp}.json frames[].cam.nearPlaneMinClearance`)
  const gr = F.filter((f) => f.cam.groundRayMin !== null)
  const worstG = gr.reduce((a, f) => (f.cam.groundRayMin < a.cam.groundRayMin ? f : a))
  add(pre + 'cam.groundRays', worstG.cam.groundRayMin >= 20 ? 'pass' : worstG.cam.groundRayMin >= 8 ? 'warn' : 'fail',
    `nearest terrain/sea hit over a 32x18 ray grid: ${worstG.cam.groundRayMin} u at depth ${worstG.depth.toFixed(4)} px ${worstG.cam.groundRayMinAtPx}; rays under 30 u in any frame: ${max(F.map((f) => f.cam.groundRaysUnder30))}`, worstG.file)
  const objHits = F.filter((f) => f.cam.objectRayMin !== null)
  const worstO = objHits.length ? objHits.reduce((a, f) => (f.cam.objectRayMin < a.cam.objectRayMin ? f : a)) : null
  add(pre + 'cam.objectRays', !worstO || worstO.cam.objectRayMin >= 15 ? 'pass' : worstO.cam.objectRayMin >= 5 ? 'warn' : 'fail',
    worstO ? `nearest object hit ${worstO.cam.objectRayMin} u (${worstO.cam.objectRayMinName}) at depth ${worstO.depth.toFixed(4)}` : 'no object within 80 u of the camera in any frame (24x14 raycast grid)', worstO ? worstO.file : `v2-journey-${vp}.json`)
  const inside = F.filter((f) => f.cam.insideBoxes.length)
  add(pre + 'cam.insideObject', inside.length ? 'fail' : 'pass', inside.length ? inside.map((f) => `${f.depth.toFixed(3)}: ${f.cam.insideBoxes.join(',')}`).join('; ') : 'camera inside no object box in any frame', `v2-journey-${vp}.json frames[].cam.insideBoxes`)
  const pitch = F.map((f) => f.cam.pitchDeg)
  add(pre + 'cam.pitch', 'pass', `pitch ${min(pitch)}..${max(pitch)} deg down; camera height above ground ${min(clr)}..${max(clr)} u`, `v2-journey-${vp}.json`, { info: true })

  // Markers.
  const pinErr = []
  const anchorErr = []
  const offBbox = []
  const occluded = []
  for (const f of F) for (const l of f.landmarks) {
    if (l.mode === 'hidden' || l.mode === undefined) continue
    if (l.pinErr !== undefined) pinErr.push(l.pinErr)
    if (l.anchorErr !== undefined) anchorErr.push(l.anchorErr)
    if (l.pinInsideBboxX === false) offBbox.push(`${f.depth.toFixed(3)} ${l.id}`)
    if (l.los !== undefined && l.los < 0.15) occluded.push(`d${f.depth.toFixed(3)} ${l.id}:${l.mode} los ${l.los}`)
  }
  add(pre + 'markers.domMatchesScene', max(pinErr) <= 1.5 ? 'pass' : 'fail', `max |DOM pin centre - scene marker| ${max(pinErr)} px over ${pinErr.length} shown markers`, `v2-journey-${vp}.json frames[].landmarks[].pinErr`)
  add(pre + 'markers.projectedAnchor', max(anchorErr) <= 1 && !offBbox.length ? 'pass' : 'fail', `max |marker - (projected landmark top - 26 px)| ${max(anchorErr)} px; pins outside their landmark's screen x-span: ${offBbox.length}${offBbox.length ? ' ' + offBbox.slice(0, 6).join(', ') : ''}`, `v2-journey-${vp}.json frames[].landmarks[].anchorErr`)
  // A shown pin that lands inside ANOTHER landmark's screen box (inset 10%), while that
  // landmark is visible: the label reads as naming the wrong place.
  const onOther = []
  const hiddenInMiddle = []
  for (const f of F) {
    for (const l of f.landmarks) {
      if (l.mode === 'hidden' && l.bbox && l.bboxInFrame > 0.9 && l.los > 0.5 && l.dist < 1500) hiddenInMiddle.push(`d${f.depth.toFixed(3)} ${l.id}`)
      if (!l.pin || l.mode === 'hidden') continue
      for (const o of f.landmarks) {
        if (o.id === l.id || !o.bbox || o.los < 0.3) continue
        const [x0, y0, x1, y1] = o.bbox
        const ix = (x1 - x0) * 0.1, iy = (y1 - y0) * 0.1
        if (l.pin[0] > x0 + ix && l.pin[0] < x1 - ix && l.pin[1] > y0 + iy && l.pin[1] < y1 - iy) onOther.push(`d${f.depth.toFixed(3)} ${l.id}:${l.mode} pin on ${o.id}${o.mode === 'hidden' ? ' (whose own marker is hidden)' : ''}`)
      }
    }
  }
  add(pre + 'markers.pinOnOtherLandmark', onOther.some((x) => x.includes('whose own marker is hidden')) ? 'fail' : onOther.length ? 'warn' : 'pass', onOther.length ? `${onOther.length} marker-frames: ${[...new Set(onOther)].slice(0, 10).join('; ')}` : 'no pin lands on another landmark', `v2-${vp}-default.png, v2-journey-${vp}.json frames[].landmarks`)
  add(pre + 'markers.visibleLandmarkUnmarked', hiddenInMiddle.length ? 'warn' : 'pass', hiddenInMiddle.length ? `${hiddenInMiddle.length} frames where a landmark fully in frame, in clear line of sight and under 1500 u away has no marker at all: ${hiddenInMiddle.slice(0, 12).join(', ')}` : 'every clear, in-frame landmark under 1500 u has a label or dot', `v2-journey-${vp}.json frames[].landmarks[].mode`)
  add(pre + 'markers.onHiddenLandmark', occluded.length ? 'warn' : 'pass', occluded.length ? `${occluded.length} marker-frames show a pin for a landmark the terrain hides (line of sight < 15%): ${occluded.slice(0, 8).join('; ')}` : 'no shown marker points at a terrain-hidden landmark', `v2-journey-${vp}.json frames[].landmarks[].los`)

  // Own stop: silhouette, marker on it, chrome cover.
  const ownRows = []
  let ownWorst = 'pass'
  let markerWorst = 'pass'
  const markerRows = []
  for (const [id, f] of Object.entries(R.stops)) {
    const own = f.compose.own
    const lm = f.landmarks.find((l) => l.id === id)
    const cov = own.coveredShare ?? 0
    const res = !own.n ? 'fail' : cov > 0.1 ? 'fail' : cov > 0 ? 'warn' : 'pass'
    if (res === 'fail' || (res === 'warn' && ownWorst === 'pass')) ownWorst = res
    ownRows.push(`${id} ${own.n}px covered ${(cov * 100).toFixed(1)}%${Object.keys(own.covered).length ? ' by ' + Object.entries(own.covered).map(([k, v]) => `${k} ${v}px`).join('+') : ''}`)
    // Marker vs the rendered silhouette: x inside its span, y = silhouette top - 26 (+-12).
    let mres = 'pass'
    let note = `${id}:${lm.mode}`
    if (lm.mode === 'hidden') mres = 'fail'
    else if (lm.mode === 'dot') mres = 'warn'
    if (lm.pin && own.bbox) {
      const dx = lm.pin[0] < own.bbox[0] - 2 || lm.pin[0] > own.bbox[2] + 2
      const dy = lm.pin[1] + 26 - own.topY
      note += ` pin (${lm.pin.map(Math.round)}) silhouette x ${own.bbox[0]}..${own.bbox[2]} top ${own.topY} -> dy ${dy.toFixed(0)}px`
      if (dx || Math.abs(dy) > 12) mres = 'fail'
    }
    if (mres === 'fail' || (mres === 'warn' && markerWorst === 'pass')) markerWorst = mres
    markerRows.push(note)
  }
  add(pre + 'chrome.ownLandmarkAtOwnStop', ownWorst, ownRows.join('; '), `v2-${vp}-stop-<id>-mask.png, v2-${vp}-stops-mask-sheet.png`)
  // Where the own landmark sits vertically at its own stop (rendered silhouette, % of frame height).
  const H = R.viewport.height
  const vRows = []
  let low = 0
  for (const [id, f] of Object.entries(R.stops)) {
    const o = f.compose.own
    if (!o.bbox) continue
    const top = o.bbox[1] / H, bot = o.bbox[3] / H, cy = o.cy / H
    if (bot > 0.85) low++
    vRows.push(`${id} top ${(top * 100).toFixed(0)}% centre ${(cy * 100).toFixed(0)}% base ${(bot * 100).toFixed(0)}% (${(o.share * 100).toFixed(2)}% of frame, ${f.landmarks.find((l) => l.id === id).dist} u away, camera ${f.cam.clearance} u above ground, pitch ${f.cam.pitchDeg} deg)`)
  }
  add(pre + 'framing.ownLandmarkAtOwnStop', low >= 3 ? 'fail' : low ? 'warn' : 'pass', `${low}/8 stops put the area's own landmark base in the bottom 15% of the frame (the chrome band): ` + vRows.join('; '), `v2-${vp}-stops-mask-sheet.png`)
  const HPs = load(`holes-and-pins-${vp}.json`)
  if (HPs && HPs.stops.length) {
    let w = 'pass'
    const rows = HPs.stops.map((r) => {
      const res = r.mode === 'hidden' || r.gapPx === null || r.gapPx < 0 || (r.labelPixelsOverLandmark ?? 0) > 200 ? 'fail' : r.gapPx < 10 || r.mode === 'dot' || (r.labelPixelsOverLandmark ?? 0) > 0 ? 'warn' : 'pass'
      if (res === 'fail' || (res === 'warn' && w === 'pass')) w = res
      return `${r.id}:${r.mode} gap ${r.gapPx}px${r.labelPixelsOverLandmark ? ` label covers ${r.labelPixelsOverLandmark}px of it` : ''}`
    })
    add(pre + 'markers.ownStopOnSilhouette', w, 'pin centre to silhouette top in the pin column: ' + rows.join('; '), `holes-and-pins-${vp}.json, v2-${vp}-stop-<id>-mask.png (yellow ring = pin)`)
  } else add(pre + 'markers.ownStopOnSilhouette', markerWorst, markerRows.join('; '), `v2-${vp}-stop-<id>-mask.png (yellow ring = pin)`)

  // Labels.
  const ov = F.filter((f) => f.labelOverlaps.length)
  const off = F.filter((f) => f.labelsOffscreen.length)
  const onC = F.filter((f) => f.labelsOnChrome.length)
  add(pre + 'labels.overlap', ov.length ? 'fail' : 'pass', ov.length ? ov.map((f) => `${f.depth.toFixed(3)}: ${f.labelOverlaps.join(',')}`).slice(0, 6).join('; ') : `0 overlaps in ${F.length} frames (text labels and dots)`, `v2-journey-${vp}.json frames[].labelOverlaps`)
  add(pre + 'labels.offscreen', off.length ? 'fail' : 'pass', off.length ? off.map((f) => `${f.depth.toFixed(3)}: ${f.labelsOffscreen.join(',')}`).slice(0, 6).join('; ') : `0 labels or dots outside the viewport in ${F.length} frames`, `v2-journey-${vp}.json frames[].labelsOffscreen`)
  add(pre + 'labels.onChrome', onC.length ? 'fail' : 'pass', onC.length ? onC.map((f) => `${f.depth.toFixed(3)}: ${f.labelsOnChrome.join(',')}`).slice(0, 6).join('; ') : `0 labels or dots over the header/NEXT/dock/footer in ${F.length} frames`, `v2-journey-${vp}.json frames[].labelsOnChrome`)
  const textCounts = F.map((f) => f.labels.filter((l) => l.kind === 'text').length)
  add(pre + 'labels.count', 'pass', `text labels per frame ${min(textCounts)}..${max(textCounts)}`, `v2-journey-${vp}.json`, { info: true })

  // Rendering faults.
  const holes = F.filter((f) => f.compose.holes > 0)
  const HP = load(`holes-and-pins-${vp}.json`)
  const owned = HP ? HP.holes.every((h) => !h.black || Object.values(h.owner).reduce((a, b) => Math.max(a, b), 0) === h.black) : false
  add(pre + 'render.holes', !holes.length || owned ? 'pass' : 'fail',
    holes.length
      ? `pure-black (0,0,0) pixels in ${holes.length}/${F.length} frames, max ${max(holes.map((f) => f.compose.holes))}px; ${HP ? `owner probe at ${HP.holes.map((h) => h.depth.toFixed(3)).join(', ')}: ${HP.holes.map((h) => JSON.stringify(h.owner)).join(' ')} -> ${owned ? 'every one is a tree face crushed to black, not a hole' : 'some are not owned by any object (real holes)'}` : 'no owner probe run'}`
      : `0 pure clear-colour pixels in ${F.length} world-only frames`,
    HP ? `holes-and-pins-${vp}.json, holes-${vp}-*-crop.png` : `v2-journey-${vp}.json frames[].compose.holes`)
  const zf = stops.filter((f) => f.zfight)
  const zBad = zf.filter((f) => f.zfight.core > 150)
  add(pre + 'render.zfight', zBad.length ? 'warn' : 'pass', `patch flicker under a 0.03-unit camera move (5x5-eroded changed pixels): ${zf.map((f) => `${f.stop} ${f.zfight.core}`).join(', ')}; nondeterministic bytes ${max(zf.map((f) => f.zfight.nondeterministicBytes))}`, zBad.map((f) => f.zfight.file).join(', ') || `v2-journey-${vp}.json stops.*.zfight`)
  const pops = R.pops.filter((p) => p.n > 0)
  add(pre + 'render.lodPops', pops.some((p) => p.share > 0.005) ? 'warn' : 'pass', `${R.pops.length} tree-slab detail swaps crossed; changed pixels per swap ${pops.map((p) => `${(p.share * 100).toFixed(2)}%`).join(', ') || '0'}`, `v2-journey-${vp}.json pops`)

  // Default view and the sea band.
  const d = R.default
  const seaRes = d.compose.seaBottomQShare > 0.5 ? 'fail' : d.compose.seaBottomQShare > 0.2 ? 'warn' : 'pass'
  add(pre + 'default.seaBand', seaRes,
    `camera at z ${d.cam.z}, over terrain: ${d.cam.overTerrain} (terrain ends at z ${R.setup.terrainBounds.maxZ}); Sea covers ${(d.compose.seaShare * 100).toFixed(1)}% of the frame and ${(d.compose.seaBottomQShare * 100).toFixed(1)}% of the bottom quarter; bottom-quarter luma ${d.compose.world.bottomQ.mean} (std ${d.compose.world.bottomQ.std}) rgb ${d.compose.world.bottomQ.rgb}; land edge y p10/p50/p90 ${d.compose.seaTopY ? [d.compose.seaTopY.p10, d.compose.seaTopY.p50, d.compose.seaTopY.p90].join('/') : '-'}`,
    `v2-${vp}-default.png, v2-${vp}-default-mask-a1.png`)
  const seaFrames = sweep.filter((f) => f.compose.seaBottomQShare > 0.2).map((f) => `${f.depth.toFixed(3)} ${(f.compose.seaBottomQShare * 100).toFixed(0)}%`)
  add(pre + 'sweep.seaBand', seaFrames.length > 1 ? 'fail' : seaFrames.length ? 'warn' : 'pass', seaFrames.length ? `sea over 20% of the bottom quarter at: ${seaFrames.join(', ')}` : 'sea under 20% of the bottom quarter everywhere past depth 0', `v2-${vp}-sweep-sheet.png`)

  // a8.
  const a8 = R.stops.a8
  if (a8) {
    add(pre + 'a8.composition', a8.compose.skyShare + a8.compose.ridgeShare > 0.55 ? 'warn' : 'pass',
      `sky ${(a8.compose.skyShare * 100).toFixed(1)}% + ridge cards ${(a8.compose.ridgeShare * 100).toFixed(1)}% of the frame; obelisk ${a8.compose.own.n}px; luma mean ${a8.compose.world.mean}; floaters in view ${a8.floatersInView.length}`,
      `v2-${vp}-stop-a8.png, v2-${vp}-stop-a8-mask.png`)
  }
  const skyMax = sweep.reduce((a, f) => (f.compose.skyShare > a.compose.skyShare ? f : a))
  const ridgeMax = sweep.reduce((a, f) => (f.compose.ridgeShare > a.compose.ridgeShare ? f : a))
  add(pre + 'sweep.skyAndRidges', 'pass', `sky share ${min(sweep.map((f) => f.compose.skyShare))}..${skyMax.compose.skyShare} (max at ${skyMax.depth.toFixed(3)}); ridge-card share max ${ridgeMax.compose.ridgeShare} at ${ridgeMax.depth.toFixed(3)}`, skyMax.file, { info: true })
  const floatV = stops.filter((f) => f.floatersInView.length).map((f) => `${f.stop}: ${f.floatersInView.length}`)
  add(pre + 'stops.floatersInView', floatV.length ? 'warn' : 'pass', floatV.length ? `floating rocks/trees (asset check) in frame within 900 u: ${floatV.join(', ')}` : 'no floating asset in view at any stop', `v2-journey-${vp}.json stops.*.floatersInView`)

  // Asset level (split carries the extra probes).
  if (R.asset && vp === 'split') {
    const rocks = R.asset.rocks
    add('asset.rocksFloat', rocks.length ? 'warn' : 'pass', `${rocks.length}/${R.asset.rockCount} rocks leave a gap on the downhill side (bottom above the lowest ground under the footprint by >1 u): ${rocks.map((r) => `(${r.x},${r.z}) gap ${r.gapLow} d${r.depth}`).join('; ')}`, 'v2-journey-split.json asset.rocks, closeup-obelisk-rocks.png')
    const trees = R.asset.trees
    add('asset.treesFloat', trees.length ? 'warn' : 'pass', `${trees.length}/${R.asset.treeCount} trees with trunk base above the ground at their origin by >0.3 u, max ${max(trees.map((t) => t.gap))} u; nearest-rail depths ${[...new Set(trees.map((t) => t.depth.toFixed(2)))].join(',')}`, 'v2-journey-split.json asset.trees')
    if (R.piers) {
      const b = R.piers.bridge
      const hung = b.bins.filter((x) => x.gap > 1)
      add('asset.bridgePiers', hung.length ? 'fail' : 'pass', `LM_Bridge posts bottom at y ${b.medianMinY}; ground under them ${min(b.bins.map((x) => x.groundMin))}..${max(b.bins.map((x) => x.groundMax))}; ${hung.length} of ${b.bins.length} 2-unit columns end >1 u above ground: ${hung.map((x) => `x${x.x} gap ${x.gap}`).join(', ')}`, 'closeup-bridge-oblique.png, closeup-bridge-side.png')
      const v = R.piers.viaduct
      const vh = v.bins.filter((x) => x.minY < 40 && x.gap > 1)
      add('asset.viaductPiers', vh.length ? 'fail' : 'pass', `LM_Viaduct piers bottom at y ${v.medianMinY}; ground under them ${min(v.bins.map((x) => x.groundMin))}..${max(v.bins.map((x) => x.groundMax))}; columns ending above ground: ${vh.length}`, 'closeup-viaduct-side.png, closeup-viaduct-oblique.png')
    }
    if (R.inside) {
      for (const r of R.inside.filter(Boolean)) {
        if (r.a.startsWith('House') && r.inside === 0) continue
        add(`asset.inside.${r.a}`, r.inside ? 'fail' : 'pass', `${r.inside}/${r.sampled} sampled vertices of ${r.a} lie inside ${r.b} (ray parity, 3 axes)`, r.a.includes('Blades') ? 'closeup-windmill.png' : 'closeup-lighthouse-plinth.png')
      }
    }
    if (R.snapCheck) add('run.snapEquivalence', R.snapCheck.posDelta < 1e-6 && R.snapCheck.pixelsDiffering === 0 ? 'pass' : 'warn', `snapped vs naturally glided frame at depth 0.30: camera delta ${R.snapCheck.posDelta}, pixels differing ${R.snapCheck.pixelsDiffering}`, 'v2-journey-split.json snapCheck')
  }

  // Luminance, informational.
  const C = load(`codex-journey-${vp}.json`)
  const rows = sweep.map((f) => {
    const c = C ? C.frames.find((x) => x.idx === f.idx) : null
    return { i: f.idx, v2Depth: +f.depth.toFixed(4), v2: f.lum, codexDepth: c ? c.depth : null, codex: c ? c.lum : null }
  })
  out.lum[vp] = {
    rows,
    stops: {
      v2: Object.fromEntries(Object.entries(R.stops).map(([k, f]) => [k, f.lum])),
      codex: C ? Object.fromEntries(C.frames.filter((f) => f.stop).map((f) => [f.stop, f.lum])) : null,
    },
  }
  const avg = (xs) => (xs.length ? +(xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(2) : null)
  const v2L = rows.map((r) => r.v2)
  const cxL = rows.filter((r) => r.codex).map((r) => r.codex)
  const summ = (L) => L.length ? `mean ${avg(L.map((l) => l.mean))}, p5 ${avg(L.map((l) => l.p5))}, p95 ${avg(L.map((l) => l.p95))}, below mid-grey ${avg(L.map((l) => l.belowMid))}` : 'n/a'
  add(pre + 'lum.v2VsAstra', 'pass', `over ${rows.length} matched scroll fractions: v2 ${summ(v2L)}; Astra ${summ(cxL)}`, `journey-report.json lum.${vp}`, { info: true })
}

fs.writeFileSync(path.join(DIR, 'journey-report.json'), JSON.stringify(out, null, 1))
for (const c of out.checks) console.log(`${c.result.toUpperCase().padEnd(4)} ${c.id.padEnd(40)} ${c.measured}`)
