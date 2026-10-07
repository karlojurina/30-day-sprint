/**
 * B8: at the a8 stop, the notices' luma against the arch stone's (bible 4.12
 * MEASURE: notice luma at least 1.8x the pillar's median) and the arch's
 * median against the frame's p25 (5.2: the arch the darkest large shape).
 *
 *   node world-tests/v6-B8-notices.mjs
 *
 * Renders the stop, then a mask pass of Gate_Arch alone in which every face
 * whose vertex colour is paper (linear luma > 0.6) draws white and every other
 * face grey; luma is Rec. 601 on display values of the lit frame.
 */
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1691, height: 1278 });
await page.goto("http://localhost:3111/dev/world-v6", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__worldReady || window.__worldError, { timeout: 180000, polling: 300 });
await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const d = sc.stopDepths()[7];
  window.scrollTo(0, sc.scrollYForDepth(d));
  sc.seedDepth(d);
});
await new Promise((r) => setTimeout(r, 1500));
const res = await page.evaluate(() => {
  const sc = window.__worldV6Debug;
  const scene = sc.debugScene();
  const r = sc.renderer;
  const cam = sc.camera;
  const gl = r.getContext();
  const read = () => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w, h, px };
  };
  r.setRenderTarget(null);
  r.render(scene, cam);
  const lit = read();
  const arch = scene.getObjectByName("Gate_Arch");
  if (!arch) return { error: "no Gate_Arch" };
  // A mask: hide everything but the arch; paper white, stone grey.
  const vis = [];
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      vis.push([o, o.visible]);
      o.visible = o === arch;
    }
  });
  const bg = scene.background;
  scene.background = null;
  const fog = scene.fog;
  scene.fog = null;
  const prevMat = arch.material;
  // Build a ShaderMaterial through any ShaderMaterial already in the scene.
  let SM = null;
  scene.traverse((o) => {
    if (!SM && o.material && o.material.isShaderMaterial) SM = o.material.constructor;
  });
  const mask = new SM({
    vertexColors: true,
    side: 2,
    vertexShader: "varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec3 vC; void main(){ float l = dot(vC, vec3(0.299,0.587,0.114)); gl_FragColor = vec4(l > 0.6 ? vec3(1.0) : vec3(0.5), 1.0); }",
  });
  arch.material = mask;
  r.setClearColor(0x000000, 1);
  r.render(scene, cam);
  const m = read();
  arch.material = prevMat;
  mask.dispose();
  scene.background = bg;
  scene.fog = fog;
  for (const [o, v] of vis) o.visible = v;
  r.render(scene, cam);
  const luma = (i) => 0.299 * lit.px[i] + 0.587 * lit.px[i + 1] + 0.114 * lit.px[i + 2];
  const paper = [];
  const stone = [];
  const all = [];
  for (let i = 0; i < lit.px.length; i += 4) {
    const l = luma(i);
    all.push(l);
    const k = m.px[i];
    if (k > 200) paper.push(l);
    else if (k > 90) stone.push(l);
  }
  const med = (a) => {
    if (!a.length) return NaN;
    const s = Float32Array.from(a).sort();
    return s[Math.floor(s.length / 2)];
  };
  const pct = (a, q) => Float32Array.from(a).sort()[Math.floor(a.length * q)];
  const n = all.length;
  return {
    paperPx: paper.length,
    stonePx: stone.length,
    paperMedian: +med(paper).toFixed(1),
    stoneMedian: +med(stone).toFixed(1),
    ratio: +(med(paper) / med(stone)).toFixed(2),
    archShare: +((paper.length + stone.length) / n).toFixed(3),
    frameP25: +pct(all, 0.25).toFixed(1),
  };
});
console.log(JSON.stringify(res));
if (!res.error) {
  console.log(`${res.ratio >= 1.8 ? "PASS" : "FAIL"}  notices at ${res.ratio}x the arch stone's median luma (target >= 1.8)`);
  console.log(`${res.stoneMedian < res.frameP25 ? "PASS" : "FAIL"}  the arch stone's median ${res.stoneMedian} under the frame's p25 ${res.frameP25}`);
}
await browser.close();
