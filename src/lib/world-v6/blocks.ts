import * as THREE from "three";
import {
  BRIDGE,
  // v6: the cave is built in its BUILD frame (v5's, the mouth facing +z) and
  // hung under a mirror matrix into the world (layout CAVE_MIRROR_Z); the
  // side passage out of it is swept like v5's tunnel.
  CAVE_BUILD as CAVE,
  CAVE_EXIT_BUILD as TUNNEL,
  CAVE_EXIT_H as TUNNEL_H,
  CAVE_EXIT_HALF_W as TUNNEL_HALF_W,
  CAVE_MIRROR_Z,
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
 *   - the cave's source shells (Zone_mine, under the cave's mirror matrix):
 *     the hall behind the curtain and the side passage out of it (v6: the
 *     mine's tunnel, shaft and headframe are gone) as closed inward-facing
 *     shells. They are never drawn: dress-underground.ts reads them at
 *     install, bakes its light into copies and owns the flames and lamps.
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

// ── The cave behind the falls and its side passage (v6: the mine is gone) ──
//
// v6: everything in this section is in the cave's BUILD frame (layout
// CAVE_BUILD, CAVE_EXIT_BUILD, imported here as CAVE and TUNNEL): v5's cave
// behind a falls on the gorge's north wall. Zone_mine hangs it into the world
// under caveMirrorMatrix (z -> CAVE_MIRROR_Z - z); "the tunnel" below is the
// short side passage out to the cliff face east of the curtain.
//
// HOW IT IS BUILT. The mine is three voids under the terrain (layout.ts CAVE,
// TUNNEL, SHAFT). The terrain is drawn front faces only, so from inside a void
// the ground above is see-through: every surface the camera sees down here is
// built here, as a CLOSED shell whose faces point INTO the void. Three shells:
// the hall (an elliptical floor, a wall, a dome), the tunnel (a swept arch)
// and the shaft (four walls and a floor), plus the short tube of the cave's
// mouth out to the cliff face behind the curtain. Where a passage meets a
// room, the passage's tube starts a few units INSIDE the room, and the room's
// wall has a hole cut on its own grid that is a little SMALLER than the tube's
// profile: no ray from inside can slip out between the two. Faces pointing
// inward also means that, from outside, any part of a shell that pokes
// through the ground is invisible.
//
// v5: these shells are never drawn. dress-underground.ts reads their
// triangles and colours at install, re-bakes the light into them (torches,
// lanterns, the ripples near the mouth, the shaft's daylight) and draws its
// own copies; it also owns the cage, the flames and the lamps.

/** One side of the cave mouth's arch: [offset from the centre line, height over the sill], outermost first. */
const MOUTH_ARCH: ReadonlyArray<readonly [number, number]> = [[CAVE.mouthHalfW, 0], [CAVE.mouthHalfW, 46], [33, 56], [20, 61.5]];
/** One side of the tunnel's arch over its floor, outermost first. */
const TUNNEL_ARCH: ReadonlyArray<readonly [number, number]> = [[TUNNEL_HALF_W, 0], [TUNNEL_HALF_W, 9], [TUNNEL_HALF_W, 17], [9, 23], [4, TUNNEL_H - 0.4]];
/** The tunnel's and the mouth's floors sit this far over the room floors they overlap (no z-fighting). */
const FLOOR_LIFT = 0.3;

/** Height of an arch (MOUTH_ARCH / TUNNEL_ARCH) at `a` from its centre line; -Infinity outside it. */
function archTop(arch: ReadonlyArray<readonly [number, number]>, a: number): number {
  const n = arch.length;
  if (a > arch[0][0] + 1e-9) return -Infinity;
  if (a <= arch[n - 1][0]) return arch[n - 1][1];
  for (let i = n - 1; i > 0; i--) {
    const [s0, h0] = arch[i];
    const [s1, h1] = arch[i - 1];
    if (a >= s0 && a <= s1) return s1 === s0 ? Math.max(h0, h1) : h0 + ((h1 - h0) * (a - s0)) / (s1 - s0);
  }
  return arch[0][1];
}
/** The closed profile of an arch (both sides), for sweeping: floor edge first. */
function archLoop(arch: ReadonlyArray<readonly [number, number]>): [number, number][] {
  return [...arch.map(([s, h]) => [s, h] as [number, number]), ...arch.slice().reverse().map(([s, h]) => [-s, h] as [number, number])];
}

/** Smooth value noise, 0..1. */
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  const h = (a: number, b: number, c: number) => rnd(a * 157.31 + b * 113.97 + c * 71.43, 9.1);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
/** Rock colour at a point: blotches and strata, so the rock reads as it slides past. */
function rockAt(x: number, y: number, z: number, base: RGB, k = 1, strata = 0.14): RGB {
  const n = vnoise(x * 0.06, y * 0.09, z * 0.06);
  const band = Math.sin(y * 0.13 + vnoise(x * 0.02, y * 0.015, z * 0.02) * 5);
  const f = (0.8 + 0.34 * n) * (1 + strata * band) * k;
  return [base[0] * f, base[1] * f, base[2] * f];
}

/** A quad turned to face `inside` (the shells are seen only from within). */
function quadIn(b: Builder, a: V3, bb: V3, c: V3, d: V3, col: RGB, inside: V3): void {
  const ux = bb[0] - a[0];
  const uy = bb[1] - a[1];
  const uz = bb[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (a[0] + c[0]) / 2;
  const my = (a[1] + c[1]) / 2;
  const mz = (a[2] + c[2]) / 2;
  if (nx * (inside[0] - mx) + ny * (inside[1] - my) + nz * (inside[2] - mz) >= 0) b.quad(a, bb, c, d, col);
  else b.quad(a, d, c, bb, col);
}

/** A triangle turned to face `inside`. */
function triIn(b: Builder, a: V3, bb: V3, c: V3, col: RGB, inside: V3): void {
  const ux = bb[0] - a[0];
  const uy = bb[1] - a[1];
  const uz = bb[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (a[0] + bb[0] + c[0]) / 3;
  const my = (a[1] + bb[1] + c[1]) / 3;
  const mz = (a[2] + bb[2] + c[2]) / 3;
  if (nx * (inside[0] - mx) + ny * (inside[1] - my) + nz * (inside[2] - mz) >= 0) b.tri(a, bb, c, col);
  else b.tri(a, c, bb, col);
}

interface MineParts {
  cave: Builder;
  tunnel: Builder;
}

/** The cave's mirror (layout CAVE_MIRROR_Z): build frame -> world. Its own inverse. */
export const caveMirrorMatrix = (): THREE.Matrix4 => new THREE.Matrix4().makeScale(1, 1, -1).setPosition(0, 0, CAVE_MIRROR_Z);

/** A wall torch's bracket (its flame and light are dress-underground.ts's), `out` the unit vector from the wall into the void. */
function torch(m: MineParts, into: Builder, x: number, y: number, z: number, ox: number, oz: number): void {
  into.beam(x - ox * 1.2, y - 2.6, z - oz * 1.2, x + ox * 0.6, y + 0.4, z + oz * 0.6, 0.7, 0.7, C.woodDark);
  into.add(U.cyl6, T(x + ox * 0.7, y + 0.6, z + oz * 0.7, 0.75, 1.2, 0.75), C.woodDark, 0);
}

/**
 * The cave behind the falls: the hall, the mouth's tube out to the cliff face,
 * the rock frame round the arch outside (it hides the terrain cut's jagged
 * edge behind the curtain), and the set: a lantern on a post to the right of
 * the mouth as the a3 stop sees it, a mine cart on the rails running out of
 * the tunnel, crates, fallen blocks and a few stalactites clear of the camera.
 */
function buildCave(m: MineParts): void {
  const b = m.cave;
  const CV = CAVE;
  const [t0x, t0y, t0z] = TUNNEL[0];
  const [t1x, , t1z] = TUNNEL[1];
  const tl = Math.hypot(t1x - t0x, t1z - t0z);
  const tdx = (t1x - t0x) / tl;
  const tdz = (t1z - t0z) / tl;
  // Right of the direction of travel.
  const tnx = -tdz;
  const tnz = tdx;
  const ell = (th: number): [number, number] => [CV.hallX + CV.rx * Math.cos(th), CV.hallZ + CV.rz * Math.sin(th)];
  const ellR = (x: number, z: number) => Math.hypot((x - CV.hallX) / CV.rx, (z - CV.hallZ) / CV.rz);
  const ellZ = (x: number) => CV.hallZ + CV.rz * Math.sqrt(Math.max(0, 1 - ((x - CV.hallX) / CV.rx) ** 2));
  const roofAt = (r: number) => CV.floorY + Math.max(CV.mouthH, CV.hallH * Math.sqrt(Math.max(0, 1 - r * r)));
  const sOf = (x: number, z: number) => (x - t0x) * tnx + (z - t0z) * tnz;

  // Columns round the hall: 44 even, plus exact lines at the edges of the two holes.
  const special: number[] = [];
  const mouthOff = [CV.mouthHalfW - 0.4, 32.7, 19.8];
  for (const o of mouthOff) for (const sg of [-1, 1]) special.push(Math.acos((CV.x + sg * o - CV.hallX) / CV.rx));
  const tunOff = [TUNNEL_HALF_W - 0.3, 8.8, 3.9];
  for (const o of tunOff) {
    for (const sg of [-1, 1]) {
      let lo = -1.2;
      let hi = 0.8;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const [x, z] = ell(mid);
        if (sOf(x, z) < sg * o) lo = mid;
        else hi = mid;
      }
      special.push((lo + hi) / 2);
    }
  }
  const cols = [...special];
  for (let k = 0; k < 44; k++) {
    const th = (k / 44) * Math.PI * 2 - Math.PI;
    if (special.every((s) => Math.abs(s - th) > 0.035)) cols.push(th);
  }
  cols.sort((a, c) => a - c);
  // Wall rows (over the floor): exact rows at the tops of the two holes' steps.
  const WALL = [0, 8, 16.7, 22.7, 25.3, 33, 40, 45.7, 50.5, 55.7, 61.2, CV.mouthH];
  const DOME = [0.92, 0.84, 0.74, 0.63, 0.5, 0.36, 0.22, 0.09];
  const inside: V3 = [CV.hallX, CV.floorY + 40, CV.hallZ];

  const inMouth = (x: number, h: number, z: number) => z > CV.hallZ + 40 && Math.abs(x - CV.x) <= CV.mouthHalfW - 0.3 && h <= archTop(MOUTH_ARCH, Math.abs(x - CV.x)) - 0.2;
  const inTunnel = (x: number, h: number, z: number) => {
    const s = sOf(x, z);
    return x > CV.hallX + 60 && Math.abs(s) <= TUNNEL_HALF_W - 0.2 && h <= archTop(TUNNEL_ARCH, Math.abs(s)) - 0.2;
  };
  // No noise near the holes' edges (they must stay exact) or on the floor line.
  const calm = (x: number, h: number, z: number) =>
    (z > CV.hallZ + 30 && Math.abs(x - CV.x) < CV.mouthHalfW + 7 && h < CV.mouthH + 1) ||
    (x > CV.hallX + 50 && Math.abs(sOf(x, z)) < TUNNEL_HALF_W + 7 && h < TUNNEL_H + 6);

  const nc = cols.length;
  // Vertex grid: rows = wall rows, then dome rings; one apex.
  const grid: V3[][] = [];
  const raw: V3[][] = [];
  for (let j = 0; j < WALL.length + DOME.length; j++) {
    const row: V3[] = [];
    const rawRow: V3[] = [];
    for (let i = 0; i < nc; i++) {
      const th = cols[i];
      let x: number;
      let y: number;
      let z: number;
      if (j < WALL.length) {
        [x, z] = ell(th);
        y = CV.floorY + WALL[j];
      } else {
        const r = DOME[j - WALL.length];
        x = CV.hallX + CV.rx * r * Math.cos(th);
        z = CV.hallZ + CV.rz * r * Math.sin(th);
        y = roofAt(r) - 0.6;
      }
      rawRow.push([x, y, z]);
      const h = y - CV.floorY;
      let amp = j === 0 ? 0 : j < WALL.length ? 3.6 : 5;
      if (j < WALL.length && calm(x, h, z)) amp = 0;
      if (amp > 0) {
        const n = vnoise(x * 0.07, y * 0.07, z * 0.07) * 0.7 + vnoise(x * 0.19, y * 0.19, z * 0.19) * 0.3;
        const dx = inside[0] - x;
        const dy = j < WALL.length ? 0 : inside[1] - y;
        const dz = inside[2] - z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        x += (dx / dl) * amp * n;
        y += (dy / dl) * amp * n;
        z += (dz / dl) * amp * n;
      }
      row.push([x, y, z]);
    }
    grid.push(row);
    raw.push(rawRow);
  }
  const apex: V3 = [CV.hallX, CV.floorY + CV.hallH - 1.5, CV.hallZ];
  for (let j = 0; j < grid.length - 1; j++) {
    for (let i = 0; i < nc; i++) {
      const i2 = (i + 1) % nc;
      if (j < WALL.length - 1) {
        const corners = [raw[j][i], raw[j][i2], raw[j + 1][i2], raw[j + 1][i]];
        if (corners.every((p) => inMouth(p[0], p[1] - CV.floorY, p[2]))) continue;
        if (corners.every((p) => inTunnel(p[0], p[1] - t0y, p[2]))) continue;
      }
      const a = grid[j][i];
      const c = grid[j + 1][i2];
      const wet = a[2] > CV.hallZ + 55 ? 0.78 : 1;
      const col = j < WALL.length - 1 ? rockAt(a[0], a[1], a[2], C.rock, wet) : rockAt(a[0], a[1], a[2], C.rockDark, 1.08);
      quadIn(b, a, grid[j][i2], c, grid[j + 1][i], col, inside);
    }
  }
  const top = grid[grid.length - 1];
  for (let i = 0; i < nc; i++) triIn(b, top[i], top[(i + 1) % nc], apex, rockAt(apex[0], apex[1], apex[2], C.rockDark), inside);

  // The floor: rings in to a centre, rising a little in the middle.
  const FLOOR = [1, 0.72, 0.44, 0.18];
  const fl: V3[][] = FLOOR.map((r, k) =>
    cols.map((th) => {
      const x = CV.hallX + CV.rx * r * Math.cos(th);
      const z = CV.hallZ + CV.rz * r * Math.sin(th);
      return [x, CV.floorY + (k === 0 ? 0 : 0.4 + 1.4 * vnoise(x * 0.05, 3.3, z * 0.05)), z] as V3;
    }),
  );
  const up = (p: V3): V3 => [p[0], p[1] + 20, p[2]];
  for (let k = 0; k < FLOOR.length - 1; k++) {
    for (let i = 0; i < nc; i++) {
      const i2 = (i + 1) % nc;
      const a = fl[k][i];
      quadIn(b, a, fl[k][i2], fl[k + 1][i2], fl[k + 1][i], rockAt(a[0], a[1], a[2], [0.3, 0.29, 0.27], 1, 0.05), up(a));
    }
  }
  const fc: V3 = [CV.hallX, CV.floorY + 1.6, CV.hallZ];
  const last = fl[FLOOR.length - 1];
  for (let i = 0; i < nc; i++) {
    const a = last[i];
    const c = last[(i + 1) % nc];
    triIn(b, a, c, fc, [0.3, 0.29, 0.27], up(a));
  }

  // ── The mouth: a short tube from inside the hall out to the cliff face ──
  const loop = archLoop(MOUTH_ARCH).map(([s, h]) => [s, h === 0 ? FLOOR_LIFT : h] as [number, number]);
  const faceZ = (h: number) => CV.footZ + 2.5 - h / 9;
  const ringsZ = [(s: number) => ellZ(CV.x + s) - 3, (s: number, h: number) => (ellZ(CV.x + s) - 3 + faceZ(h)) / 2, (_s: number, h: number) => faceZ(h)];
  const mouthIn: V3 = [CV.x, CV.floorY + 30, CV.footZ - 6];
  const mv = ringsZ.map((zf, r) =>
    loop.map(([s, h]) => {
      let x = CV.x + s;
      let y = CV.floorY + h;
      const z = zf(s, h);
      if (r === 1 && h > 1) {
        // A little unevenness in the middle ring, inward only.
        const n = vnoise(x * 0.1, y * 0.1, z * 0.1) * 2.2;
        const dl = Math.hypot(mouthIn[0] - x, mouthIn[1] - y) || 1;
        x += ((mouthIn[0] - x) / dl) * n;
        y += ((mouthIn[1] - y) / dl) * n;
      }
      return [x, y, z] as V3;
    }),
  );
  for (let r = 0; r < mv.length - 1; r++) {
    for (let k = 0; k < loop.length; k++) {
      const k2 = (k + 1) % loop.length;
      const a = mv[r][k];
      const floor = loop[k][1] <= FLOOR_LIFT && loop[k2][1] <= FLOOR_LIFT;
      const col = floor ? [0.28, 0.28, 0.27] as RGB : rockAt(a[0], a[1], a[2], C.rockDark, 0.95);
      quadIn(b, a, mv[r][k2], mv[r + 1][k2], mv[r + 1][k], col, [CV.x, CV.floorY + 30, a[2]]);
    }
  }

  // ── Outside: rock blocks round the arch on the cliff face, over the cut's edge ──
  for (let h = 6; h <= 58; h += 11) {
    for (const sg of [-1, 1]) {
      const x = CV.x + sg * (CV.mouthHalfW + 5 + rnd(h, 81 + sg) * 3);
      const y = CV.floorY + h;
      const r = 8 + rnd(h, 83 + sg) * 3;
      b.add(U.dode, T(x, y, faceZ(h) - 1, r * 0.9, r, 5, x + h), C.rockDark);
    }
  }
  for (let x = -36; x <= 36; x += 12) {
    const h = CV.mouthH + 4 + rnd(x, 85) * 3;
    const r = 8 + rnd(x, 86) * 3;
    b.add(U.dode, T(CV.x + x, CV.floorY + h, faceZ(h) - 1, r, r * 0.8, 5, x), C.rockDark);
  }

  // ── The set ──
  // The lantern: a post to the right of the mouth as the a3 stop sees it
  // (bearing ~214 from CAVE_VIEW, 16 in from the wall), its lamp toward the hall.
  const lx = -137;
  const lz = 1266;
  const fy = CV.floorY;
  b.add(U.box, T(lx, fy + 11, lz, 1.5, 22, 1.5), C.woodDark);
  b.add(U.box, T(lx + 2.6, fy + 21.5, lz, 6.4, 0.9, 0.9), C.woodDark);
  b.add(U.box, T(lx + 5, fy + 18.6, lz, 2.8, 3.8, 2.8), C.woodDark, 0);
  b.add(U.cone4, T(lx + 5, fy + 21.2, lz, 2.4, 1.4, 2.4, 45 * DEG), C.roof, 0);
  // Stones and a crate at the post's foot.
  b.add(U.dode, T(lx - 7, fy + 2.2, lz + 6, 5, 3.6, 5, 1), C.rockDark);
  b.add(U.box, T(lx + 4, fy + 2.5, lz + 7, 5, 5, 5, 0.4), C.woodPale);
  // v6: the mine's rails and cart are gone; the hidden camp's crates sit clear
  // of the side passage's entry (the hall's east side).
  b.add(U.box, T(-44, fy + 3, 1226, 6, 6, 6, 0.3), C.woodPale);
  b.add(U.box, T(-37, fy + 2.4, 1236, 4.8, 4.8, 4.8, 1.1), C.wood);
  b.add(U.box, T(-46, fy + 7.4, 1227, 4, 3, 4, 0.7), C.wood);
  // Fallen blocks round the hall's west and north, clear of the camera's line.
  for (let k = 0; k < 9; k++) {
    const th = Math.PI * (0.62 + k * 0.105);
    const r = 0.8 + rnd(k, 87) * 0.1;
    const x = CV.hallX + CV.rx * r * Math.cos(th);
    const z = CV.hallZ + CV.rz * r * Math.sin(th);
    const s = 4 + rnd(k, 88) * 6;
    b.add(U.dode, T(x, fy + s * 0.35, z, s, s * 0.7, s, k), C.rockDark);
  }
  // Stalactites off the dome, well above the camera (it rides at 86-96).
  for (let k = 0; k < 14; k++) {
    const th = rnd(k, 89) * Math.PI * 2;
    const r = 0.55 + rnd(k, 90) * 0.3;
    const x = CV.hallX + CV.rx * r * Math.cos(th);
    const z = CV.hallZ + CV.rz * r * Math.sin(th);
    const yTop = roofAt(r) - 2;
    const len = 6 + rnd(k, 91) * 9;
    if (yTop - len < CV.floorY + 46 || ellR(x, z) > 0.9) continue;
    b.add(U.cone6, T(x, yTop - len / 2, z, 1.8 + rnd(k, 92) * 1.6, len, 1.8 + rnd(k, 92) * 1.6, th, Math.PI), C.rock, 0.1);
  }
}

/**
 * The tunnel: an arch swept along TUNNEL, from inside the hall to 2 inside
 * the shaft; timber sets (two posts and a cap) every ~12, rails and sleepers,
 * and six torches on alternate walls, the last one lighting the lift's foot.
 */
function buildTunnel(m: MineParts): void {
  const b = m.tunnel;
  const pts = TUNNEL;
  const segLen: number[] = [];
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
    segLen.push(l);
    L += l;
  }
  const END = L;
  /** Floor centre, direction and right vector at arc length a (beyond the ends: straight on). */
  const at = (a: number) => {
    let i = 0;
    let acc = 0;
    while (i < segLen.length - 1 && a > acc + segLen[i]) acc += segLen[i++];
    const p = pts[i];
    const q = pts[i + 1];
    const u = (a - acc) / segLen[i];
    const dx = (q[0] - p[0]) / segLen[i];
    const dz = (q[2] - p[2]) / segLen[i];
    let ddx = dx;
    let ddz = dz;
    // Near a vertex, lean the rings toward the mean direction (mitred joints).
    if (u > 0.9 && i < segLen.length - 1) {
      const r = pts[i + 2];
      const l2 = segLen[i + 1];
      const w = (u - 0.9) / 0.2;
      ddx = dx + ((r[0] - q[0]) / l2 - dx) * w;
      ddz = dz + ((r[2] - q[2]) / l2 - dz) * w;
    } else if (u < 0.1 && i > 0) {
      const o = pts[i - 1];
      const l0 = segLen[i - 1];
      const w = (0.1 - u) / 0.2;
      ddx = dx + ((p[0] - o[0]) / l0 - dx) * w;
      ddz = dz + ((p[2] - o[2]) / l0 - dz) * w;
    }
    const dl = Math.hypot(ddx, ddz);
    ddx /= dl;
    ddz /= dl;
    return { x: p[0] + (q[0] - p[0]) * u, y: p[1] + (q[1] - p[1]) * u + FLOOR_LIFT, z: p[2] + (q[2] - p[2]) * u, dx: ddx, dz: ddz, rx: -ddz, rz: ddx };
  };
  const loop = archLoop(TUNNEL_ARCH);
  const CV = CAVE;
  const inHallBy = (x: number, z: number) => (1 - Math.hypot((x - CV.hallX) / CV.rx, (z - CV.hallZ) / CV.rz)) * Math.min(CV.rx, CV.rz);
  // Ring positions along the tunnel: the first starts 3 inside the hall, per vertex.
  const arcs: number[] = [0];
  for (let a = 12; a < END - 6; a += 12) arcs.push(a);
  arcs.push(END);
  const rings: V3[][] = arcs.map((a, ri) => {
    const f = at(a);
    return loop.map(([s, h]) => {
      let x = f.x + f.rx * s;
      let z = f.z + f.rz * s;
      let y = f.y + h;
      if (ri === 0) {
        // Walk back along the axis until the point is 3 inside the hall.
        let t = 0;
        while (inHallBy(x - f.dx * t, z - f.dz * t) < 3 && t < 60) t += 0.5;
        x -= f.dx * t;
        z -= f.dz * t;
      } else if (ri > 1 && ri < arcs.length - 2 && h > 1) {
        const n = vnoise(x * 0.09, y * 0.09, z * 0.09) * 1.5;
        const cx = f.x - x;
        const cy = f.y + 12 - y;
        const cz = f.z - z;
        const dl = Math.hypot(cx, cy, cz) || 1;
        x += (cx / dl) * n;
        y += (cy / dl) * n;
        z += (cz / dl) * n;
      }
      return [x, y, z] as V3;
    });
  });
  for (let r = 0; r < rings.length - 1; r++) {
    const f = at((arcs[r] + arcs[r + 1]) / 2);
    const ins: V3 = [f.x, f.y + 13, f.z];
    for (let k = 0; k < loop.length; k++) {
      const k2 = (k + 1) % loop.length;
      const a = rings[r][k];
      const floor = loop[k][1] === 0 && loop[k2][1] === 0;
      const col = floor ? rockAt(a[0], a[1], a[2], [0.27, 0.25, 0.23], 1, 0.04) : rockAt(a[0], a[1], a[2], [0.36, 0.33, 0.3]);
      quadIn(b, a, rings[r][k2], rings[r + 1][k2], rings[r + 1][k], col, ins);
    }
  }
  // Timber sets every 12, clear of both ends.
  for (let a = 18; a < L - 22; a += 12) {
    const f = at(a);
    for (const s of [-10.3, 10.3]) b.beam(f.x + f.rx * s, f.y, f.z + f.rz * s, f.x + f.rx * s, f.y + 18.4, f.z + f.rz * s, 1.5, 1.5, C.wood);
    b.beam(f.x - f.rx * 11.2, f.y + 19, f.z - f.rz * 11.2, f.x + f.rx * 11.2, f.y + 19, f.z + f.rz * 11.2, 1.6, 1.7, C.woodDark);
  }
  // v6: no rails. Two torches, alternate walls (the passage is ~90 long and
  // the daylight at its far end does the rest).
  const TORCH_AT = [22, L * 0.55];
  TORCH_AT.forEach((a, k) => {
    const f = at(a);
    const sg = k % 2 ? -1 : 1;
    torch(m, b, f.x + f.rx * sg * 11.6, f.y + 15, f.z + f.rz * sg * 11.6, -f.rx * sg, -f.rz * sg);
  });
}

/**
 * v6: the side passage's opening on the cliff face, from outside (build
 * frame): rock blocks round the arch over the terrain cut's jagged edge, as
 * round the mouth.
 */
function buildExitFrame(m: MineParts): void {
  const b = m.tunnel;
  const e = TUNNEL[TUNNEL.length - 1];
  const q = TUNNEL[TUNNEL.length - 2];
  const l = Math.hypot(e[0] - q[0], e[2] - q[2]);
  const dx = (e[0] - q[0]) / l;
  const dz = (e[2] - q[2]) / l;
  // The face: a few units back from the passage's end.
  const fx = e[0] - dx * 7;
  const fz = e[2] - dz * 7;
  const rx = -dz;
  const rz = dx;
  for (let h = 4; h <= 30; h += 8.5) {
    for (const sg of [-1, 1]) {
      const r = 7 + rnd(h, 71 + sg) * 3;
      const o = TUNNEL_HALF_W + 4 + rnd(h, 73 + sg) * 2;
      b.add(U.dode, T(fx + rx * o * sg, e[1] + h, fz + rz * o * sg, r * 0.9, r, 5, h), C.rockDark);
    }
  }
  for (let s2 = -12; s2 <= 12; s2 += 8) {
    const r = 7 + rnd(s2, 75) * 3;
    b.add(U.dode, T(fx + rx * s2, e[1] + TUNNEL_H + 3 + rnd(s2, 76) * 2, fz + rz * s2, r, r * 0.8, 5, s2), C.rockDark);
  }
}

/** a3: the cave's shells (the hall and the side passage), built in the cave's build frame. */
function buildCaveShells(m: MineParts): void {
  buildCave(m);
  buildTunnel(m);
  buildExitFrame(m);
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
  /** The mine's headframe lamp (lit once place 4 is done). */
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
  const TUNNEL_O = { x: 16, y: 70, z: 1275 };
  const mine: MineParts = {
    cave: new Builder({ x: CAVE.hallX, y: CAVE.floorY, z: CAVE.hallZ }),
    tunnel: new Builder(TUNNEL_O),
  };
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
        buildCaveShells(mine);
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

  // ── The cave: its shells in their own zone, mirrored into the world ──
  const mineZone = new THREE.Group();
  mineZone.name = "Zone_mine";
  mineZone.matrixAutoUpdate = false;
  mineZone.matrix.copy(caveMirrorMatrix());
  root.add(mineZone);
  const mineMesh = (b: Builder, o: { x: number; y: number; z: number }, mat: THREE.Material, name: string) => {
    const mesh = addMesh(mineZone, b.build(), mat, name);
    mesh.position.set(o.x, o.y, o.z);
    return mesh;
  };
  // Source shells for dress-underground.ts (it hides them and draws its own lit copies).
  mineMesh(mine.cave, { x: CAVE.hallX, y: CAVE.floorY, z: CAVE.hallZ }, solid, "Mine_Cave");
  mineMesh(mine.tunnel, TUNNEL_O, solid, "Mine_Tunnel");
  perPlace.mine = Math.round(mine.cave.tris + mine.tunnel.tris);
  /** Where the cave is worth drawing from (world): the gorge round the falls. */
  const MINE_BOX = { x0: -700, x1: 900, z0: 1200, z1: 2300, y1: 950 };

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
    // The mine: from the gorge (its mouth is behind the curtain) to the top of the shaft.
    const mineOn = camPos.x > MINE_BOX.x0 && camPos.x < MINE_BOX.x1 && camPos.z > MINE_BOX.z0 && camPos.z < MINE_BOX.z1 && camPos.y < MINE_BOX.y1;
    if (sky !== skyZone.visible || south !== southZone.visible || meadow !== meadowZone.visible || harbour !== harbourZone.visible || mineOn !== mineZone.visible) {
      skyZone.visible = sky;
      southZone.visible = south;
      meadowZone.visible = meadow;
      harbourZone.visible = harbour;
      mineZone.visible = mineOn;
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
