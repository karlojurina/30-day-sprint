/**
 * Round 1 verify: Lovro's points that need the real page, at 1691x1278 on the GPU.
 *
 *   node world-tests/v6-r1-verify-look.mjs [picks] [a3park] [bridge] [stars]   (default: all)
 *
 * picks   at each stop, an ID pass finds the landmark's drawn pixels; the
 *         scene's pickAnchor() is asked at the pixel nearest the landmark's
 *         centre and at 8 edge points (the silhouette's extreme in 8
 *         directions, stepped 3 px inside); then a real mouse click at the
 *         centre must park the camera at that place (Escape back).
 * a3park  the Video Ads I click-in view, rendered.
 * bridge  named frames from a7 to the bridge head: screenshot plus the sky
 *         share (sky dome, stars, clouds and the Gate cloud bank count as sky).
 * stars   the constellation meshes' visibility on the rail and in the telescope.
 *
 * Frames are named (stopDepths, layout ROUTE_MARKS), never raw KEYS indices.
 * Out: world-tests/shots/v6/round1/verify/look/*.png, look.json.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve("world-tests/shots/v6/round1/verify/look");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const want = (k) => argv.length === 0 || argv.includes(k);
const W = 1691;
const H = 1278;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LM = { a1: "LM_Signpost", a2: "LM_Lookout", a3: "LM_Waterfall", a4: "LM_TrailHut", a5: "LM_Boathouse", a6: "LM_GreatTree", a7: "LM_Observatory", a8: "LM_StoneArch" };

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
const api = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warn") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: W, height: H });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await page.evaluate(() => window.__worldTune && window.__worldTune({ lock: "open", frontier: 7, finished: 7, partial: 0 }));
await sleep(1800);

async function settle(n = 4) {
  await page.evaluate(async (n) => {
    const c0 = window.__worldFrameCount ?? 0;
    const t = performance.now();
    while ((window.__worldFrameCount ?? 0) < c0 + n && performance.now() - t < 15000) await new Promise((r) => setTimeout(r, 50));
  }, n);
}
async function goDepth(d) {
  await page.mouse.move(2, H / 2);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await sleep(250);
  await settle(5);
}

// The ID pass, installed once: returns class counts and, for the landmark,
// its centre and edge points in CSS px. Classes: sky 0 (nothing drawn once the
// sky, stars, clouds and the Gate bank are hidden), landmark 6, other 7.
await page.evaluate(() => {
  window.__idPass = (lmName) => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const camera = sc.camera;
    let SM = null;
    scene.traverse((o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!SM && m && m.isShaderMaterial && m.type === "ShaderMaterial") SM = m.constructor;
    });
    const vs = `void main() {
      #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      #else
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      #endif
      gl_Position = projectionMatrix * mv; }`;
    const fsh = `uniform float uClass; void main() { gl_FragColor = vec4( uClass / 255.0, 0.0, 0.0, 1.0 ); }`;
    const mats = new Map();
    const matFor = (c, side) => {
      const k = `${c}-${side}`;
      if (!mats.has(k)) mats.set(k, new SM({ uniforms: { uClass: { value: c } }, vertexShader: vs, fragmentShader: fsh, side, fog: false, toneMapped: false }));
      return mats.get(k);
    };
    const SKY = new Set(["LightSky", "LightStars", "LightClouds", "CloudBillboards", "NightSky", "Sky_GateBank"]);
    const classOf = (o) => {
      for (let e = o; e; e = e.parent) {
        if (lmName && e.name === lmName) return 6;
        if (SKY.has(e.name)) return -1;
      }
      return 7;
    };
    const saved = [];
    scene.traverse((o) => saved.push([o, o.visible, o.material, o.onBeforeRender]));
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const c = classOf(o);
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      if (c < 0 || o.isPoints || o.isLine || o.isSprite || (m0 && m0.transparent && c !== 6)) {
        o.visible = false;
        return;
      }
      if (o.geometry && o.geometry.getAttribute && o.geometry.getAttribute("aP") && m0 && m0.isShaderMaterial) {
        const puff = new SM({
          uniforms: Object.assign({}, m0.uniforms, { uClass: { value: c } }),
          defines: Object.assign({}, m0.defines),
          vertexShader: m0.vertexShader,
          fragmentShader: m0.fragmentShader.replace(/void\s+main\s*\(\s*\)/, "void puffMain_()") + "\nuniform float uClass;\nvoid main() { puffMain_(); if ( gl_FragColor.a < 0.3 ) discard; gl_FragColor = vec4( uClass / 255.0, 0.0, 0.0, 1.0 ); }",
          side: m0.side,
          fog: false,
          toneMapped: false,
        });
        mats.set(`puff-${o.uuid}`, puff);
        o.material = puff;
        return;
      }
      // Shader-moved landmark geometry (the falls' curtain) keeps its own
      // vertex shader so the ID matches what is drawn.
      if (c === 6 && m0 && m0.isShaderMaterial && m0.type === "ShaderMaterial") {
        const own = new SM({
          uniforms: Object.assign({}, m0.uniforms, { uClass: { value: c } }),
          defines: Object.assign({}, m0.defines),
          vertexShader: m0.vertexShader,
          fragmentShader: "uniform float uClass;\nvoid main() { gl_FragColor = vec4( uClass / 255.0, 0.0, 0.0, 1.0 ); }",
          side: m0.side,
          fog: false,
          toneMapped: false,
        });
        mats.set(`own-${o.uuid}`, own);
        o.material = own;
        return;
      }
      o.material = matFor(c, m0 ? m0.side : 0);
      if (o.name === "MirrorLake") o.onBeforeRender = () => {};
    });
    const gl = renderer.getContext();
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    const lake = scene.getObjectByName("MirrorLake");
    let rt = sc.__verifyRT;
    if (!rt || rt.width !== bw || rt.height !== bh) {
      rt = new (lake.getRenderTarget().constructor)(bw, bh, { samples: 0, depthBuffer: true });
      sc.__verifyRT = rt;
    }
    const clearCol = fog ? fog.color.clone() : null;
    if (clearCol) renderer.getClearColor(clearCol);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    let fail = null;
    try {
      renderer.render(scene, camera);
    } catch (e) {
      fail = String(e);
    }
    const id = new Uint8Array(bw * bh * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, bw, bh, id);
    renderer.setRenderTarget(null);
    if (clearCol) renderer.setClearColor(clearCol, clearAlpha);
    for (const [o, v, m, obr] of saved) {
      o.visible = v;
      if (m !== undefined) o.material = m;
      o.onBeforeRender = obr;
    }
    scene.background = bg;
    scene.fog = fog;
    for (const m of mats.values()) m.dispose();
    let sky = 0;
    let lmN = 0;
    let sx = 0;
    let sy = 0;
    const cls = (x, y) => id[((bh - 1 - y) * bw + x) * 4];
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const c = cls(x, y);
        if (c === 0) sky++;
        else if (c === 6) {
          lmN++;
          sx += x;
          sy += y;
        }
      }
    const toCss = bw / window.innerWidth;
    const res = { fail, bw, bh, skyPct: +((100 * sky) / (bw * bh)).toFixed(1), lmPct: +((100 * lmN) / (bw * bh)).toFixed(2) };
    if (lmN) {
      const cx = sx / lmN;
      const cy = sy / lmN;
      // Landmark pixel nearest the centroid.
      let best = null;
      let bd = Infinity;
      // Extremes in 8 directions.
      const dirs = [];
      for (let k = 0; k < 8; k++) dirs.push([Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4), -Infinity, null]);
      for (let y = 0; y < bh; y += 2)
        for (let x = 0; x < bw; x += 2) {
          if (cls(x, y) !== 6) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bd) {
            bd = d;
            best = [x, y];
          }
          for (const dr of dirs) {
            const p = (x - cx) * dr[0] + (y - cy) * dr[1];
            if (p > dr[2]) {
              dr[2] = p;
              dr[3] = [x, y];
            }
          }
        }
      // Step each edge point 3 CSS px toward the centroid, staying on the landmark.
      const edges = dirs.map((dr) => {
        let [x, y] = dr[3];
        const L = Math.hypot(cx - x, cy - y) || 1;
        const step = 3 * toCss;
        const nx = x + ((cx - x) / L) * step;
        const ny = y + ((cy - y) / L) * step;
        if (cls(Math.round(nx), Math.round(ny)) === 6) {
          x = nx;
          y = ny;
        }
        return [+(x / toCss).toFixed(1), +(y / toCss).toFixed(1)];
      });
      res.centroid = [+(cx / toCss).toFixed(1), +(cy / toCss).toFixed(1)];
      res.centre = [+(best[0] / toCss).toFixed(1), +(best[1] / toCss).toFixed(1)];
      res.edges = edges;
    }
    renderer.render(scene, camera);
    return res;
  };
});

const report = { when: new Date().toISOString() };
const stops = await page.evaluate(() => window.__worldV6Debug.stopDepths());

if (want("picks")) {
  report.picks = [];
  for (let i = 0; i < 8; i++) {
    const idp = "a" + (i + 1);
    await goDepth(stops[i]);
    const r = await page.evaluate((lm) => window.__idPass(lm), LM[idp]);
    const row = { id: idp, lm: LM[idp], lmPct: r.lmPct, centre: r.centre, centroid: r.centroid };
    if (r.centre) {
      const pts = [r.centre, ...r.edges];
      const got = await page.evaluate((pts) => pts.map(([x, y]) => window.__worldV6Debug.pickAnchor(x, y)), pts);
      row.centreHit = got[0];
      row.edgeHits = got.slice(1);
      row.edges = r.edges;
      row.edgeOk = got.slice(1).filter((g) => g === idp).length;
      // Also the raw bounding-box centre / centroid (for the arch it is the opening).
      row.centroidHit = await page.evaluate(([x, y]) => window.__worldV6Debug.pickAnchor(x, y), r.centroid);
      // Real mouse: hover then click at the centre.
      const [x, y] = r.centre;
      await page.mouse.move(x - 20, y - 20);
      await page.mouse.move(x, y, { steps: 4 });
      await sleep(400);
      await settle(3);
      row.cursor = await page.evaluate(() => {
        const st = document.querySelector("[class*='stage']");
        return st ? getComputedStyle(st).cursor : null;
      });
      await page.screenshot({ path: path.join(OUT, `hover-${idp}.png`) });
      await page.mouse.click(x, y);
      try {
        await page.waitForFunction((id) => window.__worldFrame?.parkedId === id && window.__worldFrame.parkProgress > 0.98, { polling: 100, timeout: 12000 }, idp);
        row.clickParks = true;
      } catch {
        row.clickParks = await page.evaluate(() => ({ parked: window.__worldFrame?.parkedId, p: window.__worldFrame?.parkProgress }));
      }
      if (idp === "a3" && row.clickParks === true) {
        await sleep(600);
        await settle(3);
        await page.screenshot({ path: path.join(OUT, "park-a3.png") });
        row.parkCam = await page.evaluate(() => {
          const p = window.__worldV6Debug.cameraPose();
          return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), pitch: +p.pitch.toFixed(1) };
        });
        const inCave = await page.evaluate(() => {
          const sc = window.__worldV6Debug;
          return typeof sc.inCave === "function" ? sc.inCave() : null;
        });
        row.parkInCave = inCave;
      }
      await page.keyboard.press("Escape");
      try {
        await page.waitForFunction(() => window.__worldV6Debug.mode === "rail" && window.__worldFrame?.parkedId === null, { polling: 100, timeout: 15000 });
        row.escapeBack = true;
      } catch {
        row.escapeBack = false;
      }
    }
    console.log(JSON.stringify(row));
    report.picks.push(row);
  }
}

if (want("bridge")) {
  report.bridge = [];
  const frames = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const r = sc.debugRail();
    const L = sc.ctx.layout;
    const n = L.TRAIL.length;
    const sOfKey = (k) => {
      const t = k / (n - 1);
      let a = 0;
      let b = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        if (r.tAtS(m) < t) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    const M = L.ROUTE_MARKS;
    const a7 = sc.stopDepths()[6];
    const isl = r.depthOfS(sOfKey(M.island));
    const bh = r.depthOfS(sOfKey(M.bridgehead));
    const br = r.depthOfS(sOfKey(L.BRIDGE_KEYS.first));
    const lerp = (a, b, u) => a + (b - a) * u;
    return [
      ["a7", a7],
      ["a7-to-island-50", lerp(a7, isl, 0.5)],
      ["island", isl],
      ["island-to-bridgehead-33", lerp(isl, bh, 0.33)],
      ["island-to-bridgehead-66", lerp(isl, bh, 0.66)],
      ["bridgehead", bh],
      ["bridge-start", br],
    ];
  });
  for (const [name, d] of frames) {
    await goDepth(d);
    await page.screenshot({ path: path.join(OUT, `bridge-${name}.png`) });
    const r = await page.evaluate(() => window.__idPass(null));
    const cam = await page.evaluate(() => {
      const p = window.__worldV6Debug.cameraPose();
      return { pitch: +p.pitch.toFixed(1) };
    });
    const row = { name, depth: +d.toFixed(5), skyPct: r.skyPct, pitchBelow: cam.pitch };
    console.log(JSON.stringify(row));
    report.bridge.push(row);
  }
}

if (want("stars")) {
  report.stars = [];
  const vis = () =>
    page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const scene = sc.debugScene();
      const shown = (name) => {
        const o = scene.getObjectByName(name);
        if (!o) return "missing";
        for (let e = o; e; e = e.parent) if (!e.visible) return false;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const a = m && m.uniforms && m.uniforms.uAlpha ? m.uniforms.uAlpha.value : m ? m.opacity : null;
        return { visible: true, alpha: a, telescopeK: scene.userData.telescopeK ?? null };
      };
      return { stars: shown("ConstellationStars"), lines: shown("ConstellationLines") };
    });
  const d7 = stops[6];
  for (const [name, d] of [
    ["a6", stops[5]],
    ["a7-minus", d7 - 0.004],
    ["a7", d7],
    ["a7-plus", d7 + 0.004],
    ["a8-flight", (stops[6] + stops[7]) / 2],
  ]) {
    await goDepth(d);
    const v = await vis();
    report.stars.push({ name, ...v });
    console.log(JSON.stringify({ name, ...v }));
  }
  // The telescope park.
  await goDepth(d7);
  await page.evaluate(() => window.__worldPark && window.__worldPark("a7"));
  try {
    await page.waitForFunction(() => window.__worldFrame?.parkedId === "a7" && window.__worldFrame.parkProgress > 0.98, { polling: 100, timeout: 15000 });
  } catch {}
  await sleep(800);
  await settle(4);
  const v = await vis();
  report.stars.push({ name: "telescope-park", ...v });
  console.log(JSON.stringify({ name: "telescope-park", ...v }));
  await page.screenshot({ path: path.join(OUT, "park-a7-telescope.png") });
  await page.evaluate(() => window.__worldPark && window.__worldPark(null));
  await sleep(1500);
}

report.errors = errors;
report.api = api;
fs.writeFileSync(path.join(OUT, "look.json"), JSON.stringify(report, null, 1));
console.log(`console errors+warnings ${errors.length}, /api ${api.length}`);
if (errors.length) console.log(errors.slice(0, 8).join("\n"));
await browser.close();
