import * as THREE from "three";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";

/**
 * Atmosphere: the Firewatch sky and light for world-v3.
 *
 *   AtmoSky      gradient dome drawn at the far plane around the camera. Warm
 *                glowing horizon (the haze colour, so hazed land meets it with
 *                no seam), a peach band, a cooler desaturated top, and a sun
 *                disc with a soft two-lobe glow at ctx.sunDir.
 *   AtmoRidges   four far mountain silhouettes on rings around the valley,
 *                one draw call. Each ring is further, lighter, cooler and more
 *                hazed than the one in front, and fades into valley mist at its
 *                base; the nearest carries a conifer tree line. They replace
 *                the glb's Ridge0..3 cards, which are removed.
 *   AtmoSun      directional light from ctx.sunDir, ctx.sunColor.
 *   AtmoFill     warm, desaturated hemisphere fill (V2's violet sky fill made
 *                every shaded slope plum).
 *   AtmoShade    a faint cool ambient, so shade reads cool and desaturated.
 *   AtmoGrade    one full-screen blended quad, drawn last: gentle warm lift,
 *                vignette, sun glare toward ctx.sunDir, and 1-2 levels of
 *                grain that also dithers the sky gradient. No render target,
 *                no second scene pass, no change to the frame loop.
 *
 * Also sets scene.fog's colour to ctx.hazeColor.
 *
 * For other modules, scene.userData.atmosphere holds:
 *   skyColorAt(dir, out)  the sky's linear colour in a world direction (the
 *                         same function the dome's shader draws)
 *   envMap()              a small prefiltered map of this sky, built on first
 *                         call and owned here, for water reflections
 *   horizon, sunDisc      linear colours
 *
 * Real-time shadows are not used: a shadow pass redraws every caster (the
 * forest alone is tens of draw calls), which the 90-call budget cannot carry,
 * and SwiftShader doubles its frame time. Shade comes from the sun angle
 * against the fill.
 *
 * Nothing here animates: no update(), and the loop keeps sleeping when idle.
 */

// ── Palette (display sRGB hex, converted to linear on use) ──────────────────

/**
 * The sky at the horizon is LIGHTER than the haze: fogged land, then each far
 * ridge, then the sky, step up in value, so every layer reads as further away
 * than the one in front (atmospheric perspective) and the valley walls stand
 * as silhouettes against a glowing sky.
 */
const HORIZON_LIFT_HEX = 0xffe6c8;
const HORIZON_LIFT = 0.45;
/** Just above the horizon toward the sun: golden. */
const GLOW_HEX = 0xffdcaa;
/** The band a few degrees up: dusty peach. */
const MID_HEX = 0xf3cdb4;
/** The top of the sky: cooler and desaturated, never violet. */
const TOP_HEX = 0xb4bcc2;
/** The sun disc: warm near-white. */
const SUN_DISC_HEX = 0xfff0cf;
/** Added around the sun: warm glare. */
const SUN_GLOW_HEX = 0xffc98e;

/** Far ridge base colour before haze: a cool, dark, desaturated slate green. */
const RIDGE_BASE_HEX = 0x4f5a5c;
/** Rim light on the ridge tops facing the sun. */
const RIDGE_RIM_HEX = 0xffd7a3;

/** Hemisphere fill: warm desaturated grey from above, warm earth bounce from below. */
const FILL_SKY_HEX = 0x9c9189;
const FILL_GROUND_HEX = 0x6a5140;
const FILL_INTENSITY = 4.0;
/** Faint cool ambient: the shade tone. */
const SHADE_HEX = 0x8f9aa6;
const SHADE_INTENSITY = 1.1;
const SUN_INTENSITY = 3.6;

// ── Sky shape (degrees of elevation) ────────────────────────────────────────

/** Sun disc angular radius. */
const SUN_RADIUS_DEG = 1.35;
/** Where the peach band is fully in, and where the cool top starts and ends. */
const MID_FROM_DEG = 1.2;
const MID_TO_DEG = 6.0;
const TOP_FROM_DEG = 4.5;
const TOP_TO_DEG = 20.0;

// ── Ridges ───────────────────────────────────────────────────────────────────

interface RidgeLayer {
  /** Ring semi-axes in x and z, world units, around RING_CENTRE. */
  a: number;
  b: number;
  /** Silhouette baseline and amplitude, world y. */
  base: number;
  amp: number;
  /** 0..1: how much of the sky colour the layer takes (atmospheric perspective). */
  haze: number;
  /** Periods (whole numbers so the ring closes) of the ridge noise octaves. */
  periods: [number, number, number];
  seed: number;
}

/** Rings are centred on the upper valley, so the camera is inside all four from the shore to the summit. */
const RING_CX = 0;
const RING_CZ = -200;
const RING_BOTTOM = -600;

const LAYERS: RidgeLayer[] = [
  { a: 1500, b: 1650, base: 175, amp: 150, haze: 0.74, periods: [9, 23, 61], seed: 11 },
  { a: 2100, b: 2300, base: 250, amp: 230, haze: 0.81, periods: [7, 19, 47], seed: 23 },
  { a: 2800, b: 3050, base: 330, amp: 330, haze: 0.87, periods: [6, 15, 37], seed: 37 },
  { a: 3600, b: 3900, base: 420, amp: 420, haze: 0.92, periods: [5, 13, 29], seed: 51 },
];
/** Columns per ring. At ~45 px per degree a column is ~6-12 px at the nearest ring. */
const RIDGE_COLUMNS = 1440;
/** The nearest ring's tree line: tree height and spacing, world units. */
const TREE_H = 11;
const TREE_W = 7;
/** Toward +z (over the sea) the rings sink to this share of their height. */
const SEA_SIDE_SCALE = 0.3;

// ── Grade ────────────────────────────────────────────────────────────────────

/** Warm lift: the colour mixed over the frame and how much (premultiplied "over"). */
const LIFT_HEX = 0xffc89a;
const LIFT_ALPHA = 0.04;
/**
 * Vignette: a dark warm brown, strength at the far corners. Kept off the top
 * and bottom middle: the interface already shades those two edges for its
 * text (world.module.css .shade), and doubling it muddied the sky.
 */
const VIGNETTE_HEX = 0x2a1a12;
const VIGNETTE_ALPHA = 0.26;
/** Sun glare added toward the sun's screen position. */
const GLARE_HEX = 0xffb778;
const GLARE_STRENGTH = 0.28;
/** Grain amplitude in 8-bit levels (triangular noise, doubles as dither). */
const GRAIN_LEVELS = 1.6;

// ── Shared GLSL ──────────────────────────────────────────────────────────────

const SKY_GLSL = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uMid;
uniform vec3 uTop;
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform vec3 uSunGlow;
uniform vec4 uSkyShape; // midFrom, midTo, topFrom, topTo (degrees)
uniform float uSunRadius; // radians

// Linear sky colour in unit direction d, WITHOUT the disc.
vec3 atmoSky(vec3 d) {
  float deg = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec2 hz = d.xz;
  float hl = length(hz);
  vec2 sz = normalize(uSunDir.xz);
  float toward = hl > 1e-4 ? 0.5 + 0.5 * dot(hz / hl, sz) : 0.5;
  // The horizon glows gold toward the sun and stays the haze away from it.
  vec3 low = mix(uHorizon, uGlow, toward * toward * 0.85);
  vec3 c = mix(uHorizon, low, smoothstep(-0.8, 1.2, deg));
  c = mix(c, uMid, smoothstep(uSkyShape.x, uSkyShape.y, deg) * (0.55 + 0.45 * (1.0 - toward)));
  c = mix(c, uTop, smoothstep(uSkyShape.z, uSkyShape.w, deg));
  // Two-lobe glow: a broad warm bloom and a tight bright halo.
  float ca = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (0.22 * pow(ca, 5.0) + 0.55 * pow(ca, 90.0));
  // Below the horizon everything is haze.
  return mix(uHaze, c, smoothstep(-2.0, 0.0, deg));
}
`;

function hexLinear(hex: number): THREE.Color {
  // Color.setHex reads sRGB and stores linear (ColorManagement is on in r169).
  return new THREE.Color().setHex(hex);
}

// ── Deterministic periodic value noise (ring silhouettes) ────────────────────

function hash1(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise at u in [0,1), periodic with `period` lattice cells. */
function pnoise(u: number, period: number, seed: number): number {
  const x = u * period;
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(((i % period) + period) % period, seed);
  const b = hash1((((i + 1) % period) + period) % period, seed);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ── Install ──────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const scene = ctx.scene;
  const sunDir = ctx.sunDir.clone().normalize();
  const owned: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const hidden: THREE.Object3D[] = [];
  const detached: { obj: THREE.Object3D; parent: THREE.Object3D }[] = [];

  const haze = ctx.hazeColor.clone();
  const horizon = haze.clone().lerp(hexLinear(HORIZON_LIFT_HEX), HORIZON_LIFT);
  const glow = hexLinear(GLOW_HEX);
  const mid = hexLinear(MID_HEX);
  const top = hexLinear(TOP_HEX);
  const sunDisc = hexLinear(SUN_DISC_HEX);
  const sunGlow = hexLinear(SUN_GLOW_HEX);

  const skyUniforms = {
    uHaze: { value: haze },
    uHorizon: { value: horizon },
    uGlow: { value: glow },
    uMid: { value: mid },
    uTop: { value: top },
    uSunDir: { value: sunDir },
    uSunDisc: { value: sunDisc },
    uSunGlow: { value: sunGlow },
    uSkyShape: { value: new THREE.Vector4(MID_FROM_DEG, MID_TO_DEG, TOP_FROM_DEG, TOP_TO_DEG) },
    uSunRadius: { value: THREE.MathUtils.degToRad(SUN_RADIUS_DEG) },
  };

  // Stand in for anything the scene drew before this module: V2's sky dome,
  // its lights, and the glb's flat ridge cards.
  for (const name of ["Sky"]) {
    const o = scene.getObjectByName(name);
    if (o && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  }
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if (l.isLight && (l.name === "Sun" || l.name === "Hemisphere") && l.visible) hidden.push(l);
  });
  for (const l of hidden) l.visible = false;
  for (let i = 0; i < 4; i++) {
    const r = ctx.root.getObjectByName(`Ridge${i}`);
    if (r?.parent) {
      detached.push({ obj: r, parent: r.parent });
      r.parent.remove(r);
    }
  }

  // ── Sky dome ──
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
  const skyMat = new THREE.ShaderMaterial({
    name: "AtmoSkyMat",
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Centred on the camera and pinned to the far plane: never clipped,
        // never in front of anything, whatever the rail does.
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = atmoSky(d);
        float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float disc = 1.0 - smoothstep(uSunRadius * 0.82, uSunRadius * 1.06, ang);
        c = mix(c, uSunDisc, disc);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = "AtmoSky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.matrixAutoUpdate = false;
  scene.add(sky);
  owned.push(sky);
  disposables.push(skyGeo, skyMat);

  // ── Far ridges ──
  const ridgeGeo = buildRidges();
  const ridgeMat = new THREE.ShaderMaterial({
    name: "AtmoRidgeMat",
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: {
      ...skyUniforms,
      uRidgeBase: { value: hexLinear(RIDGE_BASE_HEX) },
      uRim: { value: hexLinear(RIDGE_RIM_HEX) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aRidge; // silhouette top y, haze, mist top y, mist floor y
      varying vec3 vWorld;
      varying vec4 vRidge;
      void main() {
        vRidge = aRidge;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 uRidgeBase;
      uniform vec3 uRim;
      varying vec3 vWorld;
      varying vec4 vRidge;
      float h21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec3 toP = vWorld - cameraPosition;
        float dist = length(toP);
        vec3 d = toP / dist;
        // What the sky is right behind this point: the layer takes that much of it.
        vec3 skyHere = atmoSky(d);
        float top = vRidge.x;
        float haze = vRidge.y;
        float mistTop = vRidge.z;
        // Painterly: long horizontal strokes of slightly lighter and darker paint.
        float az = atan(vWorld.x, vWorld.z);
        float stroke = vn(vec2(az * 60.0, vWorld.y * 0.012 + haze * 17.0)) * 0.6
                     + vn(vec2(az * 190.0, vWorld.y * 0.03)) * 0.4;
        vec3 base = uRidgeBase * (0.9 + 0.2 * stroke);
        // Darker at the crest, lighter toward the misty foot.
        float fromTop = clamp((top - vWorld.y) / max(top - mistTop, 1.0), 0.0, 1.0);
        vec3 c = mix(base, skyHere, haze + (1.0 - haze) * 0.18 * fromTop);
        // Valley mist: the foot of every ring dissolves into the horizon haze.
        float mist = 1.0 - smoothstep(vRidge.w, mistTop, vWorld.y);
        c = mix(c, mix(uHaze, skyHere, 0.3), mist);
        // Rim light along the crest where the ring faces the sun.
        vec2 sz = normalize(uSunDir.xz);
        float toward = max(dot(normalize(d.xz), sz), 0.0);
        float rimW = dist * 0.0018;
        float rim = (1.0 - smoothstep(0.0, rimW, top - vWorld.y)) * pow(toward, 3.0) * (1.0 - haze * 0.6);
        c = mix(c, uRim, rim * 0.55);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const ridges = new THREE.Mesh(ridgeGeo, ridgeMat);
  ridges.name = "AtmoRidges";
  ridges.frustumCulled = false;
  ridges.matrixAutoUpdate = false;
  scene.add(ridges);
  owned.push(ridges);
  disposables.push(ridgeGeo, ridgeMat);

  // ── Lights ──
  const sun = new THREE.DirectionalLight(ctx.sunColor.clone(), SUN_INTENSITY);
  sun.name = "AtmoSun";
  sun.position.copy(sunDir).multiplyScalar(2000);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.HemisphereLight(hexLinear(FILL_SKY_HEX), hexLinear(FILL_GROUND_HEX), FILL_INTENSITY);
  fill.name = "AtmoFill";
  scene.add(fill);
  const shade = new THREE.AmbientLight(hexLinear(SHADE_HEX), SHADE_INTENSITY);
  shade.name = "AtmoShade";
  scene.add(shade);
  owned.push(sun, sun.target, fill, shade);

  // ── Fog colour ──
  let fogWas: THREE.Color | null = null;
  const fog = scene.fog as THREE.Fog | THREE.FogExp2 | null;
  if (fog) {
    fogWas = fog.color.clone();
    fog.color.copy(ctx.hazeColor);
  }

  // ── Grade ──
  const gradeGeo = new THREE.PlaneGeometry(2, 2);
  const sunNdc = new THREE.Vector3();
  const res = new THREE.Vector2(1, 1);
  const gradeUniforms = {
    uRes: { value: res },
    uLift: { value: displayColor(LIFT_HEX) },
    uLiftA: { value: LIFT_ALPHA },
    uVig: { value: displayColor(VIGNETTE_HEX) },
    uVigA: { value: VIGNETTE_ALPHA },
    uGlare: { value: displayColor(GLARE_HEX) },
    uGlareA: { value: 0 },
    uSun: { value: new THREE.Vector2(0.5, 1.2) },
    uGrain: { value: GRAIN_LEVELS / 255 },
  };
  const gradeMat = new THREE.ShaderMaterial({
    name: "AtmoGradeMat",
    uniforms: gradeUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // Values here are DISPLAY values (the framebuffer holds sRGB): no
    // colorspace include, on purpose.
    fragmentShader: /* glsl */ `
      uniform vec2 uRes;
      uniform vec3 uLift; uniform float uLiftA;
      uniform vec3 uVig; uniform float uVigA;
      uniform vec3 uGlare; uniform float uGlareA;
      uniform vec2 uSun;
      uniform float uGrain;
      float h12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float aspect = uRes.x / uRes.y;
        // Vignette on an ellipse that keeps its shape on ultrawide screens.
        vec2 p = (uv - 0.5) * 2.0;
        p.x *= min(aspect, 1.8) / 1.8 * 0.9 + 0.1;
        p.y *= 0.72;
        float v = smoothstep(0.5, 1.45, length(p));
        v *= v;
        // Glare: a wide soft bloom around where the sun is (often just off
        // screen), and the vignette gives way on that side.
        vec2 q = (uv - uSun) * vec2(aspect, 1.0);
        float gs = exp(-dot(q, q) / 0.9);
        float g = gs * uGlareA;
        v *= 1.0 - 0.7 * gs * step(0.001, uGlareA);
        vec3 rgb = uLift * uLiftA + uVig * (uVigA * v) + uGlare * g;
        float a = uLiftA + uVigA * v;
        // Triangular grain, one to two 8-bit levels: also dithers the sky.
        float n = h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy + 71.7) - 1.0;
        rgb += uGrain * (n + 1.0) * 0.5;
        gl_FragColor = vec4(rgb, a);
      }`,
  });
  const grade = new THREE.Mesh(gradeGeo, gradeMat);
  grade.name = "AtmoGrade";
  grade.frustumCulled = false;
  grade.renderOrder = 1e6;
  grade.matrixAutoUpdate = false;
  grade.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(res);
    // Sun position on screen, projected from far along ctx.sunDir.
    sunNdc.copy(sunDir).multiplyScalar(4000).add(camera.position).project(camera);
    const inFront = camera.getWorldDirection(scratchDir).dot(sunDir);
    gradeUniforms.uSun.value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
    gradeUniforms.uGlareA.value = GLARE_STRENGTH * smoothstep(0.05, 0.6, inFront);
  };
  const scratchDir = new THREE.Vector3();
  scene.add(grade);
  owned.push(grade);
  disposables.push(gradeGeo, gradeMat);

  // ── For other modules ──
  let env: THREE.WebGLRenderTarget | null = null;
  const skyCpu = makeSkyCpu(haze, horizon, glow, mid, top, sunDir, sunGlow);
  scene.userData.atmosphere = {
    skyColorAt: skyCpu,
    horizon: horizon.clone(),
    sunDisc: sunDisc.clone(),
    envMap(): THREE.Texture {
      if (env) return env.texture;
      env = buildEnv(ctx.renderer, skyCpu);
      return env.texture;
    },
  };

  const ms = performance.now() - t0;
  const tris = (ridgeGeo.index ? ridgeGeo.index.count : ridgeGeo.attributes.position.count) / 3;

  return {
    name: "atmosphere",
    dispose() {
      for (const o of owned) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      env?.dispose();
      env = null;
      for (const o of hidden) o.visible = true;
      for (const { obj, parent } of detached) parent.add(obj);
      if (fog && fogWas) fog.color.copy(fogWas);
      delete scene.userData.atmosphere;
    },
    stats() {
      return {
        ridgeTriangles: tris,
        drawCalls: 3,
        ridgeCardsRemoved: detached.length,
        msToBuild: Math.round(ms * 10) / 10,
      };
    },
  };
};

/** A linear colour for a grade uniform that is compared against DISPLAY values. */
function displayColor(hex: number): THREE.Color {
  const c = new THREE.Color();
  c.r = ((hex >> 16) & 255) / 255;
  c.g = ((hex >> 8) & 255) / 255;
  c.b = (hex & 255) / 255;
  return c;
}

// ── Ridge geometry ───────────────────────────────────────────────────────────

/**
 * All four rings in one indexed strip mesh. Each column is two vertices (the
 * silhouette top and the ring bottom) sharing an aRidge attribute: the top y,
 * the layer's haze, the y where its mist begins, and the layer index.
 */
function buildRidges(): THREE.BufferGeometry {
  const pos: number[] = [];
  const ridge: number[] = [];
  const index: number[] = [];

  LAYERS.forEach((L, li) => {
    const tops: { u: number; y: number }[] = [];
    const height = (u: number) => {
      const [p1, p2, p3] = L.periods;
      const n1 = pnoise(u, p1, L.seed);
      const ridged = 1 - Math.abs(2 * pnoise(u, p2, L.seed + 1) - 1);
      const n3 = pnoise(u, p3, L.seed + 2);
      let h = L.base + L.amp * (0.55 * n1 + 0.33 * ridged * ridged + 0.12 * n3 - 0.35);
      // Sink toward +z, over the sea.
      const th = u * Math.PI * 2;
      const dz = Math.sin(th); // ring direction z component
      h *= SEA_SIDE_SCALE + (1 - SEA_SIDE_SCALE) * (1 - smoothstep(-0.1, 0.75, dz));
      return h;
    };
    if (li === 0) {
      // The nearest ring wears a tree line: forest patches of narrow spikes.
      const circumference = Math.PI * (L.a + L.b);
      const count = Math.floor(circumference / TREE_W);
      for (let i = 0; i < count; i++) {
        const u0 = i / count;
        const uMid = (i + 0.5) / count;
        const forest = smoothstep(0.42, 0.62, pnoise(u0, 70, L.seed + 9));
        const jitter = 0.55 + 0.45 * hash1(i, L.seed + 5);
        tops.push({ u: u0, y: height(u0) });
        tops.push({ u: uMid, y: height(uMid) + TREE_H * forest * jitter });
      }
    } else {
      for (let i = 0; i < RIDGE_COLUMNS; i++) {
        const u = i / RIDGE_COLUMNS;
        tops.push({ u, y: height(u) });
      }
    }
    const first = pos.length / 3;
    const mistTop = L.base - L.amp * 0.1;
    const mistFloor = mistTop - L.amp * 0.8 - 40;
    for (const t of tops) {
      const th = t.u * Math.PI * 2;
      const x = RING_CX + Math.cos(th) * L.a;
      const z = RING_CZ + Math.sin(th) * L.b;
      pos.push(x, t.y, z, x, RING_BOTTOM, z);
      ridge.push(t.y, L.haze, mistTop, mistFloor, t.y, L.haze, mistTop, mistFloor);
    }
    const n = tops.length;
    for (let i = 0; i < n; i++) {
      const a = first + i * 2;
      const b = first + ((i + 1) % n) * 2;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRidge", new THREE.Float32BufferAttribute(ridge, 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

// ── CPU sky, for reflections ─────────────────────────────────────────────────

type SkyFn = (dir: THREE.Vector3, out: THREE.Color) => THREE.Color;

/** The dome's atmoSky() in TypeScript: linear colour in a unit direction, no disc. */
function makeSkyCpu(
  haze: THREE.Color,
  horizon: THREE.Color,
  glow: THREE.Color,
  mid: THREE.Color,
  top: THREE.Color,
  sunDir: THREE.Vector3,
  sunGlow: THREE.Color,
): SkyFn {
  const sz = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  const low = new THREE.Color();
  const tmp = new THREE.Color();
  return (d, out) => {
    const deg = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y))));
    const hl = Math.hypot(d.x, d.z);
    const toward = hl > 1e-4 ? 0.5 + 0.5 * ((d.x / hl) * sz.x + (d.z / hl) * sz.y) : 0.5;
    low.copy(horizon).lerp(glow, toward * toward * 0.85);
    out.copy(horizon).lerp(low, smoothstep(-0.8, 1.2, deg));
    out.lerp(mid, smoothstep(MID_FROM_DEG, MID_TO_DEG, deg) * (0.55 + 0.45 * (1 - toward)));
    out.lerp(top, smoothstep(TOP_FROM_DEG, TOP_TO_DEG, deg));
    const ca = Math.max(d.dot(sunDir), 0);
    const g = 0.22 * Math.pow(ca, 5) + 0.55 * Math.pow(ca, 90);
    out.r += sunGlow.r * g;
    out.g += sunGlow.g * g;
    out.b += sunGlow.b * g;
    tmp.copy(haze).lerp(out, smoothstep(-2, 0, deg));
    return out.copy(tmp);
  };
}

function buildEnv(renderer: THREE.WebGLRenderer, sky: SkyFn): THREE.WebGLRenderTarget {
  const W = 64;
  const H = 32;
  const data = new Float32Array(W * H * 4);
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  for (let row = 0; row < H; row++) {
    const lat = ((row + 0.5) / H - 0.5) * Math.PI;
    for (let col = 0; col < W; col++) {
      // Equirect: u = atan(dir.z, dir.x) / 2pi + 0.5 in three's convention.
      const lon = ((col + 0.5) / W - 0.5) * Math.PI * 2;
      d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      sky(d, c);
      const o = (row * W + col) * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      data[o + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromEquirectangular(tex);
  } finally {
    pmrem.dispose();
    tex.dispose();
  }
}
