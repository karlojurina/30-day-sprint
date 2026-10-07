/**
 * Final pass (fixer "world"): record the area-done moment (or the pulse) as a
 * short video. Seeds a stop at the mid state with the area one lesson short,
 * starts a CDP screencast, completes the area and fires celebrate(area),
 * records SECS seconds, then writes frames, an mp4 and a contact sheet.
 *
 *   OUT=<dir> SECS=9 node world-tests/v6-finalA-world-record.mjs a4 [pulse]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const [id, mode] = process.argv.slice(2);
const OUT = path.resolve(process.env.OUT || `world-tests/shots/v6/finalA/world/done-${id}`);
const SECS = Number(process.env.SECS || 9);
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const k = IDS.indexOf(id);
const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
for (const f of fs.readdirSync(path.join(OUT, "frames"))) fs.unlinkSync(path.join(OUT, "frames", f));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1691, height: 1278 });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await sleep(1200);
// Before: every area up to k done, area k one lesson short (its last lesson next).
const done = LESSONS.map((n, i) => (i < k ? n : i === k ? (mode === "pulse" ? Math.floor(n * 0.8) : n - 1) : 0));
const before = { lessons: LESSONS, done, current: k, next: done[k] + 1 };
await page.evaluate(
  (p, k) => {
    const sc = window.__worldV6Debug;
    sc.setProgress(k + p.done[k] / p.lessons[k]);
    sc.setWorldProgress(p);
    sc.debugPose?.(null);
    sc.park(null);
    const d = sc.stopDepths()[k];
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  },
  before,
  k,
);
await sleep(1500);
const cdp = await page.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ t: f.metadata.timestamp, data: f.data });
  try {
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
  } catch {}
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1280, maxHeight: 968, everyNthFrame: 1 });
await sleep(700);
if (mode !== "pulse") {
  const after = { lessons: LESSONS, done: done.map((d, i) => (i === k ? LESSONS[k] : d)), current: Math.min(7, k + 1), next: 1 };
  await page.evaluate(
    (p, k) => {
      const sc = window.__worldV6Debug;
      sc.setProgress(k + 1);
      sc.setWorldProgress(p);
      sc.celebrate(k);
    },
    after,
    k,
  );
}
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  // Keep the page's own fixture from re-sending its progress over ours: nothing to do but wait.
  await sleep(250);
}
await cdp.send("Page.stopScreencast");
await browser.close();
frames.sort((a, b) => a.t - b.t);
const T0 = frames[0]?.t ?? 0;
const list = [];
frames.forEach((f, i) => {
  const name = `f${String(i).padStart(4, "0")}.jpg`;
  fs.writeFileSync(path.join(OUT, "frames", name), Buffer.from(f.data, "base64"));
  const next = frames[i + 1];
  list.push(`file 'frames/${name}'\nduration ${next ? Math.max(0.01, next.t - f.t).toFixed(3) : "0.1"}`);
});
fs.writeFileSync(path.join(OUT, "concat.txt"), list.join("\n") + "\n");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-vf", "fps=30,scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "20", "clip.mp4"], { cwd: OUT });
// Contact sheet: 12 frames evenly spread in time.
const picks = [];
const span = (frames[frames.length - 1]?.t ?? T0) - T0;
for (let i = 0; i < 12; i++) {
  const tt = T0 + (span * i) / 11;
  let bi = 0;
  frames.forEach((f, j) => {
    if (Math.abs(f.t - tt) < Math.abs(frames[bi].t - tt)) bi = j;
  });
  picks.push({ i: bi, t: (frames[bi].t - T0).toFixed(2) });
}
fs.writeFileSync(path.join(OUT, "picks.json"), JSON.stringify({ n: frames.length, span, picks }));
console.log("frames", frames.length, "span", span.toFixed(2), "RECDONE");
