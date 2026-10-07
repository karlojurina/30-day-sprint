/**
 * Detail pass 2, LAKEFOREST (dress-lakeforest.ts): renders the Mirror Lake,
 * the crossing, the Glowing Forest and the rise's first step at 960x600 on
 * the real page (/dev/world-v6, with its interface), and attributes each
 * frame's triangles and draw calls to the scene group that drew them (the
 * same attribution as v5-gates.mjs, the lake's reflection pass as "mirror:").
 *
 *   node world-tests/v6-lakeforest.mjs [--tag before] [--only a5,cross,a6,step]
 *
 * Writes PNGs + report-<tag>.json to world-tests/shots/v6-pass2/lakeforest/.
 * SwiftShader: ~1 s a frame, the lake about twice that. 6 frames per run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6-pass2/lakeforest");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const TAG = flag("--tag", "now");
const ONLY = flag("--only", "");
const TRAIL_KEYS = 77;
/** [id, stop index or trail key, label]: a stop index uses the page's own stop depth. */
const FRAMES = [
  ["a5", { stop: 4 }, "a5 the Mirror Lake"],
  ["cross1", { key: 44.3 }, "the crossing, low over the water"],
  ["cross2", { key: 45.5 }, "across the lake, into the forest"],
  ["canopy", { key: 46.3 }, "under the canopy, between the trunks"],
  ["a6", { stop: 5 }, "a6 the Great Tree"],
  ["step", { key: 48 }, "behind the first step"],
].filter(([id]) => !ONLY || ONLY.split(",").some((o) => id.startsWith(o)));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

const stats = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const s = sc.moduleStats ? sc.moduleStats() : null;
  return s ? s["dress-lakeforest"] ?? null : null;
});
console.log("module stats:", JSON.stringify(stats));

const report = { tag: TAG, stats, frames: [] };
/** Other builders' saves hot-reload the page: wait until the world is back. */
async function ready() {
  await page.waitForFunction(() => (window.__worldReady || window.__worldError) && window.__worldV6Debug && window.__worldV6Debug.debugScene(), { timeout: 180000, polling: 500 });
}
for (const [id, where, label] of FRAMES) {
  let res = null;
  for (let attempt = 0; attempt < 4 && !res; attempt++) {
    try {
      await ready();
      res = await shoot(where);
    } catch (e) {
      console.log(`  ${id}: retry after ${String(e.message || e).slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!res) continue;
  const file = path.join(OUT, `${TAG}-${id}.png`);
  fs.writeFileSync(file, Buffer.from(res.png.split(",")[1], "base64"));
  delete res.png;
  const top = Object.entries(res.attr)
    .sort((a, b) => b[1].tris - a[1].tris)
    .slice(0, 9)
    .map(([k, v]) => `${k} ${Math.round(v.tris / 100) / 10}k/${v.calls}`)
    .join(" · ");
  console.log(`${id} [${res.ver}] ${label}: cam ${res.cam} pitch ${res.pitch} | ${res.tot.tris} tris / ${res.tot.calls} calls | ${top}`);
  report.frames.push({ id, label, ...res });
}
async function shoot(where) {
  return page.evaluate(
    async (where, TRAIL_KEYS) => {
      const sc = window.__worldV6Debug;
      let d;
      if (where.stop !== undefined) d = sc.stopDepths()[where.stop];
      else {
        const u = where.key / (TRAIL_KEYS - 1);
        const r = sc.debugRail();
        let lo = 0;
        let hi = r.length;
        for (let i = 0; i < 60; i++) {
          const m = (lo + hi) / 2;
          if (r.tAtS(m) < u) lo = m;
          else hi = m;
        }
        d = r.depthOfS((lo + hi) / 2);
      }
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
      const wait = async (n) => {
        const c0 = window.__worldFrameCount ?? 0;
        const t = performance.now();
        while ((window.__worldFrameCount ?? 0) < c0 + n && performance.now() - t < 20000) await new Promise((r) => setTimeout(r, 100));
      };
      await wait(3);
      const scene = sc.debugScene();
      const renderer = sc.renderer;
      const camera = sc.camera;
      const world = scene.getObjectByName("World");
      const ownerKey = (o) => {
        let e = o;
        while (e.parent && e.parent !== world && e.parent !== scene) e = e.parent;
        return e.name || e.type;
      };
      const attr = {};
      const info = renderer.info;
      let pT = 0;
      let pC = 0;
      const hooked = [];
      scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
        const base = o.onAfterRender;
        const key = ownerKey(o);
        hooked.push([o, base]);
        o.onAfterRender = function (...a) {
          base.apply(this, a);
          const k = (renderer.getRenderTarget() ? "mirror:" : "") + key;
          const e = attr[k] || (attr[k] = { tris: 0, calls: 0 });
          e.tris += info.render.triangles - pT;
          e.calls += info.render.calls - pC;
          pT = info.render.triangles;
          pC = info.render.calls;
        };
      });
      const auto = info.autoReset;
      info.autoReset = false;
      info.reset();
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      const tot = { tris: info.render.triangles, calls: info.render.calls };
      // The pixels of THIS render (a reload from another builder's save can blank the canvas before a screenshot).
      const gl = renderer.getContext();
      const bw = gl.drawingBufferWidth;
      const bh = gl.drawingBufferHeight;
      const raw = new Uint8Array(bw * bh * 4);
      gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      const cv = document.createElement("canvas");
      cv.width = bw;
      cv.height = bh;
      const cx = cv.getContext("2d");
      const id = cx.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) id.data.set(raw.subarray((bh - 1 - y) * bw * 4, (bh - y) * bw * 4), y * bw * 4);
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
      cx.putImageData(id, 0, 0);
      const png = cv.toDataURL("image/png");
      info.autoReset = auto;
      for (const [o, base] of hooked) o.onAfterRender = base;
      const c = window.__worldCamera();
      const ver = (sc.moduleStats ? sc.moduleStats()["dress-lakeforest"] : null)?.version ?? "?";
      return { d, tot, attr, png, ver, cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1) };
    },
    where,
    TRAIL_KEYS,
  );
}
report.errors = errors.slice(0, 20);
if (errors.length) console.log("errors:", errors.slice(0, 8).join("\n"));
fs.writeFileSync(path.join(OUT, `report-${TAG}.json`), JSON.stringify(report, null, 1));
await browser.close();
