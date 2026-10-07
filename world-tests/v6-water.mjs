/**
 * Detail pass 3, the falls: render the dive and cave keys and dump what draws there.
 *
 *   node world-tests/v6-water.mjs <tag> [keys...]          frames at 960x600 (default 12 14 16.6 19 20.6 23)
 *   node world-tests/v6-water.mjs <tag> layers <key>       the same key with each water layer hidden in turn
 *   node world-tests/v6-water.mjs <tag> info <key>         the visible water/mist meshes and their live materials
 *
 * Writes world-tests/shots/v6-pass3/water/<tag>-k<key>[-<layer>].png.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "shots/v6-pass3/water");
fs.mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3111";
const TRAIL_KEYS = 77;
const argv = process.argv.slice(2);
const tag = argv[0] || "x";
const mode = argv[1] === "layers" || argv[1] === "info" ? argv[1] : "keys";
const keys = (mode === "keys" ? argv.slice(1) : argv.slice(2)).map(Number).filter((n) => !Number.isNaN(n));
if (!keys.length) keys.push(...(mode === "keys" ? [12, 14, 16.6, 19, 20.6, 23] : [19]));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
await page.setViewport({ width: 960, height: 600 });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

async function frames(n) {
  const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
  try {
    await page.waitForFunction((c0, n) => (window.__worldFrameCount ?? 0) >= c0 + n, { polling: 100, timeout: 20000 }, c0, n);
  } catch {}
}
async function depthForU(u) {
  return page.evaluate((u) => {
    const r = window.__worldV6Debug.debugRail();
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    return r.depthOfS((lo + hi) / 2);
  }, u);
}
async function seed(d) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug;
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
  }, d);
  await frames(3);
}
async function info() {
  return page.evaluate(() => {
    const f = window.__worldFrame;
    const c = window.__worldCamera();
    const scene = window.__worldV6Debug.debugScene();
    const cam = window.__worldV6Debug.camera;
    const rows = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isSprite) return;
      let vis = true;
      for (let e = o; e; e = e.parent) if (!e.visible) vis = false;
      if (!vis) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const nm = (o.name || "") + " " + (m && m.name ? m.name : "");
      if (!/curtain|water|mist|spray|pool|fall|glow|ray/i.test(nm)) return;
      rows.push({ mesh: o.name, mat: m && m.name, type: m && m.type, transparent: m && m.transparent, blending: m && m.blending, uBack: m && m.uniforms && m.uniforms.uBack ? +m.uniforms.uBack.value.toFixed(3) : undefined, uDay: m && m.uniforms && m.uniforms.uDay ? +m.uniforms.uDay.value.toFixed(3) : undefined, renderOrder: o.renderOrder });
    });
    return { cam: [Math.round(c.x), Math.round(c.y), Math.round(c.z)], pitch: +c.pitch.toFixed(1), yaw: c.yaw !== undefined ? +c.yaw.toFixed(1) : null, fov: cam.fov, triangles: f.triangles, calls: f.calls, fog: scene.fog ? { near: Math.round(scene.fog.near), far: Math.round(scene.fog.far), color: scene.fog.color.getHexString() } : null, rows };
  });
}
async function setHidden(names, hide) {
  await page.evaluate(
    (names, hide) => {
      const scene = window.__worldV6Debug.debugScene();
      window.__waterHidden = window.__waterHidden || new Map();
      scene.traverse((o) => {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (names.includes(o.name) || (m && names.includes(m.name))) {
          if (hide) {
            window.__waterHidden.set(o, o.visible);
            o.visible = false;
          } else if (window.__waterHidden.has(o)) o.visible = window.__waterHidden.get(o);
        }
      });
      window.__worldV6Debug.seedDepth(window.__worldFrame.depth);
    },
    names,
    hide,
  );
  await frames(3);
}

for (const key of keys) {
  const d = await depthForU(key / (TRAIL_KEYS - 1));
  await seed(d);
  const i = await info();
  console.log(`key ${key}: cam ${i.cam} pitch ${i.pitch} fov ${i.fov} ${i.triangles}/${i.calls} fog ${JSON.stringify(i.fog)}`);
  if (mode === "info") {
    for (const r of i.rows) console.log("   ", JSON.stringify(r));
    continue;
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-k${key}.png`) });
  if (process.env.PROBE) {
    // PROBE=1: paint the curtain's foam colour and the pool's foam colour pure red / green.
    await page.waitForFunction(
      () => {
        let n = 0;
        window.__worldV6Debug.debugScene().traverse((o) => {
          if ((o.name === "Landmark_a3_Water" || o.name === "Pool") && o.material && o.material.uniforms) n++;
        });
        return n >= 2;
      },
      { timeout: 60000, polling: 500 },
    );
    await seed(d);
    await page.screenshot({ path: path.join(OUT, `${tag}-k${key}.png`) });
    await page.evaluate(() => {
      const scene = window.__worldV6Debug.debugScene();
      const by = (n) => {
        let f = null;
        scene.traverse((o) => {
          if (!f && o.name === n && o.material) f = o;
        });
        return f;
      };
      window.__probeBy = by;
      const c = by("Landmark_a3_Water").material;
      const p = by("Pool").material;
      window.__probeWas = [c.uniforms.uFoamC.value.clone(), p.uniforms.uFoam.value.clone()];
      c.uniforms.uFoamC.value.setRGB(1, 0, 0);
      p.uniforms.uFoam.value.setRGB(0, 1, 0);
      window.__worldV6Debug.seedDepth(window.__worldFrame.depth);
    });
    await frames(3);
    await page.screenshot({ path: path.join(OUT, `${tag}-k${key}-probe.png`) });
    await setHidden(["UG_Mist", "FallsSpray"], true);
    await page.screenshot({ path: path.join(OUT, `${tag}-k${key}-probe-nomist.png`) });
    await setHidden(["UG_Mist", "FallsSpray"], false);
    await page.evaluate(() => {
      window.__probeBy("Landmark_a3_Water").material.uniforms.uFoamC.value.copy(window.__probeWas[0]);
      window.__probeBy("Pool").material.uniforms.uFoam.value.copy(window.__probeWas[1]);
    });
  }
  if (mode === "layers") {
    for (const [lab, names] of [
      ["nocurtain", ["Landmark_a3_Water"]],
      ["nomist", ["UG_Mist", "FallsSpray"]],
      ["noglow", ["UG_Glow"]],
      ["nopool", ["Pool"]],
    ]) {
      await setHidden(names, true);
      await page.screenshot({ path: path.join(OUT, `${tag}-k${key}-${lab}.png`) });
      await setHidden(names, false);
    }
  }
}
if (errors.length) console.log("errors:", errors.slice(0, 5));
await browser.close();
