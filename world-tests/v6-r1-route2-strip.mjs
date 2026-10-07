/**
 * Round 1, route stage 2: the whole route as a scroll strip, one frame every
 * STEP vh of scroll (default 20), for judging the pacing by eye: which
 * stretches hold something to look at and which are dull transit.
 *
 *   OUT=<dir> STEP=20 [FROM=0 TO=2200] node world-tests/v6-r1-route2-strip.mjs
 *
 * Real GPU (bible 4.1) at half Lovro's size (846x639, the same aspect). Each
 * frame is named by its scroll position in vh (v0340.png). strip.json holds,
 * per frame: vh, depth, the place coordinate, the camera, and a detail
 * measure on a 64x48 read of the frame (luminance mean and spread, mean
 * gradient): a flat frame (a dark wall, an empty sky) scores low.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(process.env.OUT || "world-tests/shots/v6/round1/route2/strip");
fs.mkdirSync(OUT, { recursive: true });
const STEP = Number(process.env.STEP || 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 846, height: 639 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await sleep(1500);
const total = await page.evaluate(() => window.__worldV6Debug.debugRail().totalVh());
const FROM = Number(process.env.FROM || 0);
const TO = Math.min(total, Number(process.env.TO || total));
async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 50, timeout: 8000 }, c0, n);
  } catch {
    /* idle */
  }
}
const out = [];
const bufs = [];
for (let vh = FROM; vh <= TO + 1e-6; vh += STEP) {
  const d = Math.min(1, vh / total);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  const name = `v${String(Math.round(vh)).padStart(4, "0")}`;
  const buf = await page.screenshot({ path: path.join(OUT, name + ".png") });
  bufs.push(buf);
  const cam = await page.evaluate(() => {
    const c = window.__worldCamera();
    return { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z), pitch: +c.pitch.toFixed(1), place: +c.place.toFixed(2) };
  });
  out.push({ vh: Math.round(vh), d: +d.toFixed(5), ...cam });
  console.log(name, JSON.stringify(out[out.length - 1]));
}
// The detail measure, in a second page once the route is done (a second
// page opened earlier hides the first, and a hidden page does not draw).
const an = await browser.newPage();
for (let i = 0; i < out.length; i++) {
  const m = await an.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const W = 64;
    const H = 48;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const Lm = new Float32Array(W * H);
    let s = 0;
    for (let i = 0; i < W * H; i++) {
      Lm[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      s += Lm[i];
    }
    const mean = s / (W * H);
    let v = 0;
    let grad = 0;
    let dark = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        v += (Lm[i] - mean) ** 2;
        if (Lm[i] < 0.06) dark++;
        if (x + 1 < W && y + 1 < H) grad += Math.abs(Lm[i + 1] - Lm[i]) + Math.abs(Lm[i + W] - Lm[i]);
      }
    return { mean: +mean.toFixed(3), spread: +Math.sqrt(v / (W * H)).toFixed(3), grad: +((grad / (W * H)) * 100).toFixed(2), dark: +(dark / (W * H)).toFixed(2) };
  }, Buffer.from(bufs[i]).toString("base64"));
  Object.assign(out[i], m);
}
fs.writeFileSync(path.join(OUT, "strip.json"), JSON.stringify({ total, step: STEP, frames: out }, null, 1));
await browser.close();
