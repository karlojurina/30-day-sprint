/**
 * Night on the student's clock, on the real page (2026-10-20 night; option D of
 * _admin/prds/map-review-2026-10-15/real_time_light.md). What the client test
 * (client-tests/night-clock.test.mjs) cannot reach: the clock's wiring in
 * WorldV6, the scene's wake and the light's ease, and the lake at the lowest
 * quality tier.
 *
 *   node world-tests/v6-night.mjs          (BASE_URL, default http://localhost:3111; never starts a server)
 *
 * The page's clock is a stand-in Date (evaluateOnNewDocument), set from here.
 * On the real GPU, /dev/world-v6?poster=off, 1691 x 1278. Rows:
 *   1. no ?tod at 23:00: the dev page stays on day (the pin every world test relies on);
 *   2. ?tod=clock at 23:00: the first frame is already night (no fade in at load);
 *   3. ?tod=clock, 20:00 to 20:30 on coming back to the tab: the factor follows
 *      (0.5), and with the map awake the change eases in (CLOCK.easeMs);
 *   4. the map asleep (45 s with no input): a change draws a frame or two and
 *      no more, lands at once, and the map stays asleep;
 *   5. the lake at tier 3, whose reflection is drawn once and kept until the
 *      camera moves: with the camera still, a change of the light draws it again.
 * And the morning on the same clock (2026-10-21):
 *   6. ?tod=clock at 07:30: the first frame is the morning (no fade in at load);
 *      ?tod=morning on a dev page the same, at any hour;
 *   7. ?tod=clock, 05:00 then 05:30 on coming back to the tab: the night eases
 *      off the morning (the morning under it all along);
 *   8. ?tod=clock, 09:00 then 09:30: the morning eases halfway into the day.
 * Takes about 2 minutes (row 4 waits for the map to fall asleep).
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3111";
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
const at = (h, m = 0) => new Date(2026, 9, 20, h, m, 0).getTime();

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 180000,
});

/** A fresh page on `query` with the page's clock at `ms` (local time). */
async function open(query, ms) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 });
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
  }, ms);
  await page.goto(`${BASE}/dev/world-v6?poster=off${query ? `&${query}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === "string", { timeout: 180000, polling: 200 });
  const err = await page.evaluate(() => window.__worldError ?? null);
  if (err) throw new Error(`the scene failed: ${err}`);
  return { ctx, page, errors };
}
const lightOf = (page) =>
  page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const l = sc.debugScene().userData.light;
    const st = l.stats();
    return { ...sc.nightInfo(), here: l.state.night, morningHere: l.state.morning, easing: st.nightEasing, idle: sc.qualityInfo().idle.phase, frames: window.__worldFrameCount ?? 0, passes: st.reflectionPasses, mode: st.reflectionMode };
  });
/** The page comes back to the tab: the clock watcher reads the clock (clock.ts watchClock). */
const visible = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

try {
  console.log("\n1. The dev page with no ?tod, at 23:00");
  {
    const { ctx, page, errors } = await open("", at(23));
    const l = await lightOf(page);
    ok(l.target === 0 && l.shown === 0 && l.here === 0, "stays on day (the pin the world tests rely on)", JSON.stringify(l));
    ok(errors.length === 0, "no page errors", errors.join(" | "));
    await ctx.close();
  }

  console.log("\n2. ?tod=clock at 23:00");
  {
    const { ctx, page } = await open("tod=clock", at(23));
    const l = await lightOf(page);
    ok(l.target === 1 && l.shown === 1 && l.here === 1 && l.easing === 0, "the first frame is night, with no fade in at load", JSON.stringify(l));
    await ctx.close();
  }

  console.log("\n3. ?tod=clock, 20:00 then 20:30 on coming back to the tab");
  const { ctx, page } = await open("tod=clock", at(20));
  {
    const l0 = await lightOf(page);
    ok(l0.target === 0 && l0.shown === 0, "20:00: day", JSON.stringify(l0));
    // Awake: input a moment ago (the idle ladder's active phase).
    await page.mouse.move(400, 400);
    await page.mouse.move(420, 410);
    await page.evaluate((v) => window.__clock.set(v), at(20, 30));
    await visible(page);
    await sleep(120);
    const l1 = await lightOf(page);
    ok(Math.abs(l1.target - 0.5) < 1e-9, "the factor follows the clock (0.5 at 20:30)", String(l1.target));
    ok(l1.easing === 1 && l1.shown > 0 && l1.shown < 0.5, "with the map awake it eases in", JSON.stringify(l1));
    await sleep(1900);
    const l2 = await lightOf(page);
    ok(Math.abs(l2.shown - 0.5) < 1e-9 && l2.easing === 0, "and lands on 0.5 within the ease (1.5 s)", JSON.stringify(l2));
  }

  console.log("\n4. The map asleep");
  {
    // 45 s after the last input the idle ladder sleeps (perf.ts IdleLadder).
    const t0 = Date.now();
    while ((await lightOf(page)).idle !== "asleep" && Date.now() - t0 < 70000) await sleep(1000);
    const a = await lightOf(page);
    ok(a.idle === "asleep", "falls asleep with no input", `${Math.round((Date.now() - t0) / 1000)} s`);
    await sleep(2000);
    const b = await lightOf(page);
    ok(b.frames === a.frames, "and draws nothing while asleep", `${b.frames - a.frames} frames in 2 s`);
    await page.evaluate((v) => window.__clock.set(v), at(23));
    await visible(page);
    await sleep(1500);
    const c = await lightOf(page);
    ok(c.target === 1 && c.shown === 1 && c.here === 1 && c.easing === 0, "a change lands at once (no ease while asleep)", JSON.stringify(c));
    ok(c.frames - b.frames >= 1 && c.frames - b.frames <= 2, "in the one wake (a frame or two)", `${c.frames - b.frames} frames`);
    await sleep(3000);
    const d = await lightOf(page);
    ok(d.frames === c.frames && d.idle === "asleep", "then the map sleeps on", `${d.frames - c.frames} frames in 3 s, ${d.idle}`);
  }
  await ctx.close();

  console.log("\n5. The lake at tier 3 (its reflection drawn once and kept)");
  {
    const { ctx: c5, page: p5 } = await open("tod=clock", at(15));
    await p5.evaluate(() => {
      const sc = window.__worldV6Debug;
      sc.setQualityTier(3);
      const d = sc.stopDepths()[4];
      window.scrollTo(0, Math.round(sc.scrollYForDepth(d)));
      sc.seedDepth(d);
    });
    await sleep(3000);
    const a = await lightOf(p5);
    ok(a.mode === "frozen", "tier 3 keeps the reflection (frozen)", a.mode);
    await p5.mouse.move(300, 300);
    await sleep(1500);
    const b = await lightOf(p5);
    ok(b.passes === a.passes, "with the camera and the light still, it is not drawn again", `${b.passes - a.passes} passes`);
    await p5.evaluate((v) => window.__clock.set(v), at(23));
    await visible(p5);
    await sleep(2500);
    const c = await lightOf(p5);
    ok(c.shown === 1, "the night came in", String(c.shown));
    ok(c.passes > b.passes, "a change of the light draws the reflection again (the camera never moved)", `${c.passes - b.passes} passes`);
    await c5.close();
  }

  console.log("\n6. The morning: ?tod=clock at 07:30, and ?tod=morning at 23:00");
  {
    const { ctx: c6, page: p6, errors: e6 } = await open("tod=clock", at(7, 30));
    const l = await lightOf(p6);
    ok(l.target === 0 && l.shown === 0 && l.morningTarget === 1 && l.morningShown === 1 && l.morningHere === 1 && l.here === 0 && l.easing === 0, "07:30: the first frame is the morning, with no fade in at load", JSON.stringify(l));
    ok(e6.length === 0, "no page errors", e6.join(" | "));
    await c6.close();
    const { ctx: c6b, page: p6b } = await open("tod=morning", at(23));
    const m = await lightOf(p6b);
    ok(m.target === 0 && m.morningTarget === 1 && m.morningShown === 1 && m.morningHere === 1, "?tod=morning at 23:00: the morning (the address wins over the clock)", JSON.stringify(m));
    await c6b.close();
  }

  console.log("\n7. ?tod=clock, 05:00 then 05:30 on coming back to the tab: the night goes off the morning");
  {
    const { ctx: c7, page: p7 } = await open("tod=clock", at(5));
    const a = await lightOf(p7);
    ok(a.target === 1 && a.shown === 1 && a.morningTarget === 1 && a.here === 1 && a.morningHere === 0, "05:00: the full night, the morning under it and none of it shown", JSON.stringify(a));
    await p7.mouse.move(400, 400);
    await p7.mouse.move(420, 410);
    await p7.evaluate((v) => window.__clock.set(v), at(5, 30));
    await visible(p7);
    await sleep(120);
    const b = await lightOf(p7);
    ok(Math.abs(b.target - 0.5) < 1e-9 && b.morningTarget === 1 && b.easing === 1 && b.shown < 1 && b.shown > 0.5, "05:30: the night factor follows (0.5) and eases in, the map awake", JSON.stringify(b));
    await sleep(1900);
    const c = await lightOf(p7);
    ok(Math.abs(c.shown - 0.5) < 1e-9 && c.morningShown === 1 && c.easing === 0 && c.morningHere > 0.1 && c.morningHere < 0.25, "and lands: the night at 82%, the morning showing through it", JSON.stringify(c));
    await c7.close();
  }

  console.log("\n8. ?tod=clock, 09:00 then 09:30: the morning eases halfway into the day");
  {
    const { ctx: c8, page: p8 } = await open("tod=clock", at(9));
    const a = await lightOf(p8);
    ok(a.target === 0 && a.morningTarget === 1 && a.morningShown === 1, "09:00: the morning", JSON.stringify(a));
    await p8.mouse.move(400, 400);
    await p8.mouse.move(420, 410);
    await p8.evaluate((v) => window.__clock.set(v), at(9, 30));
    await visible(p8);
    await sleep(120);
    const b = await lightOf(p8);
    ok(Math.abs(b.morningTarget - 0.5) < 1e-9 && b.easing === 1 && b.morningShown < 1 && b.morningShown > 0.5, "09:30: the morning factor follows (0.5) and eases out, the map awake", JSON.stringify(b));
    await sleep(1900);
    const c = await lightOf(p8);
    ok(Math.abs(c.morningShown - 0.5) < 1e-9 && Math.abs(c.morningHere - 0.5) < 1e-9 && c.easing === 0 && c.shown === 0, "and lands halfway between the morning and the day", JSON.stringify(c));
    await c8.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
