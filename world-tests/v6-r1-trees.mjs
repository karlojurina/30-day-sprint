/**
 * Round 1, trees and steps: render frames on the real GPU in one page load,
 * for the "weird thing on top of the trees" and the last floating step.
 *
 *   node world-tests/v6-r1-trees.mjs jobs.json outDir
 *
 * jobs.json is an array of frames. The depth comes from one of:
 *   { "between": [3, 4, 0.6] }     stopDepths()[3] to stopDepths()[4], 60 percent of the way
 *   { "kind": "rise", "at": 1 }     the rail's run of TRAIL_KIND "rise", 0 = first row, 1 = last row
 *   { "stop": 6 }                   stopDepths()[6]
 * plus optional:
 *   "pose": { x, y, z, bearing, pitch, fov }   pin the camera (scene.debugPose); light keyed to the depth
 *   "tier": 0..3                                 scene.setQualityTier (null releases)
 *   "W", "H"                                     viewport, default 1691 x 1278
 *   "frames"                                     frames to wait, default 6
 *   "atlas": true                                also dump the foliage atlas to <name>-atlas.png
 * Writes <name>.png and prints one JSON line per frame with the camera pose
 * (as a debugPose object, so a frame found on the rail can be pinned).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [jobsPath, outArg] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
const OUT = path.resolve(outArg);
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:3111";

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
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
// NOMSAA=1: report an integrated Intel GPU, so the page picks tier 2 with no MSAA (the cheap laptop path, cutout without alpha to coverage).
if (process.env.NOMSAA) {
  await page.evaluateOnNewDocument(() => {
    const fake = "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)";
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const orig = C.prototype.getParameter;
      C.prototype.getParameter = function (p) {
        if (p === 37446 || p === 37445) return fake;
        return orig.call(this, p);
      };
    }
    try {
      localStorage.clear();
    } catch {}
  });
}
let vw = jobs[0].W || 1691;
let vh = jobs[0].H || 1278;
await page.setViewport({ width: vw, height: vh });
await page.goto(BASE + "/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => (window.__worldReady && window.__worldV6Debug) || window.__worldError, { timeout: 80000, polling: 300 });
const err = await page.evaluate(() => window.__worldError || null);
if (err) throw new Error("world error: " + err);

const frames = (n) =>
  page.evaluate(async (n) => {
    const c0 = window.__worldFrameCount ?? 0;
    const t = performance.now();
    while ((window.__worldFrameCount ?? 0) < c0 + n && performance.now() - t < 10000) await new Promise((r) => setTimeout(r, 40));
  }, n);

// Other builders' edits hot reload the page: wait for a live scene before each frame, retry a frame that dies.
const live = () => page.waitForFunction(() => (window.__worldReady && window.__worldV6Debug && typeof window.__worldCamera === "function") || window.__worldError, { timeout: 80000, polling: 300 });
for (const job of jobs) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await live();
      await shoot(job);
      break;
    } catch (e) {
      console.error(`retry ${job.name}: ${String(e).slice(0, 160)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
if (errors.length) console.log("ERRORS", errors.slice(0, 5));
await browser.close();

async function shoot(job) {
  const W = job.W || 1691;
  const H = job.H || 1278;
  if (W !== vw || H !== vh) {
    await page.setViewport({ width: W, height: H });
    vw = W;
    vh = H;
    await frames(3);
  }
  const info = await page.evaluate((job) => {
    const sc = window.__worldV6Debug;
    const st = sc.stopDepths();
    let d;
    if (job.between) d = st[job.between[0]] + (st[job.between[1]] - st[job.between[0]]) * job.between[2];
    else if (job.stop !== undefined) d = st[job.stop];
    else if (job.kind) {
      const L = sc.ctx.layout;
      const first = L.TRAIL_KIND.indexOf(job.kind);
      let last = first;
      while (L.TRAIL_KIND[last + 1] === job.kind) last++;
      const key = first + (last - first) * job.at;
      const u = key / (L.TRAIL.length - 1);
      const r = sc.debugRail();
      let lo = 0;
      let hi = r.length;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (r.tAtS(m) < u) lo = m;
        else hi = m;
      }
      d = r.depthOfS((lo + hi) / 2);
    }
    if (job.tier !== undefined) sc.setQualityTier(job.tier);
    sc.debugPose(job.pose || null);
    window.scrollTo(0, sc.scrollYForDepth(d));
    sc.seedDepth(d);
    return { d };
  }, job);
  await frames(job.frames || 6);
  await page.screenshot({ path: path.join(OUT, `${job.name}.png`) });
  const r = await page.evaluate(() => {
    const sc = window.__worldV6Debug;
    const c = window.__worldCamera();
    const f = window.__worldFrame;
    const bearing = (Math.atan2(c.dx, -c.dz) * 180) / Math.PI;
    return {
      pose: { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), bearing: +bearing.toFixed(3), pitch: +c.pitch.toFixed(3), fov: +sc.camera.fov.toFixed(3) },
      tris: f.triangles,
      calls: f.calls,
      tier: sc.qualityInfo().override ?? (sc.qualityInfo().quality || {}).tier,
      msaa: sc.qualityInfo().report.msaa,
    };
  });
  if (job.probe) {
    // Screen points (css px) to the ground under them: march the ray against ctx.heightAt.
    r.hits = await page.evaluate((pts) => {
      const sc = window.__worldV6Debug;
      const cam = sc.camera;
      const W = window.innerWidth;
      const H = window.innerHeight;
      return pts.map(([px, py]) => {
        const o = cam.position.clone();
        const v = cam.position.clone().set((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
        let t = 1;
        for (; t < 9000; t += 2) {
          const x = o.x + v.x * t;
          const z = o.z + v.z * t;
          if (o.y + v.y * t < sc.ctx.heightAt(x, z)) break;
        }
        return [+(o.x + v.x * t).toFixed(1), +(o.y + v.y * t).toFixed(1), +(o.z + v.z * t).toFixed(1), Math.round(t)];
      });
    }, job.probe);
  }
  if (job.expr) r.expr = await page.evaluate((src) => new Function("sc", src)(window.__worldV6Debug), job.expr);
  if (job.atlas) {
    const b64 = await page.evaluate(() => {
      const data = window.__v6FoliageAtlasData?.();
      if (!data) return null;
      const N = 1024;
      const c = document.createElement("canvas");
      c.width = c.height = N;
      const g = c.getContext("2d");
      const img = g.createImageData(N, N);
      // Stored bottom row first: flip back for viewing, alpha kept.
      for (let y = 0; y < N; y++) img.data.set(data.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);
      g.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    });
    if (b64) fs.writeFileSync(path.join(OUT, `${job.name}-atlas.png`), Buffer.from(b64, "base64"));
  }
  console.log(job.name, JSON.stringify({ depth: +info.d.toFixed(1), ...r }));
}
