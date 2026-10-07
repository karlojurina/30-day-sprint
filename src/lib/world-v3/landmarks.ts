import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";

/**
 * The eight landmarks, rebuilt as stylised models in code.
 *
 * The glb's LM_* primitives (and their children) are removed and each model
 * is added to ctx.root under the SAME name, so the scene's landmark index,
 * the markers and the park solver find it exactly as before.
 *
 * HOW A MODEL IS MADE. Every part (box, cylinder, cone, extruded profile) is
 * built in the landmark's local frame with WORLD heights, given one flat
 * colour, and merged into ONE mesh per landmark with vertex colours. So a
 * landmark costs one draw call however many parts it has; its palette is two
 * or three colours with one warm accent. After merging, two passes run on the
 * colours: a contact darkening near the ground under each vertex (grounds the
 * model the way ambient occlusion would) and a vertical gradient over the
 * whole model (darker base, lighter top: the Firewatch silhouette read).
 *
 * The only other meshes: the lighthouse lantern (the one glowing surface,
 * material LM_LighthouseLampMat so the scene's emissive strip keeps it) and
 * the windmill sails (LM_WindmillSails, turned by update()).
 *
 * TWO PLACEMENTS DIFFER FROM THE GLB, on purpose:
 *   Bridge: the glb slab stood at x -47..48, z 244; the river channel there is
 *     centred on x 64.8, so the old bridge never crossed the water. The new
 *     one is centred on the river (riverXAtZ) and turned square to its flow.
 *   Jetty: the glb ran it straight away from the rail camera (end-on). It now
 *     leaves the pond's north-east shore at 30 degrees, so it reads side-on;
 *     its tip is still the glb's point.
 * Everything else stands on its glb base.
 */

// ── Palette (sRGB hex; THREE.Color converts to linear) ──────────────────────

const STONE_DARK = 0x857a6a;
const STONE_WARM = 0xb39570;
const STONE_PALE = 0xdcc9a3;
const LIMESTONE = 0xb8a68a;
const WHITEWASH = 0xebe1cc;
const TERRACOTTA = 0xb4502e;
const ROOF_RED = 0xa8402a;
const IRON = 0x3a302c;
const TIMBER_DARK = 0x5a3f2e;
const TIMBER = 0x8a6445;
const TIMBER_LIGHT = 0xb68c5e;
const GLASS = 0x2c323c;
const BRICK = 0x8c5444;
const GOLD = 0xe0ac4c;
/** Darker than the plinth so the shaft stands out against the pale summit sky. */
const OBELISK_SHAFT = 0x9c8a72;
const BOAT = 0xc0502c;
const CREAM = 0xe4d7b9;

/** Rotation speed of the windmill sails, rad/s. */
const SAIL_SPEED = 0.3;
/** Beyond this distance the sails are a few pixels in the haze: they stop turning, and the loop can sleep. */
const SAIL_ANIM_DIST = 1300;
/** Emissive strength of the lantern. scene.ts clamps LM_LighthouseLampMat to 0.6 anyway. */
const LAMP_GLOW = 0.6;
/** Tower landmarks are drawn at a base size and scaled to read at 25-40% of a parked frame. */
const LIGHTHOUSE_SCALE = 1.18;
const WINDMILL_SCALE = 1.2;
/** Pond surface when the Pond mesh is gone (glb: 82). */
const POND_LEVEL_FALLBACK = 82;

const NAMES = [
  "LM_Lighthouse",
  "LM_Windmill",
  "LM_Bridge",
  "LM_Viaduct",
  "LM_Watchtower",
  "LM_Cairn",
  "LM_Jetty",
  "LM_Obelisk",
] as const;
type LmName = (typeof NAMES)[number];

// ── Small geometry kit ──────────────────────────────────────────────────────

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Move/rotate/scale a geometry in place and return it. */
function at(
  g: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  ry = 0,
  rx = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    V(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")),
    V(sx, sy, sz),
  );
  g.applyMatrix4(m);
  return g;
}

/** A square-section beam from a to b. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d = w): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
  return g;
}

/** A box whose bottom face is (wB x dB) and top face (wT x dT), centred on x/z, from y0 to y1. */
function frustum(wT: number, dT: number, wB: number, dB: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wT : wB), top ? y1 : y0, p.getZ(i) * (top ? dT : dB));
  }
  return g;
}

/** Extrude a closed outline in the XY plane along z, centred on z = zc. */
function extrude(pts: Array<[number, number]>, depth: number, zc = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, zc - depth / 2);
  return g;
}

/** Half ring (an arch's voussoirs) centred at (cx, cy), from angle 0 to PI, in the XY plane. */
function archRing(cx: number, cy: number, r0: number, r1: number, depth: number, seg = 14): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= seg; i++) {
    const a = (Math.PI * i) / seg;
    pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
  }
  for (let i = seg; i >= 0; i--) {
    const a = (Math.PI * i) / seg;
    pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
  }
  return extrude(pts, depth);
}

/** A rough flat stone: a squashed, jittered icosahedron. */
function slab(rng: () => number, rx: number, ry: number, rz: number, rough = 0.18): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  // Jitter per unique position so shared corners stay shared (no cracks).
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let j = seen.get(key);
    if (!j) {
      j = [1 + (rng() * 2 - 1) * rough, 1 + (rng() * 2 - 1) * rough * 0.6, 1 + (rng() * 2 - 1) * rough];
      seen.set(key, j);
    }
    // Flatten the top and bottom so stones stack.
    const y = Math.max(-0.72, Math.min(0.72, p.getY(i)));
    p.setXYZ(i, p.getX(i) * rx * j[0], y * ry * j[1], p.getZ(i) * rz * j[2]);
  }
  return g;
}

interface PartOpts {
  /** Brightness jitter, +-share. */
  jitter?: number;
  /** Recompute normals per face (faceted look). */
  flat?: boolean;
}

/** Collects coloured parts for one mesh. */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private xf: THREE.Matrix4 | null = null;
  constructor(private readonly rng: () => number) {}

  /** Every part added from now on is scaled by s about the local point (0, y0, 0). */
  scaleAbout(y0: number, s: number): void {
    this.xf = new THREE.Matrix4()
      .makeTranslation(0, y0, 0)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(0, -y0, 0));
  }

  add(g: THREE.BufferGeometry, hex: number, o: PartOpts = {}): void {
    let geo = g;
    if (geo.index) {
      geo = g.toNonIndexed();
      g.dispose();
    }
    if (this.xf) geo.applyMatrix4(this.xf);
    for (const name of Object.keys(geo.attributes)) {
      if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    }
    if (o.flat || !geo.getAttribute("normal")) geo.computeVertexNormals();
    geo.clearGroups();
    const c = new THREE.Color(hex);
    const k = 1 + (this.rng() * 2 - 1) * (o.jitter ?? 0.05);
    const n = geo.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(geo);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!g) throw new Error("[world-v3] landmarks: merge failed");
    return g;
  }
}

/** Where a landmark stands: local frame (x, z rotated by yaw about the origin), WORLD heights. */
class Site {
  readonly cos: number;
  readonly sin: number;
  constructor(
    readonly ctx: WorldCtx,
    readonly ox: number,
    readonly oz: number,
    readonly yaw: number,
  ) {
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }
  wx(lx: number, lz: number): number {
    return this.ox + this.cos * lx + this.sin * lz;
  }
  wz(lx: number, lz: number): number {
    return this.oz - this.sin * lx + this.cos * lz;
  }
  /** World ground height under a local point. */
  g(lx: number, lz: number): number {
    return this.ctx.heightAt(this.wx(lx, lz), this.wz(lx, lz));
  }
  /** Lowest and highest ground within a local disc. */
  range(lx: number, lz: number, r: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let rr = 0; rr <= r; rr += Math.max(0.5, r / 4)) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const h = this.g(lx + Math.cos(a) * rr, lz + Math.sin(a) * rr);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    return [lo, hi];
  }
}

/**
 * Colour passes on a merged, local-frame, world-height geometry: contact
 * darkening within `aoH` of the ground under each vertex, then a vertical
 * gradient from `bot` (lowest vertex) to `top` (highest).
 */
function shade(g: THREE.BufferGeometry, site: Site | null, aoH = 5, aoMin = 0.62, bot = 0.84, top = 1.06): void {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const c = g.getAttribute("color") as THREE.BufferAttribute;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
  }
  const span = Math.max(1e-3, y1 - y0);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    let f = bot + (top - bot) * ((y - y0) / span);
    if (site) {
      const h = (y - site.g(p.getX(i), p.getZ(i))) / aoH;
      const s = Math.min(1, Math.max(0, h));
      f *= aoMin + (1 - aoMin) * s * s * (3 - 2 * s);
    }
    c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f);
  }
  c.needsUpdate = true;
}

// ── The models ──────────────────────────────────────────────────────────────

interface Built {
  site: Site;
  /** World height the root sits at (ground under the origin). */
  oy: number;
  body: Kit;
  /** Extra meshes, each with its own kit, name and material role. */
  extras: Array<{ name: string; kit: Kit; role: "body" | "lamp"; pos?: THREE.Vector3; rot?: THREE.Euler; ao?: boolean }>;
}

function lighthouse(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  // Door and stripes face the shore camera (a1 stands to the south, +z).
  const site = new Site(ctx, base.x, base.z, 0.15);
  const k = new Kit(rng);
  const lamp = new Kit(rng);
  const [gLo, gHi] = site.range(0, 0, 10);
  const oy = site.g(0, 0);

  // Rock plinth the tower stands on, dug into the slope.
  const pTop = gHi + 1.6;
  k.add(at(new THREE.CylinderGeometry(8.6, 10.2, pTop - (gLo - 2), 10), 0, (pTop + gLo - 2) / 2, 0), STONE_DARK, { flat: true });
  k.add(at(new THREE.CylinderGeometry(7.4, 8.0, 0.8, 20), 0, pTop + 0.4, 0), STONE_PALE);
  // Boulders round the foot.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng() * 0.4;
    const r = 9.5 + rng() * 3;
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    const s = 1.6 + rng() * 2.2;
    k.add(at(slab(rng, s * 1.3, s, s * 1.1, 0.25), lx, site.g(lx, lz) + s * 0.25, lz, rng() * 6), STONE_DARK, { flat: true, jitter: 0.1 });
  }

  // Everything above the plinth is drawn at 1 and scaled up about its top.
  k.scaleAbout(pTop, LIGHTHOUSE_SCALE);
  lamp.scaleAbout(pTop, LIGHTHOUSE_SCALE);
  // Tapered tower in five bands: white, terracotta, white, terracotta, white.
  const t0 = pTop + 0.8;
  const H = 40;
  const rB = 6.0;
  const rT = 4.1;
  const rAt = (f: number) => rB + (rT - rB) * f;
  const bands: Array<[number, number, number]> = [
    [0, 0.22, WHITEWASH],
    [0.22, 0.38, TERRACOTTA],
    [0.38, 0.6, WHITEWASH],
    [0.6, 0.76, TERRACOTTA],
    [0.76, 1, WHITEWASH],
  ];
  for (const [f0, f1, col] of bands) {
    const h = (f1 - f0) * H;
    k.add(at(new THREE.CylinderGeometry(rAt(f1), rAt(f0), h, 24, 1, true), 0, t0 + (f0 * H + f1 * H) / 2, 0), col, { jitter: 0.02 });
  }
  // Door and two windows on the camera side.
  k.add(at(new THREE.BoxGeometry(2.4, 4.2, 1.2), 0, t0 + 2.1, rAt(0.05) - 0.3), IRON);
  k.add(at(new THREE.BoxGeometry(1.3, 2.0, 1.0), 0, t0 + H * 0.48, rAt(0.48) - 0.25), IRON);
  k.add(at(new THREE.BoxGeometry(1.2, 1.8, 1.0), 0, t0 + H * 0.86, rAt(0.86) - 0.25), IRON);

  // Gallery: corbelled deck, railing.
  const gY = t0 + H;
  k.add(at(new THREE.CylinderGeometry(6.2, rT, 1.4, 24), 0, gY + 0.2, 0), WHITEWASH);
  k.add(at(new THREE.CylinderGeometry(6.3, 6.3, 0.5, 24), 0, gY + 1.15, 0), IRON);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    k.add(at(new THREE.BoxGeometry(0.25, 1.9, 0.25), Math.cos(a) * 5.9, gY + 2.3, Math.sin(a) * 5.9), IRON);
  }
  k.add(at(new THREE.TorusGeometry(5.9, 0.16, 4, 36), 0, gY + 3.25, 0, 0, Math.PI / 2), IRON);

  // Lantern room: white base, glowing glass, iron mullions, red cap.
  k.add(at(new THREE.CylinderGeometry(3.6, 3.8, 1.6, 16), 0, gY + 2.2, 0), WHITEWASH);
  lamp.add(at(new THREE.CylinderGeometry(3.1, 3.1, 4.4, 12), 0, gY + 5.2, 0), 0xffd58a);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.add(at(new THREE.BoxGeometry(0.35, 4.4, 0.35), Math.cos(a) * 3.2, gY + 5.2, Math.sin(a) * 3.2), IRON);
  }
  k.add(at(new THREE.CylinderGeometry(3.7, 3.7, 0.5, 16), 0, gY + 7.6, 0), IRON);
  k.add(at(new THREE.ConeGeometry(4.2, 4.6, 16), 0, gY + 10.1, 0), ROOF_RED);
  k.add(at(new THREE.SphereGeometry(0.7, 8, 6), 0, gY + 12.7, 0), IRON);
  k.add(at(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 4), 0, gY + 14.0, 0), IRON);

  return { site, oy, body: k, extras: [{ name: "LM_LighthouseLamp", kit: lamp, role: "lamp" }] };
}

function windmill(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  // Sails face the a2 camera (south, a little west), turned 25 degrees so they read with depth.
  const site = new Site(ctx, base.x, base.z, -0.12 - 0.44);
  const k = new Kit(rng);
  const sails = new Kit(rng);
  const [gLo, gHi] = site.range(0, 0, 8);
  const oy = site.g(0, 0);

  // Stone terrace the mill stands on; on the downhill side it is a retaining wall.
  const pTop = gHi + 0.8;
  k.add(at(new THREE.CylinderGeometry(8.2, 9.4, pTop - (gLo - 2), 8), 0, (pTop + gLo - 2) / 2, 0, Math.PI / 8), STONE_DARK, { flat: true });
  k.add(at(new THREE.CylinderGeometry(8.5, 8.5, 0.6, 8), 0, pTop + 0.3, 0, Math.PI / 8), STONE_PALE, { flat: true });

  k.scaleAbout(pTop, WINDMILL_SCALE);
  sails.scaleAbout(0, WINDMILL_SCALE);
  // Tapered whitewashed tower.
  const t0 = pTop + 0.6;
  const H = 27;
  const rB = 6.0;
  const rT = 4.2;
  const rAt = (f: number) => rB + (rT - rB) * f;
  k.add(at(new THREE.CylinderGeometry(rT, rB, H, 20, 1, true), 0, t0 + H / 2, 0), WHITEWASH, { jitter: 0.02 });
  // Door, windows (front), a dark curb under the cap.
  k.add(at(new THREE.BoxGeometry(2.6, 4.4, 1.2), 0, t0 + 2.2, rAt(0.08) - 0.3), TIMBER_DARK);
  k.add(at(new THREE.BoxGeometry(1.4, 1.9, 1.0), 0, t0 + H * 0.52, rAt(0.52) - 0.25), GLASS);
  k.add(at(new THREE.BoxGeometry(1.3, 1.8, 1.0), rAt(0.78) * 0.55 - 0.2, t0 + H * 0.78, rAt(0.78) * 0.8, 0.6), GLASS);
  // Reefing stage: a timber balcony at a third of the height.
  const sY = t0 + H * 0.34;
  const sR = rAt(0.34) + 2.2;
  k.add(at(new THREE.CylinderGeometry(sR, sR, 0.5, 20), 0, sY, 0), TIMBER);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.add(at(new THREE.BoxGeometry(0.25, 1.8, 0.25), Math.cos(a) * (sR - 0.2), sY + 1.1, Math.sin(a) * (sR - 0.2)), TIMBER_DARK);
    // Struts under the deck.
    k.add(beam(V(Math.cos(a) * (sR - 0.4), sY - 0.2, Math.sin(a) * (sR - 0.4)), V(Math.cos(a) * rAt(0.25), t0 + H * 0.25, Math.sin(a) * rAt(0.25)), 0.3), TIMBER_DARK);
  }
  k.add(at(new THREE.TorusGeometry(sR - 0.2, 0.14, 4, 32), 0, sY + 2.0, 0, 0, Math.PI / 2), TIMBER_DARK);
  const cY = t0 + H;
  k.add(at(new THREE.CylinderGeometry(rT + 0.5, rT + 0.5, 0.9, 20), 0, cY + 0.45, 0), TIMBER_DARK);
  // Conical cap: the warm accent.
  k.add(at(new THREE.ConeGeometry(5.3, 7.2, 20), 0, cY + 0.9 + 3.6, 0), ROOF_RED);
  k.add(at(new THREE.SphereGeometry(0.7, 8, 6), 0, cY + 8.6, 0), TIMBER_DARK);
  // Fantail-side tail pole (back), and the windshaft housing (front).
  k.add(beam(V(0, cY + 1.2, -rT), V(0, t0 + H * 0.3, -rB - 5), 0.6), TIMBER_DARK);
  k.add(at(new THREE.BoxGeometry(2.2, 2.2, 3.2), 0, cY + 2.4, rT + 0.6, 0, -0.14), TIMBER_DARK);

  // Sails: four lattice sails in the group's XY plane, hub at the origin, axle along +z.
  const L = 21;
  sails.add(at(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 10), 0, 0, 0.6, 0, Math.PI / 2), TIMBER_DARK);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const d = V(Math.cos(a), Math.sin(a), 0);
    const n = V(-Math.sin(a), Math.cos(a), 0);
    const p = (u: number, v: number, z = 0) => d.clone().multiplyScalar(u).addScaledVector(n, v).setZ(z);
    // Stock (whip), then the lattice on its trailing side.
    sails.add(beam(p(-0.5, 0), p(L, 0), 0.75, 0.75), TIMBER_DARK);
    const u0 = 4.2;
    const w = 4.4;
    sails.add(beam(p(u0, w), p(L, w), 0.35, 0.4), TIMBER_LIGHT);
    sails.add(beam(p(u0, -1.1), p(L, -1.1), 0.3, 0.35), TIMBER_LIGHT);
    for (let j = 0; j <= 9; j++) {
      const u = u0 + ((L - u0) * j) / 9;
      sails.add(beam(p(u, -1.1, 0.25), p(u, w, 0.25), 0.28, 0.3), TIMBER_LIGHT);
    }
    for (const v of [1.1, 2.2, 3.3]) sails.add(beam(p(u0, v, -0.2), p(L, v, -0.2), 0.18, 0.2), TIMBER_LIGHT);
  }
  const hub = V(0, pTop + (cY + 2.6 - pTop) * WINDMILL_SCALE, (rT + 2.5) * WINDMILL_SCALE);
  return {
    site,
    oy,
    body: k,
    extras: [{ name: "LM_WindmillSails", kit: sails, role: "body", pos: hub, rot: new THREE.Euler(-0.14, 0, 0), ao: false }],
  };
}

/** Stone road bridge: three round arches, the middle one widest, humped deck. */
function bridge(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  // Centred on the river at the glb's z, square to the river's flow.
  const z0 = base.z;
  let x0 = ctx.riverXAtZ(z0);
  if (!Number.isFinite(x0)) x0 = base.x;
  let tx = ctx.riverXAtZ(z0 - 2) - ctx.riverXAtZ(z0 + 2);
  if (!Number.isFinite(tx)) tx = 0;
  // Flow direction (tx, -4); the span runs perpendicular: (4, tx) normalised.
  const px = 4;
  const pz = tx;
  const site = new Site(ctx, x0, z0, Math.atan2(-pz, px));
  const k = new Kit(rng);
  const oy = site.g(0, 0);
  const W = 10; // roadway width across the span

  // Find the banks: first point either side where the ground is within 6 of its outer level.
  const bankAt = (dir: number) => {
    const outer = site.g(dir * 70, 0);
    for (let s = 0; s <= 70; s += 1) if (site.g(dir * s, 0) >= outer - 6) return dir * s;
    return dir * 50;
  };
  const sW = bankAt(-1) - 8;
  const sE = bankAt(1) + 8;
  const yW = site.g(sW, 0) + 3;
  const yE = site.g(sE, 0) + 3;
  const mid = (sW + sE) / 2;
  const half = (sE - sW) / 2;
  const peak = Math.max(yW, yE) + 5;
  // Hump: quadratic from each end up to the peak at the middle.
  const deck = (s: number) => {
    const f = Math.min(1, Math.abs(s - mid) / half);
    const yEnd = s < mid ? yW : yE;
    return peak - (peak - yEnd) * f * f;
  };

  // Arches: middle over the channel, one each side.
  const spanAll = sE - sW;
  const rMid = Math.min(16, spanAll * 0.16);
  const rSide = rMid * 0.72;
  const pier = 6;
  const arches: Array<{ c: number; r: number; spring: number }> = [];
  for (const [c, r] of [
    [mid - rMid - pier - rSide, rSide],
    [mid, rMid],
    [mid + rMid + pier + rSide, rSide],
  ] as Array<[number, number]>) {
    arches.push({ c, r, spring: deck(c) - 4.2 - r });
  }
  const bottom = Math.min(site.g(mid, 0), oy) - 6;

  // Body: one extruded elevation with the arches cut from its underside.
  const pts: Array<[number, number]> = [[sW, bottom]];
  for (const a of arches) {
    pts.push([a.c - a.r, bottom], [a.c - a.r, a.spring]);
    for (let i = 1; i < 16; i++) {
      const t = Math.PI - (Math.PI * i) / 16;
      pts.push([a.c + Math.cos(t) * a.r, a.spring + Math.sin(t) * a.r]);
    }
    pts.push([a.c + a.r, a.spring], [a.c + a.r, bottom]);
  }
  pts.push([sE, bottom]);
  for (let i = 0; i <= 24; i++) {
    const s = sE - ((sE - sW) * i) / 24;
    pts.push([s, deck(s)]);
  }
  k.add(extrude(pts, W), STONE_WARM, { jitter: 0.03 });

  // Voussoir rings (lighter, proud of both faces) with keystones.
  for (const a of arches) {
    k.add(archRing(a.c, a.spring, a.r, a.r + 2.1, W + 0.6), STONE_PALE, { jitter: 0.02 });
    k.add(at(new THREE.BoxGeometry(1.6, 2.8, W + 0.9), a.c, a.spring + a.r + 1.2, 0), STONE_PALE);
  }
  // Cutwaters on the two piers, both faces.
  for (const sgn of [-1, 1]) {
    const pc = mid + sgn * (rMid + pier / 2);
    const top = arches[1].spring + 1;
    for (const face of [-1, 1]) {
      const tri = extrude(
        [
          [-pier / 2, 0],
          [pier / 2, 0],
          [0, -face * 4.5],
        ].map(([x, y]) => [x, y] as [number, number]),
        top - bottom,
      );
      // Extruded along z; stand it up: XY triangle -> XZ footprint (rotateX(-90) sends y to -z).
      tri.rotateX(-Math.PI / 2);
      tri.translate(pc, bottom + (top - bottom) / 2, face * (W / 2));
      k.add(tri, STONE_WARM, { flat: true });
      const cap = extrude(
        [
          [-pier / 2 - 0.4, 0],
          [pier / 2 + 0.4, 0],
          [0, -face * 5.3],
        ],
        0.9,
      );
      cap.rotateX(-Math.PI / 2);
      cap.translate(pc, top + 0.45, face * (W / 2));
      k.add(cap, STONE_PALE, { flat: true });
    }
  }
  // Parapets and their coping, following the hump.
  for (const face of [-1, 1]) {
    const wall: Array<[number, number]> = [];
    const cap: Array<[number, number]> = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const s = sW + ((sE - sW) * i) / n;
      wall.push([s, deck(s) + 2.6]);
      cap.push([s, deck(s) + 3.2]);
    }
    for (let i = n; i >= 0; i--) {
      const s = sW + ((sE - sW) * i) / n;
      wall.push([s, deck(s) - 0.5]);
      cap.push([s, deck(s) + 2.5]);
    }
    k.add(extrude(wall, 1.1, face * (W / 2 - 0.55)), STONE_WARM);
    k.add(extrude(cap, 1.6, face * (W / 2 - 0.55)), STONE_DARK);
  }
  // End piers (pilasters) where the parapets meet the banks.
  for (const s of [sW + 1.2, sE - 1.2]) {
    for (const face of [-1, 1]) {
      k.add(at(new THREE.BoxGeometry(2.4, deck(s) + 4.4 - (site.g(s, face * W * 0.5) - 1), 2.0), s, (deck(s) + 4.4 + site.g(s, face * W * 0.5) - 1) / 2, face * (W / 2 - 0.4)), STONE_PALE, { flat: true });
    }
  }
  return { site, oy, body: k, extras: [] };
}

/** Brick railway viaduct: eight tall round arches on tapering piers across the gorge. */
function viaduct(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  const z0 = base.z;
  let tx = ctx.riverXAtZ(z0 - 2) - ctx.riverXAtZ(z0 + 2);
  if (!Number.isFinite(tx)) tx = 0;
  const site = new Site(ctx, base.x, z0, Math.atan2(-tx, 4));
  const k = new Kit(rng);
  const oy = site.g(0, 0);

  const n = 8;
  const a = 13; // arch span
  const p = 5; // pier width at the top
  const D = 8; // deck width
  const L = n * a + (n + 1) * p;
  const s0 = -L / 2 + 4; // shifted a little east, onto the rising bank
  const deckY = 60;
  const r = a / 2;
  const spring = deckY - 3.2 - r;

  // Piers, tapering toward the top, from below the ground to the springline.
  for (let i = 0; i <= n; i++) {
    const c = s0 + p / 2 + i * (a + p);
    const end = i === 0 || i === n;
    const [gLo] = site.range(c, 0, p);
    const y0 = gLo - 3;
    const h = spring - y0;
    const wT = end ? p + 2 : p;
    const g = frustum(wT, D, wT + 0.07 * h, D + 0.1 * h, y0, spring);
    g.translate(c, 0, 0);
    k.add(g, BRICK, { flat: true, jitter: 0.04 });
    // Impost band at the springline.
    k.add(at(new THREE.BoxGeometry(wT + 1.0, 0.9, D + 0.9), c, spring - 0.2, 0), STONE_PALE);
  }
  // Spandrel wall: from the springline to the deck, arches cut out.
  const pts: Array<[number, number]> = [[s0, spring]];
  for (let i = 0; i < n; i++) {
    const c = s0 + p + r + i * (a + p);
    pts.push([c - r, spring]);
    for (let j = 1; j < 14; j++) {
      const t = Math.PI - (Math.PI * j) / 14;
      pts.push([c + Math.cos(t) * r, spring + Math.sin(t) * r]);
    }
    pts.push([c + r, spring]);
  }
  pts.push([s0 + L, spring], [s0 + L, deckY], [s0, deckY]);
  k.add(extrude(pts, D), BRICK, { jitter: 0.03 });
  for (let i = 0; i < n; i++) {
    const c = s0 + p + r + i * (a + p);
    k.add(archRing(c, spring, r, r + 1.5, D + 0.5, 12), STONE_PALE, { jitter: 0.02 });
  }
  // Cornice, parapets, coping.
  k.add(at(new THREE.BoxGeometry(L + 1.2, 1.1, D + 1.6), s0 + L / 2, deckY + 0.35, 0), STONE_PALE);
  for (const face of [-1, 1]) {
    k.add(at(new THREE.BoxGeometry(L, 2.2, 0.9), s0 + L / 2, deckY + 2.0, face * (D / 2 + 0.25)), BRICK);
    k.add(at(new THREE.BoxGeometry(L + 0.4, 0.5, 1.3), s0 + L / 2, deckY + 3.3, face * (D / 2 + 0.25)), STONE_DARK);
  }
  return { site, oy, body: k, extras: [] };
}

/** Fire lookout: splayed timber legs, cross-braced, stairs, a cabin with a red hip roof. */
function watchtower(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  const site = new Site(ctx, base.x, base.z, 0.12);
  const k = new Kit(rng);
  const oy = site.g(0, 0);
  const bH = 10.5; // half-width at the foot
  const tH = 6.0; // half-width at the platform
  const topY = oy + 36;
  const levels = [0, 0.3, 0.58, 0.8, 1];
  const corner = (cx: number, cz: number, f: number): THREE.Vector3 => {
    const h = bH + (tH - bH) * f;
    const lx = cx * h;
    const lz = cz * h;
    const g0 = site.g(cx * bH, cz * bH);
    return V(lx, g0 + (topY - g0) * f, lz);
  };
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  // Footings and legs.
  for (const [cx, cz] of corners) {
    const g0 = site.g(cx * bH, cz * bH);
    k.add(at(new THREE.BoxGeometry(2.6, 2.4, 2.6), cx * bH, g0 + 0.2, cz * bH), STONE_DARK);
    k.add(beam(corner(cx, cz, 0), corner(cx, cz, 1).add(V(0, 0.6, 0)), 1.1), TIMBER_DARK);
  }
  // Girts at each level and X braces between levels, all four faces.
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e];
    const [bx, bz] = corners[(e + 1) % 4];
    for (let l = 1; l < levels.length; l++) {
      const f0 = levels[l - 1];
      const f1 = levels[l];
      k.add(beam(corner(ax, az, f1), corner(bx, bz, f1), 0.55), TIMBER_DARK);
      k.add(beam(corner(ax, az, f0), corner(bx, bz, f1), 0.4), TIMBER);
      k.add(beam(corner(bx, bz, f0), corner(ax, az, f1), 0.4), TIMBER);
    }
  }
  // Stairs: flights zig-zagging up inside the frame between the levels.
  for (let l = 0; l < levels.length - 1; l++) {
    const fA = levels[l];
    const fB = levels[l + 1];
    const yA = oy + (topY - oy) * fA;
    const yB = oy + (topY - oy) * fB;
    const hw = (bH + (tH - bH) * fB) * 0.55;
    const side = l % 2 === 0 ? 1 : -1;
    const a = V(-side * hw, yA + 0.4, 0.8);
    const b = V(side * hw, yB - 0.2, 0.8);
    k.add(beam(a, b, 0.35, 2.2), TIMBER, { flat: true });
    k.add(at(new THREE.BoxGeometry(3.0, 0.35, 2.6), b.x, yB - 0.25, 0.8), TIMBER);
    // Handrail on the open side.
    k.add(beam(a.clone().add(V(0, 2, 1.1)), b.clone().add(V(0, 2, 1.1)), 0.18), TIMBER_DARK);
  }

  // Platform, railing and cabin, drawn at 1 and scaled about the platform.
  k.scaleAbout(topY, 1.15);
  const pH = 7.2;
  k.add(at(new THREE.BoxGeometry(pH * 2, 0.9, pH * 2), 0, topY + 0.9, 0), TIMBER);
  for (let i = -3; i <= 3; i++) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const t = (i / 3) * (pH - 0.3);
      const x = dx !== 0 ? dx * (pH - 0.3) : t;
      const z = dz !== 0 ? dz * (pH - 0.3) : t;
      k.add(at(new THREE.BoxGeometry(0.28, 2.2, 0.28), x, topY + 2.4, z), TIMBER_DARK);
    }
  }
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const len = pH * 2;
    k.add(at(new THREE.BoxGeometry(dz !== 0 ? len : 0.3, 0.3, dx !== 0 ? len : 0.3), dx * (pH - 0.3), topY + 3.5, dz * (pH - 0.3)), TIMBER_DARK);
    k.add(at(new THREE.BoxGeometry(dz !== 0 ? len : 0.2, 0.2, dx !== 0 ? len : 0.2), dx * (pH - 0.3), topY + 2.3, dz * (pH - 0.3)), TIMBER_DARK);
  }

  // Cabin: timber walls, a band of windows all round, a hip roof in red.
  const cW = 5.0;
  const c0 = topY + 1.35;
  k.add(at(new THREE.BoxGeometry(cW * 2, 2.2, cW * 2), 0, c0 + 1.1, 0), TIMBER_LIGHT);
  k.add(at(new THREE.BoxGeometry(cW * 2 + 0.2, 2.6, cW * 2 + 0.2), 0, c0 + 3.5, 0), GLASS);
  for (let i = -2; i <= 2; i++) {
    const t = (i / 2) * (cW - 0.1);
    for (const [x, z] of [
      [t, cW + 0.1],
      [t, -cW - 0.1],
      [cW + 0.1, t],
      [-cW - 0.1, t],
    ]) {
      k.add(at(new THREE.BoxGeometry(0.4, 2.6, 0.4), x, c0 + 3.5, z), TIMBER_LIGHT);
    }
  }
  k.add(at(new THREE.BoxGeometry(cW * 2 + 0.4, 0.7, cW * 2 + 0.4), 0, c0 + 5.15, 0), TIMBER_LIGHT);
  k.add(at(new THREE.ConeGeometry(cW * 1.62, 4.6, 4, 1), 0, c0 + 5.5 + 2.3, 0, Math.PI / 4), ROOF_RED, { flat: true });
  k.add(at(new THREE.BoxGeometry(0.5, 1.6, 0.5), 0, c0 + 10.2, 0), TIMBER_DARK);
  return { site, oy, body: k, extras: [] };
}

/** Cairn: irregular flat stones stacked high on a rubble base, a red pennant line to a post. */
function cairn(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  const site = new Site(ctx, base.x, base.z, 0.05);
  const k = new Kit(rng);
  const oy = site.g(0, 0);
  // Light and dark stones alternate up the stack so each reads as its own stone.
  // Darker than they look in isolation: the scene's warm fill lifts them.
  const shades = [0x8e8574, 0x4a4641, 0x7d7566, 0x57524b, 0x5a5f48];

  // Rubble base.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng() * 0.5;
    const r = 6.5 + rng() * 6;
    const lx = Math.cos(a) * r;
    const lz = Math.sin(a) * r;
    const s = 2.5 + rng() * 2.7;
    k.add(at(slab(rng, s * 1.3, s * 0.8, s * 1.1, 0.25), lx, site.g(lx, lz) + s * 0.2, lz, rng() * 6), shades[i % 5], { flat: true, jitter: 0.08 });
  }
  // The stack: big to small, each a little off centre and turned.
  const [, gHi] = site.range(0, 0, 7);
  let y = gHi - 0.8;
  let ox = 0;
  let oz = 0;
  const stones = 11;
  for (let i = 0; i < stones; i++) {
    const f = i / (stones - 1);
    const rad = 10.2 - 7 * f + (rng() - 0.5) * 1.0;
    const th = 2.9 + rng() * 1.6 - f * 0.5;
    ox += (rng() - 0.5) * 1.6;
    oz += (rng() - 0.5) * 1.6;
    const half = th * 0.72;
    k.add(at(slab(rng, rad, th, rad * (0.75 + rng() * 0.2), 0.14), ox, y + half, oz, rng() * 6, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12), shades[i % 2 === 0 ? (i % 4 === 0 ? 0 : 2) : i % 3 === 0 ? 4 : i % 4 === 1 ? 1 : 3], { flat: true, jitter: 0.07 });
    y += half * 1.75;
  }
  // Marker stick on top with a pennant line down to a leaning post: the warm accent.
  // The post stands off to the side, so the line reads across the frame, not down the stack.
  const topP = V(ox, y + 4.5, oz);
  k.add(beam(V(ox, y - 1.5, oz), topP, 0.45), TIMBER_DARK);
  const postL = V(24, 0, -3);
  const pg = site.g(postL.x, postL.z);
  const postTop = V(postL.x, pg + 12, postL.z);
  k.add(beam(V(postL.x, pg - 1, postL.z), postTop, 0.55), TIMBER_DARK);
  const flags = 9;
  let prev = topP.clone();
  for (let i = 1; i <= flags + 1; i++) {
    const t = i / (flags + 1);
    const q = topP.clone().lerp(postTop, t);
    q.y -= Math.sin(Math.PI * t) * 3.6;
    k.add(beam(prev, q, 0.14), IRON);
    if (i <= flags) {
      const dir = q.clone().sub(prev).normalize();
      const flag = extrude(
        [
          [-1.2, 0],
          [1.2, 0],
          [0, -2.9],
        ],
        0.15,
      );
      const qa = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), V(dir.x, 0, dir.z).normalize());
      flag.applyQuaternion(qa);
      flag.translate(q.x, q.y, q.z);
      k.add(flag, i % 2 ? TERRACOTTA : CREAM, { jitter: 0.03 });
    }
    prev = q;
  }
  // Two small companion stacks.
  for (const [lx, lz, n0] of [
    [-16, 7, 4],
    [13, -11, 3],
  ] as Array<[number, number, number]>) {
    let yy = site.g(lx, lz) - 0.3;
    for (let i = 0; i < n0; i++) {
      const rad = 3.2 - i * 0.6;
      const th = 1.5;
      k.add(at(slab(rng, rad, th, rad * 0.85, 0.15), lx + (rng() - 0.5) * 0.5, yy + th * 0.7, lz, rng() * 6), shades[(i + n0) % 5], { flat: true });
      yy += th * 1.25;
    }
  }
  return { site, oy, body: k, extras: [] };
}

/** Timber jetty on posts from the pond's north-east shore, a boathouse, a red rowing boat. */
function jetty(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  const pond = ctx.root.getObjectByName("Pond");
  let water = POND_LEVEL_FALLBACK;
  if (pond) {
    const b = new THREE.Box3().setFromObject(pond);
    if (!b.isEmpty()) water = b.max.y;
  }
  // Local +x runs from the tip (origin, the glb point) to the shore, 30 degrees north of east.
  const site = new Site(ctx, base.x, base.z, -Math.PI / 6);
  const k = new Kit(rng);
  const oy = site.g(0, 0);
  let shore = 20;
  for (let s = 0; s < 60; s += 0.5) {
    if (site.g(s, 0) > water + 0.4) {
      shore = s;
      break;
    }
  }
  const x0 = -14;
  const deckY = water + 2.6;
  // The deck runs until the bank comes up to meet it.
  let x1 = shore + 8;
  for (let s = shore; s < shore + 20; s += 0.5) {
    if (site.g(s, 0) >= deckY - 0.3) {
      x1 = s + 1;
      break;
    }
  }
  const hw = 3.6;

  // Planks across the pier, with gaps.
  const pitch = 1.45;
  for (let s = x0; s < x1; s += pitch) {
    k.add(at(new THREE.BoxGeometry(1.2, 0.4, hw * 2 + (rng() - 0.5) * 0.4), s + 0.6, deckY, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.03), TIMBER_LIGHT, { jitter: 0.1 });
  }
  // Stringers and posts down to the bed (or the bank).
  for (const z of [-hw + 0.4, hw - 0.4]) k.add(at(new THREE.BoxGeometry(x1 - x0, 0.6, 0.5), (x0 + x1) / 2, deckY - 0.5, z), TIMBER_DARK);
  for (let s = x0 + 0.4; s <= x1; s += 5) {
    for (const z of [-hw - 0.1, hw + 0.1]) {
      const g0 = site.g(s, z) - 1.5;
      const top = deckY + (s < x0 + 1 ? 2.2 : 0.5);
      k.add(at(new THREE.CylinderGeometry(0.55, 0.62, top - g0, 6), s, (top + g0) / 2, z), TIMBER_DARK, { flat: true });
    }
  }
  // A lantern pole at the tip (unlit: only the lighthouse glows).
  {
    const g0 = site.g(x0 + 1.2, -hw + 0.8) - 1.5;
    k.add(at(new THREE.CylinderGeometry(0.3, 0.36, deckY + 7 - g0, 6), x0 + 1.2, (deckY + 7 + g0) / 2, -hw + 0.8), TIMBER_DARK, { flat: true });
    k.add(beam(V(x0 + 1.2, deckY + 6.6, -hw + 0.8), V(x0 + 1.2, deckY + 6.6, -hw + 2.6), 0.25), TIMBER_DARK);
    k.add(at(new THREE.BoxGeometry(0.9, 1.3, 0.9), x0 + 1.2, deckY + 5.6, -hw + 2.6), IRON);
  }

  // Boathouse on the bank at the shore end, beside the pier.
  const hx = shore + 3;
  const hz = -hw - 6;
  const hg = site.range(hx, hz, 5);
  const hy = hg[1] + 0.3;
  k.add(at(new THREE.BoxGeometry(11, hy - hg[0] + 1.5, 8.8), hx, (hy + hg[0] - 1.5) / 2, hz), STONE_DARK, { flat: true });
  k.add(at(new THREE.BoxGeometry(10.2, 6.2, 8), hx, hy + 3.1, hz), TIMBER_LIGHT);
  k.add(at(new THREE.BoxGeometry(2.2, 4.0, 0.3), hx - 2, hy + 2.0, hz + 4.05), TIMBER_DARK);
  k.add(at(new THREE.BoxGeometry(2.0, 1.6, 0.3), hx + 2.6, hy + 3.6, hz + 4.05), GLASS);
  // Gable roof along local x, overhanging.
  const roof = extrude(
    [
      [-5.2, 0],
      [5.2, 0],
      [0, 4.4],
    ],
    11.8,
  );
  roof.rotateY(Math.PI / 2);
  roof.translate(hx, hy + 6.2, hz);
  k.add(roof, ROOF_RED, { flat: true });

  // Rowing boat alongside the tip: the warm accent.
  const bx = x0 + 6.5;
  const bz = hw + 3.4;
  const hull = boatHull(12, 3.5, 1.9);
  for (const g of [hull.outer, hull.inner]) {
    g.rotateY(0.18);
    g.translate(bx, water - 0.6, bz);
  }
  k.add(hull.outer, BOAT, { jitter: 0.02 });
  k.add(hull.inner, CREAM, { jitter: 0.02 });
  for (const u of [-2.2, 1.9]) {
    k.add(at(new THREE.BoxGeometry(0.7, 0.24, 2.9), bx + u * Math.cos(0.18), water + 0.75, bz - u * Math.sin(0.18), 0.18), TIMBER_LIGHT);
  }
  // Rope from the bow to the mooring post.
  k.add(beam(V(x0 + 0.9, deckY + 1.8, hw + 0.2), V(bx - 5.2, water + 1.0, bz - 0.6), 0.14), TIMBER_DARK);
  return { site, oy, body: k, extras: [] };
}

/** A pointed rowing-boat hull: outer skin and an inner skin (flipped), gunwale at y = h. */
function boatHull(len: number, beamW: number, h: number): { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry } {
  const nu = 14;
  const nv = 6;
  const make = (inset: number, flip: boolean) => {
    const pos: number[] = [];
    const pt = (i: number, j: number): [number, number, number] => {
      const u = i / nu; // 0..1 along the length
      const x = (u - 0.5) * len;
      const w = Math.pow(Math.sin(Math.PI * u), 0.55) * (beamW / 2 - inset);
      const sheer = h + Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.6;
      // One sweep round the cross-section: gunwale (-90 deg), keel (0), other gunwale (+90).
      const a = (j / nv - 0.5) * Math.PI;
      const z = Math.sin(a) * w;
      const depth = (sheer - inset) * (1 - Math.pow(Math.abs(Math.sin(a)), 3) * 0.2);
      const y = sheer - Math.cos(a) * depth * Math.pow(Math.sin(Math.PI * u), 0.3);
      return [x, y + inset * 0.2, z];
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = pt(i, j);
        const b = pt(i + 1, j);
        const c = pt(i + 1, j + 1);
        const d = pt(i, j + 1);
        const tri = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
        for (const q of tri) pos.push(...q);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  return { outer: make(0, true), inner: make(0.18, false) };
}

/** Obelisk: stepped plinth, pedestal with cornice, tapered shaft, gilded capstone. */
function obelisk(ctx: WorldCtx, base: { x: number; z: number }, rng: () => number): Built {
  const site = new Site(ctx, base.x, base.z, 0.03);
  const k = new Kit(rng);
  const oy = site.g(0, 0);
  const [gLo, gHi] = site.range(0, 0, 9);
  let y = gHi;
  const steps: Array<[number, number]> = [
    [17, 1.8],
    [13.5, 1.8],
    [10.2, 1.8],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [w, h] = steps[i];
    const y0 = i === 0 ? gLo - 1.5 : y;
    k.add(at(new THREE.BoxGeometry(w, y + h - y0, w), 0, (y0 + y + h) / 2, 0), i === 0 ? STONE_DARK : LIMESTONE, { jitter: 0.03 });
    y += h;
  }
  // Pedestal with a cornice and a base moulding.
  k.add(at(new THREE.BoxGeometry(8.4, 0.8, 8.4), 0, y + 0.4, 0), LIMESTONE);
  k.add(at(new THREE.BoxGeometry(7.2, 5.4, 7.2), 0, y + 0.8 + 2.7, 0), LIMESTONE);
  k.add(at(new THREE.BoxGeometry(8.2, 1.0, 8.2), 0, y + 6.7, 0), LIMESTONE);
  // Inscription panel on the camera side.
  k.add(at(new THREE.BoxGeometry(4.4, 3.0, 0.4), 0, y + 3.6, 3.65), STONE_DARK);
  // Corner blocks on the top step.
  for (const [cx, cz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    k.add(at(new THREE.BoxGeometry(1.6, 1.8, 1.6), cx * 5.8, y - 1.8 + 0.9, cz * 5.8), LIMESTONE);
    k.add(at(new THREE.ConeGeometry(1.2, 1.2, 4, 1), cx * 5.8, y - 1.8 + 2.4, cz * 5.8, Math.PI / 4), GOLD, { flat: true });
  }
  y += 7.2;
  // Tapered shaft (a four-sided frustum) and the capstone.
  const H = 38;
  k.add(frustum(3.5, 3.5, 5.4, 5.4, y, y + H), OBELISK_SHAFT, { flat: true, jitter: 0.02 });
  k.add(at(new THREE.ConeGeometry((3.5 / 2) * Math.SQRT2, 5.6, 4, 1), 0, y + H + 2.8, 0, Math.PI / 4), GOLD, { flat: true });
  return { site, oy, body: k, extras: [] };
}

const BUILDERS: Record<LmName, (ctx: WorldCtx, base: { x: number; z: number }, rng: () => number) => Built> = {
  LM_Lighthouse: lighthouse,
  LM_Windmill: windmill,
  LM_Bridge: bridge,
  LM_Viaduct: viaduct,
  LM_Watchtower: watchtower,
  LM_Cairn: cairn,
  LM_Jetty: jetty,
  LM_Obelisk: obelisk,
};

// ── Install ─────────────────────────────────────────────────────────────────

export const install: InstallFn = (ctx) => {
  const t0 = performance.now();
  const bodyMat = new THREE.MeshStandardMaterial({
    name: "LM_StoneTimberMat",
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    name: "LM_LighthouseLampMat",
    color: 0xffe0a0,
    emissive: new THREE.Color(0xffc466),
    emissiveIntensity: LAMP_GLOW,
    roughness: 0.4,
    metalness: 0,
  });
  const roots: THREE.Object3D[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  let sails = null as THREE.Object3D | null;
  const sailSphere = new THREE.Sphere();

  for (let idx = 0; idx < NAMES.length; idx++) {
    const name = NAMES[idx];
    const base = ctx.landmarks[name];
    // Remove the glb primitive (and its children, e.g. the old lamp and blades).
    for (let guard = 0; guard < 4; guard++) {
      const old = ctx.root.getObjectByName(name);
      if (!old) break;
      old.removeFromParent();
      old.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mm.dispose();
      });
    }
    if (!base) {
      console.warn("[world-v3] landmarks: no base for", name);
      continue;
    }
    const built = BUILDERS[name](ctx, base, mulberry32(1013 + idx * 7919));
    const { site, oy } = built;
    const root = new THREE.Group();
    root.name = name;
    root.position.set(site.ox, oy, site.oz);
    root.rotation.y = site.yaw;

    const bodyGeo = built.body.build();
    shade(bodyGeo, site);
    bodyGeo.translate(0, -oy, 0);
    bodyGeo.computeBoundingBox();
    bodyGeo.computeBoundingSphere();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = name.slice(3) + "Body";
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    geometries.push(bodyGeo);
    triangles += bodyGeo.getAttribute("position").count / 3;

    for (const ex of built.extras) {
      if (ex.kit.empty) continue;
      const g = ex.kit.build();
      if (ex.pos) {
        // Built around its own origin (the sails' hub); placed at pos in the local frame.
        shade(g, null, 1, 1, 0.92, 1.04);
        const holder = new THREE.Group();
        holder.name = ex.name;
        holder.position.set(ex.pos.x, ex.pos.y - oy, ex.pos.z);
        if (ex.rot) holder.rotation.copy(ex.rot);
        const mesh = new THREE.Mesh(g, ex.role === "lamp" ? lampMat : bodyMat);
        mesh.name = ex.name.slice(3) + "Mesh";
        mesh.castShadow = true;
        holder.add(mesh);
        root.add(holder);
        if (ex.name === "LM_WindmillSails") sails = holder;
      } else {
        if (ex.role === "body") shade(g, site);
        g.translate(0, -oy, 0);
        const mesh = new THREE.Mesh(g, ex.role === "lamp" ? lampMat : bodyMat);
        mesh.name = ex.name;
        root.add(mesh);
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      geometries.push(g);
      triangles += g.getAttribute("position").count / 3;
    }
    ctx.root.add(root);
    roots.push(root);
  }
  ctx.root.updateMatrixWorld(true);
  if (sails) {
    sails.getWorldPosition(sailSphere.center);
    sailSphere.radius = 23;
  }
  const buildMs = performance.now() - t0;

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  let angle = 0;
  let animating = false;

  const mod: WorldModule = {
    name: "landmarks",
    update(_time, dt) {
      if (!sails || ctx.reducedMotion) {
        animating = false;
        return false;
      }
      const cam = ctx.camera;
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      const on =
        frustum.intersectsSphere(sailSphere) && cam.position.distanceTo(sailSphere.center) < SAIL_ANIM_DIST;
      animating = on;
      if (!on) return false;
      angle = (angle + SAIL_SPEED * Math.min(Math.max(dt, 0), 0.1)) % (Math.PI * 2);
      sails.rotation.z = angle;
      return true;
    },
    isAnimating() {
      return animating;
    },
    dispose() {
      for (const r of roots) r.removeFromParent();
      for (const g of geometries) g.dispose();
      bodyMat.dispose();
      lampMat.dispose();
      roots.length = 0;
      geometries.length = 0;
      sails = null;
    },
    stats() {
      return { triangles, meshes: geometries.length, landmarks: roots.length, buildMs: +buildMs.toFixed(1) };
    },
  };
  return mod;
};
