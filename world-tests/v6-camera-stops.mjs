/**
 * V5 camera pass 2: the stop frames as a student sees them (the real page,
 * interface on), at 960x600, for re-aiming the stop views and tuning light.
 *   node world-tests/v6-camera-stops.mjs a1 a2 a5 a8        (<= 6 ids per run)
 *   node world-tests/v6-camera-stops.mjs a8 --tag morning2  (file suffix)
 * Seeds the page's own stop depth (stopDepths()), waits two drawn frames and
 * screenshots. Writes world-tests/shots/v6-pass2/camera-light/{id}{-tag}.png
 * and .json (camera, pitch, triangles, draw calls, and the frame's luma:
 * row means of the top, middle and bottom thirds, p5, p95, Rec. 601 on the
 * screenshot with the interface's rectangles left out).
 *   node world-tests/v6-camera-stops.mjs --stats file.png ...   stats of shots on disk
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6-pass2/camera-light");
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const ti = argv.indexOf("--tag");
const TAG = ti >= 0 ? "-" + argv[ti + 1] : "";
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const want = argv.filter((a, i) => IDS.includes(a) && !(i > 0 && argv[i - 1] === "--tag")).slice(0, 6);
/** Luma stats of a 960x600 screenshot, skipping the panel (lower left), the timeline (lower right) and the top bar. */
async function statsOf(file) {
  const p2 = await browser.newPage();
  await p2.setContent(`<canvas id=c width=960 height=600></canvas>`);
  const r = await p2.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.getElementById("c").getContext("2d");
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, 960, 600).data;
    const skip = (x, y) => y < 60 || (x < 300 && y > 370) || (x > 520 && y > 460);
    const rows = [[0, 0], [0, 0], [0, 0]];
    const all = [];
    for (let y = 0; y < 600; y += 2)
      for (let x = 0; x < 960; x += 2) {
        if (skip(x, y)) continue;
        const i = (y * 960 + x) * 4;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const t = Math.min(2, Math.floor(y / 200));
        rows[t][0] += l;
        rows[t][1]++;
        all.push(l);
      }
    all.sort((a, b) => a - b);
    const q = (f) => Math.round(all[Math.floor(f * (all.length - 1))]);
    return { rows: rows.map(([a, n]) => Math.round(a / Math.max(1, n))), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
  }, "data:image/png;base64," + fs.readFileSync(file).toString("base64"));
  await p2.close();
  return r;
}
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
if (argv[0] === "--stats") {
  for (const f of argv.slice(1)) console.log(path.basename(f), JSON.stringify(await statsOf(f)));
  await browser.close();
  process.exit(0);
}
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function open() {
  await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  const err = await page.evaluate(() => window.__worldError || null);
  if (err) throw new Error("world error: " + err);
}
await open();
async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 30000 }, c0, n);
  } catch {}
}
// Other builders' saves hot-reload the page: a stop that dies mid-shot is retried on a fresh load.
async function shoot(id) {
  const i = IDS.indexOf(id);
  const d = await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], i);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
  const file = path.join(OUT, `${id}${TAG}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(2), bearing: c.bearing !== undefined ? +c.bearing.toFixed(2) : null, triangles: f.triangles, calls: f.calls };
  });
  const luma = await statsOf(file);
  fs.writeFileSync(path.join(OUT, `${id}${TAG}.json`), JSON.stringify({ id, ...info, luma }));
  console.log(`${id}${TAG} ${JSON.stringify(info)} luma ${JSON.stringify(luma)}`);
}
for (const id of want) {
  for (let t = 0; ; t++) {
    try {
      await shoot(id);
      break;
    } catch (e) {
      if (t >= 2) throw e;
      console.log(`${id}: ${e.message.split("\n")[0]}; reloading`);
      await new Promise((r) => setTimeout(r, 3000));
      await open();
    }
  }
}
if (errors.length) console.log("page errors:", errors.slice(0, 5).join(" | "));
await browser.close();
