/**
 * Frame cleanup (final run): v6-quick.mjs on the real GPU (Metal) at 1691x1278,
 * for the a7 approach, the walk on and the telescope sky.
 *
 *   node world-tests/v6-fc-quick.mjs <outdir> <tag> k12 k14 a3 a4 ...   (<= 6 per run)
 *
 * kNN = TRAIL key NN (fractional ok), aN = stop N (stopDepths). Writes <tag>-<item>.png.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [outDir, tag, ...items] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setViewport({ width: 1691, height: 1278 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("WORLD ERROR", err);
  process.exit(1);
}
async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {}
}
for (const it of items) {
  let d;
  if (it.startsWith("a")) {
    const i = Number(it.slice(1)) - 1;
    d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], i);
  } else {
    const key = Number(it.slice(1));
    d = await page.evaluate((u) => {
      const r = window.__worldV6Debug.debugRail();
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      return r.depthOfS((lo + hi) / 2);
    }, key / (Number(process.env.NK1) || 85));
  }
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  if (process.env.HIDE) {
    const hidden = await page.evaluate((names) => {
      const sc = window.__worldV6Debug.debugScene();
      const out = [];
      sc.traverse((o) => {
        if (names.some((n) => (o.name || "").startsWith(n) || (o.material && !Array.isArray(o.material) && o.material.name === n))) {
          o.visible = false;
          out.push(o.name || o.material.name);
        }
      });
      return out;
    }, process.env.HIDE.split(","));
    console.log("hidden", hidden.join(","));
  }
  await frames(3);
  const f = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), tris: f.triangles, calls: f.calls };
  });
  await page.screenshot({ path: path.join(outDir, `${tag}-${it}.png`) });
  console.log(it, JSON.stringify(f));
}
if (errors.length) console.log("ERRORS", errors.slice(0, 5));
await browser.close();
