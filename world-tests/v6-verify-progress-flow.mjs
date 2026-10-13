/**
 * Integration check (2026-09-28): the progress flow end to end, recorded.
 *
 *   node world-tests/v6-verify-progress-flow.mjs [--vp 1691x1278] [--no-video]
 *
 * The student at 58/145 (three places done, 18 of 22 into Video Ads II), a
 * fresh load with ?arrive=1 (the page skips its arrival travel under
 * automation unless asked):
 *   1 load       the opening frame
 *   2 arrive     the auto travel lands at a4 and the card appears; lanterns
 *                17 and 18 of Video Ads II lit, 19 pulsing (read from the
 *                instance state, projected, and cropped at two pulse phases)
 *   3 chip       a wheel scroll away (to a4 + 45%): the chip shows
 *   4 back       a wheel scroll back to a4: the card again
 *   5 panel      a click on the Trail Hut itself (sc.pickAnchor finds a
 *                pixel on the structure): the panel in the quiet side
 *   6 esc        Esc: back on the map
 *   7 done       the progress pushed to finish Video Ads II: the scene's
 *                run and the done card, stills at 0, 300, 700, 1200, 2500 ms
 * A CDP screencast runs through all of it -> verify/flow.mp4. Prints one JSON
 * line per step plus the console errors and /api requests seen.
 * Output: world-tests/shots/v6/progress/verify/flow/
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "shots", "v6", "progress", "verify");
const OUT = path.join(ROOT, "flow");
const FR = path.join(OUT, "frames");
fs.rmSync(FR, { recursive: true, force: true });
fs.mkdirSync(FR, { recursive: true });

const argv = process.argv.slice(2);
let vp = [1691, 1278];
let video = true;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--vp") vp = argv[++i].split("x").map(Number);
  else if (argv[i] === "--no-video") video = false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE_URL || "http://localhost:3111";
const MID = { lock: "open", frontier: 3, finished: 3, partial: 18 };

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 85000,
});
const errors = [];
const api = [];
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("pageerror " + e.message + " :: " + (e.stack || "").split("\n").slice(1, 4).join(" <- ")));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/GPU stall|GL Driver|WebGL-|React DevTools/i.test(t)) errors.push(t.slice(0, 240));
});
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/api")) api.push(r.url());
});
await page.setViewport({ width: vp[0], height: vp[1] });
// The mid state before the page reads its tuning, so the arrival travels to a4.
await page.evaluateOnNewDocument((t) => {
  try {
    localStorage.setItem("world-v6:tuning:trail", JSON.stringify(t)); // the current TUNE key (tuning.ts KEY)
  } catch {
    /* ignore */
  }
}, MID);

const cdp = await page.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async (fr) => {
  const file = `f${String(frames.length).padStart(5, "0")}.jpg`;
  frames.push({ file, ts: fr.metadata.timestamp });
  fs.writeFileSync(path.join(FR, file), Buffer.from(fr.data, "base64"));
  try {
    await cdp.send("Page.screencastFrameAck", { sessionId: fr.sessionId });
  } catch {
    /* closing */
  }
});

const log = [];
const step = (o) => {
  log.push(o);
  console.log(JSON.stringify(o));
};
const shot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
};
const ui = () => page.evaluate(() => window.__worldUi?.() ?? null);
async function waitFor(fn, ms = 5000, arg) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return Date.now() - t0;
    await sleep(120);
  }
  return -1;
}
async function settle() {
  for (let i = 0; i < 120; i++) {
    const ok = await page.evaluate(() => {
      const f = window.__worldFrame;
      const t = window.__worldTuning?.();
      if (!f || !t) return false;
      const total = t.scrollVh.reduce((a, b) => a + b, 0) + t.tailVh + (t.flightVh ?? 0);
      const max = window.__worldLock?.().maxDepth ?? 1;
      const target = Math.min(max, ((scrollY / innerHeight) * 100) / total);
      return Math.abs(f.depth - target) < 2e-5 && (f.parkProgress === 0 || f.parkProgress >= 0.999) && f.flight >= 0.999;
    });
    if (ok) return;
    await sleep(200);
  }
}
/** Scroll with the wheel, in notches, until scrollY is near `y`. */
async function wheelTo(y) {
  await page.mouse.move(vp[0] * 0.5, vp[1] * 0.45);
  for (let i = 0; i < 200; i++) {
    const cur = await page.evaluate(() => scrollY);
    const d = y - cur;
    if (Math.abs(d) < 60) break;
    await page.mouse.wheel({ deltaY: Math.sign(d) * Math.min(120, Math.abs(d)) });
    await sleep(45);
  }
  await page.evaluate((yy) => window.scrollTo(0, yy), Math.round(y));
}

/** Area 3's lantern instances around the pulse: state, screen position. */
async function lanternInfo() {
  return page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const scene = sc.debugScene();
    const halos = scene.getObjectByName("ProgressLanternHalos");
    const glass = scene.getObjectByName("ProgressLanternGlass");
    const st = glass.geometry.getAttribute("aState").array;
    const pos = halos.geometry.getAttribute("position").array;
    const cam = sc.camera;
    cam.updateMatrixWorld();
    const stats = sc.moduleStats()["progress-world"] ?? null;
    const first = 8 + 10 + 22; // area 3's lesson lanterns follow areas 0..2 (8, 10, 22)
    const out = [];
    const V = cam.position.constructor;
    for (let j = 0; j < 22; j++) {
      const i = first + j;
      const v = new V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(cam);
      out.push({
        lesson: j + 1,
        state: st[i],
        x: Math.round(((v.x + 1) / 2) * innerWidth),
        y: Math.round(((1 - v.y) / 2) * innerHeight),
        onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
        dist: Math.round(cam.position.distanceTo(new V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))),
      });
    }
    return { pulseInstance: stats?.pulse ?? null, perArea: stats?.perArea ?? null, lanterns: out };
  });
}

await page.goto(`${BASE}/dev/world-v6?poster=off&arrive=1`, { waitUntil: "domcontentloaded", timeout: 80000 });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 78, maxWidth: 1280, maxHeight: 968, everyNthFrame: 2 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 100 });
const werr = await page.evaluate(() => window.__worldError || null);
if (werr) throw new Error("world error " + werr);

// 1 load
const t1 = Date.now();
const f1 = await shot("1-load");
const p1 = await page.evaluate(() => ({ y: scrollY, wp: window.__worldProgress?.() ?? null }));
step({ step: "1-load", scrollY: p1.y, progress: p1.wp, file: f1 });

// 2 arrive: the travel starts ~900 ms after ready and lands at a4
const cardMs = await waitFor(() => !!window.__worldUi?.().card, 15000);
await settle();
await sleep(600);
const u2 = await ui();
const f2 = await shot("2-arrive-card");
const L2 = await lanternInfo();
const stops = await page.evaluate(() => window.__worldV6Debug.stopDepths());
const a4y = await page.evaluate((d) => window.__worldScrollFor(d), stops[3]);
const cardText = await page.evaluate(() => {
  const el = document.querySelector("[data-show][data-side]");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
});
step({
  step: "2-arrive",
  cardAfterMs: cardMs < 0 ? null : Date.now() - t1,
  scrollY: await page.evaluate(() => scrollY),
  a4ScrollY: Math.round(a4y),
  place: u2?.place,
  card: u2?.card,
  cardText,
  pulseInstance: L2.pulseInstance,
  lanterns17to20: L2.lanterns.slice(16, 20),
  file: f2,
});
// Two pulse phases, the crop around lanterns 16..20 (whichever are on screen).
const vis = L2.lanterns.slice(15, 20).filter((l) => l.onScreen);
if (vis.length) {
  const xs = vis.map((l) => l.x);
  const ys = vis.map((l) => l.y);
  const pad = 120;
  const clip = {
    x: Math.max(0, Math.min(...xs) - pad),
    y: Math.max(0, Math.min(...ys) - pad),
    width: 0,
    height: 0,
  };
  clip.width = Math.min(vp[0] - clip.x, Math.max(...xs) - clip.x + pad);
  clip.height = Math.min(vp[1] - clip.y, Math.max(...ys) - clip.y + pad);
  // Full-frame screenshots, cropped afterwards: puppeteer's `clip` is in
  // document coordinates and would scroll the page to the top to take it.
  const crops = [];
  for (let k = 0; k < 4; k++) {
    const f = path.join(OUT, `2b-phase${k}.png`);
    await page.screenshot({ path: f });
    crops.push(f);
    await sleep(650);
  }
  const yAfter = await page.evaluate(() => scrollY);
  fs.writeFileSync(path.join(OUT, "2b-clip.json"), JSON.stringify(clip));
  step({ step: "2b-lantern-phases", clip, crops, scrollYAfter: yAfter });
}

// 3 chip: scroll away
const awayD = stops[3] + (stops[4] - stops[3]) * 0.45;
const awayY = await page.evaluate((d) => window.__worldScrollFor(d), awayD);
await wheelTo(awayY);
await settle();
const chipMs = await waitFor(() => !!window.__worldUi?.().chip, 5000);
await sleep(500);
const u3 = await ui();
const f3 = await shot("3-chip");
const chipText = await page.evaluate(() => {
  const el = [...document.querySelectorAll("[data-show][data-dir]")][0];
  return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
});
step({ step: "3-chip", chipShown: chipMs >= 0, card: !!u3?.card, chip: u3?.chip, chipText, file: f3 });

// 4 back: scroll back to a4
await wheelTo(a4y);
await settle();
const backMs = await waitFor(() => !!window.__worldUi?.().card, 6000);
await sleep(500);
const u4 = await ui();
const f4 = await shot("4-card-back");
step({ step: "4-back", cardShown: backMs >= 0, chip: !!u4?.chip, card: u4?.card, file: f4 });

// 5 panel: click the structure itself
const hit = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const obj = sc.debugScene().getObjectByName("LM_TrailHut");
  const cam = sc.camera;
  const card = window.__worldUi().card;
  const inCard = (x, y) => card && x >= card.l && x <= card.r && y >= card.t && y <= card.b;
  let cx = innerWidth / 2;
  let cy = innerHeight / 2;
  if (obj) {
    const box = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    obj.updateWorldMatrix(true, true);
    const V = cam.position.constructor;
    obj.traverse((o) => {
      if (!o.geometry || !o.visible) return;
      o.geometry.computeBoundingBox?.();
      const bb = o.geometry.boundingBox;
      if (!bb) return;
      for (let i = 0; i < 8; i++) {
        const v = new V(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld).project(cam);
        const x = ((v.x + 1) / 2) * innerWidth;
        const y = ((1 - v.y) / 2) * innerHeight;
        box.min[0] = Math.min(box.min[0], x);
        box.min[1] = Math.min(box.min[1], y);
        box.max[0] = Math.max(box.max[0], x);
        box.max[1] = Math.max(box.max[1], y);
      }
    });
    cx = (box.min[0] + box.max[0]) / 2;
    cy = (box.min[1] + box.max[1]) / 2;
  }
  // Spiral out from the box centre until pickAnchor names a4, avoiding the card.
  for (let r = 0; r < 300; r += 6) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * r);
      const y = Math.round(cy + Math.sin((a / 16) * Math.PI * 2) * r);
      if (inCard(x, y)) continue;
      if (sc.pickAnchor(x, y) === "a4") return { x, y, cx: Math.round(cx), cy: Math.round(cy) };
      if (r === 0) break;
    }
  }
  return null;
});
if (!hit) throw new Error("no pixel on the Trail Hut picks a4");
await page.mouse.move(hit.x, hit.y);
await sleep(300);
await page.mouse.click(hit.x, hit.y);
const parkMs = await waitFor(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, 12000);
await waitFor(() => !!window.__worldUi?.().leader, 3000);
await sleep(700);
const u5 = await ui();
const f5 = await shot("5-panel");
const panelTitle = await page.evaluate(() => document.querySelector("#v4-panel-title")?.textContent ?? null);
step({ step: "5-panel", clickedAt: hit, parked: parkMs >= 0, panel: u5?.panel, leader: u5?.leader, panelTitle, file: f5 });

// 6 Esc
await page.keyboard.press("Escape");
const homeMs = await waitFor(() => (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== "hidden", 12000);
await settle();
const cardAgain = await waitFor(() => !!window.__worldUi?.().card, 6000);
await sleep(500);
const u6 = await ui();
const f6 = await shot("6-esc");
step({ step: "6-esc", home: homeMs >= 0, panelOpen: u6?.panel?.open, cardShown: cardAgain >= 0, focus: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName), file: f6 });

// 7 done: the last 4 lessons watched (the TUNE's finishing step)
const tDone = Date.now();
await page.evaluate(() => window.__worldTune({ frontier: 4, finished: 4, partial: 0 }));
const doneFiles = [];
for (const ms of [0, 300, 700, 1200, 2500]) {
  const wait = ms - (Date.now() - tDone);
  if (wait > 0) await sleep(wait);
  doneFiles.push(await shot(`7-done-${ms}`));
}
const u7 = await ui();
const L7 = await lanternInfo();
const doneText = await page.evaluate(() => {
  const els = [...document.querySelectorAll("[data-show]")].filter((e) => /done\./.test(e.innerText));
  return els.length ? els[0].innerText.replace(/\s+/g, " ").trim() : null;
});
step({ step: "7-done", done: u7?.done, doneText, card: !!u7?.card, place: u7?.place, a4LitAfter: L7.lanterns.filter((l) => l.state === 1).length, files: doneFiles });
await sleep(1500);
await cdp.send("Page.stopScreencast");

step({ step: "end", errors: [...new Set(errors)], api, frames: frames.length });
await browser.close();

if (video && frames.length > 2) {
  const list = [];
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].ts - frames[i].ts) : 0.5;
    list.push(`file 'frames/${frames[i].file}'`, `duration ${dur.toFixed(4)}`);
  }
  list.push(`file 'frames/${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(OUT, "concat.txt"), list.join("\n") + "\n");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(OUT, "concat.txt"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", path.join(ROOT, "flow.mp4")]);
  console.log("video: " + path.join(ROOT, "flow.mp4"));
}
fs.writeFileSync(path.join(OUT, "flow.json"), JSON.stringify(log, null, 1));
