/**
 * The loading posters on the student's clock, on the real page (2026-10-21,
 * the night posters; option D of
 * _admin/prds/map-review-2026-10-15/real_time_light.md). What
 * client-tests/night-posters.test.mjs cannot reach: the head's script in a
 * real page before its first paint, the stylesheets' pick, the files the page
 * asks for, and what is painted from the first frame until the live map (on a
 * phone, the place's picture) has taken over.
 *
 *   node world-tests/v6-night-posters.mjs [--out=<dir>]   (BASE_URL, default http://localhost:3111; never starts a server)
 *
 * The page's clock is a stand-in Date (evaluateOnNewDocument), so the head's
 * script reads it too. The page is /dev/world-app?catalog=course&p=p0&
 * discount=locked&tod=clock: the dev page asked to follow the clock, as /world
 * does with nothing asked (/world needs a login). A first load compiles the
 * page; every load after it is in a fresh browser context (an empty cache).
 * Painted frames come from the screencast (Page.startScreencast), timed from
 * the page's navigation start. Rows:
 *   1. 12:00, desktop 1691x1278: <html> says day from the first frame, the page
 *      asks for k0.webp and no night file, and gets the bytes on disk (by day
 *      the page shows what it showed: client-tests/night-posters.test.mjs
 *      compares the files with the ones at f0fb483).
 *   2. 23:00, desktop: night from the first frame; k0-night.webp and no day
 *      file of a place that has a night; every frame the page painted, from
 *      its first to the live map's 1.5 s after it took over, nearer the night
 *      poster than the day poster (both fitted to the window as the page fits
 *      them); its layout shift the day load's (the pick moves nothing); the
 *      frames at 0.05 s, the first paint, 1 s and the take over saved.
 *   3. 12:00 and 23:00, phone 390x844 (3x, touch): the loading card's ground
 *      and the place's picture (a1, the Landing, for a new student), day and
 *      night; at 23:00 no day file at all, every frame the page painted
 *      nearer the 23:00 phone's last frame than the 12:00 one's, and the
 *      layout shift the 12:00 load's.
 *   4. 20:30 and 05:30, desktop: halfway through the fades, night (the
 *      attribute and k0-night.webp).
 *   5. Poster mode (?poster=on) at 23:00: the nine posters, k0 to a6 their
 *      night twins, a7 and a8 their one file, all loaded.
 *   6. The clock crossing the line with the page open (20:20, then 20:30 on
 *      coming back to the tab): poster mode's posters, the phone's picture
 *      and <html> turn to night.
 * And the morning posters (2026-10-21, the morning on the same clock):
 *   7. 07:30, desktop: morning from the first frame; k0-morning.webp and no
 *      day or night file of a place that has a morning; every frame the page
 *      painted, from its first to the live map's 1.5 s after it took over,
 *      nearer the page's morning than its day and its night; its layout shift
 *      the day load's. The morning and the day are closer than the day and
 *      the night (the page's shade over the poster's sea weighs as much as
 *      the light), so the references are the page's own frames at 12:00,
 *      23:00 and 07:30 (the poster showing at 1 s, and the live map alone),
 *      a frame of one flat colour is the page's blank ground before any
 *      picture (counted apart), and every other frame is fitted as a fade
 *      from that ground toward each reference before its distance is read.
 *   8. 07:30, phone: the loading card's ground and the Landing's picture in
 *      the morning, no day or night file, and in every frame the band where a
 *      picture shows (under the header: the card's ground, then the place's
 *      picture) dark (before any picture, counted apart) or, fitted as a fade
 *      from dark, nearer the morning's pictures than the day's and the
 *      night's.
 *   9. Round the morning's two lines: 05:30 night, 05:40 morning, 09:15
 *      morning, 09:45 day (the attribute and the files).
 *  10. Poster mode at 07:30: k0 to a6 their morning twins, a7 and a8 their
 *      one file, all loaded.
 *  11. The clock crossing the morning's lines with the page open (05:30 then
 *      05:40, and 09:25 then 09:35): poster mode's posters, the phone's
 *      picture and <html> follow.
 * Pictures in --out (default world-tests/shots/v6/night-posters/). About 3 minutes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASE = process.env.BASE_URL || "http://localhost:3111";
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const OUT = path.resolve(arg("out", path.join(HERE, "shots/v6/night-posters")));
fs.mkdirSync(OUT, { recursive: true });
const POSTERS = path.join(ROOT, "public/world-v6/posters");
const Q = "catalog=course&p=p0&discount=locked&tod=clock";
const DESKTOP = { width: 1691, height: 1278, deviceScaleFactor: 1 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const NIGHT_IDS = ["k0", "a1", "a2", "a3", "a4", "a5", "a6"];
/** The places with a morning twin: the same seven (poster.ts MORNING_POSTER_IDS). */
const MORNING_IDS = NIGHT_IDS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const fails = [];
const ok = (c, label, detail = "") => {
  if (c) {
    pass++;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fails.push(label);
    console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0).getTime();
// The poster layer's two blurred 48 px stills, as the stylesheet has them (world.module.css .poster::before).
const STILLS = (() => {
  const css = fs.readFileSync(path.join(ROOT, "src/components/world-v6/world.module.css"), "utf8");
  const uri = (sel) => {
    const i = css.indexOf(`${sel} {`);
    return i < 0 ? null : /url\("(data:image\/webp;base64,[^"]+)"\)/.exec(css.slice(i, css.indexOf("}", i)))?.[1] ?? null;
  };
  return { day: uri(".poster::before"), night: uri(':global(html[data-world-tod="night"]) .poster::before'), morning: uri(':global(html[data-world-tod="morning"]) .poster::before') };
})();
/** What the stylesheets give the poster layer's still, its landing poster and the loading card (if up), as the page computes them. */
const drawn = (page) =>
  page.evaluate(() => {
    const layer = document.querySelector("main picture")?.parentElement;
    const card = document.querySelector("[data-world-card]");
    const img = document.querySelector("main picture img");
    return {
      still: layer ? getComputedStyle(layer, "::before").backgroundImage : null,
      landing: img ? getComputedStyle(img).backgroundImage : null,
      card: card ? getComputedStyle(card).backgroundImage : null,
    };
  });
const hhmm = (h, m = 0) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;

// ── Pixels: 64 x 48, by ffmpeg ──────────────────────────────────────────────
const SMALL = "scale=64:48:flags=area";
const pixels = (file, vf = SMALL) => execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
/** A poster fitted to the window as the page fits it (object-fit: cover, centred), then 64 x 48. */
const posterPixels = (file, vw, vh) => pixels(file, `scale=-2:${vh},crop=${vw}:${vh},${SMALL}`);
const dist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
/**
 * The morning rows: how far a painted frame is from showing `ref`, allowing
 * for a fade from the page's blank ground (`blank`, its first paint, before
 * any picture): the frame is fitted as blank + a (ref - blank), a in 0..1,
 * and the mean channel distance left over is returned. A frame mid fade-in of
 * the morning picture is then nearest the morning, where a plain distance
 * found its darkness nearer the night.
 */
const fitRes = (f, blank, ref) => {
  let vw = 0;
  let ww = 0;
  for (let i = 0; i < f.length; i++) {
    const w = ref[i] - blank[i];
    vw += (f[i] - blank[i]) * w;
    ww += w * w;
  }
  const a = ww > 0 ? Math.min(1, Math.max(0, vw / ww)) : 0;
  let s = 0;
  for (let i = 0; i < f.length; i++) s += Math.abs(f[i] - blank[i] - a * (ref[i] - blank[i]));
  return s / f.length;
};
/** A frame of one flat colour (the page's ground before any picture): its luma's standard deviation under 2. */
const flat = (px) => {
  let s = 0;
  let s2 = 0;
  const n = px.length / 3;
  for (let i = 0; i < px.length; i += 3) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    s += l;
    s2 += l * l;
  }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) < 2;
};

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 300000,
});

/**
 * Loads the dev page in a fresh context with the clock at `ms`. Records the
 * poster files asked for, <html>'s data-world-tod at the first animation frame
 * and at DOMContentLoaded, when the landing's poster layer let go
 * (data-show removed) and when the phone's picture came on, and, with `cast`,
 * every painted frame.
 */
async function load({ viewport, ms, query = Q, cast = false, until }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument((start) => {
    const Real = Date;
    let fixed = start;
    let base = performance.now();
    window.__clock = {
      set(v) {
        fixed = v;
        base = performance.now();
      },
    };
    class StandIn extends Real {
      constructor(...a) {
        if (a.length) super(...a);
        else super(fixed + (performance.now() - base));
      }
      static now() {
        return fixed + (performance.now() - base);
      }
    }
    window.Date = StandIn;
    const tod = () => document.documentElement.getAttribute("data-world-tod");
    window.__tod = { raf: undefined, dcl: undefined };
    // Layout shifts, summed (the posters' pick must add none: the day's load and the night's shift alike).
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      window.__cls = null;
    }
    requestAnimationFrame(() => (window.__tod.raf = tod()));
    document.addEventListener("DOMContentLoaded", () => {
      window.__tod.dcl = tod();
      // When the landing's poster layer lets go (revealLive) and when the phone's picture comes on.
      new MutationObserver((recs) => {
        for (const r of recs) {
          const el = r.target;
          if (r.attributeName === "data-show" && !el.hasAttribute("data-show") && el.querySelector("picture") && window.__letGo === undefined) window.__letGo = performance.now();
          if (r.attributeName === "data-on" && el.hasAttribute("data-on") && el.parentElement && /phoneWorld/.test(el.parentElement.className) && window.__phoneOn === undefined) window.__phoneOn = performance.now();
        }
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-show", "data-on"] });
    });
  }, ms);
  const asked = [];
  const bodies = new Map();
  page.on("response", async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith("/world-v6/posters/") || !u.pathname.endsWith(".webp")) return;
    asked.push(path.basename(u.pathname));
    try {
      bodies.set(path.basename(u.pathname), await res.buffer());
    } catch {
      /* a redirect or an aborted body */
    }
  });
  let cdp = null;
  const frames = [];
  if (cast) {
    cdp = await page.createCDPSession();
    cdp.on("Page.screencastFrame", (f) => {
      frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  }
  await page.goto(`${BASE}/dev/world-app?${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const t0 = Date.now();
  if (until) {
    while (Date.now() - t0 < 60000 && !(await page.evaluate(until))) await sleep(100);
  }
  return { ctx, page, cdp, frames, asked, bodies, errors };
}

/** The timeline of a load: navigation start, first paint, the let go and the phone's picture, ms since navigation start. */
async function timeline(page) {
  return page.evaluate(() => {
    const fp = performance.getEntriesByType("paint").find((e) => e.name === "first-paint");
    return { origin: performance.timeOrigin, firstPaint: fp ? fp.startTime : null, letGo: window.__letGo ?? null, phoneOn: window.__phoneOn ?? null, tod: window.__tod, cls: window.__cls, now: performance.now() };
  });
}

/** The frame on screen at `t` ms after navigation start (the last painted at or before it), or null. */
function frameAt(frames, origin, t) {
  let best = null;
  for (const f of frames) if (f.ts - origin <= t) best = f;
  return best;
}
/** The first frame painted at or after `t` ms (an event's first picture), or null. */
function frameAfter(frames, origin, t) {
  for (const f of frames) if (f.ts - origin >= t) return f;
  return null;
}
/**
 * The frames asked for, in time order: 0.05 s, the first paint, 1 s and the
 * take over (the first frame painted after it), each saved as `<prefix>-<name>.jpg`.
 */
function pickFrames(frames, tl, prefix, takeAt, takeLabel) {
  const fp = tl.firstPaint ?? 0;
  const out = [];
  const add = (f, t, name, label) => {
    if (!f) return;
    const before = f.ts - tl.origin < fp - 1;
    out.push({ t, file: saveFrame(f, path.join(OUT, `${prefix}-${name}.jpg`)), label: before ? `${label}: nothing painted yet (the page before)` : label });
  };
  const at50 = frameAt(frames, tl.origin, 50);
  const first = frameAfter(frames, tl.origin, fp - 1);
  if (first && first === at50) add(at50, 50, "0.05s", `0.05 s (the first paint was at ${(fp / 1000).toFixed(3)} s)`);
  else {
    add(at50, 50, "0.05s", "0.05 s");
    add(first, fp, "first-paint", `${(fp / 1000).toFixed(2)} s, the first paint`);
  }
  add(frameAt(frames, tl.origin, 1000), 1000, "1s", "1 s");
  add(frameAfter(frames, tl.origin, takeAt), takeAt, "takeover", `${(takeAt / 1000).toFixed(2)} s, ${takeLabel}`);
  return out.sort((a, b) => a.t - b.t);
}
const saveFrame = (f, file) => (fs.writeFileSync(file, Buffer.from(f.data, "base64")), file);

/** A labelled sheet of pictures, drawn in a page of the same browser. */
async function sheet(file, items, cols, cellW, cellH, title) {
  const page = await browser.newPage();
  const rows = Math.ceil(items.length / cols);
  await page.setViewport({ width: cols * cellW + (cols + 1) * 8, height: rows * (cellH + 30) + 8 + 40, deviceScaleFactor: 1 });
  const cells = items
    .map((it) => `<figure style="margin:0"><div style="width:${cellW}px;height:${cellH}px;background:#000"><img src="data:image/${it.file.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(it.file).toString("base64")}" style="width:100%;height:100%;object-fit:contain;display:block"></div><figcaption style="font:600 13px ui-monospace,monospace;color:#ddd;padding:6px 2px">${it.label}</figcaption></figure>`)
    .join("");
  await page.setContent(`<body style="margin:0;padding:8px;background:#16131c"><p style="margin:4px 2px 12px;font:600 15px ui-monospace,monospace;color:#fff">${title}</p><div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px">${cells}</div></body>`, { waitUntil: "load" });
  await page.screenshot({ path: file, type: "jpeg", quality: 90 });
  await page.close();
}

try {
  // Compile the page (the dev server's first request), then every load is warm.
  {
    const w = await load({ viewport: DESKTOP, ms: at(12), until: () => window.__worldReady === true });
    await w.ctx.close();
  }

  console.log("\n1. 12:00, desktop: the day");
  const cls = {};
  /** The page's own frames at each hour, the morning rows' references: the poster showing (1 s) and the live map alone. */
  const deskRef = {};
  {
    const L = await load({ viewport: DESKTOP, ms: at(12), cast: true, until: () => window.__worldReady === true && window.__letGo !== undefined });
    await sleep(1500);
    const tl = await timeline(L.page);
    deskRef.day = { live: path.join(OUT, "desktop-1200-live.png"), poster: path.join(OUT, "desktop-1200-1s.jpg") };
    await L.page.screenshot({ path: deskRef.day.live, captureBeyondViewport: false });
    await L.cdp.send("Page.stopScreencast");
    const f1 = frameAt(L.frames, tl.origin, 1000);
    if (f1) saveFrame(f1, deskRef.day.poster);
    ok(tl.tod.raf === "day" && tl.tod.dcl === "day", "<html> says day from the first frame", JSON.stringify(tl.tod));
    const d = await drawn(L.page);
    ok(!!STILLS.day && d.still?.includes(STILLS.day) && /\/k0\.webp/.test(d.landing ?? ""), "the stylesheets draw the day's still and landing poster", `${d.still?.slice(0, 60)}…, ${d.landing}`);
    ok(L.asked.includes("k0.webp") && !L.asked.some((f) => f.endsWith("-night.webp") || f.endsWith("-morning.webp")), "the page asks for k0.webp and no night or morning file", L.asked.join(" "));
    const body = L.bodies.get("k0.webp");
    ok(!!body && body.equals(fs.readFileSync(path.join(POSTERS, "k0.webp"))), "and gets the bytes on disk", body ? `${body.length} bytes` : "no body");
    ok(L.errors.length === 0, "no page errors", L.errors.join(" | "));
    cls.desktopDay = tl.cls;
    await L.ctx.close();
  }

  console.log("\n2. 23:00, desktop: night from the first frame to the live map");
  const dayRef = posterPixels(path.join(POSTERS, "k0.webp"), DESKTOP.width, DESKTOP.height);
  const nightRef = posterPixels(path.join(POSTERS, "k0-night.webp"), DESKTOP.width, DESKTOP.height);
  {
    const L = await load({ viewport: DESKTOP, ms: at(23), cast: true, until: () => window.__worldReady === true && window.__letGo !== undefined });
    await sleep(1500);
    const tl = await timeline(L.page);
    const live = path.join(OUT, "desktop-2300-live.png");
    await L.page.screenshot({ path: live, captureBeyondViewport: false });
    await L.cdp.send("Page.stopScreencast");
    ok(tl.tod.raf === "night" && tl.tod.dcl === "night", "<html> says night from the first frame", JSON.stringify(tl.tod));
    const d = await drawn(L.page);
    ok(!!STILLS.night && d.still?.includes(STILLS.night) && /\/k0-night\.webp/.test(d.landing ?? ""), "the stylesheets draw the night's still and landing poster", `${d.still?.slice(0, 60)}…, ${d.landing}`);
    ok(L.asked.includes("k0-night.webp"), "the page asks for k0-night.webp", L.asked.join(" "));
    const dayFiles = L.asked.filter((f) => NIGHT_IDS.includes(f.replace(".webp", "")));
    ok(dayFiles.length === 0, "and for no day poster of a place that has a night", dayFiles.join(" ") || "none");
    // Every frame the page painted (from its first paint), against the two posters.
    const painted = L.frames.filter((f) => f.ts - tl.origin >= (tl.firstPaint ?? 0) - 1);
    const tmp = path.join(OUT, "_frame.jpg");
    let worst = Infinity;
    let worstAt = null;
    const dayish = [];
    for (const f of painted) {
      saveFrame(f, tmp);
      const px = pixels(tmp);
      const margin = dist(px, dayRef) - dist(px, nightRef);
      if (margin < worst) {
        worst = margin;
        worstAt = Math.round(f.ts - tl.origin);
      }
      if (margin <= 0) dayish.push(Math.round(f.ts - tl.origin));
    }
    fs.rmSync(tmp, { force: true });
    ok(painted.length > 10 && dayish.length === 0, `no day frame: all ${painted.length} painted frames, ${Math.round(tl.firstPaint)} ms to ${Math.round(tl.now)} ms, nearer the night poster than the day poster`, `the closest call ${worst.toFixed(1)} (mean channel distance, day minus night) at ${worstAt} ms${dayish.length ? `; nearer day at ${dayish.join(", ")} ms` : ""}`);
    // The frames asked for: 0.05 s, 1 s, the take over (the poster layer letting go), and the first paint and the live map alone.
    const shots = pickFrames(L.frames, tl, "desktop-2300", tl.letGo, "the live map takes over (the poster fades out)");
    shots.push({ file: live, label: `${((tl.letGo + 1500) / 1000).toFixed(2)} s, the live map alone` });
    deskRef.night = { live, poster: path.join(OUT, "desktop-2300-1s.jpg") };
    const f1 = frameAt(L.frames, tl.origin, 1000);
    if (f1) saveFrame(f1, deskRef.night.poster);
    console.log(`        first paint ${Math.round(tl.firstPaint)} ms, the live map took over at ${Math.round(tl.letGo)} ms`);
    ok(tl.cls !== null && Math.abs(tl.cls - cls.desktopDay) < 1e-6, "no layout shift from the pick: the night load shifts what the day load shifts", `layout shift ${tl.cls} at 23:00, ${cls.desktopDay} at 12:00`);
    await sheet(path.join(OUT, "load-2300-desktop.jpg"), shots, 3, 560, 423, `23:00 on the student's clock, desktop 1691 x 1278: the load, ${painted.length} painted frames, none nearer the day poster`);
    ok(L.errors.length === 0, "no page errors", L.errors.join(" | "));
    await L.ctx.close();
  }

  console.log("\n3. The phone, 12:00 and 23:00: the loading card and the place's picture");
  const phoneOn = () => !!document.querySelector('[class*="phoneWorld"] img[data-on]');
  const phoneFinal = {};
  {
    const L = await load({ viewport: PHONE, ms: at(12), until: phoneOn });
    await sleep(800);
    const tl = await timeline(L.page);
    phoneFinal.day = path.join(OUT, "phone-1200-final.png");
    await L.page.screenshot({ path: phoneFinal.day, captureBeyondViewport: false });
    const src = await L.page.evaluate(() => document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src"));
    ok(tl.tod.raf === "day" && src === "/world-v6/posters/a1.webp" && !L.asked.some((f) => f.endsWith("-night.webp")), "12:00: the day, the Landing's day picture, no night file", `${JSON.stringify(tl.tod)} ${src} [${L.asked.join(" ")}]`);
    cls.phoneDay = tl.cls;
    await L.ctx.close();
  }
  {
    const L = await load({ viewport: PHONE, ms: at(23), cast: true, until: phoneOn });
    await sleep(800);
    const tl = await timeline(L.page);
    phoneFinal.night = path.join(OUT, "phone-2300-final.png");
    await L.page.screenshot({ path: phoneFinal.night, captureBeyondViewport: false });
    await L.cdp.send("Page.stopScreencast");
    const src = await L.page.evaluate(() => document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src"));
    ok(tl.tod.raf === "night" && tl.tod.dcl === "night", "23:00: <html> says night from the first frame", JSON.stringify(tl.tod));
    ok(src === "/world-v6/posters/a1-night.webp", "the Landing's night picture", src);
    ok(L.asked.includes("k0-night.webp") && L.asked.every((f) => f.endsWith("-night.webp")), "the loading card's ground and the picture are the night files, and no day file is asked for", L.asked.join(" "));
    const dRef = pixels(phoneFinal.day);
    const nRef = pixels(phoneFinal.night);
    const painted = L.frames.filter((f) => f.ts - tl.origin >= (tl.firstPaint ?? 0) - 1);
    const tmp = path.join(OUT, "_frame.jpg");
    let worst = Infinity;
    const dayish = [];
    for (const f of painted) {
      saveFrame(f, tmp);
      const px = pixels(tmp);
      const margin = dist(px, dRef) - dist(px, nRef);
      worst = Math.min(worst, margin);
      if (margin <= 0) dayish.push(Math.round(f.ts - tl.origin));
    }
    fs.rmSync(tmp, { force: true });
    ok(painted.length > 3 && dayish.length === 0, `no day frame: all ${painted.length} painted frames nearer the 23:00 phone's last frame than the 12:00 one's`, `the closest call ${worst.toFixed(1)}${dayish.length ? `; nearer day at ${dayish.join(", ")} ms` : ""}`);
    const shots = pickFrames(L.frames, tl, "phone-2300", tl.phoneOn, "the place's picture comes on");
    shots.push({ file: phoneFinal.night, label: `${((tl.phoneOn + 800) / 1000).toFixed(2)} s, settled` });
    shots.push({ file: phoneFinal.day, label: "12:00, the same, to compare" });
    console.log(`        first paint ${Math.round(tl.firstPaint)} ms, the picture on at ${Math.round(tl.phoneOn)} ms`);
    ok(tl.cls !== null && Math.abs(tl.cls - cls.phoneDay) < 1e-6, "no layout shift from the pick on the phone either", `layout shift ${tl.cls} at 23:00, ${cls.phoneDay} at 12:00`);
    await sheet(path.join(OUT, "load-2300-phone.jpg"), shots, shots.length, 250, 541, `23:00 on the student's clock, phone 390 x 844: the load, ${painted.length} painted frames, none nearer the day`);
    ok(L.errors.length === 0, "no page errors", L.errors.join(" | "));
    await L.ctx.close();
  }

  console.log("\n4. Halfway through the fades: 20:30 and 05:30");
  for (const [h, m] of [[20, 30], [5, 30]]) {
    const L = await load({ viewport: DESKTOP, ms: at(h, m), until: () => !!document.querySelector("main picture") });
    await sleep(400);
    const tl = await timeline(L.page);
    ok(tl.tod.raf === "night" && L.asked.includes("k0-night.webp") && !L.asked.includes("k0.webp"), `${hhmm(h, m)}: the night poster (the factor 0.5, the live map's light 82% night)`, `${JSON.stringify(tl.tod)} [${L.asked.join(" ")}]`);
    await L.ctx.close();
  }

  console.log("\n5. Poster mode at 23:00: the nine posters");
  {
    const allOn = () => {
      const p = window.__worldPoster?.();
      return !!p && p.layerShown && p.shown.every((s) => s.loaded);
    };
    const L = await load({ viewport: DESKTOP, ms: at(23), query: `${Q}&poster=on`, until: allOn });
    const srcs = await L.page.evaluate(() => [...document.querySelector("main picture").parentElement.querySelectorAll("img")].map((i) => i.getAttribute("src")));
    const want = ["k0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].map((id) => `/world-v6/posters/${id}${NIGHT_IDS.includes(id) ? "-night" : ""}.webp`);
    ok(JSON.stringify(srcs) === JSON.stringify(want), "k0 to a6 their night twins, a7 and a8 their one file", srcs.map((s) => path.basename(s ?? "none")).join(" "));
    ok(await L.page.evaluate(allOn), "all nine loaded");
    ok(!L.asked.some((f) => NIGHT_IDS.includes(f.replace(".webp", ""))), "no day file of a place that has a night", L.asked.join(" "));
    await L.page.screenshot({ path: path.join(OUT, "postermode-2300.png"), captureBeyondViewport: false });
    await L.ctx.close();
  }

  console.log("\n6. The clock crossing the line with the page open (20:20, then 20:30 on coming back to the tab)");
  {
    const allOn = () => {
      const p = window.__worldPoster?.();
      return !!p && p.layerShown && p.shown.every((s) => s.loaded);
    };
    const L = await load({ viewport: DESKTOP, ms: at(20, 20), query: `${Q}&poster=on`, until: allOn });
    const before = await L.page.evaluate(() => [document.documentElement.getAttribute("data-world-tod"), ...[...document.querySelector("main picture").parentElement.querySelectorAll("img")].map((i) => i.getAttribute("src"))]);
    ok(before[0] === "day" && before.slice(1).every((s) => !s.includes("-night")), "poster mode at 20:20: the day posters", before.map((s) => path.basename(s)).join(" "));
    await L.page.evaluate((v) => window.__clock.set(v), at(20, 30));
    await L.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await L.page.waitForFunction(allOn, { timeout: 20000, polling: 100 });
    await sleep(300);
    const after = await L.page.evaluate(() => [document.documentElement.getAttribute("data-world-tod"), ...[...document.querySelector("main picture").parentElement.querySelectorAll("img")].map((i) => i.getAttribute("src"))]);
    ok(after[0] === "night" && after.slice(1, 8).every((s) => s.endsWith("-night.webp")) && after.slice(8).every((s) => !s.includes("-night")), "at 20:30 the night posters, k0 to a6, loaded", after.map((s) => path.basename(s)).join(" "));
    await L.ctx.close();
  }
  {
    const L = await load({ viewport: PHONE, ms: at(20, 20), until: phoneOn });
    const before = await L.page.evaluate(() => document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src"));
    await L.page.evaluate((v) => window.__clock.set(v), at(20, 30));
    await L.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await L.page.waitForFunction(() => /-night\.webp$/.test(document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src") ?? ""), { timeout: 10000, polling: 100 }).catch(() => {});
    const after = await L.page.evaluate(() => [document.documentElement.getAttribute("data-world-tod"), document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src")]);
    ok(before === "/world-v6/posters/a1.webp" && after[0] === "night" && after[1] === "/world-v6/posters/a1-night.webp", "the phone's picture: the day's at 20:20, the night's at 20:30", `${before} then ${after.join(" ")}`);
    await L.ctx.close();
  }

  console.log("\n7. 07:30, desktop: the morning from the first frame to the live map");
  {
    const L = await load({ viewport: DESKTOP, ms: at(7, 30), cast: true, until: () => window.__worldReady === true && window.__letGo !== undefined });
    await sleep(1500);
    const tl = await timeline(L.page);
    const live = path.join(OUT, "desktop-0730-live.png");
    await L.page.screenshot({ path: live, captureBeyondViewport: false });
    await L.cdp.send("Page.stopScreencast");
    ok(tl.tod.raf === "morning" && tl.tod.dcl === "morning", "<html> says morning from the first frame", JSON.stringify(tl.tod));
    const d = await drawn(L.page);
    ok(!!STILLS.morning && d.still?.includes(STILLS.morning) && /\/k0-morning\.webp/.test(d.landing ?? ""), "the stylesheets draw the morning's still and landing poster", `${d.still?.slice(0, 60)}…, ${d.landing}`);
    ok(L.asked.includes("k0-morning.webp"), "the page asks for k0-morning.webp", L.asked.join(" "));
    const others = L.asked.filter((f) => MORNING_IDS.includes(f.replace(/(-night)?\.webp$/, "")) && !f.endsWith("-morning.webp"));
    ok(others.length === 0, "and for no day or night poster of a place that has a morning", others.join(" ") || "none");
    // The references are the page's own frames, as the student sees them (the
    // page's shade lies over the poster, darkening the sea, and the live map
    // has its interface): the poster showing at 1 s and the live map alone, at
    // 12:00, 23:00 and here at 07:30.
    deskRef.morning = { live, poster: path.join(OUT, "desktop-0730-1s.jpg") };
    const f1 = frameAt(L.frames, tl.origin, 1000);
    if (f1) saveFrame(f1, deskRef.morning.poster);
    const refPx = Object.fromEntries(Object.entries(deskRef).map(([k, r]) => [k, [pixels(r.poster), pixels(r.live)]]));
    const painted = L.frames.filter((f) => f.ts - tl.origin >= (tl.firstPaint ?? 0) - 1);
    const tmp = path.join(OUT, "_frame.jpg");
    let blank = null;
    let blanks = 0;
    let worst = Infinity;
    let worstAt = null;
    const off = [];
    for (const f of painted) {
      saveFrame(f, tmp);
      const px = pixels(tmp);
      if (flat(px)) {
        blank ??= px;
        blanks++;
        continue;
      }
      const b = blank ?? px.map(() => 0);
      const res = (k) => Math.min(...refPx[k].map((r) => fitRes(px, b, r)));
      const margin = Math.min(res("day"), res("night")) - res("morning");
      if (margin < worst) {
        worst = margin;
        worstAt = Math.round(f.ts - tl.origin);
      }
      if (margin <= 0) off.push(Math.round(f.ts - tl.origin));
    }
    fs.rmSync(tmp, { force: true });
    ok(painted.length > 10 && painted.length - blanks > 10 && off.length === 0, `no day or night frame: all ${painted.length} painted frames, ${Math.round(tl.firstPaint)} ms to ${Math.round(tl.now)} ms, ${blanks} of them the page's blank ground before any picture and every other one nearer the page's morning than its day and its night`, `the closest call ${worst.toFixed(1)} (mean channel distance left once fitted, the nearer of day and night minus morning) at ${worstAt} ms${off.length ? `; nearer another at ${off.join(", ")} ms` : ""}`);
    const shots = pickFrames(L.frames, tl, "desktop-0730", tl.letGo, "the live map takes over (the poster fades out)");
    shots.push({ file: live, label: `${((tl.letGo + 1500) / 1000).toFixed(2)} s, the live map alone` });
    console.log(`        first paint ${Math.round(tl.firstPaint)} ms, the live map took over at ${Math.round(tl.letGo)} ms`);
    ok(tl.cls !== null && Math.abs(tl.cls - cls.desktopDay) < 1e-6, "no layout shift from the pick: the morning load shifts what the day load shifts", `layout shift ${tl.cls} at 07:30, ${cls.desktopDay} at 12:00`);
    await sheet(path.join(OUT, "load-0730-desktop.jpg"), shots, 3, 560, 423, `07:30 on the student's clock, desktop 1691 x 1278: the load, ${painted.length} painted frames, none nearer the day or the night poster`);
    ok(L.errors.length === 0, "no page errors", L.errors.join(" | "));
    await L.ctx.close();
  }

  console.log("\n8. The phone at 07:30: the loading card and the place's picture in the morning");
  {
    const L = await load({ viewport: PHONE, ms: at(7, 30), cast: true, until: phoneOn });
    await sleep(800);
    const tl = await timeline(L.page);
    phoneFinal.morning = path.join(OUT, "phone-0730-final.png");
    await L.page.screenshot({ path: phoneFinal.morning, captureBeyondViewport: false });
    await L.cdp.send("Page.stopScreencast");
    const src = await L.page.evaluate(() => document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src"));
    ok(tl.tod.raf === "morning" && tl.tod.dcl === "morning", "07:30: <html> says morning from the first frame", JSON.stringify(tl.tod));
    ok(src === "/world-v6/posters/a1-morning.webp", "the Landing's morning picture", src);
    ok(L.asked.includes("k0-morning.webp") && L.asked.every((f) => f.endsWith("-morning.webp")), "the loading card's ground and the picture are the morning files, and no day or night file is asked for", L.asked.join(" "));
    // On the phone a picture shows in one band, under the header: first the
    // loading card's ground (the opening's poster, cover), then the place's
    // picture at the top of the list. Only that band is read (the list and the
    // card are the same at every hour); a band still dark is the page before
    // any picture (counted apart); every other is fitted as a fade from the
    // dark band toward each hour's picture: the opening's poster as the card's
    // ground shows it, and the place's picture as the 12:00, 23:00 and 07:30
    // loads ended on it.
    const BAND = "crop=iw:ih*0.26:0:ih*0.10,scale=48:24:flags=area";
    const band = (file) => pixels(file, BAND);
    const ground = (file) => pixels(file, `scale=-2:${PHONE.height},crop=${PHONE.width}:${PHONE.height},${BAND}`);
    const refs = {
      day: [band(phoneFinal.day), ground(path.join(POSTERS, "k0.webp"))],
      night: [band(phoneFinal.night), ground(path.join(POSTERS, "k0-night.webp"))],
      morning: [band(phoneFinal.morning), ground(path.join(POSTERS, "k0-morning.webp"))],
    };
    const lumaOf = (px) => {
      let l = 0;
      for (let i = 0; i < px.length; i += 3) l += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return l / (px.length / 3);
    };
    const painted = L.frames.filter((f) => f.ts - tl.origin >= (tl.firstPaint ?? 0) - 1);
    const tmp = path.join(OUT, "_frame.jpg");
    let dark = null;
    let blanks = 0;
    let worst = Infinity;
    const off = [];
    for (const f of painted) {
      saveFrame(f, tmp);
      const px = band(tmp);
      if (lumaOf(px) < 45) {
        dark ??= px;
        blanks++;
        continue;
      }
      const g = dark ?? px.map(() => 20);
      const res = (k) => Math.min(...refs[k].map((r) => fitRes(px, g, r)));
      const margin = Math.min(res("day"), res("night")) - res("morning");
      worst = Math.min(worst, margin);
      if (margin <= 0) off.push(Math.round(f.ts - tl.origin));
    }
    fs.rmSync(tmp, { force: true });
    ok(painted.length > 3 && painted.length - blanks > 1 && off.length === 0, `no day or night frame: all ${painted.length} painted frames, ${blanks} of them before any picture and every other one's picture nearer the morning's than the day's and the night's`, `the closest call ${worst.toFixed(1)} (the picture band, fitted as a fade from the dark band)${off.length ? `; nearer another at ${off.join(", ")} ms` : ""}`);
    const shots = pickFrames(L.frames, tl, "phone-0730", tl.phoneOn, "the place's picture comes on");
    shots.push({ file: phoneFinal.morning, label: `${((tl.phoneOn + 800) / 1000).toFixed(2)} s, settled` });
    shots.push({ file: phoneFinal.day, label: "12:00, the same, to compare" });
    shots.push({ file: phoneFinal.night, label: "23:00, the same, to compare" });
    console.log(`        first paint ${Math.round(tl.firstPaint)} ms, the picture on at ${Math.round(tl.phoneOn)} ms`);
    ok(tl.cls !== null && Math.abs(tl.cls - cls.phoneDay) < 1e-6, "no layout shift from the pick on the phone either", `layout shift ${tl.cls} at 07:30, ${cls.phoneDay} at 12:00`);
    await sheet(path.join(OUT, "load-0730-phone.jpg"), shots, shots.length, 250, 541, `07:30 on the student's clock, phone 390 x 844: the load, ${painted.length} painted frames, none nearer the day or the night`);
    ok(L.errors.length === 0, "no page errors", L.errors.join(" | "));
    await L.ctx.close();
  }

  console.log("\n9. Round the morning's lines: 05:30, 05:40, 09:15, 09:45");
  for (const [h, m, want, file] of [[5, 30, "night", "k0-night.webp"], [5, 40, "morning", "k0-morning.webp"], [9, 15, "morning", "k0-morning.webp"], [9, 45, "day", "k0.webp"]]) {
    const L = await load({ viewport: DESKTOP, ms: at(h, m), until: () => !!document.querySelector("main picture") });
    await sleep(400);
    const tl = await timeline(L.page);
    const k0s = L.asked.filter((f) => /^k0(-night|-morning)?\.webp$/.test(f));
    ok(tl.tod.raf === want && k0s.length === 1 && k0s[0] === file, `${hhmm(h, m)}: the ${want} poster`, `${JSON.stringify(tl.tod)} [${L.asked.join(" ")}]`);
    await L.ctx.close();
  }

  console.log("\n10. Poster mode at 07:30: the nine posters");
  {
    const allOn = () => {
      const p = window.__worldPoster?.();
      return !!p && p.layerShown && p.shown.every((s) => s.loaded);
    };
    const L = await load({ viewport: DESKTOP, ms: at(7, 30), query: `${Q}&poster=on`, until: allOn });
    const srcs = await L.page.evaluate(() => [...document.querySelector("main picture").parentElement.querySelectorAll("img")].map((i) => i.getAttribute("src")));
    const want = ["k0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"].map((id) => `/world-v6/posters/${id}${MORNING_IDS.includes(id) ? "-morning" : ""}.webp`);
    ok(JSON.stringify(srcs) === JSON.stringify(want), "k0 to a6 their morning twins, a7 and a8 their one file", srcs.map((s) => path.basename(s ?? "none")).join(" "));
    ok(await L.page.evaluate(allOn), "all nine loaded");
    ok(!L.asked.some((f) => MORNING_IDS.includes(f.replace(/(-night)?\.webp$/, "")) && !f.endsWith("-morning.webp")), "no day or night file of a place that has a morning", L.asked.join(" "));
    await L.page.screenshot({ path: path.join(OUT, "postermode-0730.png"), captureBeyondViewport: false });
    await L.ctx.close();
  }

  console.log("\n11. The clock crossing the morning's lines with the page open");
  {
    const allOn = () => {
      const p = window.__worldPoster?.();
      return !!p && p.layerShown && p.shown.every((s) => s.loaded);
    };
    const srcsOf = (page) => page.evaluate(() => [document.documentElement.getAttribute("data-world-tod"), ...[...document.querySelector("main picture").parentElement.querySelectorAll("img")].map((i) => i.getAttribute("src"))]);
    for (const [[h0, m0], [h1, m1], from, to] of [
      [[5, 30], [5, 40], "night", "morning"],
      [[9, 25], [9, 35], "morning", "day"],
    ]) {
      const L = await load({ viewport: DESKTOP, ms: at(h0, m0), query: `${Q}&poster=on`, until: allOn });
      const before = await srcsOf(L.page);
      await L.page.evaluate((v) => window.__clock.set(v), at(h1, m1));
      await L.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await L.page.waitForFunction(allOn, { timeout: 20000, polling: 100 });
      await sleep(300);
      const after = await srcsOf(L.page);
      const setOf = (srcs) => srcs.slice(1, 8).map((s) => (s.endsWith("-night.webp") ? "night" : s.endsWith("-morning.webp") ? "morning" : "day"));
      const fixed = (srcs) => srcs.slice(8).every((s) => !/-(night|morning)\.webp$/.test(s));
      ok(before[0] === from && setOf(before).every((t) => t === from) && fixed(before), `poster mode at ${hhmm(h0, m0)}: the ${from} posters`, before.map((s) => path.basename(s)).join(" "));
      ok(after[0] === to && setOf(after).every((t) => t === to) && fixed(after), `at ${hhmm(h1, m1)} the ${to} posters, k0 to a6, loaded`, after.map((s) => path.basename(s)).join(" "));
      await L.ctx.close();
    }
    const L = await load({ viewport: PHONE, ms: at(9, 25), until: phoneOn });
    const before = await L.page.evaluate(() => document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src"));
    await L.page.evaluate((v) => window.__clock.set(v), at(9, 35));
    await L.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await L.page.waitForFunction(() => /\/a1\.webp$/.test(document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src") ?? ""), { timeout: 10000, polling: 100 }).catch(() => {});
    const after = await L.page.evaluate(() => [document.documentElement.getAttribute("data-world-tod"), document.querySelector('[class*="phoneWorld"] img')?.getAttribute("src")]);
    ok(before === "/world-v6/posters/a1-morning.webp" && after[0] === "day" && after[1] === "/world-v6/posters/a1.webp", "the phone's picture: the morning's at 09:25, the day's at 09:35", `${before} then ${after.join(" ")}`);
    await L.ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fails.length} failed (pictures in ${OUT})`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
