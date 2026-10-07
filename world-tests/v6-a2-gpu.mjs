/**
 * A2 foundations on the real GPU (ANGLE Metal), on a standalone page (no dev
 * server needed): perf.ts and noise.ts transpiled with typescript and served
 * with three through request interception.
 *
 *   node world-tests/v6-a2-gpu.mjs
 *
 * Known answers:
 *   - measureOverdraw "visible" on a built scene (an alpha cutout plane in front whose bottom half is cut
 *     away, an opaque plane on the left half, three blended planes behind): quadrants 1, 1, 1, 3 layers,
 *     average 1.5, p99 3. "raster": the cutout draws in full and hides everything: average 1.0.
 *   - warmCompile: after it, rendering to the screen and into the extra target makes no new program.
 *   - burstProbe: a positive ms per frame.
 *   - getNoiseTexture: in-page generation time, and a render of the texture 2 x 2 tiled per channel
 *     (shots/v6/A2/noise-tiles.png) to open and check for seams.
 * Exits 1 on any failed check.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, "shots/v6/A2");
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://a2.test";
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");
const js = (file) =>
  ts.transpileModule(fs.readFileSync(path.join(ROOT, "src/lib/world-v6", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
    .replace(/from "three"/g, `from "${ORIGIN}/three.module.js"`)
    .replace(/from "\.\/quality"/g, `from "${ORIGIN}/quality.js"`);
const served = {
  "/index.html": ["text/html", `<!doctype html><html><body style="margin:0;background:#000"></body></html>`],
  "/three.module.js": ["text/javascript", fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")],
  "/perf.js": ["text/javascript", js("perf.ts")],
  "/quality.js": ["text/javascript", js("quality.ts")],
  "/noise.js": ["text/javascript", js("noise.ts")],
};

let fails = 0;
const check = (name, pass, value = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${value !== "" ? `  (${value})` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--no-sandbox", "--hide-scrollbars"],
  protocolTimeout: 85000,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.setRequestInterception(true);
page.on("request", (r) => {
  const u = new URL(r.url());
  const hit = u.origin === ORIGIN && served[u.pathname];
  if (hit) return r.respond({ status: 200, contentType: hit[0], body: hit[1] });
  r.respond({ status: 204, body: "" }); // favicon and anything else: empty, not an error
});
await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
await page.goto(`${ORIGIN}/index.html`);

const res = await page.evaluate(async (origin) => {
  const THREE = await import(`${origin}/three.module.js`);
  const perf = await import(`${origin}/perf.js`);
  const noise = await import(`${origin}/noise.js`);
  const out = {};
  const gpuName = perf.readGpuName();
  out.gpu = gpuName;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(960, 600);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // ── Overdraw known answer ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x223344);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  const plane = (w, h, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  // Cutout: alpha 1 on the top half, 0 on the bottom half (a 1 x 2 texture, nearest).
  const cut = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]), 1, 2);
  cut.magFilter = cut.minFilter = THREE.NearestFilter;
  cut.needsUpdate = true;
  plane(2, 2, new THREE.MeshBasicMaterial({ map: cut, alphaTest: 0.5, color: 0x88aa66 }), 0, 0, -0.25);
  plane(1, 2, new THREE.MeshLambertMaterial({ color: 0x996633 }), -0.5, 0, -0.5);
  for (const z of [-1, -2, -3]) plane(2, 2, new THREE.MeshBasicMaterial({ color: 0x3366ff, transparent: true, opacity: 0.3, depthWrite: false }), 0, 0, z);
  scene.add(new THREE.DirectionalLight(0xffffff, 1));
  const vis = perf.measureOverdraw(renderer, scene, cam, { mode: "visible" });
  const ras = perf.measureOverdraw(renderer, scene, cam, { mode: "raster" });
  out.overdraw = { visible: { avg: vis.avg, p99: vis.p99, max: vis.max, hist: vis.histogram.slice(0, 5), w: vis.width, h: vis.height, ms: vis.ms }, raster: { avg: ras.avg, p99: ras.p99, max: ras.max, hist: ras.histogram.slice(0, 5), ms: ras.ms } };
  // Materials restored: stencil off again, the scene renders as before.
  let stencilLeft = 0;
  scene.traverse((o) => { if (o.material && o.material.stencilWrite) stencilLeft++; });
  out.stencilLeft = stencilLeft;
  out.backgroundKept = scene.background && scene.background.isColor;

  // ── Warm compile ──
  const s2 = new THREE.Scene();
  s2.fog = new THREE.Fog(0x888888, 1, 100);
  const cam2 = new THREE.PerspectiveCamera(40, 1.6, 0.1, 100);
  cam2.position.set(0, 0, 10);
  const mats = [
    new THREE.MeshLambertMaterial({ color: 0x8899aa }),
    new THREE.MeshStandardMaterial({ color: 0xaa8866, roughness: 0.8 }),
    new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.5 }),
    new THREE.ShaderMaterial({ vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "void main(){ gl_FragColor = vec4(1.0,0.5,0.2,1.0); }" }),
  ];
  mats.forEach((m, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
    mesh.position.set(i * 1.5 - 2.25, 0, 0);
    if (i === 1) mesh.visible = false; // a hidden group: must still compile
    s2.add(mesh);
  });
  const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x66aa44, alphaTest: 0.5 }), 50);
  s2.add(inst);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const moon = new THREE.DirectionalLight(0x8899ff, 0);
  s2.add(sun, moon);
  const rt = new THREE.WebGLRenderTarget(256, 256);
  const p0 = renderer.info.programs.length;
  const warm = await perf.warmCompile(renderer, s2, cam2, [rt]);
  const p1 = renderer.info.programs.length;
  const hiddenAfterWarm = s2.children[1].visible === false;
  renderer.render(s2, cam2);
  s2.children[1].visible = true;
  renderer.render(s2, cam2);
  renderer.setRenderTarget(rt);
  renderer.render(s2, cam2);
  renderer.setRenderTarget(null);
  const p2 = renderer.info.programs.length;
  out.warm = { ...warm, before: p0, afterWarm: p1, afterRenders: p2, hiddenRestored: hiddenAfterWarm };

  // ── Burst ──
  out.burst = perf.burstProbe(renderer, s2, cam2, { renders: 8, repeats: 5, warmMs: 150 });

  // ── Noise: in-page generation time and a 2 x 2 tiled render per channel ──
  const t0 = performance.now();
  const tex = noise.getNoiseTexture(renderer);
  const tGet = performance.now() - t0;
  out.noise = { getMs: +tGet.toFixed(2), ...noise.noiseStats(), sameOnSecondCall: noise.getNoiseTexture(renderer) === tex };
  const s3 = new THREE.Scene();
  const cam3 = new THREE.OrthographicCamera(0, 4, 2, 0, -1, 1);
  const chan = ["vec3(t.r)", "vec3(t.g)", "vec3(t.b)", "vec3(t.a)"];
  for (let c = 0; c < 4; c++) {
    const m = new THREE.ShaderMaterial({
      uniforms: { uNoiseTex: { value: tex } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `uniform sampler2D uNoiseTex; varying vec2 vUv;\n${noise.NOISE_TEX_GLSL}\n${noise.NOISE_TEX_FRAG_GLSL}\nvoid main(){ vec4 t = texture2D(uNoiseTex, vUv * 2.0); vec3 c = ${chan[c]};\n float band = pBands3(t.r, 0.38, 0.62); if (${c} == 0 && vUv.y < 0.5) c = vec3(band); gl_FragColor = vec4(c, 1.0); }`,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), m);
    q.position.set(c + 0.5, 1, 0);
    s3.add(q);
  }
  renderer.setSize(1024, 512);
  renderer.render(s3, cam3);
  out.png = renderer.domElement.toDataURL("image/png");
  return out;
}, ORIGIN);

console.log(`gpu: ${res.gpu}`);
console.log("measureOverdraw");
const v = res.overdraw.visible, r = res.overdraw.raster;
check("visible: average 1.5 (quadrants 1, 1, 1, 3)", Math.abs(v.avg - 1.5) < 0.02, `avg ${v.avg}, hist ${v.hist.join(",")}, ${v.w}x${v.h}, ${v.ms} ms`);
check("visible: p99 3, max 3", v.p99 === 3 && v.max === 3, `p99 ${v.p99} max ${v.max}`);
check("raster: the cutout draws in full, average 1.0", Math.abs(r.avg - 1.0) < 0.02, `avg ${r.avg}, hist ${r.hist.join(",")}`);
check("materials restored (no stencil left on), background kept", res.stencilLeft === 0 && res.backgroundKept);
console.log("warmCompile");
check("programs compiled by the warm up", res.warm.afterWarm > res.warm.before, `${res.warm.before} -> ${res.warm.afterWarm}, ${res.warm.ms} ms, ${res.warm.shown} shown, ${res.warm.targets} target`);
check("no new program on screen or target renders after it", res.warm.afterRenders === res.warm.afterWarm, `${res.warm.afterWarm} -> ${res.warm.afterRenders}`);
check("hidden object restored", res.warm.hiddenRestored);
console.log("burstProbe");
check("positive ms per frame", res.burst.ms > 0 && res.burst.ms < 50, `${res.burst.ms} ms, ${res.burst.calls} calls, took ${res.burst.took} ms`);
console.log("noise");
console.log(`  in page: generation ${res.noise.ms} ms, getNoiseTexture ${res.noise.getMs} ms (target 10), ${res.noise.bytesWithMips} bytes with mips`);
check("texture cached per renderer", res.noise.sameOnSecondCall);
const png = path.join(OUT, "noise-tiles.png");
fs.writeFileSync(png, Buffer.from(res.png.split(",")[1], "base64"));
console.log(`  wrote ${png} (R, G, B, A left to right, each 2 x 2 tiles; R's lower half is pBands3 posterised)`);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
await browser.close();
process.exit(fails ? 1 : 0);
