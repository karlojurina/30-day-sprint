/**
 * Round 1, UI: clickable places and labels that stay on screen.
 *
 *   node world-tests/v6-r1-ui.mjs <tag> [--hover] [--click] [--vp 1691x1278] frame ...
 *
 * Frames are named, never raw KEYS indices (the route agents change the key
 * count): aN is stop N from stopDepths(); aN+P / aN-P is P percent of the gap
 * to the next / previous stop past or before stop N (a6+20 = a fifth of the
 * way from the Great Tree to the Sky Island).
 *
 * --hover moves the real mouse onto the frame's own landmark (the first grid
 *   point the scene's pickAnchor() returns that place for) before the shot.
 * --click then clicks there and checks the camera parks at that place, closes
 *   it with Escape, and checks the same place opens from the keyboard (Tab to
 *   its label, Enter).
 *
 * Prints one JSON line per frame: marker modes, text label boxes, the hover
 * state, the pick point and the click results. PNGs go to
 * world-tests/shots/v6/round1/ui/<tag>-<frame>.png.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots", "v6", "round1", "ui");
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const tag = argv.shift();
const hover = argv.includes("--hover");
const click = argv.includes("--click");
let vp = [1691, 1278];
const frames = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--vp") vp = argv[++i].split("x").map(Number);
  else if (!argv[i].startsWith("--")) frames.push(argv[i]);
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setViewport({ width: vp[0], height: vp[1] });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6?poster=off", { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) {
  console.log("WORLD ERROR", err);
  process.exit(1);
}

async function settle(n = 4) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 50, timeout: 15000 }, c0, n);
  } catch {}
}

function depthOf(name, stops) {
  const m = /^a(\d)([+-]\d+)?$/.exec(name);
  if (!m) throw new Error("bad frame " + name);
  const i = Number(m[1]) - 1;
  const pct = m[2] ? Number(m[2]) / 100 : 0;
  if (pct > 0) return stops[i] + pct * ((i + 1 < stops.length ? stops[i + 1] : 1) - stops[i]);
  if (pct < 0) return stops[i] + pct * (stops[i] - (i > 0 ? stops[i - 1] : 0));
  return stops[i];
}

const stops = await page.evaluate(() => window.__worldV6Debug.stopDepths());

for (const name of frames) {
  const d = depthOf(name, stops);
  const id = "a" + /^a(\d)/.exec(name)[1];
  await page.mouse.move(2, vp[1] / 2);
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await settle(4);
  const out = { frame: name, depth: +d.toFixed(4) };
  if (hover || click) {
    // A point on the landmark: scan a grid, nearest to the landmark's visible middle first.
    const pt = await page.evaluate((id) => {
      const sc = window.__worldV6Debug;
      if (typeof sc.pickAnchor !== "function") return null;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const m = (window.__worldFrame?.markers ?? []).find((x) => x.id === id);
      const f = window.__worldV6Debug.markers?.find?.((x) => x.id === id);
      const r = f && Number.isFinite(f.rl) ? f : null;
      const cx = r ? Math.min(W - 40, Math.max(40, (Math.max(0, r.rl) + Math.min(W, r.rr)) / 2)) : m ? m.x : W / 2;
      const cy = r ? Math.min(H - 40, Math.max(40, (Math.max(0, r.rt) + Math.min(H, r.rb)) / 2)) : m ? m.y + 60 : H / 2;
      const pts = [];
      for (let y = 20; y < H; y += 24) for (let x = 20; x < W; x += 24) pts.push([x, y]);
      pts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [x, y] of pts) {
        // Skip the chrome: the pick only sees the canvas.
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest("[class*='stage']")) continue;
        if (sc.pickAnchor(x, y) === id) return [x, y];
      }
      return null;
    }, id);
    out.pickAt = pt;
    if (pt) {
      await page.mouse.move(pt[0] - 30, pt[1] - 30);
      await page.mouse.move(pt[0], pt[1], { steps: 4 });
      await new Promise((r) => setTimeout(r, 350));
      await settle(3);
      out.hover = await page.evaluate(() => {
        const stage = document.querySelector("[class*='stage']");
        const hovered = [...document.querySelectorAll("button[data-hover]")].map((b) => b.getAttribute("aria-label"));
        return { cursor: stage ? getComputedStyle(stage).cursor : null, hovered };
      });
    }
  }
  out.markers = await page.evaluate(() =>
    [...document.querySelectorAll("button[data-mode]")].map((b) => `${b.getAttribute("aria-label").split(",")[0]}:${b.dataset.mode}`).join(" | "),
  );
  out.labels = (await page.evaluate(() => window.__worldLabelBoxes?.() ?? [])).map((b) => ({
    id: b.id,
    box: [b.left, b.top, b.right, b.bottom].map(Math.round),
  }));
  const file = path.join(OUT, `${tag}-${name}.png`);
  await page.screenshot({ path: file });
  out.shot = path.relative(HERE, file);
  if (click && out.pickAt) {
    const [x, y] = out.pickAt;
    await page.mouse.click(x, y);
    try {
      await page.waitForFunction((id) => window.__worldFrame?.parkedId === id && window.__worldFrame.parkProgress > 0.98, { polling: 100, timeout: 12000 }, id);
      out.clickParks = true;
    } catch {
      out.clickParks = await page.evaluate(() => ({ parked: window.__worldFrame?.parkedId, p: window.__worldFrame?.parkProgress }));
    }
    await page.keyboard.press("Escape");
    try {
      await page.waitForFunction(() => window.__worldV6Debug.mode === "rail" && window.__worldFrame?.parkedId === null && document.body.style.overflow !== "hidden", { polling: 100, timeout: 15000 });
    } catch {}
    await settle(3);
    // Keyboard: focus the place's label button and press Enter.
    const focused = await page.evaluate((id) => {
      const names = { a1: "Introduction", a2: "Fundamentals", a3: "Video Ads I,", a4: "Video Ads II", a5: "Static Ads", a6: "AI Ads", a7: "Creative Strategy", a8: "Job Board" };
      const b = [...document.querySelectorAll("button[data-mode]")].find((x) => (x.getAttribute("aria-label") + ",").startsWith(names[id]));
      if (!b || b.dataset.mode === "hidden" || b.tabIndex < 0) return b ? b.dataset.mode : "none";
      b.focus();
      return document.activeElement === b ? "focused" : "not focused";
    }, id);
    out.keyboard = focused;
    if (focused === "focused") {
      await page.keyboard.press("Enter");
      try {
        await page.waitForFunction((id) => window.__worldFrame?.parkedId === id, { polling: 100, timeout: 8000 }, id);
        out.keyboardParks = true;
      } catch {
        out.keyboardParks = false;
      }
      await page.keyboard.press("Escape");
      try {
        await page.waitForFunction(() => window.__worldV6Debug.mode === "rail" && window.__worldFrame?.parkedId === null && document.body.style.overflow !== "hidden", { polling: 100, timeout: 15000 });
      } catch {}
    }
  }
  console.log(JSON.stringify(out));
}
if (errors.length) console.log("ERRORS", JSON.stringify(errors.slice(0, 6)));
await browser.close();
