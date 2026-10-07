/**
 * B9: the a7 park through the telescope (world_art_bible_v6.md 1.17) on the
 * real page at 1691x1278 on the GPU.
 *
 *   node world-tests/v6-b9-telescope.mjs
 *
 * Seeds the a7 stop, parks a7 and captures the flight at q 0.25, 0.5, 0.75
 * and at rest; checks the rest pose looks within 5 degrees of the Creative
 * Strategy constellation (layout SKY_MARKS[6]) through an 18 degree lens;
 * then leaves the park and checks the camera lands back on its rail pose.
 * Out: world-tests/shots/v6/B9-composition/tel-*.png and a PASS/FAIL list.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6/B9-composition");
const BASE = process.env.BASE_URL || "http://localhost:3111";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 120000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
await page.setViewport({ width: 1691, height: 1278 });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 80000, polling: 300 });
let fails = 0;
const check = (ok, name, info) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${info}`);
};
const pose = () =>
  page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const c = sc.camera;
    const d = c.getWorldDirection(new c.position.constructor());
    return { p: c.position.toArray(), d: d.toArray(), fov: c.fov, q: window.__worldFrame.flight, park: window.__worldFrame.parkProgress };
  });
await page.evaluate(() => window.__worldTune && window.__worldTune({ lock: "open", frontier: 8 }));
const d7 = await page.evaluate(() => window.__worldV6Debug.stopDepths()[6]);
await page.evaluate((d) => {
  const sc = window.__worldV6Debug;
  window.scrollTo(0, sc.scrollYForDepth(d));
  sc.seedDepth(d);
}, d7);
await new Promise((r) => setTimeout(r, 800));
const rail0 = await pose();
await page.evaluate(() => window.__worldPark("a7"));
for (const q of [0.25, 0.5, 0.75]) {
  await page.waitForFunction((q) => window.__worldFrame.flight >= q, { polling: 16, timeout: 30000 }, q);
  await page.screenshot({ path: path.join(OUT, `tel-q${q}.png`) });
  const p = await pose();
  console.log(`q ${q}: at ${p.p.map((v) => v.toFixed(0)).join(", ")} fov ${p.fov.toFixed(1)}`);
}
await page.waitForFunction(() => window.__worldFrame.parkProgress >= 0.999 && window.__worldFrame.flight >= 0.999, { polling: 50, timeout: 30000 });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: path.join(OUT, "tel-rest.png") });
const rest = await pose();
const mark = await page.evaluate(() => {
  const m = window.__worldV6Debug.ctx.layout.SKY_MARKS[6];
  return [m.az, m.el];
});
const a = (mark[0] * Math.PI) / 180;
const e = (mark[1] * Math.PI) / 180;
const md = [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
const ang = (Math.acos(Math.min(1, md[0] * rest.d[0] + md[1] * rest.d[1] + md[2] * rest.d[2])) * 180) / Math.PI;
check(ang <= 5, "at rest the view is on the Creative Strategy constellation", `${ang.toFixed(1)} deg off its centre`);
check(Math.abs(rest.fov - 18) < 0.5, "at rest the lens is 18", rest.fov.toFixed(1));
await page.evaluate(() => window.__worldPark(null));
await page.waitForFunction(() => window.__worldFrame.flight >= 0.5 && window.__worldFrame.parkProgress <= 0.5, { polling: 16, timeout: 30000 });
await page.screenshot({ path: path.join(OUT, "tel-return-mid.png") });
await page.waitForFunction(() => window.__worldFrame.parkedId === null && window.__worldFrame.parkProgress === 0 && window.__worldFrame.flight >= 0.999, { polling: 50, timeout: 30000 });
await new Promise((r) => setTimeout(r, 300));
const back = await pose();
const dp = Math.hypot(...back.p.map((v, i) => v - rail0.p[i]));
check(dp < 0.5 && Math.abs(back.fov - rail0.fov) < 0.1, "leaving the park lands on the rail pose", `${dp.toFixed(2)} units off, fov ${back.fov.toFixed(1)} (rail ${rail0.fov.toFixed(1)})`);
check(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
