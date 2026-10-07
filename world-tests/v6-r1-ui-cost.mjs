/**
 * Round 1, UI: what the clickable landmarks cost, and how a locked one behaves.
 *
 *   node world-tests/v6-r1-ui-cost.mjs
 *
 * At the Great Tree (a6): the per-frame marker projection (now with each
 * landmark's surface samples on screen) timed over 2,000 calls, and one
 * pickAnchor() timed over 300 calls. Then "look" mode with the frontier at
 * a3: hovering the tree shows the not-allowed cursor, clicking it shows the
 * "finish ... first" hint and does not park. The tuning is reset after.
 */
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1691, height: 1278 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v6?poster=off", { waitUntil: "domcontentloaded", timeout: 80000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
const go = (i) =>
  page.evaluate(async (i) => {
    const sc = window.__worldV6Debug;
    const d = sc.stopDepths()[i];
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
    await new Promise((r) => setTimeout(r, 700));
  }, i);
await go(5);
const cost = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  let t0 = performance.now();
  for (let i = 0; i < 2000; i++) sc.projectMarkers();
  const project = (performance.now() - t0) / 2000;
  t0 = performance.now();
  let id = null;
  for (let i = 0; i < 300; i++) id = sc.pickAnchor(1028, 524);
  const pick = (performance.now() - t0) / 300;
  t0 = performance.now();
  for (let i = 0; i < 300; i++) sc.pickAnchor(200, 300);
  const miss = (performance.now() - t0) / 300;
  return { projectMarkersMs: +project.toFixed(4), pickHitMs: +pick.toFixed(4), pickMissMs: +miss.toFixed(4), picked: id };
});
console.log(JSON.stringify(cost));

await page.evaluate(() => window.__worldTune({ lock: "look", frontier: 2 }));
await go(5);
await page.mouse.move(900, 400);
await page.mouse.move(1028, 524, { steps: 4 });
await new Promise((r) => setTimeout(r, 400));
const locked = await page.evaluate(() => ({
  cursor: getComputedStyle(document.querySelector("[class*='stage']")).cursor,
  hovered: [...document.querySelectorAll("button[data-hover]")].map((b) => b.getAttribute("aria-label")),
}));
await page.mouse.click(1028, 524);
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => ({
  hint: document.querySelector("[role='status']")?.textContent ?? null,
  parked: window.__worldFrame?.parkedId ?? null,
  scrollLocked: document.body.style.overflow === "hidden",
}));
console.log(JSON.stringify({ locked, after }));
await page.evaluate(() => window.__worldTune("reset"));
await browser.close();
