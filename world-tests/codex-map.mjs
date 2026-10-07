/** Visual + interaction verification for /dev/world-codex. No real accounts. */
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const base = process.env.BASE_URL || "http://127.0.0.1:3111";
const out = process.env.OUT_DIR || "/tmp/codex-map-shots";
const quick = process.argv.includes("--quick");
const finalPass = process.argv.includes("--final-pass");
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--hide-scrollbars"],
});
const errors = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 1700));
async function clickText(page, text) {
  const handle = await page.evaluateHandle(text => [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(text)), text);
  const button = handle.asElement();
  assert(button, `missing button: ${text}`);
  await button.click();
  await handle.dispose();
}
try {
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && /THREE|Shader|codex map/.test(m.text())) errors.push(m.text()); });
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 });
  await page.goto(`${base}/dev/world-codex`, { waitUntil: "networkidle2", timeout: 90000 });
  await page.waitForSelector('main[data-ready="true"]', { timeout: 90000 });
  await settle();
  await page.screenshot({ path: `${out}/01-shore.png` });
  console.log("Initial scene", await page.evaluate(() => ({ ...document.documentElement.dataset })));
  if (finalPass) {
    await page.focus("#codex-resume");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#codex-area-title");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.id === "codex-resume");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector('main[data-ready="true"]');
    await page.click('button[aria-label="Travel to Creative Strategy"]');
    await settle();
    await page.click("#codex-area-6");
    await settle();
    assert.equal(await page.$eval("#codex-area-title", el => el.textContent), "Creative Strategy");
    await page.screenshot({ path: `${out}/07-pond.png` });
    await page.keyboard.press("Escape");
    await page.click('button[aria-label="Travel to Introduction"]');
    await page.setViewport({ width: 3428, height: 1230, deviceScaleFactor: 1 });
    await settle();
    await page.screenshot({ path: `${out}/08-shore-ultrawide.png` });
    assert.equal(Number(await page.evaluate(() => document.documentElement.dataset.codexDepth)), 0);
    console.log("Focus restoration, reduced motion, pond selection and coastal ultrawide verified");
  } else if (!quick) {
    for (const [depth, name] of [[.41, "02-viaduct"], [1, "03-summit"]]) {
      await page.evaluate(d => scrollTo(0, d * (document.documentElement.scrollHeight - innerHeight)), depth);
      await settle();
      await page.screenshot({ path: `${out}/${name}.png` });
    }
    for (const name of ["Introduction", "Fundamentals", "Video Ads I", "Video Ads II", "Static Ads", "AI Ads & Content", "Creative Strategy", "Job Board"]) {
      await page.click(`button[aria-label="Travel to ${name}"]`);
      await settle();
      const marker = await page.$(`button[aria-label^="${name},"]`);
      assert(marker, `missing ${name} marker`);
      // Open through the course index too: all eight areas must remain reachable
      // even if a distant landmark label is suppressed to prevent overlap.
      await clickText(page, "Course index");
      await page.evaluate(title => {
        const row = [...document.querySelectorAll("button")].find(b => b.querySelector("strong")?.textContent === title);
        row.click();
      }, name);
      await page.waitForSelector("#codex-area-title");
      assert.equal(await page.$eval("#codex-area-title", el => el.textContent), name);
      await page.keyboard.press("Escape");
      await clickText(page, "World");
      console.log(`Area verified: ${name}`);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await clickText(page, "Continue learning");
    await settle();
    assert.equal(await page.$eval("#codex-area-title", el => el.textContent), "Writing a hook that lands");
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval("#codex-area-title", el => el.textContent), "Video Ads I");
    await page.screenshot({ path: `${out}/04-area.png` });
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await page.setViewport({ width: 3428, height: 1230, deviceScaleFactor: 1 });
    await settle();
    await page.screenshot({ path: `${out}/05-ultrawide.png` });
    await clickText(page, "Hide interface");
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval('button[aria-pressed][class*="hideUi"]', el => el.getAttribute("aria-pressed")), "false");
    await page.close();

    const mobile = await browser.newPage();
    mobile.on("pageerror", e => errors.push(e.message));
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await mobile.goto(`${base}/dev/world-codex`, { waitUntil: "networkidle2" });
    assert.equal(await mobile.$$eval("canvas", elements => elements.length), 0, "phone must not mount WebGL");
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "phone must not overflow");
    await mobile.screenshot({ path: `${out}/06-phone.png`, fullPage: true });
    await mobile.close();

    const fallback = await browser.newPage();
    await fallback.setViewport({ width: 1400, height: 900 });
    await fallback.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.includes("webgl") ? null : original.call(this, type, ...args); };
    });
    await fallback.goto(`${base}/dev/world-codex`, { waitUntil: "networkidle2" });
    await fallback.waitForSelector('main[data-view="list"]');
    assert.equal(await fallback.$$eval("canvas", elements => elements.length), 0);
    assert(await fallback.evaluate(() => document.body.textContent.includes("3D world isn’t available")));
    await fallback.close();
  }
  assert.deepEqual(errors, [], "browser errors");
  console.log(`PASS — screenshots in ${out}`);
} finally { await browser.close(); }
