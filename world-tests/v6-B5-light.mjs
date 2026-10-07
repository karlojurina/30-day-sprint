/**
 * B5 (light, fog, grade, sky): render TRAIL keys on the real page and measure
 * what the light has to prove (world_art_bible_v6.md 2.6): luma p5 / p50 /
 * p95 (Rec. 601 on display values, 0..255), the share of pixels over 70 and
 * under 20 percent luma, the mean HSV saturation, all on the WebGL buffer
 * (no UI). Also the light state at the frame and the renderer's program count.
 *
 *   node world-tests/v6-B5-light.mjs --keys 0,2,7 [--size 1691x1278] [--tag pass1]
 *   node world-tests/v6-B5-light.mjs --sweep 0,85,0.5      program count sweep (no shots)
 *
 * Out: world-tests/shots/v6/B5-light-sky/<tag>-k<key>.png and <tag>.json.
 * Keep a run to 6 keys or fewer (STALL RULE: run it in the background).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/B5-light-sky");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const [W, H] = (flag("--size") || "1691x1278").split("x").map(Number);
const TAG = flag("--tag") || "b5";
const KEYS = (flag("--keys") || "").split(",").filter(Boolean).map(Number);
const SWEEP = flag("--sweep") ? flag("--sweep").split(",").map(Number) : null;
const TRAIL_N = 86;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + " " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: W, height: H });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) {
  console.log("world error:", werr);
  await browser.close();
  process.exit(1);
}

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {
    /* the loop sleeps once nothing moves */
  }
}

async function seedKey(key) {
  const u = key / (TRAIL_N - 1);
  await page.evaluate((u) => {
    const sc = window.__worldV6Debug;
    const r = sc.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    const d = r.depthOfS((lo + hi) / 2);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, u);
  await frames(4);
}

/** Render once, read the buffer, measure. */
async function measure() {
  return page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const renderer = sc.renderer;
    const scene = sc.debugScene();
    const camera = sc.camera;
    const gl = renderer.getContext();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    const px = new Uint8Array(bw * bh * 4);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const L = [];
    let sat = 0;
    let bright = 0;
    let dark = 0;
    let n = 0;
    // Rows: top third, middle, bottom third (the buffer is bottom up).
    const rows = [0, 0, 0];
    const rowsN = [0, 0, 0];
    for (let y = 0; y < bh; y += 3) {
      for (let x = 0; x < bw; x += 3) {
        const i = (y * bw + x) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        L.push(l);
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        sat += mx > 0 ? (mx - mn) / mx : 0;
        if (l > 178.5) bright++;
        if (l < 51) dark++;
        const band = Math.min(2, Math.floor(((bh - 1 - y) / bh) * 3));
        rows[band] += l;
        rowsN[band]++;
        n++;
      }
    }
    L.sort((a, b) => a - b);
    const p = (q) => Math.round(L[Math.min(L.length - 1, Math.floor(q * L.length))]);
    const light = sc.modules.find((m) => m.name === "light")?.module;
    const s = light?.state;
    const hex = (c) => (c ? "#" + c.getHexString() : null);
    const info = renderer.info;
    return {
      p5: p(0.05),
      p50: p(0.5),
      p95: p(0.95),
      over70pct: +((bright / n) * 100).toFixed(1),
      under20pct: +((dark / n) * 100).toFixed(1),
      sat: +(sat / n).toFixed(3),
      rows: rows.map((v, k) => Math.round(v / rowsN[k])),
      programs: info.programs ? info.programs.length : null,
      tris: info.render.triangles,
      calls: info.render.calls,
      light: s
        ? {
            stop: s.stop,
            blend: +s.blend.toFixed(3),
            under: +s.under.toFixed(3),
            sunEl: +s.sunEl.toFixed(2),
            sunI: +s.sunIntensity.toFixed(2),
            hemiI: +s.hemiIntensity.toFixed(2),
            exposure: +s.exposure.toFixed(3),
            sat: +s.sat.toFixed(3),
            skyTop: hex(s.skyTop),
            skyHorizon: hex(s.skyHorizon),
            haze: hex(s.haze),
          }
        : null,
    };
  });
}

const report = {};
if (SWEEP) {
  const [a, b, step] = SWEEP;
  const seen = [];
  for (let k = a; k <= b + 1e-9; k += step) {
    await seedKey(k);
    const n = await page.evaluate(() => window.__worldV6Debug.renderer.info.programs.length);
    seen.push([+k.toFixed(2), n]);
  }
  report.sweep = seen;
  const first = seen[0][1];
  const grew = seen.filter(([, n]) => n !== first);
  console.log("programs at start", first, "changes:", JSON.stringify(grew.slice(0, 40)));
} else {
  for (const key of KEYS) {
    await seedKey(key);
    const file = path.join(OUT, `${TAG}-k${key}.png`);
    await page.screenshot({ path: file });
    const m = await measure();
    report["k" + key] = m;
    console.log(`k${key}  p5/50/95 ${m.p5}/${m.p50}/${m.p95}  >70% ${m.over70pct}%  <20% ${m.under20pct}%  sat ${m.sat}  rows ${m.rows.join("/")}  prog ${m.programs}  ${JSON.stringify(m.light)}`);
  }
}
report.errors = errors.slice(0, 20);
fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(report, null, 1));
if (errors.length) console.log("console:", errors.slice(0, 8).join("\n"));
await browser.close();
