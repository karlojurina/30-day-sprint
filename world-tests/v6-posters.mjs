/**
 * v6 posters (cheap laptops, 2026-09-28): the opening and the eight stops,
 * rendered on this Mac's GPU at full quality, into public/world-v6/posters/.
 *
 *   node world-tests/v6-posters.mjs [--q=0.8] [--budget=2.9]
 *
 * Each poster is drawn at 1920x1080 CSS px with device pixel ratio 1.5 (tier
 * 0, 4x MSAA, 2880x1620 on the GPU), with every piece of the interface
 * hidden, then scaled to 1920x1080 in Chrome and saved as webp. 16:9 at the
 * rail's own vertical lens, so any viewport of 16:9 or narrower sees the same
 * frame as the 3D once the poster is fitted to its height (poster.ts).
 *
 * Also writes manifest.json: every place marker's position on each poster
 * (as a share of its width and height), so poster mode can put the labels
 * where the 3D would. The quality steps down until the set fits the budget
 * (MB). Contact sheet: world-tests/shots/v6/fallback/posters-sheet.png.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "public/world-v6/posters");
const SHOTS = path.join(ROOT, "world-tests/shots/v6/fallback");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const Q0 = Number(arg("q", "0.8"));
const BUDGET = Number(arg("budget", "2.9")) * 1024 * 1024;
const W = 1920;
const H = 1080;
const DPR = 1.5;
const IDS = ["k0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  page.on("pageerror", (e) => log("pageerror", String(e).slice(0, 200)));
  // Final pass B: the posters at progress 0 (the cutover: nothing watched, no lantern lit),
  // through the page's own fixture key (tuning.ts KEY).
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("world-v6:tuning:finalB", JSON.stringify({ lock: "open", frontier: 0, finished: 0, partial: 0 }));
    } catch {
      /* ignore */
    }
  });
  const t0 = Date.now();
  await page.goto("http://localhost:3111/dev/world-v6?poster=off", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 80000, polling: 200 });
  log("ready", Date.now() - t0, "ms");
  const q = await page.evaluate(() => window.__worldV6Debug.qualityInfo());
  log("tier", q.quality.tier, "pixel ratio", q.pixelRatio, "gpu", q.report.gpu);
  if (q.quality.tier !== 0) {
    await page.evaluate(() => window.__worldV6Debug.setQualityTier(0));
    log("forced tier 0");
  }
  // Nothing of the interface on the posters (the page keeps its own shade on top).
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  const depths = await page.evaluate(() => [0, ...window.__worldV6Debug.stopDepths()]);

  const raw = [];
  for (let i = 0; i < IDS.length; i++) {
    const d = depths[i];
    await page.evaluate((dd) => {
      window.scrollTo({ top: window.__worldScrollFor(dd), left: 0, behavior: "instant" });
      window.__worldV6Debug.seedDepth(dd);
    }, d);
    // Settle: the light, the clouds' fade and the idle ladder's first frames.
    await page.waitForFunction((dd) => Math.abs((window.__worldDepth ?? -1) - dd) < 1e-4, { timeout: 15000, polling: 50 }, d);
    const f0 = await page.evaluate(() => window.__worldFrameCount);
    await sleep(1400);
    const f1 = await page.evaluate(() => window.__worldFrameCount);
    const markers = await page.evaluate(() => window.__worldMarkers);
    const png = await page.screenshot({ type: "png", encoding: "base64", captureBeyondViewport: false });
    raw.push({ id: IDS[i], stop: i - 1, depth: d, png, markers, frames: f1 - f0 });
    log(IDS[i], "depth", d.toFixed(4), "frames", f1 - f0, "markers visible", markers.filter((m) => m.visible).map((m) => m.id).join(","));
  }

  // Scale to 1920x1080 and encode, stepping the quality down until the set fits.
  const enc = await browser.newPage();
  await enc.setViewport({ width: 400, height: 300 });
  const encode = (b64, qq) =>
    enc.evaluate(
      async (src, w, h, quality) => {
        const img = new Image();
        img.src = "data:image/png;base64," + src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, w, h);
        return c.toDataURL("image/webp", quality).split(",")[1];
      },
      b64,
      W,
      H,
      qq,
    );
  let quality = Q0;
  let files;
  for (;;) {
    files = [];
    for (const r of raw) files.push(Buffer.from(await encode(r.png, quality), "base64"));
    const total = files.reduce((a, b) => a + b.length, 0);
    log(`quality ${quality.toFixed(2)}: ${(total / 1024 / 1024).toFixed(2)} MB`);
    if (total <= BUDGET || quality <= 0.5) break;
    quality -= 0.06;
  }
  const manifest = { version: 1, width: W, height: H, made: new Date().toISOString(), quality: +quality.toFixed(2), posters: [] };
  raw.forEach((r, i) => {
    const file = `${r.id}.webp`;
    fs.writeFileSync(path.join(OUT, file), files[i]);
    manifest.posters.push({
      id: r.id,
      stop: r.stop,
      file,
      bytes: files[i].length,
      markers: r.markers.map((m) => ({ id: m.id, fx: +(m.x / W).toFixed(5), fy: +(m.y / H).toFixed(5), visible: !!m.visible, proximity: +(+m.proximity).toFixed(3) })),
    });
  });
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));

  // Contact sheet of the encoded files (what the page will show), 3 x 3 at 640 wide.
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 1920, height: 1080 + 60 });
  const cells = manifest.posters
    .map((p, i) => `<figure style="margin:0;position:relative"><img src="data:image/webp;base64,${files[i].toString("base64")}" style="width:640px;height:360px;display:block"><figcaption style="position:absolute;left:8px;top:6px;font:600 14px ui-monospace;color:#fff;text-shadow:0 1px 2px #000">${p.id} · ${(p.bytes / 1024).toFixed(0)} KB</figcaption></figure>`)
    .join("");
  await sheet.setContent(`<body style="margin:0;background:#1d1826"><div style="display:grid;grid-template-columns:repeat(3,640px)">${cells}</div><p style="font:13px ui-monospace;color:#ccc;margin:10px">v6 posters, webp q ${quality.toFixed(2)}, total ${(files.reduce((a, b) => a + b.length, 0) / 1024).toFixed(0)} KB</p></body>`, { waitUntil: "load" });
  await sheet.screenshot({ path: path.join(SHOTS, "posters-sheet.png") });
  log("wrote", OUT, "and", path.join(SHOTS, "posters-sheet.png"));
} finally {
  await browser.close();
}
