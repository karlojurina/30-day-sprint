import * as THREE from "three";
import { NO_REFLECT_LAYER } from "./light";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { airshipKit } from "./dress-sky";

/**
 * V5 look module: life (world_art_bible.md 0.11, 2.1.7, 4.6, section 6).
 * "Every stop has one moving thing near and one far, periods 3 to 10 s."
 *
 * Four draw calls at most, one per effect type, each one instanced:
 *
 *   LifeBirds     InstancedMesh, 12 triangle V-winged birds, matrices on the CPU.
 *                 Gulls (pale, dark tips) over the a1 shore and the a8 quay;
 *                 dark birds soaring over the a2 valley and gliding low over
 *                 the Mirror Lake (they cross its reflection). Flap in short
 *                 bursts between glides, bank into the orbit.
 *   LifeSoft      billboard puffs, normal blending, the fog ramp: the a1
 *                 campfire's smoke column, the a2 cabin chimney, 3 to 4 harbour
 *                 chimneys (E8), and slow cloud wisps drifting past the Sky
 *                 Island's rim and over the Harbour Isle. Smoke is warm on the
 *                 sun side and cool in shade; wisps take the light key's
 *                 cloudTop / cloudBase.
 *   LifeGlow      additive sprites (the bible's `glow` program): fireflies (E4)
 *                 and glowing seeds rising off the Great Tree's roots and
 *                 drifting in the air (E5) in the Glowing Forest; dust motes
 *                 (E6) turning in the mine's torch light and the shaft's
 *                 daylight at a4; fish rings on the Mirror Lake (flat, on the
 *                 water); a shooting star (E10) every 18 to 25 s whenever the
 *                 stars are out; the lamp halos (E1) of the distant airships.
 *   LifeAirships  InstancedMesh, 3 airships built from the world's one kit
 *                 (dress-sky.ts airshipKit, pass 3), MeshLambertMaterial so the
 *                 light, the fog ramp and the grade reach them untouched. One
 *                 crosses the a8 sky, one loops the Harbour Isle, one crosses
 *                 the Sky Island's horizon at a7 (the next place, announced).
 *
 * Budget (bible 5.2, "effects and life"): about 2k triangles of the 15k, and
 * 4 calls of the 6, only while something of that type is on screen.
 *
 * PLACEMENT. Things that must be SEEN at a stop are placed in that stop's own
 * view: `anchor(stop, dist, nx, ny)` is the world point at that distance
 * along the stop camera's ray through screen point (nx, ny) (NDC, 960x600).
 * The stop cameras are the rail's own poses (layout TRAIL + TRAIL_VIEW at
 * PLACES[i].trail), so nothing here is a magic world coordinate that goes
 * stale when a place is re-dressed.
 *
 * SMOKE SOURCES. Found at install (life installs last):
 *   1. any Object3D with userData.smoke = "column" | "chimney" (true = chimney):
 *      a plume from the top of its world bounding box (an empty marker works).
 *      A tagged source within 400 of a stop replaces that stop's default.
 *   2. by name: a visible object named /campfire/i (blocks' CampfireFlame) for
 *      a1, /chimney/i anywhere.
 *   3. defaults: the a1 fire pit and the a2 cabin chimney where blocks.ts
 *      builds them (a short downward ray snaps each to the highest non
 *      terrain surface there, so a re-dressed roof is followed); at a8, roofs
 *      found by 16 downward rays in the part of the town the a8 camera frames
 *      to the side of the Guild Hall.
 *
 * THE CLOCK. Everything is a pure function of the `time` update() receives
 * (scene.ts's sum of clamped frame dts), so a sleeping loop freezes the world
 * and it resumes where it stopped. Reduced motion pins that time to FROZEN_T:
 * everything holds one good pose, no shooting star, update() asks for nothing.
 * Hidden tabs: scene.ts stops ticking, so nothing here runs.
 *
 * WHAT KEEPS THE LOOP AWAKE. isAnimating() is true only while a group (a
 * flock, a plume, a wisp bank, the fireflies, the motes, a ring site, an
 * airship, a live shooting star) is inside the camera frustum and near
 * enough to read. A type with nothing on screen draws nothing (count 0).
 *
 * FOG AND GRADE. Birds and soft puffs are ShaderMaterials with fog: true,
 * UniformsLib.fog and three's stock fog chunks, so light.ts's Firewatch ramp
 * and grade reach them like any built-in material. The airships are
 * MeshLambertMaterial. The glow sprites are ADDITIVE: mixing an additive
 * sprite toward the ramp colour would add haze-coloured squares, so the glow
 * shader instead fades by the ramp's alpha, read from light.ts's shared
 * fwRamp uniform (start, end, cap), and takes the grade through
 * <tonemapping_fragment>. Soft and glow sit on NO_REFLECT_LAYER (the lake's
 * mirror pass skips them); the birds stay on layer 0 so the lake reflects
 * them.
 *
 * Harness (development only): window.__worldLife() returns stats and where
 * each group projects; __worldLife.setTime(t | null) pins the life clock
 * (SwiftShader draws ~0.6 s a frame and the scene clamps dt to 0.05, so real
 * seconds are useless there); __worldLife.shootNow() fires a shooting star.
 */

// ── Tunables ────────────────────────────────────────────────────────────────

/** Reduced motion: every piece holds its pose at this scene time. */
const FROZEN_T = 23.0;
/** The design frame the anchors are measured in (960x600, fov 31). */
const DESIGN_ASPECT = 1.6;

const hex = (h: number) => new THREE.Color().setHex(h); // sRGB in, linear stored

// ── Stop views ──────────────────────────────────────────────────────────────

interface StopView {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  tanV: number;
}

function stopViews(ctx: WorldCtx): StopView[] {
  const L = ctx.layout;
  const tanV = Math.tan(THREE.MathUtils.degToRad(L.DESIGN_FOV / 2));
  return L.PLACES.map((p) => {
    const k = p.trail;
    const [x, y, z] = L.TRAIL[k];
    const { bearing, pitch } = L.TRAIL_VIEW[k];
    const b = THREE.MathUtils.degToRad(bearing);
    const pt = THREE.MathUtils.degToRad(pitch);
    const fwd = new THREE.Vector3(Math.sin(b) * Math.cos(pt), -Math.sin(pt), -Math.cos(b) * Math.cos(pt)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    return { pos: new THREE.Vector3(x, y, z), fwd, right, up, tanV };
  });
}

/** The world point `dist` along stop `v`'s camera ray through NDC (nx, ny). */
function anchor(v: StopView, dist: number, nx: number, ny: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out
    .copy(v.pos)
    .addScaledVector(v.fwd, dist)
    .addScaledVector(v.right, nx * dist * v.tanV * DESIGN_ASPECT)
    .addScaledVector(v.up, ny * dist * v.tanV);
}

/** Where stop `v`'s ray through (nx, ny) meets the plane y = planeY (null if it never does). */
function rayToPlane(v: StopView, nx: number, ny: number, planeY: number): THREE.Vector3 | null {
  const d = anchor(v, 1, nx, ny).sub(v.pos);
  if (Math.abs(d.y) < 1e-6) return null;
  const t = (planeY - v.pos.y) / d.y;
  return t > 0 ? v.pos.clone().addScaledVector(d, t) : null;
}

// ── Small helpers ───────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A unit quad for instanced billboards: corner in [-1,1]^2, two triangles. */
function billboardQuad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const NOISE_GLSL = /* glsl */ `
float lh(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * lnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

/** What light.ts publishes on scene.userData.light (only the fields read here). */
interface LightStateLike {
  lampGlow: number;
  magicGlow: number;
  stars: number;
  under: number;
  cloudTop: THREE.Color;
  cloudBase: THREE.Color;
  skyHorizon: THREE.Color;
  haze: THREE.Color;
}

// ── Birds ───────────────────────────────────────────────────────────────────

type BirdTone = "gull" | "dark";

interface FlockDef {
  name: string;
  /** The stop whose view the orbit is centred in, and where in that view. */
  stop: number;
  dist: number;
  nx: number;
  ny: number;
  /** Orbit semi-axes (rx along the stop camera's right, rz along its view) and ground speed (sign = direction). */
  rx: number;
  rz: number;
  speed: number;
  count: number;
  scale: [number, number];
  tone: BirdTone;
  /** Seconds between flap bursts, range. */
  glide: [number, number];
  seed: number;
  /** Past this from the camera the flock is not drawn and does not animate. */
  maxDist: number;
}

/**
 * Pixel rule (bible 1.9): at 960x600 a span S at distance d covers ~1082 S / d
 * px. Gulls at 240 with a 7.5 unit span are ~34 px; the dark birds at 560 to
 * 640 with 10 unit spans are ~18 px, silhouettes against the pale far layer.
 */
const FLOCKS: FlockDef[] = [
  // a1: gulls wheeling over the beach, above the signpost, right of it (near).
  // Pass 3: further out and smaller (at 245 / 1.9-2.2 they read as giant white cut-outs).
  { name: "shore-gulls", stop: 0, dist: 380, nx: 0.25, ny: 0.55, rx: 50, rz: 34, speed: 10, count: 5, scale: [1.2, 1.4], tone: "gull", glide: [3.5, 6], seed: 3, maxDist: 1300 },
  // a2: three hawks circling slowly over the open meadow left of the lookout
  // (mid green there; over the forest a dark bird vanishes) (far).
  { name: "valley", stop: 1, dist: 540, nx: -0.42, ny: 0.42, rx: 38, rz: 30, speed: -8.5, count: 3, scale: [3.0, 3.4], tone: "dark", glide: [6, 10], seed: 11, maxDist: 1600 },
  // a5: big dark birds skimming ~20 over the lake's bright reflection band; the mirror doubles them (far).
  { name: "lake", stop: 4, dist: 520, nx: -0.02, ny: 0.06, rx: 140, rz: 40, speed: 14, count: 5, scale: [2.8, 3.3], tone: "dark", glide: [5, 8], seed: 29, maxDist: 1700 },
  // a8: gulls over the quay and the square (near).
  { name: "harbour-gulls", stop: 7, dist: 215, nx: 0.3, ny: 0.5, rx: 38, rz: 26, speed: -9.5, count: 7, scale: [1.8, 2.1], tone: "gull", glide: [3.5, 6], seed: 41, maxDist: 1300 },
];

const GULL_BODY = 0xe8e2d6;
const GULL_TIP = 0x3a3a40;
const DARK_BIRD = 0x2a2426;

/**
 * One bird, facing +z, wings along x, 4.8 units tip to tip at scale 1, 12
 * triangles. `aWing` is 0 on the body and 1 at the tips: the vertex shader
 * lifts the wing by it and the fragment darkens a gull's tips by it. The
 * wings are held in a soaring V (~22 degrees), which still reads as a bird
 * seen from near its own height, where a flat chevron is a 1 px line.
 */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      wing.push(v[3]);
    }
  };
  const nose = [0, 0, 0.95, 0];
  const notch = [0, 0, -0.95, 0];
  for (const s of [1, -1]) {
    const rootF = [0.22 * s, 0, 0.36, 0];
    const rootB = [0.17 * s, 0, -0.34, 0];
    const elbowF = [1.05 * s, 0.4, 0.26, 0.45];
    const elbowB = [0.98 * s, 0.4, -0.3, 0.45];
    const tip = [2.4 * s, 0.95, -0.62, 1];
    const tail = [0.34 * s, 0, -1.22, 0];
    tri(rootF, elbowF, rootB);
    tri(rootB, elbowF, elbowB);
    tri(elbowF, tip, elbowB);
    tri(nose, rootF, [0, 0, 0.3, 0]);
    tri([0, 0, 0.3, 0], rootF, rootB);
    tri(rootB, tail, notch);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

function birdMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeBirdMat",
    side: THREE.DoubleSide,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTip: { value: hex(GULL_TIP) },
    },
    vertexShader: /* glsl */ `
      attribute float aWing;
      attribute float aFlap;
      attribute float aGull;
      varying float vWing;
      varying float vGull;
      varying vec3 vCol;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        // Wings beat about the shoulder: the tip travels most and sweeps in a
        // little as it rises, so a beat reads as a beat and not a hinge.
        float w = aWing * aWing;
        p.y += aFlap * w * 1.45;
        p.x *= 1.0 - abs(aFlap) * w * 0.12;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vWing = aWing;
        vGull = aGull;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(0.02);
        #endif
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      uniform vec3 uTip;
      varying float vWing;
      varying float vGull;
      varying vec3 vCol;
      #include <fog_pars_fragment>
      void main() {
        vec3 c = mix(vCol, uTip, vGull * smoothstep(0.62, 0.95, vWing));
        gl_FragColor = vec4(c * uTint, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

interface Bird {
  ox: number;
  oy: number;
  oz: number;
  scale: number;
  wf: number;
  wp: number;
  period: number;
  phase: number;
  beat: number;
}

interface Flock {
  def: FlockDef;
  c: THREE.Vector3;
  /** Orbit axes in world XZ (unit): a along the stop camera's right, b along its view. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  omega: number;
  theta0: number;
  birds: Bird[];
  sphere: THREE.Sphere;
  onScreen: boolean;
}

function buildFlocks(views: StopView[]): Flock[] {
  return FLOCKS.map((def) => {
    const rand = mulberry32(def.seed * 7919 + 13);
    const v = views[Math.min(def.stop, views.length - 1)];
    const c = anchor(v, def.dist, def.nx, def.ny);
    const a = new THREE.Vector2(v.right.x, v.right.z).normalize();
    const b = new THREE.Vector2(v.fwd.x, v.fwd.z).normalize();
    const birds: Bird[] = [];
    for (let i = 0; i < def.count; i++) {
      const k = i === 0 ? 0 : 0.35 + 0.65 * rand();
      const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * (4 + 20 * rand() * k);
      birds.push({
        ox: side,
        oy: (rand() - 0.5) * 9,
        oz: i === 0 ? 0 : 5 + 26 * k,
        scale: def.scale[0] + (def.scale[1] - def.scale[0]) * rand(),
        wf: 0.15 + 0.2 * rand(),
        wp: rand() * Math.PI * 2,
        period: def.glide[0] + (def.glide[1] - def.glide[0]) * rand(),
        phase: rand(),
        beat: def.tone === "gull" ? 1.9 + 0.8 * rand() : 2.6 + 1.2 * rand(),
      });
    }
    const meanR = (def.rx + def.rz) / 2;
    return {
      def,
      c,
      ax: a.x,
      az: a.y,
      bx: b.x,
      bz: b.y,
      omega: def.speed / meanR,
      theta0: rand() * Math.PI * 2,
      birds,
      sphere: new THREE.Sphere(c.clone(), Math.max(def.rx, def.rz) + 40),
      onScreen: false,
    };
  });
}

// ── Soft puffs: smoke and wisps ─────────────────────────────────────────────

interface PlumeSpec {
  puffs: number;
  life: number;
  rise: number;
  s0: number;
  s1: number;
  op: number;
}

interface Plume {
  name: string;
  pos: THREE.Vector3;
  kind: "column" | "chimney";
  wind: THREE.Vector3;
  from: string;
  spec: PlumeSpec;
  /** The tagged or named source: the plume shows only while it is shown (and lit). */
  src?: THREE.Object3D;
  lit?: () => boolean;
}

/**
 * A plume's numbers: the kind's defaults, overridden by a source's advisory
 * userData.smokeSpec { rate (puffs per second), rise, width (puff size at the
 * source) } where given (dress-shore.ts sets it).
 */
function plumeSpec(kind: "column" | "chimney", o?: THREE.Object3D): PlumeSpec {
  const k = PLUME_KIND[kind];
  const sp = (o?.userData?.smokeSpec ?? {}) as { rate?: number; rise?: number; width?: number };
  const rise = typeof sp.rise === "number" && sp.rise > 0 ? sp.rise : k.rise;
  const s0 = typeof sp.width === "number" && sp.width > 0 ? sp.width / 2 : k.s0;
  // Never fewer than the kind's own count: fewer puffs than that part at the root into separate balls.
  const puffs = typeof sp.rate === "number" && sp.rate > 0 ? Math.round(THREE.MathUtils.clamp(sp.rate * k.life, k.puffs, 32)) : k.puffs;
  // A taller plume spreads wider at the top.
  const s1 = k.s1 * Math.sqrt(rise / k.rise);
  return { puffs, life: k.life, rise, s0, s1, op: k.op };
}

/** Per plume kind: puffs, life (s), rise, start and end size (half extents), opacity. */
const PLUME_KIND = {
  // The Firewatch column: tall, thin at the root, leaning off downwind.
  column: { puffs: 26, life: 16, rise: 135, s0: 3.2, s1: 20, op: 0.36 },
  chimney: { puffs: 16, life: 12, rise: 58, s0: 2.2, s1: 11, op: 0.4 },
} as const;
const SMOKE_MAX_DIST = 1500;
/** Soft groups the shader can switch: plumes first, the last slot is every wisp. */
const SOFT_GROUPS_MAX = 16;

interface WispDef {
  stop: number;
  dist: number;
  nx: number;
  ny: number;
  /** Half width and half height of the band; drift speed (units/s, along the stop's right); life (s). */
  w: number;
  h: number;
  drift: number;
  life: number;
  op: number;
  seed: number;
}

/**
 * Wisps drift across the stop's view for `life` seconds (about 300 units),
 * fading in and out; each respawns where it began. a7: in the navy sky just
 * over the island's far rim, silver in the moonlight. a8: over the town in
 * the morning sky and low past the isle's edge.
 */
const WISPS: WispDef[] = [
  { stop: 6, dist: 1500, nx: -0.55, ny: 0.34, w: 190, h: 26, drift: 4.5, life: 70, op: 0.55, seed: 1.3 },
  { stop: 6, dist: 1850, nx: 0.35, ny: 0.48, w: 240, h: 30, drift: 4.0, life: 80, op: 0.5, seed: 2.9 },
  { stop: 6, dist: 1250, nx: 0.75, ny: 0.24, w: 150, h: 20, drift: 5.0, life: 60, op: 0.45, seed: 4.4 },
  { stop: 6, dist: 2100, nx: -0.1, ny: 0.62, w: 260, h: 28, drift: 3.6, life: 90, op: 0.4, seed: 5.8 },
  { stop: 7, dist: 1900, nx: -0.5, ny: 0.62, w: 230, h: 34, drift: 5.0, life: 70, op: 0.6, seed: 7.1 },
  { stop: 7, dist: 2400, nx: 0.45, ny: 0.72, w: 300, h: 40, drift: 4.2, life: 85, op: 0.55, seed: 8.6 },
  { stop: 7, dist: 1500, nx: 0.8, ny: 0.5, w: 170, h: 26, drift: 5.5, life: 60, op: 0.5, seed: 9.9 },
  { stop: 7, dist: 1150, nx: -0.85, ny: 0.05, w: 160, h: 22, drift: 4.8, life: 65, op: 0.45, seed: 11.2 },
];
const WISP_MAX_DIST = 3200;

function softMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeSoftMat",
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
      uLit: { value: hex(0xf4e6d4) },
      uShade: { value: hex(0x8c8a93) },
      uCloudTop: { value: hex(0xf0e8e0) },
      uCloudBase: { value: hex(0xa8a4b0) },
      uOn: { value: new Array(SOFT_GROUPS_MAX).fill(1) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform float uOn[${SOFT_GROUPS_MAX}];
      attribute float aGroup;
      attribute vec3 aOrigin;
      attribute vec3 aWind;
      attribute vec4 aShape;  // life (s), rise, size start, size end (half extents)
      attribute vec4 aMisc;   // seed, stretch (x), opacity, kind (0 smoke, 1 wisp)
      varying vec2 vUv;
      varying float vAlpha;
      varying float vSeed;
      varying float vKind;
      varying vec2 vSun;
      #include <fog_pars_vertex>
      void main() {
        if (uOn[int(aGroup + 0.5)] < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float life = aShape.x;
        float age = fract(uTime / life + aMisc.x);
        float t = age * life;
        vec3 c;
        float size;
        float ang;
        vec2 corner = position.xy;
        if (aMisc.w < 0.5) {
          // Smoke: buoyant, quick off the source, slowing as it cools, bending downwind.
          float rise = aShape.y * (1.0 - exp(-1.2 * age)) / (1.0 - exp(-1.2));
          vec3 drift = aWind * t * (0.15 + 0.85 * age * age);
          float wob = (sin(t * 1.1 + aMisc.x * 41.0) * 1.3 + sin(t * 0.47 + aMisc.x * 13.0)) * age * (1.0 + aShape.w * 0.08);
          c = aOrigin + vec3(wob, rise, wob * 0.4) + drift;
          size = mix(aShape.z, aShape.w, pow(age, 0.7));
          ang = aMisc.x * 6.2831 + t * 0.12;
          vAlpha = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.3, 1.0, age)) * aMisc.z;
        } else {
          // Wisp: drifts on the wind, no rise, a long flat band.
          c = aOrigin + aWind * t + vec3(0.0, sin(t * 0.05 + aMisc.x) * 4.0, 0.0);
          size = aShape.z;
          ang = 0.0;
          corner.x *= aMisc.y;
          vAlpha = smoothstep(0.0, 0.22, age) * (1.0 - smoothstep(0.62, 1.0, age)) * aMisc.z;
        }
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
        mvPosition.xy += rot * corner * size;
        gl_Position = projectionMatrix * mvPosition;
        vUv = position.xy;
        vSeed = aMisc.x;
        vKind = aMisc.w;
        // The sun's direction on screen, in this puff's rotated frame.
        vec2 s = normalize((viewMatrix * vec4(uSunDir, 0.0)).xy + vec2(1e-4));
        vSun = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform vec3 uCloudTop;
      uniform vec3 uCloudBase;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vSeed;
      varying float vKind;
      varying vec2 vSun;
      ${NOISE_GLSL}
      #include <fog_pars_fragment>
      void main() {
        float a;
        vec3 col;
        if (vKind < 0.5) {
          float r = length(vUv);
          float n = lfbm(vUv * 1.6 + vSeed * 23.0);
          float d = 1.0 - smoothstep(0.3, 1.0, r + (n - 0.5) * 0.6);
          a = d * vAlpha;
          float lit = clamp(0.45 + 0.7 * dot(vUv, vSun), 0.0, 1.0);
          col = mix(uShade, uLit, lit);
        } else {
          // A lumpy crown over a flatter base, eroded at the ends.
          float n = lfbm(vec2(vUv.x * 2.6 + vSeed * 3.1 + uTime * 0.004, vUv.y * 1.3 + vSeed));
          float e = length(vec2(vUv.x, (vUv.y + 0.2) * 1.25)) + (n - 0.5) * 0.75;
          a = (1.0 - smoothstep(0.25, 0.95, e)) * smoothstep(-0.85, -0.45, vUv.y) * vAlpha;
          col = mix(uCloudBase, uCloudTop, smoothstep(-0.5, 0.65, vUv.y + (n - 0.5) * 0.5));
        }
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ── Glow: additive sprites ──────────────────────────────────────────────────

/** Glow kinds, as aP.x in the shader. */
const K = { firefly: 0, seed: 1, mote: 2, ring: 3, star: 4, halo: 5 } as const;

// Bible 1.2: a6 accents teal #3fd6c8, cyan #7fe8ff, violet #a86cf0; fireflies a soft lime.
const FIREFLY_HEX = [0xc8f28c, 0xb4f0a8, 0x9ff0c0];
const SEED_HEX = [0x3fd6c8, 0x7fe8ff, 0xa86cf0, 0x3fd6c8];
const MOTE_TORCH = 0xffc890;
const MOTE_DAY = 0xffe2bc;
const HALO_HEX = 0xffc070;

/** Seconds a fish ring lives, and each site's period (overall one ring every ~6.5 s). */
const RING_LIFE = 3.8;
/** phase: share of the period already gone at t = 0 (site 0 fires at t = 11.8, inside the proof frames). */
const RING_SITES: { nx: number; ny: number; period: number; r: number; phase: number }[] = [
  { nx: -0.12, ny: 0.03, period: 16.3, r: 20, phase: 0.276 },
  { nx: 0.5, ny: 0.12, period: 19.1, r: 22, phase: 0.51 },
  { nx: 0.06, ny: -0.16, period: 23.7, r: 17, phase: 0.82 },
];
/** Shooting stars: every 18 to 25 s while the stars are out (light state stars above this). */
const STAR_MIN = 0.35;

function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "LifeGlowMat",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Additive: see the header (FOG AND GRADE). The fade reads light.ts's
    // shared fwRamp (start, end, cap), assigned into these uniforms by light.ts.
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uPx: { value: 0.001 },
      uMagic: { value: 1 },
      uLamp: { value: 1 },
      fwRamp: { value: new THREE.Vector4(1e8, 2e8, 0, 0) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPx;      // world units per pixel at distance 1
      uniform float uMagic;
      uniform float uLamp;
      uniform vec4 fwRamp;
      attribute vec3 aPos;
      attribute vec3 aVel;
      attribute vec4 aP;      // kind, seed, size (world), period (s)
      attribute vec4 aCol;    // linear rgb, min size in px
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vKind;
      varying float vAge;
      void main() {
        float kind = aP.x;
        float s = aP.y;
        float size = aP.z;
        vec3 p = aPos;
        float glow = 1.0;
        vKind = kind;
        vAge = 0.0;
        vUv = position.xy;
        if (kind < 0.5) {
          // Firefly: a slow hover round home, mostly dim with a short bright pulse.
          float h = s * 97.0;
          p += vec3(sin(uTime * 0.31 + h) * aVel.x + sin(uTime * 0.83 + h * 1.7) * aVel.x * 0.35,
                    sin(uTime * 0.57 + h * 2.3) * aVel.y,
                    cos(uTime * 0.27 + h * 0.9) * aVel.z + cos(uTime * 0.71 + h * 3.1) * aVel.z * 0.3);
          float b = 0.5 + 0.5 * sin(uTime * (0.9 + fract(s * 7.0) * 0.8) + h);
          glow = (0.3 + 0.7 * pow(b, 4.0)) * uMagic;
        } else if (kind < 1.5) {
          // Seed: rises on a loop, swaying, fading in and out; a slow 30 to 50 percent pulse.
          float age = fract(uTime / aP.w + s);
          float t = age * aP.w;
          p += aVel * t + vec3(sin(t * 0.7 + s * 31.0) * 3.0, 0.0, cos(t * 0.55 + s * 17.0) * 3.0);
          glow = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.7, 1.0, age)) * (0.6 + 0.4 * sin(uTime * 1.3 + s * 40.0)) * uMagic;
        } else if (kind < 2.5) {
          // Mote: drifting, turning in the light (bright only when a face catches it).
          float h = s * 61.0;
          p += vec3(sin(uTime * 0.13 + h) * aVel.x, sin(uTime * 0.09 + h * 1.9) * aVel.y - mod(uTime * 0.25 + h, 6.0) * 0.1, cos(uTime * 0.11 + h * 0.7) * aVel.z);
          glow = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.6 + fract(s * 13.0)) + h), 4.0);
        } else if (kind < 3.5) {
          // Fish ring: flat on the water, only for RING_LIFE seconds of each period.
          float age = mod(uTime + s * aP.w, aP.w);
          vAge = age;
          if (age > ${RING_LIFE.toFixed(1)}) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          // -y: the quad's winding faces up (+y), not down, so front-face culling keeps it.
          vec3 w = p + vec3(position.x * size, 0.0, -position.y * size);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(w - cameraPosition);
          float u = clamp((d - fwRamp.x) / max(fwRamp.y - fwRamp.x, 1.0), 0.0, 1.0);
          vCol = aCol.rgb * (1.0 - min(fwRamp.z, u * (1.25 - 0.35 * u)));
          return;
        } else if (kind < 4.5) {
          // Shooting star: s = start time, aP.w = duration; a streak from tail to head.
          float age = uTime - s;
          if (age < 0.0 || age > aP.w) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 head = p + aVel * age;
          vec3 tail = head - aVel * min(age, 0.3);
          vec4 h4 = modelViewMatrix * vec4(head, 1.0);
          vec4 t4 = modelViewMatrix * vec4(tail, 1.0);
          vec2 ax = h4.xy - t4.xy;
          vec2 dir = normalize(ax + vec2(1e-5));
          vec2 nrm = vec2(-dir.y, dir.x);
          float x01 = position.x * 0.5 + 0.5;
          vec4 mv = mix(t4, h4, x01);
          mv.xy += nrm * position.y * max(size, aCol.a * uPx * -mv.z);
          gl_Position = projectionMatrix * mv;
          float env = smoothstep(0.0, 0.12, age / aP.w) * (1.0 - smoothstep(0.55, 1.0, age / aP.w));
          vCol = aCol.rgb * env;
          return;
        } else {
          // Halo: a lamp, steady with a faint breath.
          glow = (0.85 + 0.15 * sin(uTime * 2.1 + s * 20.0)) * uLamp;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float px = max(size, aCol.a * uPx * -mv.z);
        mv.xy += position.xy * px;
        gl_Position = projectionMatrix * mv;
        float d = length(p - cameraPosition);
        float u = clamp((d - fwRamp.x) / max(fwRamp.y - fwRamp.x, 1.0), 0.0, 1.0);
        // Ramp alpha (bible 1.4's stops 0, .10, .32, .58, .78, cap) approximated.
        float fogA = min(fwRamp.z, u * (1.25 - 0.35 * u));
        vCol = aCol.rgb * glow * (1.0 - fogA);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vKind;
      varying float vAge;
      void main() {
        float a;
        if (vKind > 2.5 && vKind < 3.5) {
          // Two rings, the second a beat behind, spreading and thinning out.
          float r = length(vUv);
          float k = vAge / ${RING_LIFE.toFixed(1)};
          float r1 = 1.0 - exp(-vAge * 0.9);
          float r2 = 1.0 - exp(-max(vAge - 0.55, 0.0) * 0.9);
          // Wide enough to survive a 12 degree grazing view from 500 out (thinner is sub pixel).
          float w1 = 0.08 + 0.06 * k;
          float band = exp(-pow((r - r1) / w1, 2.0)) + 0.6 * exp(-pow((r - r2) / w1, 2.0)) * step(0.55, vAge);
          a = band * pow(1.0 - k, 1.25) * (1.0 - smoothstep(0.92, 1.0, r));
        } else if (vKind > 3.5 && vKind < 4.5) {
          float x = vUv.x * 0.5 + 0.5;
          float y = abs(vUv.y);
          a = pow(x, 1.6) * (1.0 - smoothstep(0.0, 1.0, y)) + smoothstep(0.82, 1.0, x) * (1.0 - smoothstep(0.0, 0.7, y)) * 0.8;
        } else {
          float r = length(vUv);
          float core = 1.0 - smoothstep(0.0, 0.3, r);
          float halo = pow(max(1.0 - r, 0.0), 2.4) * 0.5;
          a = core + halo;
        }
        if (a < 0.003) discard;
        gl_FragColor = vec4(vCol * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Writes the glow instance buffers; the vertex shader animates them. */
class GlowBuf {
  pos: number[] = [];
  vel: number[] = [];
  p: number[] = [];
  col: number[] = [];
  add(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, seed: number, size: number, period: number, c: THREE.Color, mul: number, minPx: number): number {
    this.pos.push(x, y, z);
    this.vel.push(vx, vy, vz);
    this.p.push(kind, seed, size, period);
    this.col.push(c.r * mul, c.g * mul, c.b * mul, minPx);
    return this.pos.length / 3 - 1;
  }
  get count() {
    return this.pos.length / 3;
  }
}

interface GlowGroup {
  name: string;
  sphere: THREE.Sphere;
  maxDist: number;
  onScreen: boolean;
}

// ── Airships ────────────────────────────────────────────────────────────────

interface AirshipDef {
  name: string;
  /** Centred in this stop's view (stop, dist, nx, ny), or a world centre (x, y, z). */
  stop?: number;
  dist?: number;
  nx?: number;
  ny?: number;
  x?: number;
  y?: number;
  z?: number;
  /** Semi-axes: a along the stop's right (or world x), b along its view (or world z); rot in degrees about y. */
  a: number;
  b: number;
  rot: number;
  speed: number;
  scale: number;
  phase: number;
}

/**
 * a8: one crosses the morning sky over the town, 1,600 to 2,100 out, both
 * ways (its far leg is the "ship going", its near leg the "ship coming").
 * The harbour loop: round the Harbour Isle, for the flight and the docking.
 * a7: one crossing the horizon beyond the island's rim with its lamps lit,
 * the next place announced.
 */
const AIRSHIPS: AirshipDef[] = [
  { name: "a8-sky", stop: 7, dist: 1850, nx: 0.05, ny: 0.62, a: 950, b: 260, rot: 0, speed: 22, scale: 1.15, phase: 0.62 },
  { name: "harbour-loop", x: -2300, y: 1705, z: -4350, a: 820, b: 1050, rot: 25, speed: -18, scale: 0.95, phase: 0.2 },
  { name: "a7-horizon", stop: 6, dist: 1900, nx: 0.1, ny: 0.3, a: 900, b: 220, rot: 0, speed: 20, scale: 1.0, phase: 0.35 },
];
const AIRSHIP_MAX_DIST = 5200;
/** Airship length at scale 1 (bible: your ship is 120; these read as smaller cousins). */
const AIRSHIP_LEN = 64;

/**
 * The world's one airship kit (dress-sky.ts airshipKit) at the size whose
 * envelope is AIRSHIP_LEN long, moved so the origin is the envelope's axis,
 * nose along +x; vertex colours linear; flat shaded. The kit's lit windows
 * come in as warm paint (the lamps are this module's halo sprites).
 */
const KIT_LEN = AIRSHIP_LEN * 0.81;
const KIT_K = KIT_LEN / 120;
/** Lamp points on the kit, local to the envelope's axis: the starboard bow lantern and the envelope's nose. */
const SHIP_LAMPS: [number, number, number][] = [
  [44 * KIT_K, -58.4 * KIT_K, 9.4 * KIT_K],
  [72.6 * KIT_K, 0, 0],
];
function airshipGeometry(): THREE.BufferGeometry {
  const kit = airshipKit(KIT_LEN, hex(0x6a5a78).toArray() as [number, number, number]);
  const pos: number[] = [];
  const col: number[] = kit.c.slice();
  for (let i = 0; i < kit.p.length; i += 3) pos.push(kit.p[i], kit.p[i + 1] - kit.envY, kit.p[i + 2]);
  for (let i = 0; i < kit.gp.length; i += 3) pos.push(kit.gp[i], kit.gp[i + 1] - kit.envY, kit.gp[i + 2]);
  for (let i = 0; i < kit.gc.length; i++) col.push(Math.min(1, kit.gc[i]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface Airship {
  def: AirshipDef;
  c: THREE.Vector3;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  omega: number;
  sphere: THREE.Sphere;
  onScreen: boolean;
  /** Glow slots of its two lamps (gondola, bow), and whether they are parked out of sight. */
  lamps: [number, number];
  parked: boolean;
}

// ── Smoke sources ───────────────────────────────────────────────────────────

const _box = new THREE.Box3();

/** Top centre of an object's world bounding box (its world position if it has no geometry). */
function topOf(o: THREE.Object3D): THREE.Vector3 | null {
  _box.setFromObject(o);
  if (_box.isEmpty()) return o.getWorldPosition(new THREE.Vector3());
  return new THREE.Vector3((_box.min.x + _box.max.x) / 2, _box.max.y, (_box.min.z + _box.max.z) / 2);
}

/**
 * Shown, as far as a dresser decided: the object and its ancestors are
 * visible, except the scene's distance zones (Zone_*), which blocks.ts hides
 * while the camera is far away (Zone_harbour is hidden at install).
 */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible && !/^Zone_/.test(p.name)) return false;
  return true;
}

/** Meshes a downward ray may land on: dressing and blocks, not terrain, water, sky, instanced foliage or this module. */
function rayTargets(ctx: WorldCtx, near: THREE.Vector3, radius: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const s = new THREE.Sphere();
  ctx.scene.traverse((o) => {
    if (!shown(o)) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || !m.geometry) return;
    if (/^(Terrain|Sea|River|Stream|Brook|Pool|Light|Mirror|Life|Cloud)/.test(o.name)) return;
    const mat = m.material as THREE.Material;
    if (!mat || mat.transparent) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const bs = m.geometry.boundingSphere;
    if (!bs) return;
    s.copy(bs).applyMatrix4(m.matrixWorld);
    if (s.center.distanceTo(near) - s.radius > radius) return;
    out.push(o);
  });
  return out;
}

/** The highest non terrain surface under (x, z) within `drop` below `fromY`, or null. */
function roofAt(ray: THREE.Raycaster, targets: THREE.Object3D[], x: number, z: number, fromY: number, drop: number): THREE.Vector3 | null {
  ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
  ray.far = drop;
  const hits = ray.intersectObjects(targets, false);
  return hits.length ? hits[0].point.clone() : null;
}

/**
 * Finds the plumes (see the header, SMOKE SOURCES). Wind leans each plume
 * toward the stop camera's right and a little away from it, so no plume
 * drifts across its landmark (the landmarks sit left of their plumes).
 */
function findPlumes(ctx: WorldCtx, views: StopView[]): Plume[] {
  const scene = ctx.scene;
  scene.updateMatrixWorld(true);
  const tagged: Plume[] = [];
  const named: { o: THREE.Object3D; kind: "column" | "chimney" }[] = [];
  scene.traverse((o) => {
    const tag = o.userData?.smoke;
    if (tag) {
      const p = topOf(o);
      const kind = tag === "column" ? "column" : "chimney";
      const lit = o.userData?.smokeSpec?.lit;
      if (p) tagged.push({ name: o.name || "tagged", pos: p, kind, wind: new THREE.Vector3(), from: "tag", spec: plumeSpec(kind, o), src: o, lit: typeof lit === "function" ? lit : undefined });
      return;
    }
    if (!shown(o)) return;
    if (/campfire/i.test(o.name) && !/^Life/.test(o.name)) named.push({ o, kind: "column" });
    else if (/chimney/i.test(o.name)) named.push({ o, kind: "chimney" });
  });
  const windFor = (stop: number, k: number) => {
    const v = views[stop];
    return new THREE.Vector3().addScaledVector(v.right, 2.6 * k).addScaledVector(v.fwd, 0.9 * k).setY(0);
  };
  const nearStop = (p: THREE.Vector3) => {
    let best = -1;
    let bd = Infinity;
    ctx.layout.PLACES.forEach((pl, i) => {
      const d = Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { stop: best, d: bd };
  };
  const out: Plume[] = [];
  const covered = new Set<number>();
  const perStop = new Map<number, number>();
  const fromNames: Plume[] = named.map((n) => ({ name: n.o.name, pos: topOf(n.o)!, kind: n.kind, wind: new THREE.Vector3(), from: "name", spec: plumeSpec(n.kind, n.o), src: n.o }));
  for (const t of [...tagged, ...fromNames]) {
    if (!t.pos) continue;
    if (out.some((q) => q.pos.distanceTo(t.pos) < 12)) continue;
    const ns = nearStop(t.pos);
    const had = perStop.get(ns.stop) ?? 0;
    if (had >= 4) continue;
    perStop.set(ns.stop, had + 1);
    t.wind.copy(windFor(Math.max(0, ns.stop), t.kind === "column" ? 1 : 0.8));
    if (t.kind === "column") t.pos.y += 1;
    out.push(t);
    if (ns.d < 400) covered.add(ns.stop);
  }

  const ray = new THREE.Raycaster();
  const P = ctx.layout.PLACES;
  // a1: the campfire at the dock foot (blocks.ts buildLanding).
  if (!covered.has(0)) {
    const x = 1340;
    const z = 4206;
    out.push({ name: "a1-campfire", pos: new THREE.Vector3(x, ctx.terrainHeight(x, z) + 2, z), kind: "column", wind: windFor(0, 1), from: "default", spec: plumeSpec("column") });
  }
  // a2: the supply cabin's chimney (blocks.ts buildCamp: cabin at +60, -32; chimney +9, -2).
  if (!covered.has(1)) {
    const p = P[1].pos;
    const cx = p.x + 69;
    const cz = p.z - 34;
    const targets = rayTargets(ctx, new THREE.Vector3(cx, p.y + 20, cz), 60);
    let best: THREE.Vector3 | null = null;
    for (const [dx, dz] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3], [-6, -4], [6, 4]]) {
      const h = roofAt(ray, targets, cx + dx, cz + dz, p.y + 80, 90);
      if (h && (!best || h.y > best.y)) best = h;
    }
    const pos = best ?? new THREE.Vector3(cx, p.y + 21.5, cz);
    pos.y += 1;
    out.push({ name: "a2-cabin", pos, kind: "chimney", wind: windFor(1, 0.8), from: best ? "roof ray" : "default", spec: plumeSpec("chimney") });
  }
  // a8: 3 to 4 roofs the a8 camera frames beside the Guild Hall.
  if (!covered.has(7)) {
    const v = views[7];
    const Y = ctx.layout.WORLD.harbourIsle.y;
    const targets = rayTargets(ctx, new THREE.Vector3(P[7].pos.x, Y, P[7].pos.z), 520);
    const cands: THREE.Vector3[] = [];
    // Screen points in the town's band, both sides of the hall (NDC |x| > 0.3).
    const spots: [number, number][] = [[0.55, -0.1], [0.8, -0.05], [0.42, 0.02], [0.68, 0.08], [0.95, 0.0], [-0.45, -0.05], [-0.65, 0.05], [-0.85, -0.02], [0.35, -0.2], [0.6, -0.25], [-0.4, -0.2], [0.75, -0.18], [0.5, 0.12], [-0.6, -0.15], [0.88, 0.1], [-0.9, 0.08]];
    for (const [nx, ny] of spots) {
      // Where that screen point meets roof height, then a ray down onto whatever stands there.
      const g = rayToPlane(v, nx, ny, Y + 22);
      if (!g || g.distanceTo(v.pos) < 200 || g.distanceTo(v.pos) > 720) continue;
      const h = roofAt(ray, targets, g.x, g.z, Y + 140, 150);
      if (h && h.y > Y + 12) cands.push(h);
    }
    // Prefer the tallest, keep them apart.
    cands.sort((a, b) => b.y - a.y);
    const picks: THREE.Vector3[] = [];
    for (const c of cands) {
      if (picks.length >= 4) break;
      if (picks.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 70)) continue;
      picks.push(c);
    }
    picks.forEach((c, i) => {
      c.y += 1.5;
      out.push({ name: `a8-roof-${i}`, pos: c, kind: "chimney", wind: windFor(7, 0.9), from: "roof ray", spec: plumeSpec("chimney") });
    });
  }
  return out;
}

// ── Install ─────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const scene = ctx.scene;
  const camera = ctx.camera;
  const disposables: { dispose(): void }[] = [];
  const owned: THREE.Object3D[] = [];
  const motionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const frozen = () => ctx.reducedMotion || !!motionQuery?.matches;
  const lightHandle = () => (scene.userData.light as { state?: LightStateLike } | undefined)?.state ?? null;
  const noReflect = (o: THREE.Object3D) => {
    if (scene.userData.light) o.layers.set(NO_REFLECT_LAYER);
  };
  const views = stopViews(ctx);

  // ── Birds
  const flocks = buildFlocks(views);
  const birdCount = flocks.reduce((n, f) => n + f.birds.length, 0);
  const birdGeo = birdGeometry();
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(birdCount), 1);
  flap.setUsage(THREE.DynamicDrawUsage);
  birdGeo.setAttribute("aFlap", flap);
  const gullAttr = new THREE.InstancedBufferAttribute(new Float32Array(birdCount), 1);
  gullAttr.setUsage(THREE.DynamicDrawUsage);
  birdGeo.setAttribute("aGull", gullAttr);
  const birdMat = birdMaterial();
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
  birds.name = "LifeBirds";
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(birdCount * 3), 3);
  birds.instanceColor.setUsage(THREE.DynamicDrawUsage);
  // Only the flocks on screen are packed into the first `count` instances each frame.
  birds.count = 0;
  birds.frustumCulled = false;
  scene.add(birds);
  owned.push(birds);
  disposables.push(birdGeo, birdMat);
  const gullC = hex(GULL_BODY);
  const darkC = hex(DARK_BIRD);

  // ── Soft: plumes and wisps in one call
  const plumes = findPlumes(ctx, views);
  const plumesUsed = plumes.slice(0, SOFT_GROUPS_MAX - 4);
  const softN = plumesUsed.reduce((n, p) => n + p.spec.puffs, 0) + WISPS.length;
  const softGeo = billboardQuad();
  const sOrigin = new Float32Array(softN * 3);
  const sWind = new Float32Array(softN * 3);
  const sShape = new Float32Array(softN * 4);
  const sMisc = new Float32Array(softN * 4);
  const sGroup = new Float32Array(softN);
  const softGroups: GlowGroup[] = [];
  {
    const rand = mulberry32(77);
    let i = 0;
    plumesUsed.forEach((pl, k) => {
      const K2 = pl.spec;
      for (let j = 0; j < K2.puffs; j++, i++) {
        sOrigin.set([pl.pos.x, pl.pos.y, pl.pos.z], i * 3);
        sWind.set([pl.wind.x, pl.wind.y, pl.wind.z], i * 3);
        sShape.set([K2.life * (0.95 + 0.1 * rand()), K2.rise, K2.s0, K2.s1], i * 4);
        sMisc.set([(j + rand() * 0.45) / K2.puffs + k * 0.37, 1, K2.op, 0], i * 4);
        sGroup[i] = k;
      }
      const reach = pl.wind.clone().multiplyScalar(K2.life);
      const top = pl.pos.clone().add(new THREE.Vector3(reach.x, K2.rise, reach.z));
      softGroups.push({ name: pl.name, sphere: new THREE.Sphere(pl.pos.clone().add(top).multiplyScalar(0.5), pl.pos.distanceTo(top) / 2 + K2.s1 + 6), maxDist: SMOKE_MAX_DIST, onScreen: false });
    });
    const wispBox = new Map<number, THREE.Box3>();
    for (const w of WISPS) {
      const v = views[Math.min(w.stop, views.length - 1)];
      const c = anchor(v, w.dist, w.nx, w.ny);
      // Start half a life upwind, so the band crosses its anchor mid-life.
      const wind = new THREE.Vector3(v.right.x, 0, v.right.z).normalize().multiplyScalar(w.drift);
      const start = c.clone().addScaledVector(wind, -w.life * 0.5);
      sOrigin.set([start.x, start.y, start.z], i * 3);
      sWind.set([wind.x, wind.y, wind.z], i * 3);
      sShape.set([w.life, 0, w.h, w.h], i * 4);
      sMisc.set([w.seed * 0.137, w.w / w.h, w.op, 1], i * 4);
      sGroup[i] = SOFT_GROUPS_MAX - 1;
      i++;
      const b = wispBox.get(w.stop) ?? new THREE.Box3().makeEmpty();
      b.expandByPoint(start).expandByPoint(start.clone().addScaledVector(wind, w.life));
      b.expandByScalar(w.w);
      wispBox.set(w.stop, b);
    }
    for (const [stop, b] of wispBox) softGroups.push({ name: `wisps-a${stop + 1}`, sphere: b.getBoundingSphere(new THREE.Sphere()), maxDist: WISP_MAX_DIST, onScreen: false });
  }
  softGeo.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(sOrigin, 3));
  softGeo.setAttribute("aWind", new THREE.InstancedBufferAttribute(sWind, 3));
  softGeo.setAttribute("aShape", new THREE.InstancedBufferAttribute(sShape, 4));
  softGeo.setAttribute("aMisc", new THREE.InstancedBufferAttribute(sMisc, 4));
  softGeo.setAttribute("aGroup", new THREE.InstancedBufferAttribute(sGroup, 1));
  softGeo.instanceCount = 0;
  const softMat = softMaterial(ctx.sunDir);
  const soft = new THREE.Mesh(softGeo, softMat);
  soft.name = "LifeSoft";
  soft.frustumCulled = false;
  soft.renderOrder = 2;
  noReflect(soft);
  scene.add(soft);
  owned.push(soft);
  disposables.push(softGeo, softMat);

  // ── Glow
  const gb = new GlowBuf();
  const glowGroups: GlowGroup[] = [];
  const addGroup = (name: string, pts: THREE.Vector3[], pad: number, maxDist: number) => {
    const s = new THREE.Box3().setFromPoints(pts).expandByScalar(pad).getBoundingSphere(new THREE.Sphere());
    glowGroups.push({ name, sphere: s, maxDist, onScreen: false });
  };
  {
    const rand = mulberry32(606);
    const tmp = new THREE.Vector3();
    // a6 fireflies: most in the a6 view between the camera and the Great Tree,
    // hovering 4 to 40 over the floor; the rest spread through the forest.
    const v6 = views[5];
    const F = ctx.layout.WORLD.forest;
    const flyPts: THREE.Vector3[] = [];
    for (let i = 0; i < 150; i++) {
      let x: number;
      let z: number;
      if (i < 110) {
        const d = 90 + Math.pow(rand(), 0.8) * 560;
        anchor(v6, d, (rand() * 2 - 1) * 1.05, 0, tmp);
        x = tmp.x;
        z = tmp.z;
      } else {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * F.r * 0.95;
        x = F.x + Math.cos(a) * r;
        z = F.z + Math.sin(a) * r;
      }
      const y = ctx.terrainHeight(x, z) + 4 + Math.pow(rand(), 1.6) * 38;
      const c = hex(FIREFLY_HEX[i % FIREFLY_HEX.length]);
      gb.add(K.firefly, x, y, z, 5 + rand() * 4, 1.5 + rand() * 2, 5 + rand() * 4, rand(), 1.3 + rand() * 0.6, 0, c, 1.5, 3);
      flyPts.push(new THREE.Vector3(x, y, z));
    }
    addGroup("fireflies", flyPts, 20, 1400);
    // a6 seeds: rising off the Great Tree's roots toward its canopy, and drifting in the air.
    const T = ctx.landmarks["LM_GreatTree"] ?? { x: -760, y: 791, z: -1190, height: 200 };
    const seedPts: THREE.Vector3[] = [];
    for (let i = 0; i < 110; i++) {
      const a = rand() * Math.PI * 2;
      const r = 26 + rand() * 60;
      const x = T.x + Math.cos(a) * r;
      const z = T.z + Math.sin(a) * r;
      const y = ctx.terrainHeight(x, z) + 1;
      const life = 14 + rand() * 8;
      const up = (150 + rand() * 90) / life;
      const c = hex(SEED_HEX[i % SEED_HEX.length]);
      gb.add(K.seed, x, y, z, Math.cos(a) * 1.2, up, Math.sin(a) * 1.2, rand(), 1.4 + rand() * 0.9, life, c, 1.05, 2.4);
      seedPts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + up * life, z));
    }
    for (let i = 0; i < 120; i++) {
      const d = 120 + rand() * 520;
      anchor(v6, d, (rand() * 2 - 1) * 1.1, 0, tmp);
      const g = ctx.terrainHeight(tmp.x, tmp.z);
      const y = g + 8 + rand() * 70;
      const life = 20 + rand() * 14;
      const c = hex(SEED_HEX[(i + 1) % SEED_HEX.length]);
      gb.add(K.seed, tmp.x, y, tmp.z, (rand() - 0.5) * 1.6, 2 + rand() * 2.5, (rand() - 0.5) * 1.6, rand(), 1.0 + rand() * 0.8, life, c, 0.85, 2.0);
      seedPts.push(new THREE.Vector3(tmp.x, y, tmp.z));
    }
    addGroup("seeds", seedPts, 30, 1500);
    // a4 dust motes: in the tunnel's last stretch before the lift and the shaft's daylight over the cage.
    const v4 = views[3];
    const moteC = hex(MOTE_TORCH);
    const dayC = hex(MOTE_DAY);
    const motePts: THREE.Vector3[] = [];
    const lift = ctx.landmarks["LM_MineLift"] ?? { x: 1436.09, y: 95, z: 1041.56, height: 30 };
    for (let i = 0; i < 150; i++) {
      const inColumn = i < 45;
      let x: number;
      let y: number;
      let z: number;
      if (inColumn) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 10;
        x = lift.x + Math.cos(a) * r;
        z = lift.z + Math.sin(a) * r;
        y = lift.y + 2 + rand() * 40;
      } else {
        const d = 8 + Math.pow(rand(), 0.9) * 66;
        // Keep inside the tunnel: +-10 across, from the floor to the roof.
        const half = Math.min(1, 10 / (d * v4.tanV * DESIGN_ASPECT));
        anchor(v4, d, (rand() * 2 - 1) * half, 0, tmp);
        x = tmp.x;
        z = tmp.z;
        y = v4.pos.y - 11 + rand() * 21;
      }
      gb.add(K.mote, x, y, z, 1.2 + rand() * 1.5, 0.8 + rand(), 1.2 + rand() * 1.5, rand(), 0.07 + rand() * 0.06, 0, inColumn ? dayC : moteC, inColumn ? 0.55 : 0.4, 1.6);
      motePts.push(new THREE.Vector3(x, y, z));
    }
    addGroup("motes", motePts, 8, 260);
    // a5 fish rings on the Mirror Lake.
    const v5 = views[4];
    const lake = ctx.layout.WORLD.lake;
    const ringPts: THREE.Vector3[] = [];
    const ringC = new THREE.Color(1, 0.86, 0.74);
    // On the mirror itself: light.ts's MirrorLake sits a unit over WORLD.lake.y, and a ring under it is hidden.
    const mirror = scene.getObjectByName("MirrorLake");
    const ringY = Math.max(lake.y, mirror ? mirror.getWorldPosition(new THREE.Vector3()).y : lake.y) + 0.6;
    RING_SITES.forEach((r) => {
      const p = rayToPlane(v5, r.nx, r.ny, lake.y);
      if (!p || Math.hypot(p.x - lake.x, p.z - lake.z) > lake.r - 30 || ctx.terrainHeight(p.x, p.z) > lake.y) return;
      gb.add(K.ring, p.x, ringY, p.z, 0, 0, 0, r.phase, r.r, r.period, ringC, 0.5, 0);
      ringPts.push(p);
    });
    if (ringPts.length) addGroup("rings", ringPts, 20, 1500);
  }
  // The shooting star and the airship lamps: slots rewritten on the CPU.
  const starSlot = gb.add(K.star, 0, -1e5, 0, 0, 0, 0, -1e3, 1.2, 1, new THREE.Color(0.95, 0.97, 1.0), 1.25, 1.8);
  const airshipLampBase = gb.count;
  for (let i = 0; i < AIRSHIPS.length * 2; i++) gb.add(K.halo, 0, -1e5, 0, 0, 0, 0, i * 0.17, i % 2 ? 2.2 : 3.2, 0, hex(HALO_HEX), i % 2 ? 0.9 : 0.75, i % 2 ? 3 : 4);
  const glowGeo = billboardQuad();
  const gPos = new THREE.InstancedBufferAttribute(new Float32Array(gb.pos), 3);
  const gVel = new THREE.InstancedBufferAttribute(new Float32Array(gb.vel), 3);
  const gP = new THREE.InstancedBufferAttribute(new Float32Array(gb.p), 4);
  gPos.setUsage(THREE.DynamicDrawUsage);
  gVel.setUsage(THREE.DynamicDrawUsage);
  gP.setUsage(THREE.DynamicDrawUsage);
  glowGeo.setAttribute("aPos", gPos);
  glowGeo.setAttribute("aVel", gVel);
  glowGeo.setAttribute("aP", gP);
  glowGeo.setAttribute("aCol", new THREE.InstancedBufferAttribute(new Float32Array(gb.col), 4));
  glowGeo.instanceCount = 0;
  const glowMat = glowMaterial();
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = "LifeGlow";
  glow.frustumCulled = false;
  glow.renderOrder = 3;
  noReflect(glow);
  scene.add(glow);
  owned.push(glow);
  disposables.push(glowGeo, glowMat);
  const glowN = gb.count;

  // ── Airships
  const shipGeo = airshipGeometry();
  const shipMat = new THREE.MeshLambertMaterial({ name: "LifeAirshipMat", vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const ships = new THREE.InstancedMesh(shipGeo, shipMat, AIRSHIPS.length);
  ships.name = "LifeAirships";
  ships.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ships.count = 0;
  ships.frustumCulled = false;
  scene.add(ships);
  owned.push(ships);
  disposables.push(shipGeo, shipMat);
  const shipList: Airship[] = AIRSHIPS.map((def, k) => {
    let c: THREE.Vector3;
    let a = new THREE.Vector2(1, 0);
    let b = new THREE.Vector2(0, 1);
    if (def.stop !== undefined) {
      const v = views[Math.min(def.stop, views.length - 1)];
      c = anchor(v, def.dist ?? 1500, def.nx ?? 0, def.ny ?? 0);
      a = new THREE.Vector2(v.right.x, v.right.z).normalize();
      b = new THREE.Vector2(v.fwd.x, v.fwd.z).normalize();
    } else {
      c = new THREE.Vector3(def.x ?? 0, def.y ?? 1700, def.z ?? 0);
    }
    const r = THREE.MathUtils.degToRad(def.rot);
    a.rotateAround(new THREE.Vector2(), r);
    b.rotateAround(new THREE.Vector2(), r);
    const meanR = Math.sqrt((def.a * def.a + def.b * def.b) / 2);
    return {
      def,
      c,
      ax: a.x,
      az: a.y,
      bx: b.x,
      bz: b.y,
      omega: def.speed / meanR,
      sphere: new THREE.Sphere(c.clone(), AIRSHIP_LEN * def.scale),
      onScreen: false,
      lamps: [airshipLampBase + k * 2, airshipLampBase + k * 2 + 1],
      parked: true,
    };
  });
  const shipTris = shipGeo.attributes.position.count / 3;

  // ── Per frame
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const WHITE = new THREE.Color(1, 1, 1);
  const tint = new THREE.Color();
  const sunTmp = new THREE.Color();
  let animating = false;
  let lastT = -1;
  let timeOverride: number | null = null;
  const starRand = mulberry32(2718);
  const star = { at: 8 + starRand() * 10, live: false, shown: 0 };

  const onScreen = (s: THREE.Sphere, maxDist: number) => s.radius > 0 && camPos.distanceTo(s.center) - s.radius < maxDist && frustum.intersectsSphere(s);

  const refreshView = () => {
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
  };

  const poseBirds = (t: number) => {
    let any = false;
    let n = 0;
    for (const f of flocks) {
      const th = f.theta0 + f.omega * t;
      const dir = f.omega < 0 ? -1 : 1;
      const ea = f.def.rx * Math.cos(th);
      const eb = f.def.rz * Math.sin(th);
      const ta = -f.def.rx * Math.sin(th) * dir;
      const tb = f.def.rz * Math.cos(th) * dir;
      const px = f.c.x + f.ax * ea + f.bx * eb;
      const pz = f.c.z + f.az * ea + f.bz * eb;
      const py = f.c.y + Math.sin(th * 0.5) * 6;
      f.sphere.center.set(px, py, pz);
      f.sphere.radius = 50;
      f.onScreen = onScreen(f.sphere, f.def.maxDist);
      if (!f.onScreen) continue;
      any = true;
      fwd.set(f.ax * ta + f.bx * tb, 0, f.az * ta + f.bz * tb).normalize();
      right.crossVectors(up, fwd).normalize();
      const centreSide = right.x * (f.c.x - px) + right.z * (f.c.z - pz);
      const bank = -0.3 * Math.sign(centreSide || 1);
      const col = f.def.tone === "gull" ? gullC : darkC;
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        const w = t * b.wf + b.wp;
        const ox = b.ox + Math.sin(w) * 3.5;
        const oy = b.oy + Math.sin(w * 1.3 + 1.1) * 2.2 + Math.sin(th * 2 + b.wp) * 3;
        const oz = b.oz + Math.cos(w * 0.8) * 3;
        pos.set(px + right.x * ox - fwd.x * oz, py + oy, pz + right.z * ox - fwd.z * oz);
        basis.makeBasis(right, up, fwd);
        q.setFromRotationMatrix(basis);
        qBank.setFromAxisAngle(zAxis, bank + Math.sin(w) * 0.08);
        q.multiply(qBank);
        qBank.setFromAxisAngle(up, Math.sin(w * 0.7) * 0.12);
        q.premultiply(qBank);
        scl.setScalar(b.scale);
        m4.compose(pos, q, scl);
        birds.setMatrixAt(n, m4);
        birds.setColorAt(n, col);
        gullAttr.setX(n, f.def.tone === "gull" ? 1 : 0);
        // Flap in short bursts, then glide with a faint flex.
        const ph = (t / b.period + b.phase) % 1;
        const env = THREE.MathUtils.smoothstep(ph, 0, 0.05) * (1 - THREE.MathUtils.smoothstep(ph, 0.22, 0.3));
        flap.setX(n, Math.sin(t * Math.PI * 2 * b.beat + b.wp) * env + Math.sin(w * 2.1) * 0.07);
        n++;
      }
    }
    birds.count = n;
    if (n) {
      birds.instanceMatrix.needsUpdate = true;
      if (birds.instanceColor) birds.instanceColor.needsUpdate = true;
      flap.needsUpdate = true;
      gullAttr.needsUpdate = true;
    }
    // The light's colour on the birds: the sun's hue, normalised, half strength.
    sunTmp.copy(ctx.sunColor);
    const mx = Math.max(sunTmp.r, sunTmp.g, sunTmp.b, 1e-3);
    tint.setRGB(sunTmp.r / mx, sunTmp.g / mx, sunTmp.b / mx).lerp(WHITE, 0.5);
    birdMat.uniforms.uTint.value.copy(tint);
    return any;
  };

  const poseSoft = (t: number, ls: LightStateLike | null) => {
    let any = false;
    const on = softMat.uniforms.uOn.value as number[];
    for (let k = 0; k < softGroups.length; k++) {
      const g = softGroups[k];
      const pl = k < plumesUsed.length ? plumesUsed[k] : null;
      const live = !pl || ((!pl.src || shown(pl.src)) && (!pl.lit || pl.lit()));
      g.onScreen = live && onScreen(g.sphere, g.maxDist);
      if (pl) on[k] = live ? 1 : 0;
      if (g.onScreen) any = true;
    }
    softGeo.instanceCount = any ? softN : 0;
    const u = softMat.uniforms;
    u.uTime.value = t;
    // Lit side leans to the sun's colour, shade to the haze.
    u.uLit.value.setHex(0xe8ded2).lerp(ctx.sunColor, 0.16);
    u.uShade.value.setHex(0x7e7c86).lerp(ctx.hazeColor, 0.35);
    if (ls) {
      u.uCloudTop.value.copy(ls.cloudTop);
      u.uCloudBase.value.copy(ls.cloudBase);
    }
    return any;
  };

  /** Fires a shooting star into the part of the current frame that shows sky. */
  const spawnStar = (t: number): boolean => {
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const elC = Math.asin(THREE.MathUtils.clamp(camDir.y, -1, 1));
    const top = elC + vfov / 2 - 0.035;
    const bottom = Math.max(elC - vfov / 2, 0) + 0.03;
    if (top - bottom < 0.03) return false;
    const azC = Math.atan2(camDir.x, -camDir.z);
    const hh = Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const az0 = azC + (starRand() * 1.2 - 0.6) * hh;
    const el0 = bottom + (0.45 + 0.5 * starRand()) * (top - bottom);
    const sgn = starRand() < 0.5 ? -1 : 1;
    const dur = 0.9 + starRand() * 0.5;
    const az1 = az0 + sgn * (0.14 + starRand() * 0.1);
    const el1 = el0 - (0.03 + starRand() * 0.04);
    const R = Math.min(6000, camera.far * 0.8);
    const dirOf = (az: number, el: number) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const a = camPos.clone().addScaledVector(dirOf(az0, el0), R);
    const b = camPos.clone().addScaledVector(dirOf(az1, el1), R);
    gPos.setXYZ(starSlot, a.x, a.y, a.z);
    const vel = b.sub(a).divideScalar(dur);
    gVel.setXYZ(starSlot, vel.x, vel.y, vel.z);
    gP.setXYZW(starSlot, K.star, t, R * 0.0016, dur);
    gPos.needsUpdate = true;
    gVel.needsUpdate = true;
    gP.needsUpdate = true;
    star.live = true;
    star.shown++;
    star.at = t + dur;
    return true;
  };

  const poseGlow = (t: number, ls: LightStateLike | null, still: boolean) => {
    let any = false;
    for (const g of glowGroups) {
      g.onScreen = onScreen(g.sphere, g.maxDist);
      if (g.onScreen) any = true;
    }
    // Shooting star: only while the stars are out and never under reduced motion.
    const starsOut = !!ls && ls.stars > STAR_MIN && ls.under < 0.2;
    if (star.live && t > star.at) {
      star.live = false;
      star.at = t + 18 + starRand() * 7;
    }
    if (!star.live && starsOut && !still && t >= star.at) {
      if (!spawnStar(t)) star.at = t + 2;
    }
    if (star.live) any = true;
    // Airship lamps ride with the ships (poseShips writes them).
    for (const s of shipList) if (s.onScreen) any = true;
    glowGeo.instanceCount = any ? glowN : 0;
    const u = glowMat.uniforms;
    u.uTime.value = t;
    u.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, ctx.renderer.domElement.height || 600);
    if (ls) {
      u.uMagic.value = Math.min(1.1, ls.magicGlow);
      u.uLamp.value = ls.lampGlow;
    }
    return any;
  };

  const poseShips = (t: number) => {
    let n = 0;
    let any = false;
    let lampsDirty = false;
    for (let k = 0; k < shipList.length; k++) {
      const s = shipList[k];
      const d = s.def;
      const th = d.phase * Math.PI * 2 + s.omega * t;
      const dir = s.omega < 0 ? -1 : 1;
      const ea = d.a * Math.cos(th);
      const eb = d.b * Math.sin(th);
      const ta = -d.a * Math.sin(th) * dir;
      const tb = d.b * Math.cos(th) * dir;
      const px = s.c.x + s.ax * ea + s.bx * eb;
      const pz = s.c.z + s.az * ea + s.bz * eb;
      const py = s.c.y + Math.sin(t * 0.21 + k) * 4;
      s.sphere.center.set(px, py, pz);
      s.onScreen = onScreen(s.sphere, AIRSHIP_MAX_DIST);
      fwd.set(s.ax * ta + s.bx * tb, 0, s.az * ta + s.bz * tb).normalize();
      if (!s.onScreen) {
        // Lamps out of the way while the ship is off screen (written once, not every frame).
        if (!s.parked) {
          for (const slot of s.lamps) gPos.setXYZ(slot, 0, -1e5, 0);
          s.parked = true;
          lampsDirty = true;
        }
        continue;
      }
      s.parked = false;
      any = true;
      // Nose (+x local) along the heading; a gentle roll into the turn.
      right.crossVectors(fwd, up).normalize();
      basis.makeBasis(fwd, up, right);
      q.setFromRotationMatrix(basis);
      qBank.setFromAxisAngle(xAxis, 0.05 * dir);
      q.multiply(qBank);
      scl.setScalar(d.scale);
      pos.set(px, py, pz);
      m4.compose(pos, q, scl);
      ships.setMatrixAt(n++, m4);
      // Lamps: the kit's starboard bow lantern and the envelope's nose.
      const gondola = new THREE.Vector3(...SHIP_LAMPS[0]).multiplyScalar(d.scale).applyQuaternion(q).add(pos);
      const bow = new THREE.Vector3(...SHIP_LAMPS[1]).multiplyScalar(d.scale).applyQuaternion(q).add(pos);
      gPos.setXYZ(s.lamps[0], gondola.x, gondola.y, gondola.z);
      gPos.setXYZ(s.lamps[1], bow.x, bow.y, bow.z);
      lampsDirty = true;
    }
    ships.count = n;
    if (n) ships.instanceMatrix.needsUpdate = true;
    if (lampsDirty) gPos.needsUpdate = true;
    return any;
  };

  const pose = (time: number) => {
    const still = frozen();
    const t = timeOverride ?? (still ? FROZEN_T : time);
    const ls = lightHandle();
    refreshView();
    const b = poseBirds(t);
    const s = poseSoft(t, ls);
    const sh = poseShips(t);
    const g = poseGlow(t, ls, still || timeOverride !== null);
    lastT = t;
    animating = !still && timeOverride === null && (b || s || g || sh);
    return animating;
  };

  pose(0);

  const buildMs = performance.now() - t0;
  const trianglesMax = birdCount * 12 + softN * 2 + glowN * 2 + AIRSHIPS.length * shipTris;
  const callsNow = () => (birds.count > 0 ? 1 : 0) + (softGeo.instanceCount > 0 ? 1 : 0) + (glowGeo.instanceCount > 0 ? 1 : 0) + (ships.count > 0 ? 1 : 0);
  const trianglesNow = () => birds.count * 12 + softGeo.instanceCount * 2 + glowGeo.instanceCount * 2 + ships.count * shipTris;

  const stats = () => ({
    triangles: trianglesMax,
    trianglesNow: trianglesNow(),
    drawCallsMax: 4,
    drawCallsNow: callsNow(),
    birds: birdCount,
    birdsDrawn: birds.count,
    flocksOnScreen: flocks.filter((f) => f.onScreen).map((f) => f.def.name).join(",") || "none",
    puffs: softN - WISPS.length,
    wisps: WISPS.length,
    softOnScreen: softGroups.filter((g) => g.onScreen).map((g) => g.name).join(",") || "none",
    glowSprites: glowN,
    glowOnScreen: glowGroups.filter((g) => g.onScreen).map((g) => g.name).join(",") || "none",
    airshipsDrawn: ships.count,
    shootingStars: star.shown,
    plumes: plumesUsed.map((p) => `${p.name} ${p.kind} (${p.pos.x.toFixed(0)}, ${p.pos.y.toFixed(0)}, ${p.pos.z.toFixed(0)}) ${p.from} rise ${p.spec.rise}`).join("; ") || "none",
    animating: animating ? 1 : 0,
    time: +lastT.toFixed(2),
    buildMs: +buildMs.toFixed(1),
  });

  // Development only: the proof harness (world-tests/v5-life.mjs) reads and drives this.
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
  type Hook = (() => Record<string, unknown>) & { setTime?: (t: number | null) => void; shootNow?: () => boolean };
  let debugHook: Hook | null = null;
  if (process.env.NODE_ENV !== "production" && w) {
    const project = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      return [+v.x.toFixed(2), +v.y.toFixed(2), Math.round(camPos.distanceTo(p))];
    };
    debugHook = Object.assign(
      () => ({
        ...stats(),
        flocks: flocks.map((f) => ({ name: f.def.name, ndc: project(f.sphere.center), on: f.onScreen })),
        plumeNdc: plumesUsed.map((p) => ({ name: p.name, ndc: project(p.pos) })),
        ships: shipList.map((s) => ({ name: s.def.name, ndc: project(s.sphere.center), on: s.onScreen })),
        glowGroups: glowGroups.map((g) => ({ name: g.name, ndc: project(g.sphere.center), r: Math.round(g.sphere.radius), on: g.onScreen })),
      }),
      {
        setTime(t: number | null) {
          timeOverride = t;
          pose(t ?? lastT);
        },
        shootNow() {
          refreshView();
          return spawnStar(lastT);
        },
      },
    );
    w.__worldLife = debugHook;
  }

  return {
    name: "life",
    update(time: number) {
      return pose(time);
    },
    isAnimating() {
      return animating;
    },
    dispose() {
      for (const o of owned) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      owned.length = 0;
      disposables.length = 0;
      if (w && debugHook && w.__worldLife === debugHook) delete w.__worldLife;
    },
    stats,
  };
};
