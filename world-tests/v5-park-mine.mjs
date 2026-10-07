/**
 * Grey pass 3: park flights across the mine's rock, on the live page.
 *
 *   node --import ./world-tests/v5-ts-resolve.mjs --experimental-strip-types --no-warnings world-tests/v5-park-mine.mjs
 *
 * Opens places whose flight has one end underground (a3 in the cave, a4 in
 * the tunnel) from outside and inside, and closes them, sampling the camera
 * every page frame at 860x480 (above the phone cutoff, faster frames). Every sample must be in
 * open air (>= 3 above the terrain) or inside a mine void (layout.mineMargin
 * >= 1). Before the rail glide, a flight to a3 from a1 ran straight through
 * the hills, and any flight in the cave was clamped up to the ground above it.
 * Prints PASS/FAIL per case; exits 1 on any failure.
 */
import puppeteer from "puppeteer-core";
import { mineMargin } from "../src/lib/world-v5/layout.ts";
import { terrainHeight } from "../src/lib/world-v5/terrain.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
let failed = 0;
const errors = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  await page.setViewport({ width: 860, height: 480 });
  await page.goto(BASE + "/dev/world-v5", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
  // Open mode, so every place can be opened.
  await page.evaluate(() => window.__worldTune({ lock: "open" }));
  // Record the camera every frame the page draws.
  await page.evaluate(() => {
    window.__camLog = [];
    const tick = () => {
      const c = window.__worldCamera?.();
      const f = window.__worldFrame;
      if (c && f) window.__camLog.push([c.x, c.y, c.z, f.parkProgress]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const seedAt = async (id) => {
    await page.evaluate((id) => {
      const sc = window.__worldV5Debug;
      const d = sc.depthFor(id);
      window.scrollTo(0, sc.scrollYForDepth(d));
      sc.seedDepth(d);
    }, id);
    await sleep(800);
  };
  const run = async (name, fn, target) => {
    await page.evaluate(() => (window.__camLog.length = 0));
    await fn();
    // target: the anchor the flight ends parked at, or null for back on the rail.
    await page.waitForFunction(
      (id) => {
        const f = window.__worldFrame;
        if (!f) return false;
        return id === null ? f.parkProgress === 0 && f.parkedId === null : f.parkedId === id && f.parkProgress >= 0.999;
      },
      { polling: 100, timeout: 150000 },
      target,
    );
    await sleep(400);
    const log = await page.evaluate(() => window.__camLog.slice());
    let bad = null;
    let worst = Infinity;
    for (const [x, y, z] of log) {
      const air = y - terrainHeight(x, z);
      const inVoid = mineMargin(x, y, z);
      const ok = air >= 3 || inVoid >= 1;
      const score = Math.max(air - 3, inVoid - 1);
      if (score < worst) worst = score;
      if (!ok && !bad) bad = { at: [x, y, z].map(Math.round), air: +air.toFixed(1), inVoid: +inVoid.toFixed(1) };
    }
    const pass = log.length >= 4 && !bad;
    if (!pass) failed++;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  (${log.length} frames; ${bad ? "in rock at " + JSON.stringify(bad) : "tightest margin " + worst.toFixed(1)})`);
  };
  const parked = (id) => id;
  const onRail = null;

  await seedAt("a1");
  await run("a1 (shore, on the rail) -> open a3 (the cave)", () => page.evaluate(() => window.__worldPark("a3")), parked("a3"));
  await run("a3 open -> close (back to the a1 scroll)", () => page.evaluate(() => window.__worldPark(null)), onRail);
  await seedAt("a3");
  await run("at the a3 stop -> open a3", () => page.evaluate(() => window.__worldPark("a3")), parked("a3"));
  await run("a3 open -> switch to a4 (the lift)", () => page.evaluate(() => window.__worldPark("a4")), parked("a4"));
  await run("a4 open -> switch to a6 (the forest)", () => page.evaluate(() => window.__worldPark("a6")), parked("a6"));
  await run("a6 open -> close (back to the a3 scroll, in the cave)", () => page.evaluate(() => window.__worldPark(null)), onRail);
  await seedAt("a5");
  await run("a5 (lake, on the rail) -> open a4 (down the shaft)", () => page.evaluate(() => window.__worldPark("a4")), parked("a4"));
  await run("a4 open -> close (back to a5)", () => page.evaluate(() => window.__worldPark(null)), onRail);
  await seedAt("a2");
  await run("a2 -> open a2 (outdoors, the old flight, unchanged)", () => page.evaluate(() => window.__worldPark("a2")), parked("a2"));
  await run("a2 open -> close", () => page.evaluate(() => window.__worldPark(null)), onRail);
  const fatal = errors.filter((e) => !/Download the React DevTools/.test(e));
  if (fatal.length) failed++;
  console.log(`  ${fatal.length ? "FAIL" : "PASS"}  no console errors  (${fatal.length ? fatal.slice(0, 3).join(" | ") : 0})`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
