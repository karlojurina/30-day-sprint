/**
 * v6 posters (cheap laptops, 2026-09-28): the opening and the eight stops,
 * rendered on this Mac's GPU at full quality, into public/world-v6/posters/.
 * Drawn on http://localhost:3111/dev/world-app (must already be up; this
 * script never starts a server; BASE_URL for another port) with the real
 * course at progress 0, no lesson watched: ?catalog=course&p=p0&discount=locked.
 *
 *   node world-tests/v6-posters.mjs [--q=0.8] [--budget=2.9]
 *   node world-tests/v6-posters.mjs --tod=night
 *   node world-tests/v6-posters.mjs --tod=morning
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
 *
 * --tod=night (2026-10-21, the night on the student's clock): the night twins
 * of poster.ts NIGHT_POSTER_IDS (the opening and the first six places), the
 * same page, camera and settings with ?tod=night added (the night factor 1:
 * the clock at 23:00), into <id>-night.webp. The day posters and the day part
 * of manifest.json are left as they are: only its `night` block is written,
 * and the run stops before writing anything if a night marker sits off its
 * day position (the day's markers serve both). Each file starts at the day
 * set's quality and steps down by 0.06 while it is over its day twin's size
 * by more than --over (default 0.15, a share), at 0.5 at the lowest. It also
 * makes the opening's 48 px still the poster layer shows before the file
 * arrives (world.module.css .poster::before), with the recipe the day's was
 * made with (cwebp -q 80 -m 6 -resize 48 27), and prints it. Contact sheet:
 * world-tests/shots/v6/fallback/posters-night-sheet.png.
 *
 * --tod=morning (2026-10-21, the morning on the student's clock): the morning
 * twins of poster.ts MORNING_POSTER_IDS, the same way as the night's, with
 * ?hour=07.30 added (the clock in the middle of the morning: the night factor
 * 0, the morning factor 1), into <id>-morning.webp, and only the manifest's
 * `morning` block written. Its still (.poster::before under the morning) is
 * printed the same way. Contact sheet: posters-morning-sheet.png.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TOD = arg("tod", "day");
if (!["day", "night", "morning"].includes(TOD)) throw new Error(`--tod=${TOD}: day, night or morning`);
const NIGHT = TOD === "night";
const MORNING = TOD === "morning";
/** A twin set (night or morning): only its files and its manifest block are written, the day's are left as they are. */
const TWIN = NIGHT || MORNING;
const Q0 = Number(arg("q", "0.8"));
const BUDGET = Number(arg("budget", "2.9")) * 1024 * 1024;
const OVER = Number(arg("over", "0.15"));
const W = 1920;
const H = 1080;
const DPR = 1.5;
const ALL = ["k0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
/** poster.ts NIGHT_POSTER_IDS or MORNING_POSTER_IDS, read from the source (this script runs under plain node). */
function twinIds(name) {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/world-v6/poster.ts"), "utf8");
  const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`poster.ts ${name} not found`);
  const ids = [...m[1].matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]);
  if (!ids.length || ids.some((id) => !ALL.includes(id))) throw new Error(`poster.ts ${name} reads ${JSON.stringify(ids)}`);
  return ids;
}
const IDS = NIGHT ? twinIds("NIGHT_POSTER_IDS") : MORNING ? twinIds("MORNING_POSTER_IDS") : ALL;
/** The morning twins' hour on the clock (?hour=07.30): the middle of the morning (clock.ts MORNING_HOURS). */
const MORNING_HOUR = "07.30";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const manifestPath = path.join(OUT, "manifest.json");
const dayManifest = TWIN ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  page.on("pageerror", (e) => log("pageerror", String(e).slice(0, 200)));
  // Final pass B: the posters at progress 0 (the cutover: nothing watched, no lantern lit).
  // Second Loom (2026-10-16): on the real course, the map /world draws. The scene lays out one
  // lantern per lesson of the course it is shown (progress-world.ts layoutFor), so the fixture
  // page's counts (/dev/world-v6, study.ts STUDY_AREAS) stood lanterns (Video Ads II's bench, the
  // walk to the arch) where a student's map has none. ?discount=locked pins the cache's look to
  // a new student's.
  const t0 = Date.now();
  await page.goto(`${BASE}/dev/world-app?catalog=course&p=p0&discount=locked&poster=off${NIGHT ? "&tod=night" : MORNING ? `&hour=${MORNING_HOUR}` : ""}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 80000, polling: 200 });
  log("ready", Date.now() - t0, "ms");
  const q = await page.evaluate(() => window.__worldV6Debug.qualityInfo());
  log("tier", q.quality.tier, "pixel ratio", q.pixelRatio, "gpu", q.report.gpu);
  if (q.quality.tier !== 0) {
    await page.evaluate(() => window.__worldV6Debug.setQualityTier(0));
    log("forced tier 0");
  }
  if (NIGHT) {
    const n = await page.evaluate(() => window.__worldV6Debug.nightInfo());
    log("night", JSON.stringify(n));
    if (n.target !== 1 || n.shown !== 1) throw new Error(`the page is not at night: ${JSON.stringify(n)}`);
  }
  if (MORNING) {
    const n = await page.evaluate(() => window.__worldV6Debug.nightInfo());
    log("morning", JSON.stringify(n));
    if (n.target !== 0 || n.shown !== 0 || n.morningTarget !== 1 || n.morningShown !== 1) throw new Error(`the page is not in the morning: ${JSON.stringify(n)}`);
  }
  // Nothing of the interface on the posters (the page keeps its own shade on top).
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  const depths = await page.evaluate(() => [0, ...window.__worldV6Debug.stopDepths()]);

  const raw = [];
  for (const id of IDS) {
    const i = ALL.indexOf(id);
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
    raw.push({ id, stop: i - 1, depth: d, png, markers, frames: f1 - f0 });
    log(id, "depth", d.toFixed(4), "frames", f1 - f0, "markers visible", markers.filter((m) => m.visible).map((m) => m.id).join(","));
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
  let qualities;
  if (!TWIN) {
    for (;;) {
      files = [];
      for (const r of raw) files.push(Buffer.from(await encode(r.png, quality), "base64"));
      const total = files.reduce((a, b) => a + b.length, 0);
      log(`quality ${quality.toFixed(2)}: ${(total / 1024 / 1024).toFixed(2)} MB`);
      if (total <= BUDGET || quality <= 0.5) break;
      quality -= 0.06;
    }
    qualities = raw.map(() => quality);
  } else {
    // The day set's quality, then down per file while it is over its day twin by more than OVER.
    quality = typeof dayManifest.quality === "number" ? dayManifest.quality : Q0;
    files = [];
    qualities = [];
    for (const r of raw) {
      const twin = dayManifest.posters.find((p) => p.id === r.id);
      let qq = quality;
      let buf;
      for (;;) {
        buf = Buffer.from(await encode(r.png, qq), "base64");
        if (!twin || buf.length <= twin.bytes * (1 + OVER) || qq <= 0.5 + 1e-9) break;
        qq = +(qq - 0.06).toFixed(2);
      }
      files.push(buf);
      qualities.push(+qq.toFixed(2));
      log(`${r.id}-${TOD}: quality ${qq.toFixed(2)}, ${(buf.length / 1024).toFixed(1)} KB (day ${twin ? (twin.bytes / 1024).toFixed(1) : "?"} KB, ${twin ? (((buf.length - twin.bytes) / twin.bytes) * 100).toFixed(0) : "?"}%)`);
    }
    // Same camera, same markers: the day's entries serve the night (poster mode's labels, the phone's crop).
    let worst = 0;
    for (const r of raw) {
      const twin = dayManifest.posters.find((p) => p.id === r.id);
      for (const m of r.markers) {
        const t = twin?.markers.find((x) => x.id === m.id);
        if (!t) throw new Error(`${r.id}: marker ${m.id} has no day twin`);
        worst = Math.max(worst, Math.abs(m.x / W - t.fx), Math.abs(m.y / H - t.fy));
        if (!!m.visible !== t.visible) throw new Error(`${r.id}: marker ${m.id} visible ${m.visible} in the ${TOD}, ${t.visible} by day`);
      }
    }
    log(`markers: the ${TOD}'s sit within ${worst.toFixed(5)} of the day's (as a share of the poster)`);
    if (worst > 0.002) throw new Error(`the ${TOD}'s markers moved: the day's manifest would put the labels off`);
  }

  const names = raw.map((r) => (TWIN ? `${r.id}-${TOD}.webp` : `${r.id}.webp`));
  let manifest;
  if (!TWIN) {
    manifest = { version: 1, width: W, height: H, made: new Date().toISOString(), quality: +quality.toFixed(2), posters: [] };
    raw.forEach((r, i) => {
      const file = names[i];
      fs.writeFileSync(path.join(OUT, file), files[i]);
      manifest.posters.push({
        id: r.id,
        stop: r.stop,
        file,
        bytes: files[i].length,
        markers: r.markers.map((m) => ({ id: m.id, fx: +(m.x / W).toFixed(5), fy: +(m.y / H).toFixed(5), visible: !!m.visible, proximity: +(+m.proximity).toFixed(3) })),
      });
    });
  } else {
    manifest = dayManifest;
    const block = NIGHT ? { made: new Date().toISOString(), factor: 1, posters: [] } : { made: new Date().toISOString(), hour: 7.5, factor: 1, posters: [] };
    manifest[TOD] = block;
    raw.forEach((r, i) => {
      fs.writeFileSync(path.join(OUT, names[i]), files[i]);
      block.posters.push({ id: r.id, file: names[i], bytes: files[i].length, quality: qualities[i] });
    });
    const total = files.reduce((a, b) => a + b.length, 0);
    const dayTotal = raw.reduce((a, r) => a + dayManifest.posters.find((p) => p.id === r.id).bytes, 0);
    log(`${TOD} set: ${(total / 1024).toFixed(0)} KB for ${raw.length} (their day twins ${(dayTotal / 1024).toFixed(0)} KB)`);
    // The opening's 48 px still for the poster layer's first paint (world.module.css .poster::before).
    const thumb = path.join(SHOTS, `k0-${TOD}-48.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "80", "-m", "6", "-resize", "48", "27", path.join(OUT, `k0-${TOD}.webp`), "-o", thumb]);
    log(`k0-${TOD} 48 px still (${fs.statSync(thumb).size} bytes), for world.module.css:`);
    console.log(`data:image/webp;base64,${fs.readFileSync(thumb).toString("base64")}`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  // Contact sheet of the encoded files (what the page will show), 3 x 3 at 640 wide.
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 1920, height: 1080 + 60 });
  const cells = raw
    .map((r, i) => `<figure style="margin:0;position:relative"><img src="data:image/webp;base64,${files[i].toString("base64")}" style="width:640px;height:360px;display:block"><figcaption style="position:absolute;left:8px;top:6px;font:600 14px ui-monospace;color:#fff;text-shadow:0 1px 2px #000">${names[i].replace(".webp", "")} · ${(files[i].length / 1024).toFixed(0)} KB</figcaption></figure>`)
    .join("");
  const what = TWIN ? `v6 ${TOD} posters, webp q ${qualities.map((x) => x.toFixed(2)).join("/")}` : `v6 posters, webp q ${quality.toFixed(2)}`;
  await sheet.setContent(`<body style="margin:0;background:#1d1826"><div style="display:grid;grid-template-columns:repeat(3,640px)">${cells}</div><p style="font:13px ui-monospace;color:#ccc;margin:10px">${what}, total ${(files.reduce((a, b) => a + b.length, 0) / 1024).toFixed(0)} KB</p></body>`, { waitUntil: "load" });
  const sheetFile = path.join(SHOTS, TWIN ? `posters-${TOD}-sheet.png` : "posters-sheet.png");
  await sheet.screenshot({ path: sheetFile });
  log("wrote", OUT, "and", sheetFile);
} finally {
  await browser.close();
}
