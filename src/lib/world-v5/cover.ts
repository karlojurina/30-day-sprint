import * as THREE from "three";
import { PLACES, WORLD } from "./layout";
import { NO_REFLECT_LAYER } from "./light";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { groundY, gridSlope, isWater, rnd, rockAnchors, slopeAt as slopeExact, smooth, trailDistFast as trailDist, railDist } from "./rocks";

/** Cover only needs the gentle-ground test: the drawn grid's slope (cached), exact inside the gorge. */
const slopeAt = (x: number, z: number, e?: number) => (e ? slopeExact(x, z, e) : gridSlope(x, z));

/**
 * V5 look module: ground cover (world_art_bible.md 3.4, 4.3, 5.6, 5.7).
 *
 * One signature plant per place, flooded (Tsushima's rule), plus plain tufts:
 *   a1 the Landing       reeds at the waterline, dune grass on the sand
 *   a2 Base Camp         the flower meadow before the camp: wildflower drifts,
 *                        one colour each (cream, butter, lavender, soft orange,
 *                        cornflower, dusty pink), green tufts between (pass 3)
 *   the rim and gorge    ferns on the gorge floor, round the pool, on low ledges
 *   the collar, shelf    pale dry grass
 *   the meadow walk      tufts, tall grass and scattered pale flowers
 *   a5 the Mirror Lake   golden grass on the shore, reeds at the water's edge
 *   a6 Glowing Forest    the floor in clusters (pass 3): a moss cushion, glowing
 *                        ferns (gfern) and glowcap clumps (gcap) round it, dark
 *                        ferns at the rim; extra clusters along the trail
 *   a7 the Sky Island    pale gold grass
 * Rock groups (rocks.ts rockAnchors) get a ring of tall grass and tufts: big
 * to small round anchors (3.4).
 *
 * Each kind is ONE InstancedMesh (G1 tuft, G2 tall grass, G3 reeds, G4
 * flowers, G5 fern, G6 dome), normalised to height 1 and scaled by the
 * instance. Instances are sorted into CELL-sized cells; when the camera moves,
 * the cells within the kind's fade distance and inside the frustum are copied
 * into the live instance buffer (bible 5.3's compaction, by cell), so a stop
 * draws only what is near it: one call per kind in view, none for the rest.
 *
 * Shader (MeshLambertMaterial + onBeforeCompile, standard chunks kept, so
 * light.ts's fog ramp and grade hook it like any other material):
 *   - wind: two travelling sines in world space, weight by height squared
 *     (the tips move, the roots stay), converted into the instance's local
 *     frame; pinned when reduced motion is on;
 *   - distance fade: the tuft shrinks to its root between fade.x and fade.y
 *     (no alpha, no sub pixel shimmer);
 *   - colour: root to tip from iTip (per instance), root darker and cooler;
 *     flower heads and the moss's glow take iHead; a far gust lifts the tips;
 *   - normals point up and are NOT flipped on back faces, so a blade reads
 *     with the ground under it (5.7).
 * The glowing moss material is tagged userData.lightGlow = "magic": light.ts
 * sets its colour to the live magicGlow level, which the shader reads as the
 * glow's strength (diffuse.r) instead of as a tint.
 */

// ── Kinds: geometry, normalised height 1, root at the origin ─────────────────

type KindId = "tuft" | "tall" | "reeds" | "flower" | "fern" | "moss" | "gfern" | "gcap";

interface KindDef {
  id: KindId;
  /** Shrink-fade between these distances from the camera. */
  fade: [number, number];
  /** Upper bound on live instances (the buffer's size). */
  cap: number;
  glow?: boolean;
}
const KINDS: KindDef[] = [
  { id: "tuft", fade: [520, 950], cap: 5000 },
  { id: "tall", fade: [700, 1250], cap: 4000 },
  { id: "reeds", fade: [800, 1400], cap: 2500 },
  { id: "flower", fade: [700, 1250], cap: 3500 },
  { id: "fern", fade: [380, 720], cap: 2000 },
  { id: "moss", fade: [600, 1150], cap: 1800, glow: true },
  // Pass 3, a6's floor in clusters: glowing ferns (teal frond tips) and
  // glowcap clumps (three caps, the gills lit violet or teal).
  { id: "gfern", fade: [420, 900], cap: 2400, glow: true },
  { id: "gcap", fade: [320, 640], cap: 600, glow: true },
];

/** Builds a kind's triangles: position, up-leaning normal, aT (0 root .. 1 tip), aHead (1 on flower heads). */
class Tri {
  pos: number[] = [];
  nor: number[] = [];
  t: number[] = [];
  head: number[] = [];
  v(x: number, y: number, z: number, t: number, head = 0, lean = 0.25) {
    this.pos.push(x, y, z);
    const l = Math.hypot(x, z) || 1;
    const nx = (x / l) * lean;
    const nz = (z / l) * lean;
    const n = Math.hypot(nx, 1, nz);
    this.nor.push(nx / n, 1 / n, nz / n);
    this.t.push(t);
    this.head.push(head);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(this.t, 1));
    g.setAttribute("aHead", new THREE.Float32BufferAttribute(this.head, 1));
    return g;
  }
}

/** A blade: a thin triangle from the root ring to a tip leaning outward. */
function blade(g: Tri, a: number, r0: number, w: number, rt: number, h: number, head = 0) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Root points either side of the blade's line, tip out along it.
  const px = -sa * w;
  const pz = ca * w;
  g.v(ca * r0 - px, 0, sa * r0 - pz, 0);
  g.v(ca * rt, h, sa * rt, 1, head);
  g.v(ca * r0 + px, 0, sa * r0 + pz, 0);
}

function kindGeometry(id: KindId): THREE.BufferGeometry {
  const g = new Tri();
  let k = 0;
  const r = () => rnd(k++, 901);
  if (id === "tuft" || id === "tall" || id === "flower") {
    const fans = id === "tall" ? 4 : 3;
    const per = id === "flower" ? 2 : 3;
    for (let f = 0; f < fans; f++) {
      const a0 = (f / fans) * Math.PI * 2 + r() * 0.4;
      for (let b = 0; b < per; b++) {
        const a = a0 + (b - (per - 1) / 2) * 0.55;
        const h = (id === "tall" ? 0.78 : 0.62) + r() * (id === "tall" ? 0.22 : 0.38);
        blade(g, a, 0.06 + r() * 0.08, id === "tall" ? 0.045 : 0.07, 0.24 + r() * 0.26, h);
      }
    }
    if (id === "flower") {
      // 4 heads: small tilted diamonds at the top, coloured by iHead.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + r();
        const rr = 0.1 + r() * 0.24;
        const cx = Math.cos(a) * rr;
        const cz = Math.sin(a) * rr;
        const y = 0.7 + r() * 0.28;
        const s = 0.24 + r() * 0.07;
        g.v(cx - s, y, cz, 1, 1, 0);
        g.v(cx, y + s * 0.4, cz + s, 1, 1, 0);
        g.v(cx + s, y, cz, 1, 1, 0);
        g.v(cx - s, y, cz, 1, 1, 0);
        g.v(cx + s, y, cz, 1, 1, 0);
        g.v(cx, y + s * 0.4, cz - s, 1, 1, 0);
      }
    }
  } else if (id === "reeds") {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r() * 0.5;
      blade(g, a, 0.03 + r() * 0.08, 0.035, 0.1 + r() * 0.18, 0.75 + r() * 0.25);
    }
    // Two seed heads: dark spindles near the top of two stems (vertex colour via aHead).
    for (let i = 0; i < 2; i++) {
      const a = r() * Math.PI * 2;
      const cx = Math.cos(a) * 0.1;
      const cz = Math.sin(a) * 0.1;
      const y0 = 0.72 + r() * 0.12;
      const w = 0.045;
      g.v(cx - w, y0, cz, 1, 1, 0);
      g.v(cx, y0 + 0.2, cz, 1, 1, 0);
      g.v(cx + w, y0, cz, 1, 1, 0);
      g.v(cx, y0, cz - w, 1, 1, 0);
      g.v(cx, y0 + 0.2, cz, 1, 1, 0);
      g.v(cx, y0, cz + w, 1, 1, 0);
    }
  } else if (id === "fern" || id === "gfern") {
    // 5 fronds, 4 tris each; height ~0.45 of the width (scale = width).
    // gfern (pass 3): the frond tips glow (aHead ramps up toward the tip).
    const gl = id === "gfern";
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * Math.PI * 2 + r() * 0.5;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const P = (u: number, y: number, s: number, t: number) => [ca * u - sa * s, y, sa * u + ca * s, t] as const;
      const b = P(0.02, 0.02, 0, 0);
      const m = P(0.5, 0.42 + r() * 0.08, 0, 0.8);
      const lft = P(0.42, 0.28, -0.15, 0.6);
      const rgt = P(0.42, 0.28, 0.15, 0.6);
      const t = P(0.92 + r() * 0.1, 0.16, 0, 1);
      const hd = (t: number) => (gl ? (t >= 1 ? 0.95 : t >= 0.8 ? 0.3 : 0) : 0);
      const tri = (p: readonly number[], q: readonly number[], s: readonly number[]) => {
        g.v(p[0], p[1], p[2], p[3], hd(p[3]));
        g.v(q[0], q[1], q[2], q[3], hd(q[3]));
        g.v(s[0], s[1], s[2], s[3], hd(s[3]));
      };
      tri(b, lft, m);
      tri(b, m, rgt);
      tri(m, lft, t);
      tri(m, t, rgt);
    }
  } else if (id === "gcap") {
    // Three mushrooms (a tall one and two short), each a 3 sided stem and a
    // 6 sided cap: dark top, the underside (gills) glowing. ~60 tris.
    const caps: [number, number, number, number][] = [
      [0, 0, 1.0, 0.42],
      [0.42, 0.2, 0.62, 0.3],
      [-0.3, 0.36, 0.48, 0.24],
    ];
    for (const [cx, cz, h, cr] of caps) {
      const sw = cr * 0.22;
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2;
        const a1 = ((i + 1) / 3) * Math.PI * 2;
        g.v(cx + Math.cos(a0) * sw, 0, cz + Math.sin(a0) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a1) * sw, 0, cz + Math.sin(a1) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a0) * sw * 0.8, h * 0.9, cz + Math.sin(a0) * sw * 0.8, 0.6, 0.35, 0);
        g.v(cx + Math.cos(a1) * sw, 0, cz + Math.sin(a1) * sw, 0.2, 0, 0);
        g.v(cx + Math.cos(a1) * sw * 0.8, h * 0.9, cz + Math.sin(a1) * sw * 0.8, 0.6, 0.35, 0);
        g.v(cx + Math.cos(a0) * sw * 0.8, h * 0.9, cz + Math.sin(a0) * sw * 0.8, 0.6, 0.35, 0);
      }
      const rot = r() * 2;
      const rim: number[][] = [];
      for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * Math.PI * 2;
        rim.push([cx + Math.cos(a) * cr, h * 0.86, cz + Math.sin(a) * cr]);
      }
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        // Top (dark, lit by the scene).
        g.v(cx, h * 1.08, cz, 1, 0, 0.5);
        g.v(rim[j][0], rim[j][1], rim[j][2], 0.9, 0, 0.5);
        g.v(rim[i][0], rim[i][1], rim[i][2], 0.9, 0, 0.5);
        // Gills (glowing, brightest at the rim).
        g.v(cx, h * 0.9, cz, 0.8, 0.7, 0);
        g.v(rim[i][0], rim[i][1] - 0.01, rim[i][2], 0.9, 1, 0);
        g.v(rim[j][0], rim[j][1] - 0.01, rim[j][2], 0.9, 1, 0);
      }
    }
  } else {
    // Moss dome: 5 sided, a top, one ring, the ground ring. 15 tris. The top glows (aHead).
    const n = 5;
    const top = [0, 0.55, 0];
    const A: number[][] = [];
    const B: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      A.push([Math.cos(a) * 0.72, 0.3, Math.sin(a) * 0.72]);
      B.push([Math.cos(a + 0.3) * 1.0, 0, Math.sin(a + 0.3) * 1.0]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.v(top[0], top[1], top[2], 1, 1);
      g.v(A[j][0], A[j][1], A[j][2], 0.7, 0.3);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(A[j][0], A[j][1], A[j][2], 0.7, 0.3);
      g.v(B[j][0], B[j][1], B[j][2], 0);
      g.v(A[i][0], A[i][1], A[i][2], 0.7, 0.3);
      g.v(B[j][0], B[j][1], B[j][2], 0);
      g.v(B[i][0], B[i][1], B[i][2], 0);
    }
  }
  const geo = g.geometry();
  geo.computeBoundingSphere();
  return geo;
}

// ── Colours per place (display sRGB) ─────────────────────────────────────────

const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
/** Tip colours; the root is derived (darker, cooler). Flower heads use the place's ground colours; the accent stays with the landmark. */
const TIP = {
  a1: lin(0xa39a68),
  dune: lin(0xb3a574),
  reedA1: lin(0x8d8a58),
  a2: lin(0x86985a),
  gorge: lin(0x5e7446),
  collar: lin(0xb09a68),
  meadow: lin(0x98985e),
  a5: lin(0xbf9a62),
  reedA5: lin(0x7c7650),
  a6: lin(0x2c4640),
  /** Pass 3: the glowing fern's fronds and the glowcaps' tops. */
  a6fern: lin(0x2a4a44),
  a6cap: lin(0x4a3a66),
  a7: lin(0xc4bc98),
};
/** a2's flowers: orange kept 28 degrees or more from the lookout's accent hue (#a8392c; lit by the sun the redder #e07a3a still measured 0.55% of a2 within 15 degrees of it), plus gold and cream. */
/**
 * Pass 3: a2's meadow as wildflower DRIFTS (pass 2 read as orange confetti).
 * Each drift is mostly one colour; the mix across drifts is cream, butter,
 * lavender, soft orange, cornflower and a dusty pink. Every hue stays 20
 * degrees or more from the lookout's red (#a8392c, hue 6).
 */
const DRIFT_A2: [THREE.Color, number][] = [
  [lin(0xeee6cf), 3],
  [lin(0xe4c35a), 3],
  [lin(0xa48fd0), 2],
  [lin(0xe0954a), 2],
  [lin(0x86a2d6), 1],
  [lin(0xd490aa), 1],
];
const driftColour = (r: number): THREE.Color => {
  const tot = DRIFT_A2.reduce((s, d) => s + d[1], 0);
  let t = r * tot;
  for (const [c, w] of DRIFT_A2) {
    if (t < w) return c;
    t -= w;
  }
  return DRIFT_A2[0][0];
};
const FLOWERS_MEADOW = [lin(0xe6dcb8), lin(0xc8b87a), lin(0xb4a8c8)];
const REED_HEAD = lin(0x4a3a2a);
const GLOW = [lin(0x3fd6c8), lin(0x7fe8ff), lin(0x3fd6c8), lin(0xa86cf0)];

// ── Placement ────────────────────────────────────────────────────────────────

const CELL = 200;

interface Inst {
  kind: number;
  x: number;
  y: number;
  z: number;
  s: number;
  yaw: number;
  tip: THREE.Color;
  val: number;
  head: THREE.Color | null;
}

/** Low-frequency clumping, 0..1. */
function clump(x: number, z: number): number {
  return (
    0.5 +
    0.3 * Math.sin(x * 0.0131 + 1.7) * Math.cos(z * 0.0117 - 0.6) +
    0.2 * Math.sin((x - z) * 0.029 + 4.1) * Math.sin(z * 0.021 + x * 0.004)
  );
}

function scatter(): Inst[] {
  const out: Inst[] = [];
  const KI = Object.fromEntries(KINDS.map((k, i) => [k.id, i])) as Record<KindId, number>;
  let seq = 0;
  const add = (kind: KindId, x: number, z: number, s: number, tip: THREE.Color, head: THREE.Color | null = null, y = groundY(x, z)) => {
    const k = seq++;
    out.push({ kind: KI[kind], x, y: y - 0.25, z, s, yaw: rnd(k, 71) * Math.PI * 2, tip, val: 0.86 + rnd(k, 72) * 0.24, head });
  };
  const stops = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  /** Jittered grid over a rectangle; `fn` decides each point. */
  /** `keep` (0..1): the most any point here is accepted; points drawn above it are dropped before any terrain query. */
  const grid = (x0: number, x1: number, z0: number, z1: number, step: number, seed: number, fn: (x: number, z: number, r: number) => void, keep = 1) => {
    let i = 0;
    for (let z = z0; z < z1; z += step) {
      for (let x = x0; x < x1; x += step) {
        i++;
        const r = rnd(i, seed + 2);
        if (r > keep) continue;
        const jx = x + (rnd(i, seed) - 0.5) * step;
        const jz = z + (rnd(i, seed + 1) - 0.5) * step;
        fn(jx, jz, r);
      }
    }
  };
  const S = (a: number, b: number, r: number) => a + (b - a) * r;

  // a1: reeds at the waterline, dune grass on the sand, tufts above. Only up the valley in front of the camera.
  {
    const sp = stops.a1.pos;
    grid(850, 1850, 3650, 4480, 7, 11, (x, z, r) => {
      if (Math.hypot(x - sp.x, z - sp.z) < 16) return;
      if (Math.abs(x - 1335) < 12 && z > sp.z - 5) return; // the dock
      if (trailDist(x, z) < 4) return;
      const g = groundY(x, z);
      const sl = slopeAt(x, z);
      if (sl > 0.6) return;
      const c = clump(x, z);
      if (g > -1.4 && g < 2.2) {
        if (r < 0.55 * smooth(0.3, 0.7, c)) add("reeds", x, z, S(8, 13, rnd(x, 3)), TIP.reedA1, REED_HEAD, Math.max(g, -1.4));
      } else if (g >= 2.2 && g < 26) {
        // Pass 3: a clear foreground. Dune grass in clumps with bare sand
        // between them (pass 2 spread pale blades evenly over the beach).
        if (r < 0.4 * smooth(0.5, 0.78, c)) add("tall", x, z, S(5, 8, rnd(z, 4)), TIP.dune);
        else if (r < 0.1 + 0.14 * smooth(0.4, 0.7, c)) add("tuft", x, z, S(3, 5.5, rnd(x + z, 5)), TIP.a1);
      } else if (g >= 26) {
        if (r < 0.34 * smooth(0.3, 0.75, c)) add("tuft", x, z, S(3.5, 6, rnd(x, 6)), TIP.a1);
      }
    }, 0.55);
  }
  // a1 -> a2 walk and Base Camp: tufts along the trail, a2's flower meadow flooded before the camp.
  {
    const cp = stops.a2.pos;
    grid(200, 1450, 2300, 3950, 9, 21, (x, z, r) => {
      const dT = trailDist(x, z);
      const dC = Math.hypot(x - cp.x, z - cp.z);
      if (dT > 280 && dC > 560) return;
      if (dT < 4) return;
      if (dC < 40) return; // the lookout's footing
      const g = groundY(x, z);
      if (isWater(x, z, g)) return;
      const sl = slopeAt(x, z);
      if (sl > 0.55) return;
      const c = clump(x, z);
      const meadow = 1 - smooth(380, 560, dC);
      if (meadow > 0 && r < 0.025 * meadow * smooth(0.25, 0.65, c)) {
        add("flower", x, z, S(3.8, 5.5, rnd(x, 7)), TIP.a2, driftColour(rnd(z, 8)));
      } else if (r < 0.22 * smooth(0.3, 0.7, c) + 0.05) {
        add("tuft", x, z, S(3.5, 6, rnd(x + z, 9)), z > 3400 ? TIP.a1 : TIP.a2);
      } else if (r < 0.3) {
        add("tall", x, z, S(6, 9, rnd(x, 10)), TIP.a2);
      }
    }, 0.3);
    // The flower meadow before the camp (bible a2: "flooded"): a field between the a2 camera and the lookout,
    // wobbly edged, dense enough to read as a colour at 460-900 away.
    const a2cam = [745, 3230];
    const fx = cp.x + (a2cam[0] - cp.x) * 0.24;
    const fz = cp.z + (a2cam[1] - cp.z) * 0.24;
    // Pass 3: drifts. Seeded centres inside the wobbly edge, each a patch of
    // one colour (a few strays of the next colour), dense in the middle and
    // thinning out; green tufts between them, so the meadow reads as grass
    // with wildflowers in it.
    const edgeAt = (x: number, z: number) => {
      const a = Math.atan2(z - fz, x - fx);
      return 290 * (1 + 0.16 * Math.sin(a * 3 + 0.7) + 0.1 * Math.sin(a * 7 + 2.1));
    };
    const ok = (x: number, z: number) => {
      if (Math.hypot(x - fx, z - fz) > edgeAt(x, z)) return false;
      if (Math.hypot(x - cp.x, z - cp.z) < 40) return false;
      if (trailDist(x, z) < 5) return false;
      return true;
    };
    // Fix pass 3: 70 -> 150 drifts, each larger and denser, so the near meadow floods again.
    for (let i = 0; i < 150; i++) {
      const a = rnd(i, 221) * Math.PI * 2;
      const rr = Math.sqrt(rnd(i, 222)) * 300;
      const dx = fx + Math.cos(a) * rr;
      const dz = fz + Math.sin(a) * rr;
      if (!ok(dx, dz)) continue;
      const col = driftColour(rnd(i, 223));
      const alt = driftColour(rnd(i, 224));
      const R = 9 + rnd(i, 225) * 19;
      const n = Math.round(R * R * 0.17);
      for (let j = 0; j < n; j++) {
        const b = rnd(i * 97 + j, 226) * Math.PI * 2;
        // Squared falloff: most flowers near the drift's heart.
        const q = rnd(i * 97 + j, 227);
        const d = R * q * q * 1.3;
        const x = dx + Math.cos(b) * d * 1.25;
        const z = dz + Math.sin(b) * d;
        if (!ok(x, z)) continue;
        const g = groundY(x, z);
        if (isWater(x, z, g) || slopeAt(x, z) > 0.55) continue;
        add("flower", x, z, S(3.8, 6, rnd(i * 97 + j, 228)), TIP.a2, rnd(i * 97 + j, 229) < 0.85 ? col : alt, g);
      }
    }
    grid(fx - 330, fx + 330, fz - 330, fz + 330, 11, 22, (x, z, r) => {
      if (!ok(x, z)) return;
      const g = groundY(x, z);
      if (isWater(x, z, g) || slopeAt(x, z) > 0.55) return;
      if (r < 0.05) add("flower", x, z, S(3.6, 5, rnd(x + z, 7)), TIP.a2, driftColour(rnd(x * 0.37 + z, 8)), g);
      else if (r < 0.34 * smooth(0.25, 0.7, clump(x, z)) + 0.08) add(r < 0.3 ? "tuft" : "tall", x, z, r < 0.3 ? S(3.5, 6, rnd(x, 9)) : S(6, 9, rnd(z, 10)), TIP.a2, null, g);
    }, 0.42);
  }
  // Base Camp to the rim: tufts and tall grass beside the trail.
  grid(-250, 700, 1830, 2800, 10, 31, (x, z, r) => {
    if (trailDist(x, z) > 220 || trailDist(x, z) < 4) return;
    const sl = slopeAt(x, z);
    if (sl > 0.6) return;
    const c = clump(x, z);
    if (r < 0.3 * smooth(0.3, 0.7, c)) add("tuft", x, z, S(3.5, 6, rnd(x, 11)), TIP.a2);
    else if (r < 0.33) add("tall", x, z, S(6, 9, rnd(z, 12)), TIP.a2);
  }, 0.33);
  // The gorge: ferns on the floor, round the pool, on low ledges.
  {
    const P = WORLD.pool;
    grid(-420, 320, 1270, 1620, 6, 41, (x, z, r) => {
      const g = groundY(x, z);
      if (isWater(x, z, g)) return;
      if (g > 240) return;
      const sl = slopeAt(x, z, 3);
      const dP = Math.hypot(x - P.x, z - P.z) - P.r;
      if (dP < 3) return;
      if (railDist(x, g + 4, z) < 18) return;
      const c = clump(x, z);
      const floor = g < 90 && sl < 0.5;
      const ledge = !floor && sl < 1.3 && g < 240;
      const wet = 1 - smooth(40, 260, dP);
      if (floor && r < (0.22 + 0.3 * wet) * smooth(0.25, 0.7, c)) add("fern", x, z, S(5, 9, rnd(x, 13)), TIP.gorge);
      else if (floor && r > 0.52) add("tuft", x, z, S(3, 5, rnd(z, 14)), TIP.gorge);
      else if (ledge && r < 0.08) add("fern", x, z, S(5, 8, rnd(x + z, 15)), TIP.gorge);
    }, 0.58);
  }
  // The collar and rim shelf: pale dry grass. Then the saddle and meadow down to the lake.
  grid(1120, 1780, 560, 1135, 8, 51, (x, z, r) => {
    const g = groundY(x, z);
    if (g < 560) return;
    const sl = slopeAt(x, z);
    if (sl > 0.7) return;
    if (Math.abs(x - 1436) < 26 && Math.abs(z - 1041) < 26) return; // the collar
    if (trailDist(x, z) < 4) return;
    const c = clump(x, z);
    if (r < 0.42 * smooth(0.25, 0.7, c)) add("tall", x, z, S(5.5, 9, rnd(x, 16)), TIP.collar);
    else if (r < 0.58) add("tuft", x, z, S(3.5, 5.5, rnd(z, 17)), TIP.collar);
  }, 0.58);
  grid(1050, 1950, -330, 560, 10, 61, (x, z, r) => {
    const L = WORLD.lake;
    if (Math.hypot(x - L.x, z - L.z) < L.r + 8) return;
    const dT = trailDist(x, z);
    if (dT > 380 || dT < 4) return;
    const g = groundY(x, z);
    if (isWater(x, z, g)) return;
    const sl = slopeAt(x, z);
    if (sl > 0.6) return;
    const c = clump(x, z);
    if (r < 0.3 * smooth(0.3, 0.7, c)) add("tuft", x, z, S(3.5, 6, rnd(x, 18)), TIP.meadow);
    else if (r < 0.4 * smooth(0.45, 0.8, c)) add("tall", x, z, S(6, 9, rnd(z, 19)), z < 0 ? TIP.a5 : TIP.meadow);
    else if (r < 0.43) add("flower", x, z, S(4, 6, rnd(x + z, 20)), TIP.meadow, FLOWERS_MEADOW[Math.floor(rnd(x, 21) * FLOWERS_MEADOW.length)]);
  }, 0.43);
  // a5: golden grass on the shore, reeds at the water's edge, all round the lake.
  {
    const L = WORLD.lake;
    const B = stops.a5.pos;
    grid(L.x - L.r - 160, L.x + L.r + 160, L.z - L.r - 160, L.z + L.r + 160, 8, 71, (x, z, r) => {
      const d = Math.hypot(x - L.x, z - L.z) - L.r;
      if (d < -14 || d > 150) return;
      if (Math.hypot(x - B.x, z - B.z) < 30) return;
      if (trailDist(x, z) < 4) return;
      const g = groundY(x, z);
      const sl = slopeAt(x, z);
      if (sl > 0.6) return;
      const c = clump(x, z);
      if (d < 8 && g > L.y - 3.5) {
        if (r < 0.5 * smooth(0.3, 0.7, c)) add("reeds", x, z, S(8, 14, rnd(x, 22)), TIP.reedA5, REED_HEAD, Math.max(g, L.y - 3.5));
      } else if (d >= 8 && !isWater(x, z, g)) {
        if (r < 0.34 * smooth(0.25, 0.7, c) * (1 - smooth(60, 150, d) * 0.6)) add("tall", x, z, S(5.5, 9, rnd(z, 23)), TIP.a5);
        else if (r > 0.34 && r < 0.39) add("tuft", x, z, S(3.5, 5.5, rnd(x + z, 24)), TIP.a5);
      }
    }, 0.5);
  }
  // a6: glowing moss and dark ferns on the forest floor.
  {
    const Fo = WORLD.forest;
    grid(Fo.x - Fo.r, Fo.x + Fo.r, Fo.z - Fo.r, Fo.z + Fo.r, 12, 81, (x, z, r) => {
      if (Math.hypot(x - Fo.x, z - Fo.z) > Fo.r) return;
      if (trailDist(x, z) < 8) return;
      const g = groundY(x, z);
      const c = clump(x, z);
      // Pass 3: fewer loose domes between the clusters (pass 2's even scatter read as teal shards).
      if (r < 0.05 * smooth(0.3, 0.7, c)) add("moss", x, z, S(3, 6, rnd(x, 25)), TIP.a6, GLOW[Math.floor(rnd(z, 26) * GLOW.length)], g);
      else if (r < 0.2 * smooth(0.35, 0.75, c)) add("fern", x, z, S(6, 11, rnd(z, 27)), TIP.a6, null, g);
    }, 0.26);
    // Pass 3: the floor in CLUSTERS (bible 4.2 M3/M4, 3.4 big to small): a
    // moss cushion or two at the heart, glowing ferns round it, a glowcap
    // clump in about half, dark ferns at the rim. Clusters fill the whole
    // floor, the lanes the camera walks included; only the trail itself
    // stays bare. Each cluster keeps to one glow hue so it reads as a patch.
    // 340 anywhere on the floor, then up to 240 more within 110 of the trail
    // (the lanes the camera looks down).
    let nearPath = 0;
    for (let i = 0; i < 2400; i++) {
      if (i >= 340 && nearPath >= 240) break;
      const a = rnd(i, 231) * Math.PI * 2;
      const rr = Math.sqrt(rnd(i, 232)) * (Fo.r - 20);
      const cx = Fo.x + Math.cos(a) * rr;
      const cz = Fo.z + Math.sin(a) * rr;
      const dT = trailDist(cx, cz);
      if (dT < 14) continue;
      if (i >= 340) {
        if (dT > 110 || nearPath >= 240) continue;
        nearPath++;
      }
      const hue = rnd(i, 233) < 0.68 ? 0 : 1; // teal or violet
      const glowA = hue ? GLOW[3] : GLOW[rnd(i, 234) < 0.3 ? 1 : 0];
      const R = 6 + rnd(i, 235) * 10;
      const put = (kind: KindId, n: number, s0: number, s1: number, tip: THREE.Color, head: THREE.Color | null, spread: number, seed: number) => {
        for (let j = 0; j < n; j++) {
          const b = rnd(i * 31 + j, seed) * Math.PI * 2;
          const d = R * spread * Math.sqrt(rnd(i * 31 + j, seed + 1));
          const x = cx + Math.cos(b) * d;
          const z = cz + Math.sin(b) * d;
          if (trailDist(x, z) < 9) continue;
          add(kind, x, z, S(s0, s1, rnd(i * 31 + j, seed + 2)), tip, head, groundY(x, z));
        }
      };
      put("moss", 1 + Math.floor(rnd(i, 236) * 2), 3.5, 6.5, TIP.a6, glowA, 0.35, 240);
      put("gfern", 2 + Math.floor(rnd(i, 237) * 4), 6, 10, TIP.a6fern, hue ? GLOW[3] : GLOW[0], 0.8, 243);
      if (rnd(i, 238) < 0.5) put("gcap", 1 + Math.floor(rnd(i, 239) * 2), 5, 9, TIP.a6cap, hue ? GLOW[0] : GLOW[3], 0.6, 246);
      put("fern", 2 + Math.floor(rnd(i, 249) * 3), 6, 11, TIP.a6, null, 1.1, 250);
    }
  }
  // a7: pale gold grass on the Sky Island's top.
  {
    const I = WORLD.island;
    const O = stops.a7.pos;
    const topY = (x: number, z: number) => I.y + 42 * Math.exp(-((x + 2410) ** 2 + (z + 1470) ** 2) / (150 * 150));
    grid(I.x - I.r, I.x + I.r, I.z - I.r, I.z + I.r, 10, 91, (x, z, r) => {
      const d = Math.hypot(x - I.x, z - I.z);
      if (d > I.r - 70) return; // the rim wobbles in by up to 38 and the cove by 100: stay inside
      const b = ((Math.atan2(x - I.x, -(z - I.z)) * 180) / Math.PI + 360) % 360;
      if (Math.abs(b - 133) < 26 && d > I.r - 170) return; // the cove
      if (Math.hypot(x - O.x, z - O.z) < 55) return;
      if (trailDist(x, z) < 6) return;
      const c = clump(x, z);
      if (r < 0.26 * smooth(0.25, 0.7, c)) add("tall", x, z, S(5, 8.5, rnd(x, 28)), TIP.a7, null, topY(x, z));
      else if (r < 0.3) add("tuft", x, z, S(3.5, 5, rnd(z, 29)), TIP.a7, null, topY(x, z));
    }, 0.3);
  }
  // Fix pass 3: the bounty isle's top read as a bare grey plain at boarding (key 65): the same pale gold grass.
  {
    const B = WORLD.bountyIsle;
    grid(B.x - B.r, B.x + B.r, B.z - B.r, B.z + B.r, 8, 93, (x, z, r) => {
      if (Math.hypot(x - B.x, z - B.z) > B.r - 16) return;
      if (trailDist(x, z) < 5) return;
      const c = clump(x, z);
      if (r < 0.3 * smooth(0.2, 0.7, c)) add("tall", x, z, S(5, 8, rnd(x, 31)), TIP.a7, null, B.y);
      else if (r < 0.42) add("tuft", x, z, S(3.5, 5, rnd(z, 32)), TIP.a7, null, B.y);
    }, 0.3);
  }
  // Round every rock group: a ring of tall grass and tufts (big to small).
  for (let i = 0; i < rockAnchors.length; i++) {
    const A = rockAnchors[i];
    const g0 = groundY(A.x, A.z);
    if (isWater(A.x, A.z, g0)) continue;
    const onIsland = Math.hypot(A.x - WORLD.island.x, A.z - WORLD.island.z) < WORLD.island.r;
    if (onIsland) continue;
    const tip = A.z > 3400 ? TIP.a1 : A.z > 1800 ? TIP.a2 : A.z > 1150 ? TIP.gorge : A.z > 0 ? TIP.collar : TIP.a5;
    const n = 5 + Math.floor(rnd(i, 30) * 6);
    for (let k = 0; k < n; k++) {
      const a = rnd(i * 13 + k, 31) * Math.PI * 2;
      const d = A.r * (0.7 + rnd(i * 13 + k, 32) * 0.7);
      const x = A.x + Math.cos(a) * d;
      const z = A.z + Math.sin(a) * d;
      const g = groundY(x, z);
      if (isWater(x, z, g) || slopeAt(x, z) > 0.8) continue;
      if (A.z > 1150 && A.z < 1700) add("fern", x, z, 5 + rnd(k, 33) * 3, TIP.gorge);
      else add(k % 3 ? "tuft" : "tall", x, z, k % 3 ? 3.5 + rnd(k, 34) * 2 : 6 + rnd(k, 35) * 3, tip);
    }
  }

  return out;
}

// ── Shader ───────────────────────────────────────────────────────────────────

const VERT_PARS = /* glsl */ `
attribute float aT;
attribute float aHead;
attribute vec4 iTip;
attribute vec3 iHead;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindAmp;
uniform vec2 uFade;
varying vec3 vCoverCol;
varying vec3 vCoverGlow;
`;
const VERT_BODY = /* glsl */ `
{
  vec3 ip = vec3( instanceMatrix[ 3 ] );
  float dCam = distance( ip, cameraPosition );
  float fade = 1.0 - smoothstep( uFade.x, uFade.y, dCam );
  vec3 bx = vec3( instanceMatrix[ 0 ] );
  vec3 by = vec3( instanceMatrix[ 1 ] );
  vec3 bz = vec3( instanceMatrix[ 2 ] );
  float s2 = dot( bx, bx );
  float h = clamp( position.y, 0.0, 1.0 );
  float gust = 0.6 * sin( dot( ip.xz, vec2( 0.021, 0.013 ) ) + uTime * 1.7 ) + 0.4 * sin( dot( ip.xz, vec2( -0.006, 0.011 ) ) + uTime * 0.45 );
  // World offset (units), tip weighted, then into the instance's frame (rotation x uniform scale).
  vec3 w = vec3( uWind.x, 0.0, uWind.y ) * ( uWindAmp * sqrt( s2 ) * h * h * ( 0.55 + 0.45 * gust ) );
  transformed += vec3( dot( bx, w ), dot( by, w ), dot( bz, w ) ) / s2;
  transformed *= fade;
  vec3 root = iTip.rgb * vec3( 0.34, 0.37, 0.41 );
  vec3 col = mix( root, iTip.rgb, smoothstep( 0.0, 1.0, aT ) ) * iTip.a;
  col *= 1.0 + 0.1 * gust * aT;
  vCoverCol = mix( col, iHead, step( 0.5, aHead ) );
  vCoverGlow = iHead * aHead;
}
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vCoverCol;
varying vec3 vCoverGlow;
`;

function makeMaterial(uniforms: Record<string, THREE.IUniform>, glow: boolean): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.name = glow ? "V5CoverGlow" : "V5Cover";
  if (glow) mat.userData.lightGlow = "magic";
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace(
        "#include <color_fragment>",
        glow ? "#include <color_fragment>\ndiffuseColor.rgb = vCoverCol;" : "#include <color_fragment>\ndiffuseColor.rgb *= vCoverCol;",
      )
      // Blades are single sided triangles drawn from both sides: keep the up normal on the back face too.
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize( vNormal );")
      .replace(
        "#include <emissivemap_fragment>",
        glow ? "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vCoverGlow * diffuse.r * 1.1;" : "#include <emissivemap_fragment>",
      );
  };
  mat.customProgramCacheKey = () => `v5cover|${glow ? "glow" : "plain"}`;
  return mat;
}

// ── Install ──────────────────────────────────────────────────────────────────

interface Cell {
  cx: number;
  cy: number;
  cz: number;
  start: number;
  count: number;
}
interface Live {
  def: KindDef;
  mesh: THREE.InstancedMesh;
  mats: Float32Array;
  tips: Float32Array;
  heads: Float32Array;
  cells: Cell[];
  iTip: THREE.InstancedBufferAttribute;
  iHead: THREE.InstancedBufferAttribute;
  uniforms: Record<string, THREE.IUniform>;
  shown: string;
  total: number;
  tris: number;
}

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = "V5Cover";
  ctx.root.add(root);
  const time = { value: 0 };
  const wind = { value: new THREE.Vector2(0.8, 0.6).normalize() };
  const windAmp = { value: 0.13 };
  const inst = scatter();
  const scatterMs = Math.round(performance.now() - t0);

  const materials: THREE.Material[] = [];
  const lives: Live[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  KINDS.forEach((def, ki) => {
    const list = inst.filter((p) => p.kind === ki);
    if (!list.length) return;
    // Sort into cells.
    const key = (p: Inst) => Math.floor(p.x / CELL) * 100000 + Math.floor(p.z / CELL);
    list.sort((a, b) => key(a) - key(b));
    const N = list.length;
    const mats = new Float32Array(N * 16);
    const tips = new Float32Array(N * 4);
    const heads = new Float32Array(N * 3);
    const cells: Cell[] = [];
    let cur: Cell | null = null;
    let curKey = NaN;
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      pos.set(p.x, p.y, p.z);
      scl.setScalar(p.s);
      m4.compose(pos, q, scl);
      m4.toArray(mats, i * 16);
      tips[i * 4] = p.tip.r;
      tips[i * 4 + 1] = p.tip.g;
      tips[i * 4 + 2] = p.tip.b;
      tips[i * 4 + 3] = p.val;
      const h = p.head ?? p.tip;
      heads[i * 3] = h.r;
      heads[i * 3 + 1] = h.g;
      heads[i * 3 + 2] = h.b;
      const k = key(p);
      if (k !== curKey) {
        cur = { cx: (Math.floor(p.x / CELL) + 0.5) * CELL, cy: p.y, cz: (Math.floor(p.z / CELL) + 0.5) * CELL, start: i, count: 0 };
        cells.push(cur);
        curKey = k;
      }
      cur!.count++;
      cur!.cy = Math.max(cur!.cy, p.y);
    });
    const cap = Math.min(def.cap, N);
    const geo = kindGeometry(def.id);
    const iTip = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const iHead = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    iTip.setUsage(THREE.DynamicDrawUsage);
    iHead.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iTip", iTip);
    geo.setAttribute("iHead", iHead);
    const uniforms = { uTime: time, uWind: wind, uWindAmp: windAmp, uFade: { value: new THREE.Vector2(def.fade[0], def.fade[1]) } };
    const mat = makeMaterial(uniforms, !!def.glow);
    materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = `Cover:${def.id}`;
    mesh.count = 0;
    mesh.frustumCulled = false; // culled here, by cell
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    // Tufts are too small to matter in the Mirror Lake: keep them out of its reflection pass (light.ts draws that layer on the main camera only).
    mesh.layers.set(NO_REFLECT_LAYER);
    root.add(mesh);
    lives.push({ def, mesh, mats, tips, heads, cells, iTip, iHead, uniforms, shown: "", total: N, tris: geo.getAttribute("position").count / 3 });
  });
  root.updateMatrixWorld(true);

  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQ = new THREE.Quaternion();
  const R = CELL * 0.75 + 20;

  /** Copy the cells near the camera and in view into each kind's live buffer. True when anything changed. */
  function compact(force = false): boolean {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const p = cam.getWorldPosition(pos);
    if (!force && p.distanceToSquared(lastPos) < 16 && cam.quaternion.angleTo(lastQ) < 0.02) return false;
    lastPos.copy(p);
    lastQ.copy(cam.quaternion);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    let changed = false;
    for (const L of lives) {
      const far = L.def.fade[1] + R;
      const pick: number[] = [];
      let n = 0;
      for (let c = 0; c < L.cells.length; c++) {
        const C = L.cells[c];
        const dx = C.cx - p.x;
        const dz = C.cz - p.z;
        const dy = C.cy - p.y;
        if (dx * dx + dz * dz + dy * dy > far * far) continue;
        sph.center.set(C.cx, C.cy, C.cz);
        sph.radius = R + 20;
        if (!frustum.intersectsSphere(sph)) continue;
        if (n + C.count > L.mesh.instanceMatrix.count) continue;
        pick.push(c);
        n += C.count;
      }
      const sig = pick.join(",");
      if (sig === L.shown) continue;
      L.shown = sig;
      changed = true;
      const im = L.mesh.instanceMatrix.array as Float32Array;
      const it = L.iTip.array as Float32Array;
      const ih = L.iHead.array as Float32Array;
      let o = 0;
      for (const c of pick) {
        const C = L.cells[c];
        im.set(L.mats.subarray(C.start * 16, (C.start + C.count) * 16), o * 16);
        it.set(L.tips.subarray(C.start * 4, (C.start + C.count) * 4), o * 4);
        ih.set(L.heads.subarray(C.start * 3, (C.start + C.count) * 3), o * 3);
        o += C.count;
      }
      L.mesh.count = o;
      L.mesh.visible = o > 0;
      if (o > 0) {
        L.mesh.instanceMatrix.clearUpdateRanges();
        L.mesh.instanceMatrix.addUpdateRange(0, o * 16);
        L.mesh.instanceMatrix.needsUpdate = true;
        L.iTip.clearUpdateRanges();
        L.iTip.addUpdateRange(0, o * 4);
        L.iTip.needsUpdate = true;
        L.iHead.clearUpdateRanges();
        L.iHead.addUpdateRange(0, o * 3);
        L.iHead.needsUpdate = true;
      }
    }
    return changed;
  }
  compact(true);
  const buildMs = Math.round(performance.now() - t0);
  const live = () => lives.reduce((a, L) => a + (L.mesh.visible ? L.mesh.count : 0), 0);

  return {
    name: "cover",
    update(t: number) {
      const changed = compact();
      if (!ctx.reducedMotion) time.value = t;
      return changed || (!ctx.reducedMotion && live() > 0);
    },
    isAnimating() {
      return !ctx.reducedMotion && live() > 0;
    },
    dispose() {
      root.removeFromParent();
      for (const L of lives) {
        L.mesh.geometry.dispose();
        L.mesh.dispose();
      }
      for (const m of materials) m.dispose();
    },
    stats() {
      compact();
      const out: Record<string, number | string> = { buildMs, scatterMs, instances: inst.length };
      let visibleTris = 0;
      let visibleCalls = 0;
      for (const L of lives) {
        out[`n_${L.def.id}`] = L.total;
        out[`live_${L.def.id}`] = L.mesh.visible ? L.mesh.count : 0;
        if (L.mesh.visible && L.mesh.count > 0) {
          visibleTris += L.mesh.count * L.tris;
          visibleCalls++;
        }
      }
      out.visibleTris = visibleTris;
      out.visibleCalls = visibleCalls;
      return out;
    },
  };
};
