/**
 * Which object owns a pixel? Seeds the camera at a TRAIL key, then hides each
 * group under the World root in turn (and then each child of the owner) and
 * reports which one changes the pixel.
 *
 *   node world-tests/v4-probe.mjs <key> <px> <py>      (960x600)
 */
import puppeteer from "puppeteer-core";

const [key, px, py] = process.argv.slice(2).map(Number);
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
await page.goto((process.env.BASE_URL || "http://localhost:3111") + "/dev/world-v4", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
// Seed first and let two frames draw, so the camera is really there before probing.
await page.evaluate((key) => {
  const sc = window.__worldV4Debug;
  const r = sc.debugRail();
  const u = key / 69;
  let lo = 0;
  let hi = r.length;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (r.tAtS(m) < u) lo = m;
    else hi = m;
  }
  const d = r.depthOfS((lo + hi) / 2);
  window.scrollTo(0, sc.scrollYForDepth(d));
  sc.seedDepth(d);
}, key);
const c0 = await page.evaluate(() => window.__worldFrameCount ?? 0);
await page.waitForFunction((c0) => (window.__worldFrameCount ?? 0) >= c0 + 2, { polling: 100, timeout: 30000 }, c0).catch(() => {});
await page.screenshot({ path: "/tmp/v4-probe.png" });
const out = await page.evaluate(
  (key, px, py) => {
    const sc = window.__worldV4Debug;
    const r = sc.debugRail();
    const u = key / 69;
    let lo = 0;
    let hi = r.length;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (r.tAtS(m) < u) lo = m;
      else hi = m;
    }
    void r;
    sc.setPaused(true);
    const scene = sc.debugScene();
    const renderer = sc.renderer;
    const gl = renderer.getContext();
    const dpr = gl.drawingBufferWidth / innerWidth;
    const read = () => {
      renderer.setRenderTarget(null);
      renderer.render(scene, sc.camera);
      const p = new Uint8Array(4);
      gl.readPixels(Math.round(px * dpr), gl.drawingBufferHeight - 1 - Math.round(py * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return [...p.slice(0, 3)];
    };
    const base = read();
    const probe = (list) => {
      const hits = [];
      for (const o of list) {
        if (!o.visible) continue;
        o.visible = false;
        const c = read();
        o.visible = true;
        const dd = Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]);
        if (dd > 6) hits.push({ name: o.name || o.type, diff: dd, children: o.children.length });
      }
      return hits;
    };
    const root = scene.getObjectByName("World") || scene;
    const top = probe(root.children);
    const deeper = [];
    for (const h of top) {
      const o = root.children.find((c) => (c.name || c.type) === h.name);
      if (o && o.children.length) deeper.push({ in: h.name, hits: probe(o.children) });
    }
    // Ray through the pixel against the Terrain mesh's triangles (brute force).
    const cam = sc.camera;
    const V = cam.position.constructor;
    const o = cam.position.clone();
    const dir = new V((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
    let hit = null;
    for (const name of ["Terrain", "Terrain:falls"]) {
      const m = scene.getObjectByName(name);
      if (!m) continue;
      const P = m.geometry.getAttribute("position").array;
      const I = m.geometry.getIndex().array;
      const e1 = new V();
      const e2 = new V();
      const h = new V();
      const s = new V();
      const q = new V();
      const a = new V();
      const b = new V();
      const c3 = new V();
      for (let t = 0; t < I.length; t += 3) {
        a.fromArray(P, I[t] * 3);
        b.fromArray(P, I[t + 1] * 3);
        c3.fromArray(P, I[t + 2] * 3);
        e1.subVectors(b, a);
        e2.subVectors(c3, a);
        h.crossVectors(dir, e2);
        const det = e1.dot(h);
        if (Math.abs(det) < 1e-9) continue;
        const f = 1 / det;
        s.subVectors(o, a);
        const uu = f * s.dot(h);
        if (uu < 0 || uu > 1) continue;
        q.crossVectors(s, e1);
        const vv = f * dir.dot(q);
        if (vv < 0 || uu + vv > 1) continue;
        const tt = f * e2.dot(q);
        if (tt > 0.1 && (!hit || tt < hit.t)) hit = { t: tt, mesh: name, tri: [a.toArray(), b.toArray(), c3.toArray()].map((v) => v.map(Math.round)) };
      }
    }
    if (hit) {
      hit.point = [o.x + dir.x * hit.t, o.y + dir.y * hit.t, o.z + dir.z * hit.t].map(Math.round);
      // Validate: drop only the terrain triangles within 80 of the hit and re-read the pixel.
      const m = scene.getObjectByName(hit.mesh);
      const idxAttr = m.geometry.getIndex();
      const full = idxAttr.array;
      const P = m.geometry.getAttribute("position").array;
      const keep = [];
      for (let t = 0; t < full.length; t += 3) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let k = 0; k < 3; k++) {
          cx += P[full[t + k] * 3] / 3;
          cy += P[full[t + k] * 3 + 1] / 3;
          cz += P[full[t + k] * 3 + 2] / 3;
        }
        if (Math.hypot(cx - hit.point[0], cy - hit.point[1], cz - hit.point[2]) > 80) keep.push(full[t], full[t + 1], full[t + 2]);
      }
      m.geometry.setIndex(keep);
      const c2 = read();
      m.geometry.setIndex(idxAttr);
      hit.pixelWithoutNearbyTris = c2;
    }
    const c = window.__worldCamera();
    sc.setPaused(false);
    return { base, cam: [c.x, c.y, c.z].map(Math.round), fov: cam.fov, top, deeper, hit };
  },
  key,
  px,
  py,
);
console.log(JSON.stringify(out, null, 1));
await browser.close();
