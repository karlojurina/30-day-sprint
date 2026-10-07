import * as THREE from "three";

/**
 * v6 grass atlas (world_art_bible_v6.md 2.3, 2.7): one 512x512 RGBA texture,
 * painted at load in canvas 2D at 1024 and drawn down once, seeded (the same
 * every load, nothing downloaded). cover.ts draws every clump from it.
 *
 * The channels are DATA, not colour (NoColorSpace), so one atlas serves every
 * surface and every time of day; the colours come from each clump's instance
 * (its root from the ground under it, its tip from the surface's kit, its
 * heads from the drift) and the light key does the rest:
 *
 *   R  value inside the clump: back blades darker, front blades lighter, a
 *      lit strip down one side of each blade; on heads, the head's shading
 *   G  head mask: 1 on flower heads and reed seed heads (coloured by iHead)
 *   B  t along each blade: 0 at its root, 1 at its tip (dark root, pale tip)
 *   A  coverage: hard edges, cut with alphaToCoverage in cover.ts
 *
 * Layout: the top half holds four TALL cells (128 x 256: tall dry grass, a
 * drooping variant, dune grass, reeds); the bottom half eight SQUARE cells
 * (128 x 128: short grass, a second short, sparse dry, fern, bracken, and the
 * three flower drifts). Every cell keeps a 3 px empty margin on its sides and
 * top, so mip levels never bleed between cells.
 *
 * UV convention: the texture is uploaded from the canvas rows as they are
 * (flipY off), so texture v runs DOWN the canvas. A cell's (u0, v0) is its
 * root edge (the bottom of the painted clump) and (u1, v1) its tip edge:
 * v0 > v1. cover.ts maps a card's local (0..1, 0 root .. 1 tip) onto
 * mix(u0, u1, x), mix(v0, v1, y).
 */

export const GRASS_ATLAS_SIZE = 512;
/** Kept for the A2 stub's signature: the atlas is 4 columns wide; rows vary (see the layout above). */
export const GRASS_COLS = 4;
export const GRASS_ROWS = 2;

export type GrassKind =
  | "tallDry"
  | "tallDry2"
  | "dune"
  | "reeds"
  | "short"
  | "short2"
  | "shortDry"
  | "fern"
  | "fern2"
  | "flowerRed"
  | "flowerCream"
  | "flowerViolet";

export interface GrassCell {
  id: GrassKind;
  /** Index in GRASS_CELLS, the per instance cell value. */
  index: number;
  col: number;
  row: number;
  /** Root edge (bottom of the clump) in texture space: u0 left, v0 root. */
  u0: number;
  v0: number;
  /** Tip edge: u1 right, v1 top of the cell. v1 < v0 (texture v runs down the canvas). */
  u1: number;
  v1: number;
  /** Painted width over height: a card of height h is h * aspect wide. */
  aspect: number;
}

/** [id, x, y, w, h] in 512 px, canvas coordinates (y down). */
const RECTS: ReadonlyArray<readonly [GrassKind, number, number, number, number]> = [
  ["tallDry", 0, 0, 128, 256],
  ["tallDry2", 128, 0, 128, 256],
  ["dune", 256, 0, 128, 256],
  ["reeds", 384, 0, 128, 256],
  ["short", 0, 256, 128, 128],
  ["short2", 128, 256, 128, 128],
  ["shortDry", 256, 256, 128, 128],
  ["fern", 384, 256, 128, 128],
  ["fern2", 0, 384, 128, 128],
  ["flowerRed", 128, 384, 128, 128],
  ["flowerCream", 256, 384, 128, 128],
  ["flowerViolet", 384, 384, 128, 128],
];

const S = GRASS_ATLAS_SIZE;
export const GRASS_CELLS: readonly GrassCell[] = RECTS.map(([id, x, y, w, h], index) => ({
  id,
  index,
  col: x / 128,
  row: y / 128,
  // Half a texel in from the cell's sides; the root edge is the cell's last row.
  u0: (x + 0.5) / S,
  u1: (x + w - 0.5) / S,
  v0: (y + h - 0.5) / S,
  v1: (y + 0.5) / S,
  aspect: w / h,
}));

export function grassCell(id: GrassKind): GrassCell {
  const c = GRASS_CELLS.find((g) => g.id === id);
  if (!c) throw new Error("no grass cell " + id);
  return c;
}

// ── Painting ─────────────────────────────────────────────────────────────────

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** mulberry32, seeded. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** A fill for a blade: R = value, G = head, B runs 0 at the root to 255 at the tip. */
function bladeFill(g: Ctx2D, x0: number, y0: number, x1: number, y1: number, val: number, head = 0, t0 = 0, t1 = 1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, `rgb(${byte(val)},${byte(head)},${byte(t0)})`);
  gr.addColorStop(1, `rgb(${byte(val)},${byte(head)},${byte(t1)})`);
  return gr;
}

interface BladeOpts {
  /** Root (canvas px, y down). */
  x: number;
  y: number;
  /** Height up from the root, px. */
  h: number;
  /** Width at the root, px. */
  w: number;
  /** Horizontal travel of the tip, as a share of h (+ right). */
  lean: number;
  /** 0 straight, 1 the lean all near the tip (a drooping blade). */
  bend: number;
  val: number;
  /** Extra value on the lit strip (0 for none). */
  lit?: number;
}

/** A tapered, curved blade with a lit strip down its right side. */
function blade(g: Ctx2D, o: BladeOpts) {
  const N = 10;
  const pts = (widthK: number, shift: number): Array<[number, number]> => {
    const L: Array<[number, number]> = [];
    const R: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const cx = o.x + o.lean * o.h * (o.bend * s * s + (1 - o.bend) * s);
      const cy = o.y - o.h * s;
      const dx = o.lean * o.h * (2 * o.bend * s + (1 - o.bend));
      const dy = -o.h;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const half = 0.5 * o.w * widthK * Math.pow(1 - s, 0.85);
      const ox = nx * half * shift;
      const oy = ny * half * shift;
      L.push([cx - nx * half + ox, cy - ny * half + oy]);
      R.push([cx + nx * half + ox, cy + ny * half + oy]);
    }
    return [...L, ...R.reverse()];
  };
  const tipX = o.x + o.lean * o.h;
  const tipY = o.y - o.h;
  const fill = (p: Array<[number, number]>, val: number) => {
    g.beginPath();
    g.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
    g.closePath();
    g.fillStyle = bladeFill(g, o.x, o.y, tipX, tipY, val);
    g.fill();
  };
  fill(pts(1, 0), o.val);
  if (o.lit) fill(pts(0.42, 1.1), Math.min(1, o.val + o.lit));
}

/** A disc head (flowers, umbels): the body at `val`, a lighter cap up and left. */
function headDisc(g: Ctx2D, x: number, y: number, r: number, val: number) {
  g.fillStyle = `rgb(${byte(val)},255,255)`;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = `rgb(${byte(Math.min(1, val + 0.28))},255,255)`;
  g.beginPath();
  g.ellipse(x - r * 0.18, y - r * 0.22, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
  g.fill();
}

/** Painting context for one cell at the paint scale. */
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Root line (px): the cell's bottom, a hair up. */
  base: number;
}

/** A fan of blades from a clump's root spread: back layer first, darker. */
function grassFan(g: Ctx2D, c: Cell, r: () => number, o: { n: number; hMin: number; hMax: number; wMin: number; wMax: number; spread: number; fan: number; bend: number; lit: number; lean?: number }) {
  const cx = c.x + c.w / 2;
  const blades: BladeOpts[] = [];
  for (let i = 0; i < o.n; i++) {
    const u = r() * 2 - 1;
    const x = cx + u * c.w * o.spread * 0.5;
    const hh = c.h * (o.hMin + (o.hMax - o.hMin) * Math.pow(r(), 0.8)) * (1 - 0.25 * Math.abs(u));
    const back = i < o.n * 0.45;
    blades.push({
      x,
      y: c.base,
      h: hh,
      w: (o.wMin + (o.wMax - o.wMin) * r()) * (back ? 0.9 : 1),
      lean: u * o.fan + (r() - 0.5) * 0.18 + (o.lean ?? 0),
      bend: o.bend * (0.6 + 0.8 * r()),
      val: back ? 0.5 + 0.14 * r() : 0.74 + 0.22 * r(),
      lit: o.lit,
    });
  }
  for (const b of blades) blade(g, b);
}

function paintTallDry(g: Ctx2D, c: Cell, r: () => number, droop: boolean) {
  grassFan(g, c, r, { n: 24, hMin: 0.5, hMax: 0.92, wMin: 7, wMax: 11, spread: 0.62, fan: droop ? 0.34 : 0.22, bend: droop ? 0.9 : 0.45, lit: 0.2 });
  // Seed stems: thin, above the leaves, with a pale oat head (value only).
  for (let i = 0; i < 6; i++) {
    const x = c.x + c.w * (0.3 + 0.4 * r());
    const hh = c.h * (0.78 + 0.18 * r());
    const lean = (r() - 0.5) * 0.3 + (droop ? 0.12 : 0);
    blade(g, { x, y: c.base, h: hh, w: 3.2, lean, bend: droop ? 0.8 : 0.3, val: 0.8 });
    const tx = x + lean * hh;
    const ty = c.base - hh;
    g.fillStyle = bladeFill(g, tx, ty + 30, tx, ty, 0.96, 0, 0.85, 1);
    g.beginPath();
    g.ellipse(tx, ty + 12, 4.5, 15, lean * 0.8, 0, Math.PI * 2);
    g.fill();
  }
}

function paintDune(g: Ctx2D, c: Cell, r: () => number) {
  // Long thin blades all leaning one way (away from the sea), a few short ones.
  for (let i = 0; i < 16; i++) {
    const back = i < 7;
    const x = c.x + c.w * (0.18 + 0.5 * r());
    blade(g, {
      x,
      y: c.base,
      h: c.h * (0.55 + 0.42 * r()),
      w: 6 + 4 * r(),
      lean: 0.18 + 0.32 * r(),
      bend: 0.75 + 0.25 * r(),
      val: back ? 0.52 + 0.14 * r() : 0.76 + 0.22 * r(),
      lit: 0.2,
    });
  }
  grassFan(g, c, r, { n: 7, hMin: 0.18, hMax: 0.36, wMin: 6, wMax: 9, spread: 0.5, fan: 0.4, bend: 0.5, lit: 0.15 });
}

function paintReeds(g: Ctx2D, c: Cell, r: () => number) {
  for (let i = 0; i < 12; i++) {
    const back = i < 5;
    blade(g, {
      x: c.x + c.w * (0.25 + 0.5 * r()),
      y: c.base,
      h: c.h * (0.62 + 0.36 * r()),
      w: 7 + 3 * r(),
      lean: (r() - 0.5) * 0.2,
      bend: 0.3 + 0.5 * r(),
      val: back ? 0.5 + 0.12 * r() : 0.72 + 0.22 * r(),
      lit: 0.18,
    });
  }
  // Cattails: a stem and a dark spindle head (head mask).
  for (let i = 0; i < 3; i++) {
    const x = c.x + c.w * (0.34 + 0.32 * r());
    const hh = c.h * (0.74 + 0.2 * r());
    const lean = (r() - 0.5) * 0.08;
    blade(g, { x, y: c.base, h: hh, w: 4, lean, bend: 0.2, val: 0.7 });
    const tx = x + lean * hh;
    const ty = c.base - hh;
    g.fillStyle = `rgb(${byte(0.72)},255,255)`;
    g.beginPath();
    g.ellipse(tx, ty + 26, 7, 22, lean, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgb(${byte(0.98)},255,255)`;
    g.beginPath();
    g.ellipse(tx - 2.5, ty + 22, 2.8, 14, lean, 0, Math.PI * 2);
    g.fill();
  }
}

function paintShort(g: Ctx2D, c: Cell, r: () => number, v: 0 | 1 | 2) {
  if (v === 0) grassFan(g, c, r, { n: 22, hMin: 0.42, hMax: 0.88, wMin: 9, wMax: 14, spread: 0.7, fan: 0.55, bend: 0.5, lit: 0.18 });
  else if (v === 1) {
    grassFan(g, c, r, { n: 16, hMin: 0.4, hMax: 0.9, wMin: 9, wMax: 13, spread: 0.46, fan: 0.5, bend: 0.55, lit: 0.18, lean: -0.08 });
    const side: Cell = { ...c, x: c.x + c.w * 0.22, w: c.w * 0.7 };
    grassFan(g, side, r, { n: 9, hMin: 0.25, hMax: 0.5, wMin: 8, wMax: 11, spread: 0.5, fan: 0.5, bend: 0.5, lit: 0.16, lean: 0.12 });
  } else {
    // Sparse, dry, thin: the sand's edge and dry knolls.
    grassFan(g, c, r, { n: 11, hMin: 0.35, hMax: 0.8, wMin: 5, wMax: 8, spread: 0.66, fan: 0.7, bend: 0.7, lit: 0.22 });
  }
}

/** A fern: arching fronds from the root, alternate leaflets shrinking to the tip. */
function paintFern(g: Ctx2D, c: Cell, r: () => number, bracken: boolean) {
  const cx = c.x + c.w / 2;
  const n = bracken ? 5 : 8;
  const order = Array.from({ length: n }, (_, i) => i).sort(() => r() - 0.5);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const back = k < n * 0.4;
    const ang = ((i + 0.5) / n - 0.5) * (bracken ? 2.2 : 2.6) + (r() - 0.5) * 0.25; // radians from vertical
    const len = c.h * (bracken ? 0.7 + 0.22 * r() : 0.62 + 0.3 * r());
    const val = back ? 0.5 + 0.12 * r() : 0.74 + 0.2 * r();
    const droop = 0.35 + 0.25 * r();
    // Midrib: from the root, out along ang, drooping at the end.
    const P = (s: number): [number, number] => {
      const a = ang * (1 + droop * s * s);
      return [cx + Math.sin(a) * len * s, c.base - Math.cos(a) * len * s * (1 - 0.25 * s * s)];
    };
    const steps = bracken ? 9 : 12;
    for (let j = 1; j <= steps; j++) {
      const s = 0.12 + (0.88 * j) / steps;
      const [px, py] = P(s);
      const [qx, qy] = P(Math.min(1, s + 0.04));
      const tx = qx - px;
      const ty = qy - py;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      const leaf = (bracken ? 34 : 24) * (1 - s * 0.8) * (0.85 + 0.3 * r());
      const wid = (bracken ? 9 : 6.5) * (1 - s * 0.6);
      for (const side of [-1, 1]) {
        const ex = px + (nx * side + (tx / tl) * 0.55) * leaf;
        const ey = py + (ny * side + (ty / tl) * 0.55) * leaf;
        g.fillStyle = `rgb(${byte(val + (side > 0 ? 0.08 : 0))},0,${byte(Math.min(1, s * 1.05))})`;
        g.beginPath();
        g.moveTo(px - (tx / tl) * wid, py - (ty / tl) * wid);
        g.lineTo(ex, ey);
        g.lineTo(px + (tx / tl) * wid * 1.4, py + (ty / tl) * wid * 1.4);
        g.closePath();
        g.fill();
      }
    }
    // The midrib itself, root dark to tip.
    g.strokeStyle = bladeFill(g, cx, c.base, P(1)[0], P(1)[1], val * 0.9);
    g.lineWidth = bracken ? 4 : 3;
    g.beginPath();
    const p0 = P(0);
    g.moveTo(p0[0], p0[1]);
    for (let j = 1; j <= 16; j++) {
      const p = P(j / 16);
      g.lineTo(p[0], p[1]);
    }
    g.stroke();
  }
}

function paintFlowers(g: Ctx2D, c: Cell, r: () => number, kind: "red" | "cream" | "violet") {
  // Leaves first: a low fan of grass so the stems grow out of something.
  grassFan(g, c, r, { n: 12, hMin: 0.25, hMax: 0.55, wMin: 8, wMax: 12, spread: 0.72, fan: 0.6, bend: 0.5, lit: 0.16 });
  const stems = kind === "cream" ? 5 : kind === "violet" ? 5 : 8;
  for (let i = 0; i < stems; i++) {
    const x = c.x + c.w * (0.2 + 0.6 * r());
    const hh = c.h * (kind === "violet" ? 0.55 + 0.4 * r() : 0.5 + 0.42 * r());
    const lean = (x - (c.x + c.w / 2)) / c.w * 0.5 + (r() - 0.5) * 0.12;
    blade(g, { x, y: c.base, h: hh, w: 4.2, lean, bend: 0.3, val: 0.7 });
    const tx = x + lean * hh;
    const ty = c.base - hh;
    if (kind === "red") {
      // Poppy like cups: 3 petals and a darker heart, plus a bud now and then.
      const rr = 12 + 5 * r();
      headDisc(g, tx - rr * 0.45, ty + 2, rr * 0.7, 0.66);
      headDisc(g, tx + rr * 0.45, ty + 2, rr * 0.7, 0.72);
      headDisc(g, tx, ty - rr * 0.25, rr * 0.75, 0.8);
      g.fillStyle = `rgb(${byte(0.25)},255,255)`;
      g.beginPath();
      g.arc(tx, ty + 1, rr * 0.22, 0, Math.PI * 2);
      g.fill();
      if (r() < 0.4) headDisc(g, tx + 16 * (r() - 0.5), c.base - hh * 0.7, 5, 0.6);
    } else if (kind === "cream") {
      // Yarrow umbels: a flat dome of small florets on short rays.
      const n = 10 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        const u = (k / (n - 1) - 0.5) * 2;
        const fx = tx + u * 22;
        const fy = ty + 4 + u * u * 8 + (r() - 0.5) * 5;
        g.strokeStyle = `rgb(${byte(0.62)},0,${byte(0.95)})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(tx, ty + 16);
        g.lineTo(fx, fy);
        g.stroke();
        headDisc(g, fx, fy - 2, 5 + 1.5 * r(), 0.64 + 0.2 * r());
      }
    } else {
      // Lupine spikes: florets stacked up the top half of the stem, shrinking.
      const n = 9;
      for (let k = 0; k < n; k++) {
        const s = k / (n - 1);
        const fy = c.base - hh * (0.5 + 0.5 * s);
        const fx = x + lean * hh * (0.5 + 0.5 * s) + (k % 2 ? 3 : -3);
        headDisc(g, fx, fy, 8.5 * (1 - s * 0.62), 0.6 + 0.3 * s);
      }
    }
  }
}

/** Grow colour into transparent texels (from their opaque neighbours), so mips never fringe dark. */
function dilate(px: Uint8ClampedArray | Uint8Array, n: number, passes: number) {
  const known = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) known[i] = px[i * 4 + 3] >= 16 ? 1 : 0;
  const next = new Uint8Array(n * n);
  for (let p = 0; p < passes; p++) {
    next.set(known);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= n) continue;
            const j = yy * n + xx;
            if (!known[j]) continue;
            r += px[j * 4];
            g += px[j * 4 + 1];
            b += px[j * 4 + 2];
            k++;
          }
        }
        if (k) {
          const o = i * 4;
          px[o] = r / k;
          px[o + 1] = g / k;
          px[o + 2] = b / k;
          next[i] = 1;
        }
      }
    }
    known.set(next);
  }
}

function makeCanvas(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; g: Ctx2D } | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d");
    return g ? { canvas, g } : null;
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  return g ? { canvas, g } : null;
}

let paintedData: Uint8Array | null = null;
let paintMs = 0;

/** The atlas bytes (512 x 512 RGBA), painted once per page; null without a 2D canvas. */
export function grassAtlasData(): Uint8Array | null {
  if (paintedData) return paintedData;
  const t0 = performance.now();
  const K = 2; // paint scale
  const big = makeCanvas(S * K, S * K);
  const small = makeCanvas(S, S);
  if (!big || !small) return null;
  const g = big.g;
  g.clearRect(0, 0, S * K, S * K);
  g.lineCap = "round";
  g.lineJoin = "round";
  const M = 3 * K; // margin
  for (const [id, x, y, w, h] of RECTS) {
    const c: Cell = { x: x * K + M, y: y * K + M, w: w * K - 2 * M, h: h * K - M - 2, base: (y + h) * K - 1 };
    c.h = c.base - c.y;
    const r = rng(0x9a55 + x * 7 + y * 13);
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.base - c.y + 1);
    g.clip();
    switch (id) {
      case "tallDry":
        paintTallDry(g, c, r, false);
        break;
      case "tallDry2":
        paintTallDry(g, c, r, true);
        break;
      case "dune":
        paintDune(g, c, r);
        break;
      case "reeds":
        paintReeds(g, c, r);
        break;
      case "short":
        paintShort(g, c, r, 0);
        break;
      case "short2":
        paintShort(g, c, r, 1);
        break;
      case "shortDry":
        paintShort(g, c, r, 2);
        break;
      case "fern":
        paintFern(g, c, r, false);
        break;
      case "fern2":
        paintFern(g, c, r, true);
        break;
      case "flowerRed":
        paintFlowers(g, c, r, "red");
        break;
      case "flowerCream":
        paintFlowers(g, c, r, "cream");
        break;
      case "flowerViolet":
        paintFlowers(g, c, r, "violet");
        break;
    }
    g.restore();
  }
  small.g.imageSmoothingEnabled = true;
  small.g.imageSmoothingQuality = "high";
  small.g.clearRect(0, 0, S, S);
  small.g.drawImage(big.canvas as CanvasImageSource, 0, 0, S, S);
  const img = small.g.getImageData(0, 0, S, S);
  const px = img.data;
  // Hard alpha: the cut lives in the shader, but the painted edge is kept a
  // little soft (two texels) so alphaToCoverage can antialias it.
  dilate(px, S, 4);
  paintedData = new Uint8Array(px.buffer.slice(0));
  paintMs = performance.now() - t0;
  return paintedData;
}

const perRenderer = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** The grass atlas for this renderer, painted on the first call (a 4x4 grey block without a 2D canvas). */
export function getGrassAtlas(renderer: THREE.WebGLRenderer): THREE.Texture {
  const hit = perRenderer.get(renderer);
  if (hit) return hit;
  const data = grassAtlasData();
  let tex: THREE.DataTexture;
  if (data) {
    tex = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = "V6GrassAtlas";
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  } else {
    const d = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) d.set([200, 0, 128, 255], i * 4);
    tex = new THREE.DataTexture(d, 4, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = "V6GrassAtlas(fallback)";
  }
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  perRenderer.set(renderer, tex);
  return tex;
}

export function grassAtlasStats(): Record<string, number | string> {
  return {
    paintMs: Math.round(paintMs * 100) / 100,
    size: paintedData ? S : 4,
    cells: GRASS_CELLS.length,
    bytesWithMips: paintedData ? Math.round((S * S * 4 * 4) / 3) : 0,
  };
}
