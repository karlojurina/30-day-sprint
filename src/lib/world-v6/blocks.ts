import * as THREE from "three";
import {
  BRIDGE,
  FLIGHT_KEYS,
  GATE,
  GATE_CAUSEWAY,
  GATE_DEPTH,
  PATH,
  PLACES,
  SHIP_DOCKED,
  SHIP_MOORED,
  STEPS,
  TRAIL,
  TRAIL_HUT,
  WORLD,
  shipFromCamera,
  type Place,
} from "./layout";
import { terrainHeight } from "./terrain";
import type { ShipPose } from "./modules";

/**
 * The world's skeleton and its moving parts (v5 pass 2). It began as the V4
 * grey block-out; the dress-* modules now dress every place into the groups
 * it leaves, and the grey geometry they replaced is gone from this file.
 *
 * What it adds under one group, "V4Blocks":
 *   - per place, a group named with the place's mesh name (LM_Signpost ...
 *     LM_GuildHall) that the landmark goes into, so markers and the park
 *     solver frame the landmark itself; the set around it goes into a
 *     sibling group "Set_a1".."Set_a8". Both sit at place.pos. v6: blocks
 *     builds grey stand-ins for a4's Trail Hut (LM_TrailHut) and a8's Stone
 *     Arch (LM_StoneArch) with the Gate isle's body (Set_a8), which
 *     dress-gorge.ts and dress-gate.ts replace; a1/a2 are dress-shore.ts's,
 *     a5/a6 dress-lakeforest.ts's, a7 and the bounty isle dress-sky.ts's.
 *   - the Falls' landmark group (LM_Waterfall) takes water.ts's curtain
 *     ("Landmark_a3_Water"): water.ts installs first and builds every
 *     water surface, the falls, the pool, the spray and the island falls
 *     included; this module only moves the curtain into the landmark.
 *   - nothing under the ground: the mine's tunnel, shaft and headframe went
 *     with v6, and the cave behind the falls (the hall's and the side
 *     passage's shells, Zone_mine) was removed on 2026-10-13 (layout.ts "The
 *     cave that was here").
 *   - the walk to the Mirror Lake (Set_meadow): the brook's footbridge.
 *   - the floating steps (a6 -> a7): drifting and bobbing, each settling into
 *     line as the camera approaches, driven by ctx.routeU() (dress-lakeforest
 *     swaps their geometry and material).
 *   - the rope bridge's sway group (RopeBridge_Sway; dress-sky builds into it).
 *   - your airship's group (Airship_yours, empty here; dress-sky builds the
 *     ship into it): moored at the bounty isle (SHIP_MOORED), carrying the
 *     camera through the flight (shipFromCamera on the rail), docked at the
 *     Gate isle (SHIP_DOCKED). One small ship loops high over the Gate isle.
 *   - progress: the campfire, the lookout lamp, the Trail Hut's lamp (each
 *     tagged for progress-world.ts, which owns the lesson lanterns and the
 *     places waking up) and your airship (setProgress).
 *   - mist over places past the frontier in "look" mode (setMist).
 *
 * Draw calls: about 25 meshes in all, most culled or zoned off at any one
 * stop. Triangles: see stats(). Static parts are merged per group with vertex
 * colours; the things that move have their own meshes so their matrices can
 * change.
 *
 * TUNING: every number that decides how a place reads is in the per-place
 * builders below; the moving parts' rates are in MOTION.
 */

// ── Contract ─────────────────────────────────────────────────────────────────

/** A subset of modules.ts WorldCtx: the scene's ctx can be passed as it is. */
export interface BlocksCtx {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Parent for the blocks. Default: scene. */
  root?: THREE.Object3D;
  /**
   * The TRAIL curve parameter t, key i at i / (TRAIL.length - 1)
   * (WorldCtx.railU). Places your airship: moored, riding with the camera
   * between FLIGHT_KEYS.first and .last, docked after. When absent the ship
   * stays moored.
   */
  railU?: () => number;
  /**
   * Your airship where the rail has it (WorldCtx.shipPose, rail.ts shipAtS).
   * Round 1 (the airship jiggle): during the flight the ship is drawn at this
   * pose, which eases off the mooring and into the dock and banks smoothly;
   * when absent the ship follows railU as before.
   */
  shipPose?: (out: ShipPose) => ShipPose;
  /**
   * Share of the route by distance (WorldCtx.routeU). Drives the floating
   * steps. When absent, the steps find the same measure from the camera.
   */
  routeU?: () => number;
  /**
   * The locking state, read every frame (WorldCtx.lock). In "look" mode the
   * places past the frontier go into mist, until the page calls setMist(),
   * which then takes over for good.
   */
  lock?: Readonly<{ mode: "open" | "look" | "locked"; frontier: number }>;
  reducedMotion?: boolean;
  /** Wakes a sleeping render loop; called after setProgress and setMist. */
  requestRender?: () => void;
}

export interface BlocksModule {
  name: "blocks";
  root: THREE.Group;
  /** Call every rendered frame. True when something visible changed. */
  update(time: number, dt: number): boolean;
  /** True while something time-driven is on screen (falls, boat, steps, airships, mist fading). */
  isAnimating(): boolean;
  /**
   * Places finished, 0..8. The fraction is the share of the NEXT place's
   * lessons done (3.5 = places 1-3 done, half of place 4). The campfire
   * always burns (log decision 51), lookout lamp at >= 2, the Trail Hut's lamp at >= 4 (progress-world.ts
   * overrides these three by their wake tags), your airship waits at the
   * dock at >= 7.
   */
  setProgress(p: number): void;
  /** Place indices (0 = a1 ... 7 = a8) to hide in mist. Fades over MIST_FADE_S.
   *  Once called, the mist no longer follows ctx.lock. */
  setMist(indices: readonly number[]): void;
  dispose(): void;
  stats(): Record<string, number | string>;
}

/** Seconds the mist takes to fade in or out. */
export const MIST_FADE_S = 1.2;

/** Rates of everything that moves on its own. */
const MOTION = {
  boatRoll: 0.05,
  /** Radians the rope bridge rocks about its own line. */
  bridgeSway: 0.03,
  stepBobLoose: 5,
  stepBobSet: 0.8,
  airshipLoopS: 260,
  mooredBob: 1.6,
  /** Your ship banks into turns during the flight: radians per (degree of heading per unit), capped. */
  rideBank: 9,
  rideBankMax: 0.07,
  rideBankSmooth: 30,
};
/** Steps settle between these route distances before the camera passes them (N6: several already in line behind the first step). */
const STEP_SETTLE_FROM = 640;
const STEP_SETTLE_TO = 300;

// ── Colours (linear RGB, flat greys with a hint of material) ─────────────────

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];
const C = {
  wood: [0.34, 0.29, 0.24],
  woodDark: [0.2, 0.17, 0.14],
  woodPale: [0.46, 0.41, 0.35],
  stone: [0.44, 0.44, 0.45],
  stoneDark: [0.3, 0.3, 0.31],
  rock: [0.38, 0.36, 0.35],
  rockDark: [0.25, 0.24, 0.24],
  canvas: [0.68, 0.66, 0.6],
  roof: [0.26, 0.25, 0.25],
  window: [0.08, 0.08, 0.09],
  leaf: [0.24, 0.3, 0.25],
  leafDark: [0.17, 0.22, 0.19],
  grass: [0.38, 0.42, 0.36],
  metal: [0.6, 0.61, 0.64],
  rope: [0.5, 0.45, 0.36],
  hull: [0.3, 0.26, 0.22],
  sail: [0.78, 0.76, 0.7],
  water: [0.2, 0.26, 0.31],
  paving: [0.5, 0.49, 0.47],
  plaster: [0.62, 0.6, 0.56],
  notice: [0.86, 0.84, 0.78],
  bark: [0.23, 0.2, 0.18],
  moss: [0.2, 0.27, 0.22],
  shrub: [0.3, 0.37, 0.29],
  birch: [0.32, 0.4, 0.28],
} as const satisfies Record<string, RGB>;
/** Unlit glow colours (above 1 on purpose: they read as light after tone mapping). */
const G = {
  lamp: [2.4, 1.35, 0.5],
  fire: [2.6, 0.95, 0.25],
  teal: [0.35, 1.9, 1.7],
  violet: [1.2, 0.55, 2.0],
  window: [2.0, 1.4, 0.7],
} as const satisfies Record<string, RGB>;

// ── Small helpers ────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Seeded 0..1, stable across reloads. */
function rnd(i: number, s = 0): number {
  const v = Math.sin(i * 127.1 + s * 311.7 + 17.3) * 43758.5453;
  return v - Math.floor(v);
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
function dirOf(bearing: number): [number, number] {
  return [Math.sin(bearing * DEG), -Math.cos(bearing * DEG)];
}
/** Yaw that turns local +x toward a compass bearing. */
const yawTo = (bearing: number) => (90 - bearing) * DEG;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Transform: position, scale, then yaw / pitch / roll (Y, X, Z order). */
function T(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Collects primitives into one non-indexed geometry with vertex colours.
 * Coordinates go in as WORLD coordinates and come out local to `origin`.
 */
class Builder {
  private p: number[] = [];
  private c: number[] = [];
  private n = 0;
  private readonly origin: { x: number; y: number; z: number };
  constructor(origin: { x: number; y: number; z: number }) {
    this.origin = origin;
  }
  /** World-space triangles with their own per-vertex colours. */
  raw(pos: readonly number[], col: readonly number[]): void {
    for (let i = 0; i < pos.length; i += 3) this.p.push(pos[i] - this.origin.x, pos[i + 1] - this.origin.y, pos[i + 2] - this.origin.z);
    for (const c of col) this.c.push(c);
  }
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, col: RGB, vary = 0.1): void {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const a = src.getAttribute("position");
    const k = 1 - vary / 2 + vary * rnd(this.n++, 3.7);
    for (let i = 0; i < a.count; i++) {
      _a.fromBufferAttribute(a, i).applyMatrix4(m);
      this.p.push(_a.x - this.origin.x, _a.y - this.origin.y, _a.z - this.origin.z);
      this.c.push(col[0] * k, col[1] * k, col[2] * k);
    }
    if (src !== geo) src.dispose();
  }
  /** A non-indexed geometry that already carries vertex colours (another Builder's), placed by `m`. */
  addColored(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
    const a = geo.getAttribute("position");
    const c = geo.getAttribute("color");
    for (let i = 0; i < a.count; i++) {
      _a.fromBufferAttribute(a, i).applyMatrix4(m);
      this.p.push(_a.x - this.origin.x, _a.y - this.origin.y, _a.z - this.origin.z);
      this.c.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  }
  /** One world-space triangle, counter-clockwise seen from its front. */
  tri(a: V3, b: V3, c: V3, col: RGB): void {
    this.p.push(a[0] - this.origin.x, a[1] - this.origin.y, a[2] - this.origin.z);
    this.p.push(b[0] - this.origin.x, b[1] - this.origin.y, b[2] - this.origin.z);
    this.p.push(c[0] - this.origin.x, c[1] - this.origin.y, c[2] - this.origin.z);
    for (let i = 0; i < 3; i++) this.c.push(col[0], col[1], col[2]);
  }
  /** A quad a-b-c-d, counter-clockwise seen from its front. */
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB): void {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }
  /** Adds a geometry made just for this call, then frees it. */
  once(geo: THREE.BufferGeometry, m: THREE.Matrix4, col: RGB, vary = 0.1): void {
    this.add(geo, m, col, vary);
    geo.dispose();
  }
  /** A box of section w x d from a to b (world points). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, d: number, col: RGB, geo = U.box): void {
    _a.set(ax, ay, az);
    _b.set(bx, by, bz);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return;
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _q.setFromUnitVectors(UP, _b.sub(_a).divideScalar(len));
    this.add(geo, _m.compose(_p, _q, _s.set(w, len, d)), col);
  }
  get tris(): number {
    return this.p.length / 9;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Unit primitives, made once per install and freed at the end of it. */
const U = {} as {
  box: THREE.BufferGeometry;
  cyl6: THREE.BufferGeometry;
  cyl8: THREE.BufferGeometry;
  cyl12: THREE.BufferGeometry;
  cone4: THREE.BufferGeometry;
  cone6: THREE.BufferGeometry;
  cone8: THREE.BufferGeometry;
  ico0: THREE.BufferGeometry;
  ico1: THREE.BufferGeometry;
  dode: THREE.BufferGeometry;
  hemi: THREE.BufferGeometry;
  hull: THREE.BufferGeometry;
  sph: THREE.BufferGeometry;
  tent: THREE.BufferGeometry;
  tri: THREE.BufferGeometry;
};
function makeUnits(): void {
  const ni = (g: THREE.BufferGeometry) => {
    // Polyhedra come non-indexed already.
    const o = g.index ? g.toNonIndexed() : g;
    if (o !== g) g.dispose();
    o.deleteAttribute("uv");
    o.deleteAttribute("normal");
    return o;
  };
  U.box = ni(new THREE.BoxGeometry(1, 1, 1));
  U.cyl6 = ni(new THREE.CylinderGeometry(1, 1, 1, 6));
  U.cyl8 = ni(new THREE.CylinderGeometry(1, 1, 1, 8));
  U.cyl12 = ni(new THREE.CylinderGeometry(1, 1, 1, 12));
  U.cone4 = ni(new THREE.ConeGeometry(1, 1, 4));
  U.cone6 = ni(new THREE.ConeGeometry(1, 1, 6));
  U.cone8 = ni(new THREE.ConeGeometry(1, 1, 8));
  U.ico0 = ni(new THREE.IcosahedronGeometry(1, 0));
  U.ico1 = ni(new THREE.IcosahedronGeometry(1, 1));
  U.dode = ni(new THREE.DodecahedronGeometry(1, 0));
  U.hemi = ni(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  U.hull = ni(new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
  U.sph = ni(new THREE.SphereGeometry(1, 18, 10));
  // Tent: a triangular prism, base 1 wide on y = 0, ridge at y = 1, along z.
  const t = [
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0, 1, -0.5],
    [-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 1, 0.5],
  ];
  const tf = [
    [0, 2, 1], [3, 4, 5], // ends
    [0, 3, 5], [0, 5, 2], // left slope
    [1, 2, 5], [1, 5, 4], // right slope
  ];
  const tp: number[] = [];
  for (const f of tf) for (const i of f) tp.push(...t[i]);
  U.tent = new THREE.BufferGeometry();
  U.tent.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  // A flat triangle seen from both sides (a sail): corners (0,0), (1,0), (0,1) in xy.
  U.tri = new THREE.BufferGeometry();
  U.tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
}
function freeUnits(): void {
  for (const g of Object.values(U)) g.dispose();
}

const H = terrainHeight;

// ── Shaders ──────────────────────────────────────────────────────────────────

const NOISE_GLSL = /* glsl */ `
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = bHash(i), b = bHash(i + vec2(1.0, 0.0)), c = bHash(i + vec2(0.0, 1.0)), d = bHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

/** Camera-facing soft puffs, one instance each: the place mist (the falls' spray is water.ts's). */
function puffMaterial(kind: "mist" | "spray"): THREE.ShaderMaterial {
  const spray = kind === "spray";
  return new THREE.ShaderMaterial({
    name: spray ? "V4Spray" : "V4Mist",
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0.85, 0.87, 0.9) },
        uFade: { value: new Array(8).fill(0) },
        uAlpha: { value: spray ? 0.5 : 0.5 },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec3 aOffset; attribute vec4 aData; // size, place, seed, rate
      uniform float uTime; uniform float uFade[8];
      varying vec2 vUv; varying float vA; varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        float size = aData.x; float seed = aData.z;
        vec3 c = aOffset; float a = 1.0;
        ${spray
          ? `float age = fract(uTime * aData.w + seed);
             float ang = seed * 43.0;
             c += vec3(cos(ang), 0.0, sin(ang)) * age * size * 1.1 + vec3(0.0, age * size * 1.6, 0.0);
             size *= 0.45 + age * 0.9;
             a = sin(age * 3.14159);`
          : `a = uFade[int(aData.y + 0.5)];
             c += vec3(sin(uTime * 0.05 + seed * 6.28), 0.0, cos(uTime * 0.04 + seed * 4.1)) * size * 0.12;`}
        vec4 mvPosition = viewMatrix * vec4(c, 1.0);
        mvPosition.xy += position.xy * size;
        // A puff the camera is inside of would fill the screen: fade it out.
        a *= smoothstep(size * 0.2, size * 0.8, -mvPosition.z);
        vA = a; vUv = position.xy + 0.5; vSeed = seed;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha;
      varying vec2 vUv; varying float vA; varying float vSeed;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec2 q = vUv - 0.5;
        float r = length(q) * 2.0;
        float n = bNoise(q * 4.0 + vSeed * 17.0);
        float a = 1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.35);
        a = a * a * vA * uAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

// ── Place geometry ───────────────────────────────────────────────────────────

interface PlaceParts {
  lm: Builder;
  set: Builder;
}

/**
 * a1 and a2: only the points the moving parts hang on. The sets and the
 * landmarks themselves are dress-shore.ts's, which also re-skins the boat, the
 * campfire's flame and the lookout's lamp and moves them onto its own sets.
 */
function buildLanding(p: Place, anim: Anim): void {
  const foot = PATH[0];
  const db = 155;
  const [ddx, ddz] = dirOf(db);
  const [lx, lz] = dirOf(db + 90);
  anim.flame = { x: 1340, y: p.pos.y + 0.5, z: 4206 };
  // Your boat, moored alongside the dock: rocks (see update).
  anim.boat = { x: foot.x + ddx * 96 + lx * 12, y: 0.9, z: foot.z + ddz * 96 + lz * 12, bearing: db };
}

function buildCamp(p: Place, anim: Anim): void {
  const { x, y, z } = p.pos;
  anim.lookoutLamp = { x, y: y + 56.6, z };
}

/**
 * v5: the falls' boulders (the lip's west shelf, round the pool, the cliff
 * foot either side of the curtain) are rocks.ts's now, so the set is empty and
 * Set_a3_Block is not built (a set with no triangles is skipped).
 */
function buildFallsSet(p: Place, parts: PlaceParts): void {
  void p;
  void parts;
}

/**
 * v6, a4: a grey stand-in Trail Hut (LM_TrailHut) at real scale on the spur,
 * its door and bench toward the falls (TRAIL_HUT.facing). dress-gorge.ts
 * builds the real hut into the same group and hides this. Its lamp by the
 * door is the a4 progress lamp.
 */
function buildTrailHut(p: Place, parts: PlaceParts, anim: Anim): void {
  const { lm } = parts;
  const { x, y, z } = p.pos;
  const yaw = yawTo(TRAIL_HUT.facing);
  const [fx, fz] = dirOf(TRAIL_HUT.facing);
  const [sx, sz] = dirOf(TRAIL_HUT.facing + 90);
  // Log walls 22 deep (along the facing) by 28 wide, 17 to the eaves; the
  // door (20 tall with its step) on the front.
  lm.add(U.box, T(x, y + 8.5, z, 22, 17, 28, yaw), C.wood);
  lm.add(U.tent, T(x, y + 17, z, 25, 10, 32, yaw + Math.PI / 2), C.roof);
  lm.add(U.box, T(x - fx * 6 + sx * 11, y + 16, z - fz * 6 + sz * 11, 4.5, 16, 4.5, yaw), C.stoneDark);
  lm.add(U.box, T(x + fx * 11.2, y + 8, z + fz * 11.2, 0.6, 16, 7, yaw), C.woodDark);
  // The bench facing the falls, beside the door.
  lm.add(U.box, T(x + fx * 16 - sx * 9, y + 5.5, z + fz * 16 - sz * 9, 5, 1.2, 14, yaw), C.woodPale);
  anim.headLamp = { x: x + fx * 12.5 + sx * 6.5, y: y + 14, z: z + fz * 12.5 + sz * 6.5 };
}

/**
 * v6, a8: grey stand-ins for the Stone Arch (LM_StoneArch, layout GATE) and
 * the Gate isle's body (Set_a8: a top and a hanging underside, like the
 * bounty isle). dress-gate.ts builds the real ones and hides these.
 */
function buildGate(p: Place, parts: PlaceParts): void {
  const { lm, set } = parts;
  const G = GATE;
  const yaw = yawTo(G.axis);
  const [cx, cz] = dirOf(G.axis + 90);
  const half = G.openW / 2 + G.pillarW / 2;
  for (const sg of [-1, 1]) {
    lm.add(U.box, T(G.x + cx * half * sg, G.y + G.openH / 2, G.z + cz * half * sg, G.pillarD, G.openH, G.pillarW, yaw), C.stone);
  }
  const lintel = G.height - G.openH;
  lm.add(U.box, T(G.x, G.y + G.openH + lintel / 2, G.z, G.pillarD + 4, lintel, G.openW + 2 * G.pillarW + 8, yaw), C.stone);
  const I = WORLD.gateIsle;
  set.add(U.cyl12, T(I.x, I.y - 6, I.z, I.r, 12, I.r), C.grass, 0.05);
  set.add(U.cone8, T(I.x, I.y - 12 - GATE_DEPTH / 2, I.z, I.r * 0.96, GATE_DEPTH, I.r * 0.96, 0, Math.PI), C.rock, 0.08);
  // The stone dock at the ship's bow and the causeway to the arch.
  for (let i = 0; i < GATE_CAUSEWAY.length - 1; i++) {
    const a = GATE_CAUSEWAY[i];
    const b2 = GATE_CAUSEWAY[i + 1];
    set.beam(a.x, a.y + 0.6, a.z, b2.x, b2.y + 0.6, b2.z, 16, 1.2, C.paving);
  }
  void p;
}

/** Height of the scene's main terrain grid at (x, z) (bilinear between its vertices). */
function gridH(x: number, z: number): number {
  const W = WORLD.maxX - WORLD.minX;
  const D = WORLD.maxZ - WORLD.minZ;
  const cell = Math.max(W, D) / 320;
  const sx = W / Math.max(2, Math.round(W / cell));
  const sz = D / Math.max(2, Math.round(D / cell));
  const fi = (x - WORLD.minX) / sx;
  const fj = (z - WORLD.minZ) / sz;
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const v = fj - j;
  const h = (ii: number, jj: number) => H(WORLD.minX + ii * sx, WORLD.minZ + jj * sz);
  return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
}

/**
 * The walk from the Climb's rim over the saddle and down the meadow to the
 * Mirror Lake (N4): the plank footbridge where the trail crosses the brook
 * above the lake. v5: the trees and shrubs are forest.ts's, the rocks and the
 * bank stones rocks.ts's, the brook's water water.ts's "Brook" ribbon.
 */
function buildMeadow(b: Builder): void {
  // The footbridge where the trail crosses the brook, above the lake.
  const cx = 1377;
  const cz = -170;
  const brg = 186;
  const [dx, dz] = dirOf(brg);
  const y = Math.max(H(cx, cz), gridH(cx, cz)) + 2.2;
  b.add(U.box, T(cx, y, cz, 24, 1.1, 8, yawTo(brg)), C.woodPale);
  for (const s of [-1, 1]) {
    const px = cx + dz * 4 * s;
    const pz = cz - dx * 4 * s;
    b.add(U.box, T(px, y + 3.2, pz, 24, 0.7, 0.7, yawTo(brg)), C.wood);
    for (const t of [-11, 0, 11]) b.add(U.box, T(px + dx * t, y + 1.6, pz + dz * t, 0.7, 3.4, 0.7), C.wood);
  }
}

// ── Moving parts ─────────────────────────────────────────────────────────────

interface Anim {
  flame?: { x: number; y: number; z: number };
  boat?: { x: number; y: number; z: number; bearing: number };
  lookoutLamp?: { x: number; y: number; z: number };
  /** The Trail Hut's lamp by its door (lit once place 4 is done). */
  headLamp?: { x: number; y: number; z: number };
  airships?: { x: number; y: number; z: number; heading: number; kind: "yours" | "loop" }[];
}

// ── Install ──────────────────────────────────────────────────────────────────

export function install(ctx: BlocksCtx): BlocksModule {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reduced = !!ctx.reducedMotion;
  makeUnits();
  const root = new THREE.Group();
  root.name = "V4Blocks";
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const solid = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true }));
  solid.name = "V4BlockGrey";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "V4BlockGlow";
  const counts = { meshes: 0, tris: 0 };
  const addMesh = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh => {
    track(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    parent.add(mesh);
    counts.meshes++;
    counts.tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    return mesh;
  };

  const anim: Anim = {};
  const lmGroups: THREE.Group[] = [];
  const perPlace: Record<string, number> = {};
  for (const p of PLACES) {
    const parts: PlaceParts = { lm: new Builder(p.pos), set: new Builder(p.pos) };
    // a1, a2 and a5-a8 are dressed by the dress-* modules into these same
    // LM_* and Set_* groups; blocks only keeps what moves or what nothing replaced.
    switch (p.id) {
      case "a1":
        buildLanding(p, anim);
        break;
      case "a2":
        buildCamp(p, anim);
        break;
      case "a3":
        buildFallsSet(p, parts);
        break;
      case "a4":
        buildTrailHut(p, parts, anim);
        break;
      case "a8":
        buildGate(p, parts);
        break;
    }
    const lmGroup = new THREE.Group();
    lmGroup.name = p.mesh;
    lmGroup.position.set(p.pos.x, p.pos.y, p.pos.z);
    lmGroup.userData = { placeId: p.id, placeIndex: PLACES.indexOf(p), base: { ...p.pos }, height: p.height };
    root.add(lmGroup);
    lmGroups.push(lmGroup);
    // Not "LM_..." : the scene's landmark index treats every LM_* object as a landmark.
    if (parts.lm.tris > 0) addMesh(lmGroup, parts.lm.build(), solid, `Landmark_${p.id}`);
    const setGroup = new THREE.Group();
    setGroup.name = `Set_${p.id}`;
    setGroup.position.copy(lmGroup.position);
    root.add(setGroup);
    if (parts.set.tris > 0) addMesh(setGroup, parts.set.build(), solid, `Set_${p.id}_Block`);
    perPlace[p.id] = Math.round(parts.lm.tris + parts.set.tris);
  }

  // ── The walk to the Mirror Lake: its own group and zone ──
  const meadowB = new Builder({ x: WORLD.meadow.x, y: 600, z: WORLD.meadow.z });
  buildMeadow(meadowB);
  const meadowGroup = new THREE.Group();
  meadowGroup.name = "Set_meadow";
  meadowGroup.position.set(WORLD.meadow.x, 600, WORLD.meadow.z);
  root.add(meadowGroup);
  addMesh(meadowGroup, meadowB.build(), solid, "Set_meadow_Block");
  perPlace.meadow = Math.round(meadowB.tris);

  // v6 (C1): the Upper Falls' grey stand-in is gone; water.ts draws the real cascade.

  // ── The falls' curtain: water.ts's, moved into the Falls' landmark ──
  // water.ts installs before this module and leaves the curtain under the
  // root at the place (its geometry is built round a3's base); in the
  // landmark group it frames the landmark for the park and the marker.
  {
    const lmFalls = lmGroups[2];
    const curtain = (ctx.root ?? ctx.scene).getObjectByName("Landmark_a3_Water");
    if (curtain && curtain.parent !== lmFalls) {
      curtain.position.sub(lmFalls.position);
      lmFalls.add(curtain);
    }
  }

  const puffGeo = (n: number, fill: (i: number, off: number[], data: number[]) => void): THREE.InstancedBufferGeometry => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute("position", plane.getAttribute("position"));
    const off: number[] = [];
    const data: number[] = [];
    for (let i = 0; i < n; i++) fill(i, off, data);
    g.setAttribute("aOffset", new THREE.InstancedBufferAttribute(new Float32Array(off), 3));
    g.setAttribute("aData", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    g.instanceCount = n;
    return g;
  };

  // ── Floating steps (a6 -> a7) ──
  const slab = new Builder({ x: 0, y: 0, z: 0 });
  slab.add(U.box, T(0, 0, 0, 26, 7, 20), C.stone, 0);
  slab.add(U.cone6, T(0, -12, 0, 12, 17, 12, 0, Math.PI, 0), C.rock, 0);
  slab.add(U.dode, T(6, -5, 4, 6, 5, 6), C.rockDark, 0);
  const slabGeo = slab.build();
  const steps = new THREE.InstancedMesh(track(slabGeo), solid, STEPS.length);
  steps.name = "FloatingSteps";
  steps.frustumCulled = false;
  root.add(steps);
  counts.meshes++;
  counts.tris += (slabGeo.getAttribute("position").count / 3) * STEPS.length;
  // Where each step settles: from 420 to 90 units of route before the point
  // where the camera passes closest to it, as a share of the route by
  // distance (the same measure as WorldCtx.railU).
  const route = new THREE.CatmullRomCurve3(TRAIL.map((q) => new THREE.Vector3(q[0], q[1], q[2])), false, "centripetal");
  const RS = 3000;
  const rPts = route.getPoints(RS);
  const rArc = new Float64Array(RS + 1);
  for (let i = 1; i <= RS; i++) rArc[i] = rArc[i - 1] + rPts[i].distanceTo(rPts[i - 1]);
  const routeLen = rArc[RS];
  const stepInfo = STEPS.map((s, k) => {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i <= RS; i++) {
      const d = rPts[i].distanceToSquared(_a.set(s[0], s[1], s[2]));
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    const next = STEPS[Math.min(STEPS.length - 1, k + 1)];
    const prev = STEPS[Math.max(0, k - 1)];
    const yaw = Math.atan2(-(next[2] - prev[2]), next[0] - prev[0]);
    return {
      tStart: (rArc[bi] - STEP_SETTLE_FROM) / routeLen,
      tEnd: (rArc[bi] - STEP_SETTLE_TO) / routeLen,
      yaw,
      loose: {
        dy: -(40 + 50 * rnd(k, 51)),
        side: (rnd(k, 52) - 0.5) * 70,
        rx: (rnd(k, 53) - 0.5) * 0.5,
        rz: (rnd(k, 54) - 0.5) * 0.4,
        ry: (rnd(k, 55) - 0.5) * 0.9,
      },
      phase: rnd(k, 56) * Math.PI * 2,
      freq: 0.35 + rnd(k, 57) * 0.25,
    };
  });
  let lastRouteI = 0;
  const cameraT = (): number => {
    // Fallback when ctx.railU is absent: nearest route sample, searched near the last one.
    const cp = ctx.camera.getWorldPosition(_b);
    let best = Infinity;
    const lo = Math.max(0, lastRouteI - 200);
    const hi = Math.min(RS, lastRouteI + 200);
    const scan = (a: number, b: number, step: number) => {
      for (let i = a; i <= b; i += step) {
        const d = rPts[i].distanceToSquared(cp);
        if (d < best) {
          best = d;
          lastRouteI = i;
        }
      }
    };
    scan(lo, hi, 1);
    if (best > 400 * 400) scan(0, RS, 4);
    return rArc[lastRouteI] / routeLen;
  };
  const stepObj = new THREE.Object3D();
  const settle = new Float32Array(STEPS.length);
  const placeSteps = (u: number, time: number) => {
    for (let k = 0; k < STEPS.length; k++) {
      const s = STEPS[k];
      const inf = stepInfo[k];
      const w = smooth(inf.tStart, inf.tEnd, u);
      settle[k] = w;
      const l = 1 - w;
      const bob = Math.sin(time * inf.freq * Math.PI * 2 + inf.phase) * (MOTION.stepBobSet + (MOTION.stepBobLoose - MOTION.stepBobSet) * l);
      const sway = reduced ? 0 : Math.sin(time * 0.21 + inf.phase) * 0.12 * l;
      const sx = Math.sin(inf.yaw);
      const sz = Math.cos(inf.yaw);
      stepObj.position.set(s[0] + sx * inf.loose.side * l, s[1] + inf.loose.dy * l + bob, s[2] + sz * inf.loose.side * l);
      stepObj.rotation.set(inf.loose.rx * l, inf.yaw + inf.loose.ry * l + sway, inf.loose.rz * l, "YXZ");
      stepObj.updateMatrix();
      steps.setMatrixAt(k, stepObj.matrix);
    }
    steps.instanceMatrix.needsUpdate = true;
  };

  // ── The rope bridge to the bounty isle (layout BRIDGE) ──
  // Local frame: +x along a -> b in plan, y up, BRIDGE.a at the origin. Plank
  // tops sit exactly on bridgeDeckAt(u); the camera walks BRIDGE_EYE above
  // them on the centreline. Hand ropes follow the deck 7.5 above it.
  const bA = new THREE.Vector3(...BRIDGE.a);
  const bB = new THREE.Vector3(...BRIDGE.b);
  const span = Math.hypot(bB.x - bA.x, bB.z - bA.z);
  const dyB = bB.y - bA.y;
  const bridgeRoot = new THREE.Group();
  bridgeRoot.name = "RopeBridge";
  bridgeRoot.position.copy(bA);
  bridgeRoot.rotation.y = Math.atan2(-(bB.z - bA.z), bB.x - bA.x);
  // The sway group: dress-sky.ts builds the bridge into it (RopeBridge_Art).
  const bridgeSway = new THREE.Group();
  bridgeSway.name = "RopeBridge_Sway";
  bridgeRoot.add(bridgeSway);
  const bridgeAxis = new THREE.Vector3(span, dyB, 0).normalize();
  root.add(bridgeRoot);

  // ── Progress: flame, lookout lamp, the Trail Hut's lamp ──
  let flame: THREE.Mesh | null = null;
  if (anim.flame) {
    const fb = new Builder({ x: 0, y: 0, z: 0 });
    fb.add(U.cone6, T(0, 3.2, 0, 2.6, 6.4, 2.6), G.fire, 0);
    fb.add(U.cone6, T(0.8, 2.4, 0.6, 1.6, 4.4, 1.6, 0.5), G.lamp, 0);
    flame = addMesh(root, fb.build(), glowMat, "CampfireFlame");
    flame.position.set(anim.flame.x, anim.flame.y, anim.flame.z);
  }
  let lookoutLamp: THREE.Mesh | null = null;
  if (anim.lookoutLamp) {
    const lb = new Builder({ x: 0, y: 0, z: 0 });
    lb.add(U.box, T(0, 0, 0, 12.5, 3.2, 12.5), G.window, 0);
    lookoutLamp = addMesh(root, lb.build(), glowMat, "LookoutLamp");
    lookoutLamp.position.set(anim.lookoutLamp.x, anim.lookoutLamp.y, anim.lookoutLamp.z);
  }
  let headLamp: THREE.Mesh | null = null;
  if (anim.headLamp) {
    const hb = new Builder({ x: 0, y: 0, z: 0 });
    hb.add(U.box, T(0, 0, 0, 2.6, 3.4, 2.6), G.lamp, 0);
    headLamp = addMesh(root, hb.build(), glowMat, "TrailHutLamp");
    headLamp.position.set(anim.headLamp.x, anim.headLamp.y, anim.headLamp.z);
  }

  // Airships: yours (moored at the bounty isle, then carrying the camera,
  // then docked at the Gate isle; see update) and one small ship on a slow
  // loop high over the Gate isle, above anything the camera flies through.
  const HI = WORLD.gateIsle;
  anim.airships = [
    { x: SHIP_MOORED.x, y: SHIP_MOORED.y, z: SHIP_MOORED.z, heading: SHIP_MOORED.heading, kind: "yours" },
    { x: HI.x, y: HI.y + 250, z: HI.z, heading: 0, kind: "loop" },
  ];
  const airships = anim.airships.map((a, k) => {
    const g = new THREE.Group();
    g.name = `Airship_${a.kind}`;
    // Both are empty groups blocks places, bobs and banks; dress-sky.ts builds
    // the airship kit into each (the loop ship at 62 long, scaled 1.3 here).
    if (a.kind === "loop") g.scale.setScalar(1.3);
    g.position.set(a.x, a.y, a.z);
    g.rotation.set(0, yawTo(a.heading), 0, "YXZ");
    root.add(g);
    return { ...a, g, phase: k * 2.1 };
  });
  const yoursShip = airships.find((a) => a.kind === "yours")!;

  // v6 (world progress): the lesson lanterns, the places waking up and the
  // old trail and per-place lanterns are progress-world.ts's now. These three
  // lamps stay here (dress-shore.ts and dress-gorge.ts move them onto their
  // sets) and carry a wake tag, so progress-world switches them by the share
  // of their area watched: the campfire burns from progress 0 (log decision
  // 51: at the cutover every student is at 0, and the fire and its smoke are
  // the Landing's life), the lookout's and the Trail Hut's lamps when their
  // areas are done.
  if (flame) flame.userData.wake = { place: 0, at: 0 };
  if (lookoutLamp) lookoutLamp.userData.wake = { place: 1, at: 1 };
  if (headLamp) headLamp.userData.wake = { place: 3, at: 1 };


  // ── Mist over places past the frontier ──
  // Per place: centre, spread (x, y, z) and puff size. Puffs are sized to the
  // landmark, so the stop camera (300-600 away) stands outside them; puffs
  // the size of the whole place put the camera inside and faded to nothing.
  const MIST: { c: [number, number, number]; r: [number, number, number]; size: number }[] = [
    { c: [1320, 24, 4225], r: [110, 22, 110], size: 70 },
    { c: [475, 165, 2735], r: [110, 45, 110], size: 85 },
    { c: [-100, 250, 1325], r: [90, 170, 60], size: 105 },
    { c: [1392, 108, 1043], r: [22, 4, 5], size: 22 },
    { c: [1190, 588, -425], r: [120, 20, 70], size: 70 },
    { c: [-740, 880, -1170], r: [140, 70, 140], size: 105 },
    { c: [-2090, 1695, -1680], r: [160, 40, 200], size: 100 },
    { c: [-2290, 1650, -4330], r: [170, 40, 170], size: 105 },
  ];
  const PER = 26;
  const mistMat = track(puffMaterial("mist"));
  const mistGeo = puffGeo(MIST.length * PER, (i, off, data) => {
    const m = MIST[Math.floor(i / PER)];
    const a = rnd(i, 71) * Math.PI * 2;
    const rr = Math.sqrt(rnd(i, 72));
    off.push(m.c[0] + Math.cos(a) * m.r[0] * rr, m.c[1] + (rnd(i, 73) - 0.3) * m.r[1], m.c[2] + Math.sin(a) * m.r[2] * rr);
    data.push(m.size * (0.75 + rnd(i, 74) * 0.7), Math.floor(i / PER), rnd(i, 75), 0);
  });
  const mistSpheres = MIST.map((m) => new THREE.Sphere(new THREE.Vector3(...m.c), Math.max(...m.r) + m.size));
  const mist = addMesh(root, mistGeo, mistMat, "PlaceMist");
  mist.frustumCulled = false;
  mist.renderOrder = 5;
  mist.visible = false;
  const mistTarget = new Float32Array(8);
  const mistNow = mistMat.uniforms.uFade.value as number[];

  // Two zones the terrain hides wholesale, so frustum culling alone draws
  // them for nothing: the sky (island, port, steps, airships) from anywhere
  // south of the high ridge, and the first four places from inside the high
  // basin. Only sets and moving parts move into them; the LM_* groups stay
  // put so the scene's landmark index never finds one hidden.
  const skyZone = new THREE.Group();
  skyZone.name = "Zone_sky";
  const southZone = new THREE.Group();
  southZone.name = "Zone_south";
  // The meadow from the top of the Climb on; the Harbour Isle from the bridge on.
  const meadowZone = new THREE.Group();
  meadowZone.name = "Zone_meadow";
  const harbourZone = new THREE.Group();
  harbourZone.name = "Zone_gate";
  root.add(skyZone, southZone, meadowZone, harbourZone);
  const setOf = (id: string) => root.getObjectByName(`Set_${id}`);
  for (const o of [setOf("a5"), setOf("a6"), setOf("a7"), bridgeRoot, steps, yoursShip.g]) if (o) skyZone.add(o);
  for (const o of [setOf("a8"), ...airships.filter((a) => a.kind === "loop").map((a) => a.g)]) if (o) harbourZone.add(o);
  for (const o of [setOf("a1"), setOf("a2"), setOf("a3"), setOf("a4"), flame, lookoutLamp, headLamp]) if (o) southZone.add(o);
  meadowZone.add(meadowGroup);
  const parent = ctx.root ?? ctx.scene;
  parent.add(root);
  root.updateMatrixWorld(true);
  freeUnits();

  // ── Frame loop ──
  let progress = 0;
  /** Your airship waits at the bounty isle (place 7 done). */
  let shipWaiting = false;
  let mistManual = false;
  let lockKey = "";
  let dirty = true;
  let animating = false;
  let lastU = -1;
  const applyProgress = () => {
    const done = Math.floor(progress + 1e-6);
    // Without progress-world these follow whole places, as before; with it,
    // its setProgress runs after this one and switches them by their wake tags.
    if (flame) flame.visible = true;
    if (lookoutLamp) lookoutLamp.visible = done >= 2;
    if (headLamp) headLamp.visible = done >= 4;
    shipWaiting = done >= 7;
  };
  applyProgress();
  placeSteps(0, 0);

  // Bounding spheres of the time-driven parts, for "is anything moving on screen".
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const boatSphere = anim.boat ? new THREE.Sphere(new THREE.Vector3(anim.boat.x, 5, anim.boat.z), 20) : null;
  const stepsBox = new THREE.Box3();
  for (const s of STEPS) stepsBox.expandByPoint(_a.set(s[0], s[1], s[2]));
  stepsBox.expandByScalar(110);
  steps.boundingSphere = stepsBox.getBoundingSphere(new THREE.Sphere());
  steps.frustumCulled = true;
  const bridgeSphere = new THREE.Sphere(bA.clone().add(bB).multiplyScalar(0.5), span / 2 + 20);
  // In the frustum AND near enough to matter. The frustum alone counts the
  // steps and the island as on screen from the shore, where the ridge hides
  // them, and the loop would never sleep.
  const camPos = new THREE.Vector3();
  let reach = 3000;
  const inView = (s: THREE.Sphere) => camPos.distanceTo(s.center) - s.radius < reach && frustum.intersectsSphere(s);
  const stepsSphere = steps.boundingSphere;

  // The boat: its own mesh, rocking on the water.
  let boat: THREE.Group | null = null;
  let boatInner: THREE.Mesh | null = null;
  if (anim.boat) {
    boat = new THREE.Group();
    boat.name = "LandingBoat";
    boat.position.set(anim.boat.x, anim.boat.y, anim.boat.z);
    boat.rotation.y = yawTo(anim.boat.bearing);
    // Its hull is dress-shore.ts's (it swaps this mesh's geometry and material).
    boatInner = addMesh(boat, new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3)), solid, "LandingBoat_Block");
    southZone.add(boat);
    boat.updateMatrixWorld(true);
  }

  // ── Your airship: moored, carrying the camera, docked ──
  // Before FLIGHT_KEYS.first it is moored at SHIP_MOORED; between the flight
  // keys it rides under the camera, shipFromCamera(the rail's point, the
  // rail's heading), banking into turns; after, it is docked at SHIP_DOCKED.
  // At the bounty isle it waits once place 7 is done, and whenever the
  // camera is past the a7 stop (previewing the rest of the route): the
  // camera is looking away (up at the stars) when it appears.
  const nT = TRAIL.length - 1;
  const tFly0 = FLIGHT_KEYS.first / nT;
  const tFly1 = FLIGHT_KEYS.last / nT;
  const tA7 = PLACES[6].trail / nT;
  const tBoard = (FLIGHT_KEYS.first - 1) / nT;
  const _tan = new THREE.Vector3();
  const _pt = new THREE.Vector3();
  const _p2 = new THREE.Vector3();
  const clampT = (v: number) => Math.min(1, Math.max(0, v));
  const headingAt = (tt: number) => {
    route.getTangent(clampT(tt), _tan);
    return Math.atan2(_tan.x, -_tan.z) / DEG;
  };
  const lerpAngle = (a: number, b: number, w: number) => {
    let d = b - a;
    d -= 360 * Math.round(d / 360);
    return a + d * w;
  };
  let shipT = -1;
  let shipBob = 0;
  const railShip: ShipPose = { x: 0, y: 0, z: 0, heading: 0, bank: 0, throttle: 0, phase: "moored" };
  /** Places your ship for curve parameter tt. Returns the bob weight (0 while riding). */
  const placeShip = (tt: number, time: number): number => {
    const g = yoursShip.g;
    g.visible = shipWaiting || tt > tA7 + 1e-4;
    if (!g.visible) return 0;
    let x: number;
    let y: number;
    let z: number;
    let heading: number;
    let bank = 0;
    let pitch = 0;
    let bobW = 0;
    if (ctx.shipPose) {
      // Round 1, the airship jiggle (world-tests/v6-r1-ship-record.mjs): the
      // bank below was 9 x the curve's turn rate clamped at 4 degrees, so it sat
      // on the clamp and flipped sign within one frame (12-19 units) wherever
      // the path's turn reversed or wiggled (5-7 degree roll steps at flight
      // units 217, 335, 839, 882), the pitch flipped +-2.9 over the top of the
      // climb, and the ship went from standing to full speed the instant the
      // camera reached its spot. The rail's pose (rail.ts shipAtS) is the same
      // shipFromCamera ride with a cast-off and a docking ease, the travel
      // heading, and a bank from the turn rate blurred over 40 units; the hull
      // stays level. The mooring bob fades with the throttle, so it is
      // continuous at both ends.
      const p = ctx.shipPose(railShip);
      ({ x, y, z, heading } = p);
      bank = p.bank * DEG;
      const w = tt <= tFly0 ? 1 - smooth(tBoard, tFly0, tt) : tt >= tFly1 ? smooth(tFly1, tFly1 + 1 / nT, tt) : 0;
      bobW = w * (1 - p.throttle);
    } else if (tt <= tFly0 || tt >= tFly1) {
      const P = tt <= tFly0 ? SHIP_MOORED : SHIP_DOCKED;
      ({ x, y, z, heading } = P);
      bobW = tt <= tFly0 ? 1 - smooth(tBoard, tFly0, tt) : smooth(tFly1, tFly1 + 1 / nT, tt);
    } else {
      route.getPoint(tt, _pt);
      let h = headingAt(tt);
      h = lerpAngle(SHIP_MOORED.heading, h, smooth(tFly0, tFly0 + 0.3 / nT, tt));
      h = lerpAngle(h, SHIP_DOCKED.heading, smooth(tFly1 - 0.3 / nT, tFly1, tt));
      ({ x, y, z, heading } = shipFromCamera(_pt.x, _pt.y, _pt.z, h));
      // Bank into the turn: heading change per unit of travel over ~±0.15 key.
      const dT = 0.15 / nT;
      route.getPoint(clampT(tt - dT), _p2);
      const dist = _p2.distanceTo(route.getPoint(clampT(tt + dT), _tan)) || 1;
      let dh = headingAt(tt + dT) - headingAt(tt - dT);
      dh -= 360 * Math.round(dh / 360);
      const edge = smooth(tFly0, tFly0 + 0.5 / nT, tt) * (1 - smooth(tFly1 - 0.5 / nT, tFly1, tt));
      bank = Math.max(-MOTION.rideBankMax, Math.min(MOTION.rideBankMax, (dh / dist) * MOTION.rideBank)) * edge;
      route.getTangent(tt, _tan);
      pitch = Math.max(-0.05, Math.min(0.05, Math.atan2(_tan.y, Math.hypot(_tan.x, _tan.z)))) * edge;
    }
    const bob = reduced ? 0 : bobW;
    g.position.set(x, y + MOTION.mooredBob * Math.sin(time * 0.4 + yoursShip.phase) * bob, z);
    g.rotation.set(bank + 0.015 * Math.sin(time * 0.33 + yoursShip.phase) * bob, yawTo(heading), pitch, "YXZ");
    return bobW;
  };

  const update = (time: number, _dt: number): boolean => {
    const t = reduced ? 0 : time;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(camPos);
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    let changed = dirty;
    dirty = false;
    let moving = false;
    // The ridge crest runs at z 690-1000 and 1,250-1,500 high; the route's
    // sight-line check has the island hidden until past stop 5.
    const sky = !(camPos.z > 1000 && camPos.y < 1200);
    const south = !(camPos.z < 300 && camPos.y < 1000);
    // The meadow: from the top of the Climb (over the rim) and anywhere north of the ridge.
    const meadow = camPos.z < 1000 || (camPos.z < 1400 && camPos.y > 560);
    // The Gate isle: once the camera is past the head of the rope bridge.
    const harbour = camPos.z < -2100;
    if (sky !== skyZone.visible || south !== southZone.visible || meadow !== meadowZone.visible || harbour !== harbourZone.visible) {
      skyZone.visible = sky;
      southZone.visible = south;
      meadowZone.visible = meadow;
      harbourZone.visible = harbour;
      changed = true;
    }

    mistMat.uniforms.uTime.value = t;
    reach = 1500;

    // The mist takes the haze colour, so it sits in the time of day.
    const fog = ctx.scene.fog as THREE.Fog | THREE.FogExp2 | null;
    if (fog) {
      (mistMat.uniforms.uColor.value as THREE.Color).setRGB(0.88, 0.89, 0.92).lerp(fog.color, 0.5);
    }

    if (south && boat && boatInner && boatSphere && inView(boatSphere)) {
      boatInner.rotation.x = MOTION.boatRoll * Math.sin(t * 1.1);
      boatInner.rotation.z = 0.02 * Math.sin(t * 0.7 + 1);
      boatInner.position.y = 0.35 * Math.sin(t * 0.9);
      moving = true;
    }

    reach = 3000;
    if (sky && stepsSphere && inView(stepsSphere)) {
      const u = ctx.routeU ? ctx.routeU() : ctx.railU ? ctx.railU() : cameraT();
      if (!reduced || u !== lastU) {
        placeSteps(u, t);
        if (u !== lastU) changed = true;
        lastU = u;
      }
      moving = true;
    }

    reach = 2500;
    if (sky && inView(bridgeSphere)) {
      _q.setFromAxisAngle(bridgeAxis, MOTION.bridgeSway * Math.sin(t * 0.8));
      bridgeSway.quaternion.copy(_q);
      moving = true;
    }

    {
      const tt = ctx.railU ? ctx.railU() : 0;
      if (tt !== shipT) changed = true;
      shipT = tt;
      shipBob = placeShip(tt, t);
      sph.set(yoursShip.g.position, 110);
      if (sky && yoursShip.g.visible && shipBob > 0 && inView(sph)) moving = true;
    }
    for (const a of airships) {
      if (a.kind !== "loop") continue;
      const ang = (t / MOTION.airshipLoopS) * Math.PI * 2;
      const R = 720;
      a.g.position.set(a.x + Math.cos(ang) * R, a.y + 6 * Math.sin(t * 0.3), a.z + Math.sin(ang) * R);
      // Heading along the loop (tangent), nose forward.
      a.g.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang));
      sph.set(a.g.position, 90);
      if (harbourZone.visible && inView(sph)) moving = true;
    }

    if (south && flame && flame.visible) {
      flame.scale.set(1, 1 + 0.18 * Math.sin(t * 9) + 0.1 * Math.sin(t * 13.7), 1);
      sph.set(flame.position, 10);
      reach = 1200;
      if (inView(sph)) moving = true;
    }

    // Mist follows the lock until the page sets it.
    if (!mistManual && ctx.lock) {
      const key = ctx.lock.mode + ctx.lock.frontier;
      if (key !== lockKey) {
        lockKey = key;
        for (let i = 0; i < 8; i++) mistTarget[i] = ctx.lock.mode === "look" && i > ctx.lock.frontier ? 1 : 0;
      }
    }
    // Mist fades toward its targets.
    let mistAny = false;
    let fading = false;
    const k = Math.min(1, _dt / MIST_FADE_S);
    for (let i = 0; i < 8; i++) {
      const d = mistTarget[i] - mistNow[i];
      if (Math.abs(d) > 1e-3) {
        mistNow[i] += Math.sign(d) * Math.min(Math.abs(d), k);
        fading = true;
      } else mistNow[i] = mistTarget[i];
      if (mistNow[i] > 0) mistAny = true;
    }
    mist.visible = mistAny;
    if (fading) {
      changed = true;
      moving = true;
    }
    if (mistAny && !reduced) {
      reach = 2500;
      for (let i = 0; i < 8; i++) if (mistNow[i] > 0 && (i < 4 ? south : sky) && inView(mistSpheres[i])) moving = true;
    }

    if (reduced) moving = fading;
    animating = moving;
    return changed || moving;
  };

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const buildMs = Math.round(t1 - t0);
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // The curtain in LM_Waterfall is water.ts's (it reports it).
    if (!m.isMesh || o.name === "PlaceMist" || o.name === "Landmark_a3_Water") return;
    const g = m.geometry;
    const n = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    const inst = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
    tris += n * inst;
  });

  return {
    name: "blocks",
    root,
    update,
    isAnimating: () => animating,
    setProgress(p: number) {
      progress = Math.min(8, Math.max(0, p));
      applyProgress();
      dirty = true;
      ctx.requestRender?.();
    },
    setMist(indices: readonly number[]) {
      mistManual = true;
      mistTarget.fill(0);
      for (const i of indices) if (i >= 0 && i < 8) mistTarget[i] = 1;
      if (reduced) for (let i = 0; i < 8; i++) mistNow[i] = mistTarget[i];
      dirty = true;
      ctx.requestRender?.();
    },
    dispose() {
      parent.remove(root);
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      steps.dispose();
    },
    stats() {
      const out: Record<string, number | string> = {
        triangles: Math.round(tris),
        meshes: counts.meshes,
        steps: STEPS.length,
        buildMs,
      };
      for (const [id, n] of Object.entries(perPlace)) out[`tris_${id}`] = n;
      out.settled = Array.from(settle).filter((v) => v > 0.99).length;
      return out;
    },
  };
}
