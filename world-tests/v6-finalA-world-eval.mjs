/**
 * Final pass (fixer "world"): boot the page, seed a stop (or a depth), run a
 * JS snippet in the page (the file's text is the body of an async function
 * of (sc, THREE-less helpers)) and print its JSON result. For measuring:
 * picking ground points under screen pixels, reading object bounds.
 *
 *   STATE=mid node world-tests/v6-finalA-world-eval.mjs stop:a3 snippet.js
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const [where, file] = process.argv.slice(2);
const IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const LESSONS = [8, 10, 22, 22, 25, 22, 22, 14];
const PROG = {
  p0: { lessons: LESSONS, done: [0, 0, 0, 0, 0, 0, 0, 0], current: 0, next: 1, finished: 0 },
  mid: { lessons: LESSONS, done: [8, 10, 22, 18, 0, 0, 0, 0], current: 3, next: 19, finished: 3 + 18 / 22 },
  all: { lessons: LESSONS, done: LESSONS.slice(), current: 8, next: 0, finished: 8 },
};
const p = PROG[process.env.STATE || "mid"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
await page.evaluate(
  (d, p) => {
    const sc = window.__worldV6Debug;
    sc.setProgress(p.finished);
    sc.setWorldProgress({ lessons: p.lessons, done: p.done, current: p.current, next: p.next });
    sc.debugPose?.(null);
    sc.park(null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  },
  where.startsWith("stop:") ? await page.evaluate((i) => window.__worldV6Debug.stopDepths()[i], IDS.indexOf(where.slice(5))) : Number(where),
  p,
);
await sleep(1200);
const body = fs.readFileSync(file, "utf8");
const res = await page.evaluate(`(async () => { const sc = window.__worldV6Debug; ${body} })()`);
console.log(JSON.stringify(res));
await browser.close();
