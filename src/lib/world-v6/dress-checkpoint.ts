import * as THREE from "three";
import { CHECKPOINT, type CheckpointLook } from "./checkpoint";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { addFootprint } from "./footprints";
import { NO_REFLECT_LAYER } from "./light";

/**
 * The discount checkpoint's landmark (checkpoint.ts): the trail cache on the
 * saddle between the Trail Hut (a4) and the Boathouse (a5), in LM_Checkpoint.
 *
 *   Checkpoint:body    four peeled posts with tin bands and stone footings,
 *                      cross braces, the deck and its porch, the log walls,
 *                      the shingled gable roof, the door's frame, the gable
 *                      window's frame, the lantern's bracket and iron, the
 *                      pennant's pole, a crate and a barrel at the posts' foot,
 *                      and the tag-shaped board under the deck's front edge
 *                      (the interface's tag, in the world).
 *   Checkpoint:ladder  the ladder, turning on its foot: lying on the ground
 *                      toward the trail (closed, near), up against the porch
 *                      (ready, claimed).
 *   Checkpoint:door    the door, turning on its hinge: shut, ajar (ready), open
 *                      (claimed).
 *   Checkpoint:flag    the pennant flying (ready, claimed); Checkpoint:furled,
 *                      the same pennant rolled round its pole (closed, near).
 *   Checkpoint:glow    the lantern's glass, the gable window (dimly lit in
 *                      every look) and the light inside the doorway. Dark
 *                      glass when unlit; its level is
 *                      light.ts's lampGlow (floored, as the lesson lanterns
 *                      are), so it reads as paint in daylight and as light at
 *                      dusk. Untagged on purpose: this module sets its colour
 *                      (the pulse), light.ts would overwrite a tagged one.
 *   Checkpoint:halo    an additive glow round the lantern, while it is lit.
 *
 * Stock Lambert and Basic materials with fog, so light.ts's ramp and grade
 * reach them, all on NO_REFLECT_LAYER (the lake never sees the saddle). At
 * most 6 draw calls, only while the cache is in the frame. Moving parts ease
 * to their new place over about a second when the look changes; under
 * reduced motion they jump and the lantern does not pulse.
 *
 * setCheckpoint(look) comes from the scene (WorldScene.setCheckpoint), which
 * the map's page calls with what the student's discount state means here.
 */

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];
const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
/** The gorge's palette (dress-gorge.ts), plus the tin and the pennant. */
const P = {
  log: lin(0x8a5f3e),
  logDark: lin(0x6e4a30),
  chink: lin(0xc9b89a),
  post: lin(0x9a7a58),
  postDark: lin(0x6a5040),
  plank: lin(0x8c7a66),
  plankDark: lin(0x5a4a3e),
  shingle: lin(0x5e4e46),
  shingleDark: lin(0x4a3c36),
  ridge: lin(0xa88e74),
  trim: lin(0x4a382a),
  door: lin(0x7a5a40),
  iron: lin(0x2f2d2c),
  tin: lin(0x8e8a84),
  stone: lin(0x8f8a84),
  stoneDark: lin(0x68635e),
  rope: lin(0xc2a878),
  crate: lin(0x9c7c58),
  pennant: lin(0xe0a05a),
  pennantDark: lin(0xb07a40),
  tag: lin(0xd09a5c),
};
/** Unlit glow colours (linear, over 1 so they read as light after tone mapping), and dark glass. */
const GL = {
  lamp: [2.3, 0.98, 0.26] as RGB,
  window: [2.0, 1.2, 0.5] as RGB,
  inside: [1.7, 0.95, 0.38] as RGB,
  dark: [0.03, 0.026, 0.024] as RGB,
};
/** The lantern's lit level is never under this share of the lamp colour (progress-world.ts LOOK.glassFloor). */
const GLASS_FLOOR = 0.72;
/** Seconds of the ready pulse (the next lesson's lantern pulses at 2.6). */
const PULSE_S = 2.6;
/** Seconds a moving part takes to reach its new place. */
const MOVE_S = 1.1;
/** Past this distance the cache is a few pixels: no pulse, no sway, no frame asked for. */
const ANIMATE_DIST = 2600;

/** Sizes in world units (a person is 14, the Trail Hut's door 20). */
const C = {
  /** Deck underside over the ground. */
  postH: 17,
  /** Posts at f = +-pf (front / back), s = +-ps (left / right). */
  pf: 5.2,
  ps: 6.2,
  postR: 0.95,
  /** The house: f from -hd to +hd, s from -hw to +hw, from the deck up to the eave. */
  hd: 5,
  hw: 5.5,
  wall: 8.4,
  log: 1.7,
  rise: 6,
  /** The porch: the deck runs this far past the house's front. */
  porch: 3.4,
  /** The door: width, height, its centre across (s), its hinge on the left. */
  doorW: 3.6,
  doorH: 6.2,
  doorS: -1.4,
  /** The ladder: length, width, its foot's distance in front of the house's centre. */
  ladderL: 21,
  ladderW: 4.4,
  ladderFoot: 13.6,
  /** The pennant pole over the front gable's apex. */
  pole: 9,
};

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Horizontal unit vector for a compass bearing (0 = -z, 90 = +x). */
const dirOf = (b: number): [number, number] => [Math.sin(b * DEG), -Math.cos(b * DEG)];
function rnd(i: number, s = 0): number {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

interface Units {
  box: THREE.BufferGeometry;
  cyl6: THREE.BufferGeometry;
  cyl8: THREE.BufferGeometry;
  cone4: THREE.BufferGeometry;
  sphere: THREE.BufferGeometry;
  dode: THREE.BufferGeometry;
}
function makeUnits(): Units {
  const ni = (g: THREE.BufferGeometry) => {
    const o = g.index ? g.toNonIndexed() : g;
    if (o !== g) g.dispose();
    o.deleteAttribute("uv");
    o.deleteAttribute("normal");
    return o;
  };
  return {
    box: ni(new THREE.BoxGeometry(1, 1, 1)),
    cyl6: ni(new THREE.CylinderGeometry(1, 1, 1, 6)),
    cyl8: ni(new THREE.CylinderGeometry(1, 1, 1, 8)),
    cone4: ni(new THREE.ConeGeometry(1, 1, 4)),
    sphere: ni(new THREE.IcosahedronGeometry(1, 0)),
    dode: ni(new THREE.DodecahedronGeometry(1, 0)),
  };
}

/** Faceted, vertex coloured triangles in a local frame (dress-gorge.ts's Kit, local coordinates in). */
class Kit {
  private p: number[] = [];
  private c: number[] = [];
  private n = 0;
  constructor(private readonly U: Units) {}
  get tris(): number {
    return this.p.length / 9;
  }
  private push(x: number, y: number, z: number, col: RGB, k: number): void {
    this.p.push(x, y, z);
    this.c.push(col[0] * k, col[1] * k, col[2] * k);
  }
  add(geo: keyof Units, m: THREE.Matrix4, col: RGB, vary = 0.1): void {
    const a = this.U[geo].getAttribute("position");
    const k = 1 - vary / 2 + vary * rnd(this.n++, 3.7);
    for (let i = 0; i < a.count; i++) {
      _a.fromBufferAttribute(a, i).applyMatrix4(m);
      this.push(_a.x, _a.y, _a.z, col, k);
    }
  }
  tri(a: V3, b: V3, c: V3, col: RGB): void {
    this.push(a[0], a[1], a[2], col, 1);
    this.push(b[0], b[1], b[2], col, 1);
    this.push(c[0], c[1], c[2], col, 1);
  }
  /** Both faces (cloth, glass panes). */
  sheet(a: V3, b: V3, c: V3, col: RGB): void {
    this.tri(a, b, c, col);
    this.tri(a, c, b, col);
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB): void {
    this.sheet(a, b, c, col);
    this.sheet(a, c, d, col);
  }
  /** A box or cylinder of section w x d from a to b. */
  beam(a: V3, b: V3, w: number, d: number, col: RGB, geo: keyof Units = "box", vary = 0.1, roll = 0): void {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-6) return;
    _c.addVectors(_a, _b).multiplyScalar(0.5);
    _q.setFromUnitVectors(UP, _b.sub(_a).divideScalar(len));
    if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
    this.add(geo, _m.compose(_c, _q, _s.set(w, len, d)), col, vary);
  }
  /** An axis-aligned box in the local frame (f along x, up y, s along z). */
  block(f: number, y: number, s: number, df: number, dy: number, ds: number, col: RGB, vary = 0.08): void {
    this.add("box", _m.compose(_p.set(f, y, s), _q.identity(), _s.set(df, dy, ds)), col, vary);
  }
  /** Where the colours of part `from` start (a vertex index), for recolouring it later. */
  get vertexCount(): number {
    return this.p.length / 3;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * The local frame: x is forward (f, the door side, along CHECKPOINT.facing), y
 * is up from the base's ground, z is across (s, + to the right looking out of
 * the door). The group under LM_Checkpoint carries the turn and the base.
 */
const L = (f: number, y: number, s: number): V3 => [f, y, s];

function buildBody(k: Kit, ground: (f: number, s: number) => number): { lamp: V3; tagged: number } {
  const { postH, pf, ps, postR, hd, hw, wall, log, rise, porch, doorW, doorH, doorS } = C;
  const deck = postH + 1.1;
  // Posts, tin bands, stone footings; each post from its own ground.
  for (const f of [pf, -pf]) {
    for (const s of [ps, -ps]) {
      const g = ground(f, s);
      // Unit cylinders have radius 1: the section passed is the radius.
      k.beam(L(f, g - 1.2, s), L(f, postH + 0.2, s), postR, postR, f > 0 ? P.post : P.postDark, "cyl8", 0.12, rnd(f, s) * 3);
      k.beam(L(f, 8.8, s), L(f, 11.2, s), postR * 1.2, postR * 1.2, P.tin, "cyl8", 0.05);
      k.add("dode", _m.compose(_p.set(f, g + 0.3, s), _q.identity(), _s.set(2.3, 0.9, 2.1)), P.stoneDark, 0.1);
    }
  }
  // Cross braces on the two sides and the back, under the deck.
  for (const s of [ps, -ps]) k.beam(L(pf, ground(pf, s) + 4, s), L(-pf, postH - 1.5, s), 0.7, 0.7, P.postDark, "box", 0.1);
  k.beam(L(-pf, ground(-pf, -ps) + 4, -ps), L(-pf, postH - 1.5, ps), 0.7, 0.7, P.postDark, "box", 0.1);
  // Joists along f under the deck, and the deck: planks across f, the porch in front.
  for (const s of [ps, -ps]) k.beam(L(-hd - 1.4, postH + 0.4, s), L(hd + porch + 0.2, postH + 0.4, s), 1.0, 1.1, P.plankDark, "box", 0.06);
  const f0 = -hd - 1.2;
  const f1 = hd + porch;
  const planks = 9;
  for (let i = 0; i < planks; i++) {
    const a = f0 + ((f1 - f0) * i) / planks;
    const b = f0 + ((f1 - f0) * (i + 1)) / planks;
    k.block((a + b) / 2, postH + 1.05, 0, b - a - 0.18, 0.7, ps * 2 + 1.6, i % 2 ? P.plank : P.plankDark, 0.12);
  }
  // A rail along the porch's two open sides.
  for (const s of [ps + 0.4, -ps - 0.4]) {
    k.beam(L(hd + porch - 0.3, deck, s), L(hd + porch - 0.3, deck + 3.4, s), 0.5, 0.5, P.post, "box");
    k.beam(L(hd + 0.2, deck + 3.2, s), L(hd + porch - 0.3, deck + 3.2, s), 0.45, 0.45, P.post, "box");
  }
  // The house: a pale core, log courses crossing past the corners.
  k.block(0, deck + wall / 2, 0, hd * 2 - log * 0.9, wall, hw * 2 - log * 0.9, P.chink, 0.04);
  const courses = Math.floor(wall / (log * 0.95));
  for (let i = 0; i < courses; i++) {
    const y = deck + log / 2 + i * log * 0.95;
    const col = i % 2 ? P.log : P.logDark;
    const ext = 1.1 + rnd(i, 5) * 0.5;
    for (const f of [hd - log / 2, -hd + log / 2]) {
      // The front wall leaves the doorway open (the door hangs in it).
      if (f > 0 && y - log / 2 < deck + doorH + 0.2) {
        k.beam(L(f, y, -hw - ext), L(f, y, doorS - doorW / 2 - 0.1), log / 2, log / 2, col, "cyl8", 0.12, rnd(i, 1) * 3);
        k.beam(L(f, y, doorS + doorW / 2 + 0.1), L(f, y, hw + ext), log / 2, log / 2, col, "cyl8", 0.12, rnd(i, 2) * 3);
      } else {
        k.beam(L(f, y, -hw - ext), L(f, y, hw + ext), log / 2, log / 2, col, "cyl8", 0.12, rnd(i, f) * 3);
      }
    }
    for (const s of [hw - log / 2, -hw + log / 2]) {
      k.beam(L(-hd - ext, y + log * 0.46, s), L(hd + ext, y + log * 0.46, s), log / 2, log / 2, i % 2 ? P.logDark : P.log, "cyl8", 0.12, rnd(i, s) * 3);
    }
  }
  // The doorway: a dark recess behind the door, and its frame.
  const eave = deck + wall;
  k.block(hd - 0.9, deck + doorH / 2, doorS, 0.4, doorH, doorW, P.trim, 0.02);
  k.block(hd + 0.05, deck + doorH + 0.35, doorS, 0.7, 0.7, doorW + 1.2, P.trim, 0.04);
  for (const s of [doorS - doorW / 2 - 0.3, doorS + doorW / 2 + 0.3]) k.block(hd + 0.05, deck + doorH / 2, s, 0.7, doorH + 0.2, 0.6, P.trim, 0.04);
  // Gables: boards front and back; the front one frames a small window.
  for (const f of [hd - 0.3, -hd + 0.3]) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const s0 = -hw + (2 * hw * i) / n;
      const s1 = -hw + (2 * hw * (i + 1)) / n;
      const mid = (s0 + s1) / 2;
      const h = rise * (1 - Math.abs(mid) / (hw + 0.6));
      k.block(f, eave + h / 2, mid, 0.5, h, s1 - s0 - 0.12, i % 2 ? P.plank : P.plankDark, 0.1);
    }
  }
  k.block(hd + 0.05, eave + 2.4, 0, 0.5, 2.6, 2.6, P.trim, 0.02);
  // The roof: two shingled planes over the gables, a lit ridge.
  const over = 1.5;
  const rf0 = -hd - over;
  const rf1 = hd + over + 0.4;
  const peak = eave + rise;
  for (const side of [1, -1]) {
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const s0 = side * (hw + over) * (1 - r / rows);
      const s1 = side * (hw + over) * (1 - (r + 1) / rows);
      const y0 = eave - over * 0.55 + (rise + over * 0.55) * (r / rows);
      const y1 = eave - over * 0.55 + (rise + over * 0.55) * ((r + 1) / rows);
      const col = r % 2 ? P.shingle : P.shingleDark;
      // A slab under each row, thick enough to read from below.
      _a.set(0, y1 - y0, s1 - s0);
      const len = _a.length();
      const ang = Math.atan2(y1 - y0, s1 - s0);
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ang);
      k.add("box", _m.compose(_p.set((rf0 + rf1) / 2, (y0 + y1) / 2 + 0.35, (s0 + s1) / 2), _q, _s.set(rf1 - rf0, 0.8, len + 0.3)), col, 0.08);
    }
  }
  k.beam(L(rf0, peak + 0.5, 0), L(rf1, peak + 0.5, 0), 0.9, 0.9, P.ridge, "box", 0.05);
  // The pennant's pole over the front gable's apex, a knob on top.
  const poleF = hd + 0.6;
  k.beam(L(poleF, peak - 0.5, 0), L(poleF, peak + C.pole, 0), 0.28, 0.28, P.trim, "cyl6", 0.05);
  k.add("sphere", _m.compose(_p.set(poleF, peak + C.pole + 0.4, 0), _q.identity(), _s.set(0.7, 0.7, 0.7)), P.pennant, 0);
  // The lantern's bracket on the front wall, right of the door, and its iron.
  const lamp: V3 = L(hd + 1.9, deck + 4.6, doorS + doorW / 2 + 2.3);
  k.beam(L(hd, deck + 6.6, lamp[2]), L(lamp[0] + 0.2, deck + 6.6, lamp[2]), 0.45, 0.45, P.iron, "box", 0.02);
  k.beam(L(lamp[0], deck + 6.6, lamp[2]), L(lamp[0], lamp[1] + 1.4, lamp[2]), 0.18, 0.18, P.iron, "box", 0.02);
  k.add("cone4", _m.compose(_p.set(lamp[0], lamp[1] + 1.5, lamp[2]), _q.setFromAxisAngle(UP, Math.PI / 4), _s.set(1.25, 0.9, 1.25)), P.iron, 0.02);
  k.block(lamp[0], lamp[1] - 1.15, lamp[2], 1.5, 0.3, 1.5, P.iron, 0.02);
  for (const [df, ds] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) k.beam(L(lamp[0] + df, lamp[1] - 1.1, lamp[2] + ds), L(lamp[0] + df, lamp[1] + 1.1, lamp[2] + ds), 0.16, 0.16, P.iron, "box", 0.02);
  // The tag-shaped board under the deck's front edge, right side, on two cords.
  const tagF = hd + porch + 0.1;
  const tagS = 3.4;
  const tagY = postH - 2.6;
  for (const ds of [-1.05, 1.05]) k.beam(L(tagF, tagY + 1.0, tagS + ds * 0.5), L(tagF, postH + 0.5, tagS + ds), 0.12, 0.12, P.rope, "box", 0);
  {
    // A pentagon: the point to the left, the hole near it (the timeline's tag).
    const pts: ReadonlyArray<readonly [number, number]> = [
      [-1.9, 0],
      [-1.0, 1.05],
      [1.9, 1.05],
      [1.9, -1.05],
      [-1.0, -1.05],
    ];
    const at = (u: number, v: number, t: number): V3 => [tagF + t, tagY + v, tagS + u];
    for (const t of [0.22, -0.22]) for (let i = 1; i + 1 < pts.length; i++) k.tri(at(pts[0][0], pts[0][1], t), at(pts[i][0], pts[i][1], t), at(pts[i + 1][0], pts[i + 1][1], t), t > 0 ? P.tag : P.plankDark);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      k.quad(at(pts[i][0], pts[i][1], 0.22), at(pts[i][0], pts[i][1], -0.22), at(pts[j][0], pts[j][1], -0.22), at(pts[j][0], pts[j][1], 0.22), P.plankDark);
    }
    k.add("cyl6", _m.compose(_p.set(tagF + 0.24, tagY, tagS - 1.05), _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), _s.set(0.32, 0.06, 0.32)), P.iron, 0);
  }
  // Supplies at the posts' foot: a crate with a rope coil, a barrel.
  {
    const g = ground(-1.5, -ps - 3.4);
    k.block(-1.5, g + 1.9, -ps - 3.4, 3.8, 3.8, 3.6, P.crate, 0.1);
    k.block(-1.5, g + 3.85, -ps - 3.4, 4.0, 0.25, 3.8, P.plankDark, 0.05);
    k.add("cyl8", _m.compose(_p.set(-1.3, g + 4.25, -ps - 3.3), _q.identity(), _s.set(1.3, 0.55, 1.3)), P.rope, 0.05);
    const gb = ground(-pf - 1.2, ps + 2.6);
    k.add("cyl8", _m.compose(_p.set(-pf - 1.2, gb + 2.1, ps + 2.6), _q.identity(), _s.set(1.7, 4.2, 1.7)), P.logDark, 0.08);
    for (const y of [0.9, 3.3]) k.add("cyl8", _m.compose(_p.set(-pf - 1.2, gb + y, ps + 2.6), _q.identity(), _s.set(1.78, 0.3, 1.78)), P.iron, 0.02);
  }
  return { lamp, tagged: 0 };
}

/** The ladder in its own frame: the foot's middle at the origin, running up +y. */
function buildLadder(k: Kit): void {
  const { ladderL: len, ladderW: w } = C;
  for (const s of [-w / 2, w / 2]) k.beam(L(0, 0, s), L(0, len, s), 0.6, 0.6, s > 0 ? P.post : P.postDark, "box", 0.06);
  for (let y = 1.6; y < len - 0.4; y += 2.5) k.beam(L(0, y, -w / 2), L(0, y, w / 2), 0.2, 0.2, P.plank, "cyl6", 0.1);
}

/** The door in its own frame: the hinge's foot at the origin, the door running +z (across) and +y. */
function buildDoor(k: Kit): void {
  const { doorW: w, doorH: h } = C;
  for (let i = 0; i < 4; i++) k.block(0.15, h / 2, (w * (i + 0.5)) / 4, 0.5, h, w / 4 - 0.08, i % 2 ? P.door : P.logDark, 0.1);
  for (const y of [1.2, h - 1.2]) k.block(0.45, y, w / 2, 0.2, 0.45, w - 0.3, P.iron, 0.02);
  k.block(0.5, h * 0.48, w - 0.6, 0.3, 0.3, 0.3, P.iron, 0);
}

/** The pennant in its own frame: the pole's axis at the origin, flying out along +z. */
function buildFlag(k: Kit, furled: boolean): void {
  if (furled) {
    k.beam(L(0, -2.6, 0.35), L(0, 0.4, 0.35), 0.42, 0.42, P.pennantDark, "cyl6", 0.04);
    k.beam(L(0, -0.4, 0.35), L(0, 0.2, 0.35), 0.5, 0.5, P.rope, "cyl6", 0);
    return;
  }
  // A swallowtail pennant, both faces, a darker hem along the pole.
  const a: V3 = [0, 0.4, 0.2];
  const b: V3 = [0, -2.8, 0.2];
  const tip1: V3 = [0.25, 0.1, 8.2];
  const tip2: V3 = [0.25, -2.5, 8.2];
  const notch: V3 = [0.15, -1.2, 6.4];
  k.sheet(a, b, notch, P.pennant);
  k.sheet(a, notch, tip1, P.pennant);
  k.sheet(b, tip2, notch, P.pennant);
  k.quad([0, 0.4, 0.2], [0, -2.8, 0.2], [0.05, -2.8, 1.0], [0.05, 0.4, 1.0], P.pennantDark);
}

/** The lit parts, in the cache's local frame. Their vertex ranges are returned so the look can recolour them. */
function buildGlow(k: Kit, lamp: V3): { lamp: [number, number]; window: [number, number]; inside: [number, number] } {
  const { hd, postH, wall, doorW, doorH, doorS } = C;
  const deck = postH + 1.1;
  const eave = deck + wall;
  const l0 = k.vertexCount;
  k.block(lamp[0], lamp[1], lamp[2], 1.3, 2.0, 1.3, GL.dark, 0);
  const l1 = k.vertexCount;
  k.block(hd + 0.15, eave + 2.4, 0, 0.4, 1.8, 1.8, GL.dark, 0);
  const w1 = k.vertexCount;
  k.block(hd - 0.6, deck + doorH / 2, doorS, 0.15, doorH - 0.2, doorW - 0.2, GL.dark, 0);
  const i1 = k.vertexCount;
  return { lamp: [l0, l1], window: [l1, w1], inside: [w1, i1] };
}

/** A soft round spot (64 x 64, white to clear), for the lantern's halo. */
function haloTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 2.2);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Where each moving part stands for a look: 0 down / shut / furled .. 1 up / open / flying. */
function targetsOf(look: CheckpointLook): { ladder: number; door: number; flag: number; lamp: number; window: number; inside: number; pulse: boolean } {
  switch (look) {
    case "near":
      return { ladder: 0, door: 0, flag: 0, lamp: 1, window: 0.55, inside: 0, pulse: false };
    case "ready":
      return { ladder: 1, door: 0.22, flag: 1, lamp: 1, window: 1, inside: 1, pulse: true };
    case "claimed":
      return { ladder: 1, door: 1, flag: 1, lamp: 1, window: 1, inside: 1, pulse: false };
    default:
      // Closed is still a kept place: a dim light in the gable window, so the
      // cache reads as somewhere from the trail on day one.
      return { ladder: 0, door: 0, flag: 0, lamp: 0, window: 0.55, inside: 0, pulse: false };
  }
}

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const scene = ctx.scene;
  const U = makeUnits();
  const disposables: { dispose(): void }[] = [];
  const track = <X extends { dispose(): void }>(x: X): X => {
    disposables.push(x);
    return x;
  };
  const stats: Record<string, number | string> = {};

  // The frame: base on the ground at the cache's centre, turned so local +x looks along the facing.
  const gx = CHECKPOINT.x;
  const gz = CHECKPOINT.z;
  const gy = ctx.terrainHeight(gx, gz);
  const F = dirOf(CHECKPOINT.facing);
  const S = dirOf(CHECKPOINT.facing + 90);
  const yaw = Math.atan2(-F[1], F[0]);
  const ground = (f: number, s: number) => ctx.terrainHeight(gx + F[0] * f + S[0] * s, gz + F[1] * f + S[1] * s) - gy;

  const lm = new THREE.Group();
  lm.name = CHECKPOINT.mesh;
  lm.position.set(gx, gy, gz);
  lm.rotation.y = yaw;
  (ctx.root ?? scene).add(lm);

  const wood = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  wood.name = "CheckpointWood";
  const cloth = track(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  cloth.name = "CheckpointCloth";
  const glowMat = track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  glowMat.name = "CheckpointGlow";

  const meshes: THREE.Object3D[] = [];
  const mesh = (k: Kit, mat: THREE.Material, name: string, parent: THREE.Object3D) => {
    stats[`tris_${name}`] = Math.round(k.tris);
    const m = new THREE.Mesh(track(k.build()), mat);
    m.name = name;
    m.layers.set(NO_REFLECT_LAYER);
    parent.add(m);
    meshes.push(m);
    return m;
  };

  // ── The body ──
  const kBody = new Kit(U);
  const body = buildBody(kBody, ground);
  mesh(kBody, wood, "Checkpoint:body", lm);

  // ── The ladder: a pivot at its foot, turning about the across (s) axis ──
  const ladderPivot = new THREE.Group();
  ladderPivot.name = "Checkpoint:ladderPivot";
  // A rail's half thickness over the ground, so the ladder lying down rests on it.
  ladderPivot.position.set(C.ladderFoot, ground(C.ladderFoot, C.doorS) + 0.3, C.doorS);
  lm.add(ladderPivot);
  {
    const k = new Kit(U);
    buildLadder(k);
    mesh(k, wood, "Checkpoint:ladder", ladderPivot);
  }
  /** Lean back toward the porch's edge: from the foot to the deck's edge plus a rung over it. */
  const deckY = C.postH + 1.1;
  const leanUp = Math.atan2(C.ladderFoot - (C.hd + C.porch), deckY + 0.8 - ladderPivot.position.y);
  /** Lying on the ground toward the trail: the ground's own fall under its length, plus a rail's thickness. */
  const lyingRise = ground(C.ladderFoot + C.ladderL, C.doorS) - ground(C.ladderFoot, C.doorS);
  const lieDown = -(Math.PI / 2 - Math.atan2(lyingRise + 0.5, C.ladderL));
  // Rotation about local z (the across axis): +angle tips the ladder's top toward -x (the porch).
  const ladderAngle = (u: number) => lieDown + (leanUp - lieDown) * u;
  ladderPivot.rotation.z = ladderAngle(0);

  // ── The door on its hinge (the doorway's left edge), opening outward ──
  const doorPivot = new THREE.Group();
  doorPivot.name = "Checkpoint:doorPivot";
  doorPivot.position.set(C.hd - 0.3, deckY, C.doorS - C.doorW / 2);
  lm.add(doorPivot);
  {
    const k = new Kit(U);
    buildDoor(k);
    mesh(k, wood, "Checkpoint:door", doorPivot);
  }
  const DOOR_OPEN = 1.75;

  // ── The pennant ──
  const flagPivot = new THREE.Group();
  flagPivot.name = "Checkpoint:flagPivot";
  flagPivot.position.set(C.hd + 0.6, deckY + C.wall + C.rise + C.pole - 0.4, 0);
  lm.add(flagPivot);
  let flag: THREE.Mesh;
  let furled: THREE.Mesh;
  {
    const k = new Kit(U);
    buildFlag(k, false);
    flag = mesh(k, cloth, "Checkpoint:flag", flagPivot) as THREE.Mesh;
    const kf = new Kit(U);
    buildFlag(kf, true);
    furled = mesh(kf, wood, "Checkpoint:furled", flagPivot) as THREE.Mesh;
  }

  // ── The lit parts and the halo ──
  const kGlow = new Kit(U);
  const ranges = buildGlow(kGlow, body.lamp);
  const glow = mesh(kGlow, glowMat, "Checkpoint:glow", lm) as THREE.Mesh;
  const glowColors = glow.geometry.getAttribute("color") as THREE.BufferAttribute;
  const haloMat = track(
    new THREE.SpriteMaterial({
      map: track(haloTexture()),
      color: new THREE.Color(GL.lamp[0] * 0.5, GL.lamp[1] * 0.5, GL.lamp[2] * 0.5),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  haloMat.name = "CheckpointHalo";
  const halo = new THREE.Sprite(haloMat);
  halo.name = "Checkpoint:halo";
  halo.layers.set(NO_REFLECT_LAYER);
  halo.position.set(body.lamp[0], body.lamp[1], body.lamp[2]);
  halo.scale.setScalar(10);
  halo.visible = false;
  lm.add(halo);
  meshes.push(halo);

  for (const U0 of Object.values(U)) U0.dispose();
  // The parts that move or light with the look are left out of the landmark's
  // box, samples and pin (scene.ts wakeTagged), so the pin sits in the same
  // place in every look. progress-world.ts switches only tags with a place and
  // an `at`, so it leaves these alone.
  for (const o of [ladderPivot, doorPivot, flagPivot, glow, halo]) o.userData.wake = { checkpoint: true };
  lm.updateMatrixWorld(true);

  // Footprints: the posts' square plus the porch, and the supplies; the ladder lies on the trail's side.
  addFootprint({ x: gx + F[0] * 1.5, z: gz + F[1] * 1.5, r: 10.5, kind: "building" });
  addFootprint({ x: gx + F[0] * -1.5 + S[0] * -9.6, z: gz + F[1] * -1.5 + S[1] * -9.6, r: 3.4, kind: "prop" });

  // ── The look ──
  let look: CheckpointLook = "closed";
  const now = { ladder: 0, door: 0, flag: 0 };
  let target = targetsOf(look);
  let moving = false;
  let colorsDirty = true;
  let level = -1;
  const reduced = ctx.reducedMotion;

  const paint = (range: [number, number], on: number, col: RGB) => {
    for (let i = range[0]; i < range[1]; i++) {
      glowColors.setXYZ(i, GL.dark[0] + (col[0] - GL.dark[0]) * on, GL.dark[1] + (col[1] - GL.dark[1]) * on, GL.dark[2] + (col[2] - GL.dark[2]) * on);
    }
  };
  const applyParts = () => {
    ladderPivot.rotation.z = ladderAngle(easeInOut(now.ladder));
    // About +y: the door's free edge (+z) swings out to +x, the porch.
    doorPivot.rotation.y = DOOR_OPEN * easeInOut(now.door);
    const flying = now.flag > 0.02;
    flag.visible = flying;
    furled.visible = !flying;
    flag.scale.set(1, 1, Math.max(0.05, easeInOut(now.flag)));
    ladderPivot.updateMatrixWorld(true);
    doorPivot.updateMatrixWorld(true);
    flagPivot.updateMatrixWorld(true);
  };
  applyParts();

  const setLook = (next: CheckpointLook) => {
    if (next === look) return;
    look = next;
    target = targetsOf(look);
    colorsDirty = true;
    if (reduced) {
      now.ladder = target.ladder;
      now.door = target.door;
      now.flag = target.flag;
      applyParts();
      moving = false;
    } else {
      moving = true;
    }
  };

  const camPos = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const centre = new THREE.Vector3(gx, gy + 20, gz);
  const sphere = new THREE.Sphere(centre, 40);
  let inView = false;
  const lightState = () => (scene.userData.light as { state?: { lampGlow: number } } | undefined)?.state;

  stats.triangles = Math.round(Object.keys(stats).filter((k) => k.startsWith("tris_")).reduce((a, k) => a + Number(stats[k]), 0));
  stats.calls = 6;
  stats.buildMs = Math.round(performance.now() - t0);

  return {
    name: "dress-checkpoint",
    setCheckpoint(next: CheckpointLook) {
      setLook(next);
    },
    update(time: number, dt: number): boolean {
      const cam = ctx.camera;
      cam.getWorldPosition(camPos);
      let changed = false;
      if (camPos.distanceTo(centre) < ANIMATE_DIST) {
        pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv);
        inView = frustum.intersectsSphere(sphere);
      } else {
        inView = false;
      }
      // A change nobody can see goes straight to its new place.
      if (moving && !inView) {
        now.ladder = target.ladder;
        now.door = target.door;
        now.flag = target.flag;
        applyParts();
        moving = false;
        changed = true;
      }
      if (moving) {
        const step = Math.min(0.1, Math.max(0, dt)) / MOVE_S;
        let still = true;
        for (const key of ["ladder", "door", "flag"] as const) {
          const d = target[key] - now[key];
          if (Math.abs(d) <= step) now[key] = target[key];
          else {
            now[key] += Math.sign(d) * step;
            still = false;
          }
        }
        applyParts();
        moving = !still;
        changed = true;
      }
      // The glass: the lamp level, floored; the ready pulse on top.
      const lg = lightState()?.lampGlow ?? 0.7;
      const base = Math.max(GLASS_FLOOR, lg);
      const pulse = target.pulse && !reduced ? 0.78 + 0.22 * (0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / PULSE_S)) : 1;
      const lvl = base * pulse;
      if (colorsDirty) {
        colorsDirty = false;
        paint(ranges.lamp, target.lamp, GL.lamp);
        paint(ranges.window, target.window, GL.window);
        paint(ranges.inside, target.inside, GL.inside);
        glowColors.needsUpdate = true;
        halo.visible = target.lamp > 0;
        changed = true;
      }
      if (Math.abs(lvl - level) > 1e-3) {
        level = lvl;
        glowMat.color.setScalar(lvl);
        const night = Math.min(1, Math.max(0, (lg - 0.45) / 0.55));
        haloMat.opacity = (0.55 + 0.45 * night) * pulse;
        halo.scale.setScalar(9 + 5 * night);
        changed = changed || inView;
      }
      // The pennant sways a little while it flies.
      if (now.flag > 0.02 && !reduced && inView) {
        flagPivot.rotation.y = 0.12 * Math.sin(time * 1.3) + 0.05 * Math.sin(time * 3.1);
        flagPivot.updateMatrixWorld(true);
        changed = true;
      }
      return changed;
    },
    isAnimating() {
      return inView && (moving || (target.pulse && !reduced) || (now.flag > 0.02 && !reduced));
    },
    stats: () => ({ ...stats, look }),
    dispose() {
      lm.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  } as WorldModule & { setCheckpoint(look: CheckpointLook): void };
};
