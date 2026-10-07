/**
 * B6 (shore and life) render harness, v6 final run. Real GPU (Metal args).
 *
 *   node world-tests/v6-b6.mjs <tag> item item ...
 *
 * items:
 *   k12.5            TRAIL key 12.5 (fractional ok), as the student sees it (UI on)
 *   a1 .. a8         stop N (stopDepths)
 *   f:name:x,y,z:lx,ly,lz[:fov]   a free camera (paused loop, canvas only)
 *   t=SECONDS        pin life's clock for the next items (__worldLife.setTime)
 *   star             fire a shooting star now (next item shows it)
 * env: W, H (default 1691 x 1278), OUT (default shots/v6/B6-shore-life),
 *      PROBE="js expression" (printed once after load), HIDE=name,name
 * Writes <OUT>/<tag>-<item>.png and prints frame tris / calls and life stats.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [tag, ...items] = process.argv.slice(2);
const OUT = process.env.OUT || path.join(HERE, "shots/v6/B6-shore-life");
fs.mkdirSync(OUT, { recursive: true });
const W = Number(process.env.W || 1691);
const H = Number(process.env.H || 1278);
const TRAIL_KEYS = 86;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setViewport({ width: W, height: H });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 120000, polling: 300 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) {
  console.log("WORLD ERROR", werr);
  await browser.close();
  process.exit(1);
}
const frames = async (n) => {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 15000 }, c0, n);
  } catch {}
};
if (process.env.HIDE)
  await page.evaluate((names) => {
    const sc = window.__worldV6Debug.debugScene();
    for (const n of names) {
      const o = sc.getObjectByName(n);
      if (o) o.visible = false;
    }
  }, process.env.HIDE.split(","));
if (process.env.PROBE) {
  const r = await page.evaluate((src) => {
    try {
      return JSON.stringify((0, eval)(src));
    } catch (e) {
      return "probe error " + e.message;
    }
  }, process.env.PROBE);
  console.log("PROBE", r);
}
const ms = await page.evaluate(() => {
  const s = window.__worldV6Debug.moduleStats();
  return { shore: s["dress-shore"], life: s["life"] };
});
console.log("stats", JSON.stringify(ms));

async function depthForKey(key) {
  return page.evaluate((u) => {
    const r = window.__worldV6Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, key / (TRAIL_KEYS - 1));
}

for (const it of items) {
  if (it.startsWith("t=")) {
    const t = Number(it.slice(2));
    await page.evaluate((t) => window.__worldLife?.setTime(Number.isFinite(t) ? t : null), t);
    continue;
  }
  if (it === "star") {
    const ok = await page.evaluate(() => window.__worldLife?.shootNow());
    console.log("star", ok);
    continue;
  }
  const file = path.join(OUT, `${tag}-${it.replace(/[:,]/g, "_").slice(0, 60)}.png`);
  if (it.startsWith("f:")) {
    const [, , p, l, fov] = it.split(":");
    const pos = p.split(",").map(Number);
    const look = l.split(",").map(Number);
    const url = await page.evaluate(
      (pos, look, fov) => {
        const sc = window.__worldV6Debug;
        const cam = sc.camera;
        sc.setPaused(true);
        cam.position.set(...pos);
        cam.lookAt(...look);
        if (fov) cam.fov = Number(fov);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        const scene = sc.debugScene();
        const r = sc.renderer;
        r.setRenderTarget(null);
        r.render(scene, cam);
        r.render(scene, cam);
        const gl = r.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        const id = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const s = ((h - 1 - y) * w + x) * 4;
            const t = (y * w + x) * 4;
            id.data[t] = px[s];
            id.data[t + 1] = px[s + 1];
            id.data[t + 2] = px[s + 2];
            id.data[t + 3] = 255;
          }
        ctx.putImageData(id, 0, 0);
        return c.toDataURL("image/png");
      },
      pos,
      look,
      fov,
    );
    fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    await page.evaluate(() => window.__worldV6Debug.setPaused(false));
    console.log(it, "->", path.basename(file));
    continue;
  }
  let d;
  if (/^a\d$/.test(it)) {
    const i = Number(it.slice(1)) - 1;
    d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], i);
  } else {
    d = await depthForKey(Number(it.slice(1)));
  }
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(4);
  await new Promise((r) => setTimeout(r, 400));
  await frames(2);
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    const L = window.__worldLife ? window.__worldLife() : {};
    return {
      tris: f.triangles,
      calls: f.calls,
      cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)],
      pitch: +c.pitch.toFixed(1),
      flocks: L.flocksOnScreen,
      soft: L.softOnScreen,
      glow: L.glowOnScreen,
      ships: L.airshipsDrawn,
    };
  });
  await page.screenshot({ path: file });
  if (process.env.PERF) {
    // Indicative GPU time: 3 bursts of 8 renders synced by a 1 px readPixels, fastest burst (other builders share the GPU).
    info.ms = await page.evaluate(() => {
      const sc = window.__worldV6Debug;
      const r = sc.renderer;
      const scene = sc.debugScene();
      const gl = r.getContext();
      const px = new Uint8Array(4);
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        for (let i = 0; i < 8; i++) r.render(scene, sc.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        best = Math.min(best, (performance.now() - t0) / 8);
      }
      return +best.toFixed(2);
    });
    info.pr = await page.evaluate(() => window.__worldV6Debug.renderer.getPixelRatio());
  }
  console.log(it, JSON.stringify(info));
}
console.log("errors", errors.length, errors.slice(0, 6).join("\n"));
await browser.close();
