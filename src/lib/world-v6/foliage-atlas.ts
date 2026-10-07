import * as THREE from "three";

/**
 * v6 foliage atlas (world_art_bible_v6.md 2.1, v6_techniques.md 1 "Painting a
 * good cell"). 1024 x 1024, 16 cells, painted at load in canvas 2D at 2048 and
 * drawn down once, seeded, the same every load, nothing downloaded.
 *
 * Layout: a 4 x 4 grid of square cells, cell 0 at the top left (u0, v1),
 * row by row. uv runs bottom up as three's textures do (flipY), so a cell's
 * (u0, v0) is its bottom left corner, where the trunk stands at u = (u0+u1)/2.
 *
 * How a cell is painted (the Firewatch rules): branch clumps are filled
 * polygons with a zigzag lower edge, 3 to 6 per whorl, 10 to 20 percent of
 * whorl sides skipped so sky shows through; three flat values per clump (dark
 * body at the zigzag underside, mid, a lit band along the upper edge toward
 * the tips); upper whorls overlap the ones below; the trunk leans 0 to 4
 * degrees and the leader bends; the two sides are uneven; alpha is hard.
 *
 * Channels: rgb the painted colour (sRGB). Alpha: 0 = empty, 0.8 = foliage,
 * 1.0 = foliage that glows (the magic cells' tips, strands and undersides).
 * The forest shader reads coverage as min(a / 0.8, 1) and the glow as
 * smoothstep(0.86, 0.96, a). Empty texels carry the cell's dark body colour,
 * so the mips never bleed black into the far puff.
 */

export const FOLIAGE_ATLAS_SIZE = 1024;
export const FOLIAGE_GRID = 4;

export type FoliageSpecies = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "magic";

export interface FoliageCell {
  /** Stable name, for example "spruce-a". */
  id: string;
  species: FoliageSpecies;
  /** Index in FOLIAGE_CELLS, the per instance aCell value. */
  index: number;
  col: number;
  row: number;
  /** uv rectangle, bottom left (u0, v0) to top right (u1, v1). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** The cell carries a glow mask (the magic cells, the teal tipped spruce). */
  glow: boolean;
}

const IDS: ReadonlyArray<readonly [string, FoliageSpecies, boolean]> = [
  ["spruce-a", "S1", false],
  ["spruce-b", "S1", false],
  ["spruce-c", "S1", false],
  ["lodgepole-a", "S2", false],
  ["lodgepole-b", "S2", false],
  ["fir-spire", "S3", false],
  ["young-spruce", "S6", false],
  ["aspen-a", "S4", false],
  ["aspen-b", "S4", false],
  ["shrub-a", "S7", false],
  ["shrub-b", "S7", false],
  ["spruce-dying", "S1", false],
  ["snag", "S5", false],
  ["spruce-teal", "magic", true],
  ["willow-lobe", "magic", true],
  ["elder-lobe", "magic", true],
];

export const FOLIAGE_CELLS: readonly FoliageCell[] = IDS.map(([id, species, glow], index) => {
  const col = index % FOLIAGE_GRID;
  const row = Math.floor(index / FOLIAGE_GRID);
  const s = 1 / FOLIAGE_GRID;
  return { id, species, index, col, row, u0: col * s, u1: (col + 1) * s, v0: 1 - (row + 1) * s, v1: 1 - row * s, glow };
});

/** The cell with this id, or undefined. */
export function foliageCell(id: string): FoliageCell | undefined {
  return FOLIAGE_CELLS.find((c) => c.id === id);
}

// ── Painting ────────────────────────────────────────────────────────────────

/** Paint resolution (drawn down to FOLIAGE_ATLAS_SIZE once). */
const P = 2048;
const CS = P / FOLIAGE_GRID;
/** Margins inside a cell at paint size: the mips of far trees must not bleed into the neighbour. */
const M_SIDE = 18;
const M_TOP = 18;
const M_BOT = 6;

type Pal = readonly [string, string, string];
interface Pt {
  x: number;
  y: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poly(g: CanvasRenderingContext2D, pts: readonly Pt[], fill: string) {
  if (pts.length < 3) return;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fill();
}

/** A tapered trunk from (x0, y0) up to (x1, y1), half widths w0 and w1. */
function trunk(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, fill: string) {
  poly(
    g,
    [
      { x: x0 - w0, y: y0 },
      { x: x1 - w1, y: y1 },
      { x: x1 + w1, y: y1 },
      { x: x0 + w0, y: y0 },
    ],
    fill,
  );
}

/**
 * One branch clump: from the trunk at (x0, y) out to a tip `len` away on side
 * s (-1 left, 1 right), drooping `droop` px at the tip (negative points up),
 * `th` thick. Three flat values: the whole clump dark (its zigzag underside
 * stays dark), a mid band under the upper edge, a lit band along the upper
 * edge's outer part.
 */
function clump(g: CanvasRenderingContext2D, rnd: () => number, x0: number, y: number, s: number, len: number, th: number, droop: number, pal: Pal, teeth: number, glowG: CanvasRenderingContext2D | null) {
  const n = 7;
  const up: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // The upper edge bows up a little, then falls to the tip.
    const bow = Math.sin(t * Math.PI) * th * 0.28;
    // Needle fringe: every other point on the outer half pokes up.
    const spike = t > 0.35 && t < 0.98 && i % 2 === 1 ? th * (0.18 + 0.3 * rnd()) : 0;
    up.push({ x: x0 + s * len * t, y: y - th * 0.42 * (1 - t) + droop * t * t - bow - spike });
  }
  const tip = up[n];
  // The zigzag underside, tip back to the trunk.
  const low: Pt[] = [];
  const k = teeth;
  for (let j = 0; j <= k; j++) {
    const t = 1 - j / k;
    const bx = x0 + s * len * t;
    const by = y + th * 0.55 * (1 - t) + droop * t * t + th * 0.1;
    if (j > 0) {
      // A tooth hanging down between this point and the last.
      const tm = 1 - (j - 0.5) / k;
      const tx = x0 + s * len * tm + s * (rnd() - 0.5) * (len / k) * 0.5;
      const ty = y + th * 0.55 * (1 - tm) + droop * tm * tm + th * (0.45 + 0.45 * rnd()) * (0.5 + 0.5 * tm);
      low.push({ x: tx, y: ty });
    }
    low.push({ x: bx, y: by - (j > 0 && j < k ? th * 0.12 * rnd() : 0) });
  }
  const body = [...up, ...low.slice(1)];
  poly(g, body, pal[0]);
  // Mid: under the upper edge, down to about half the thickness, its own small zigzag.
  const mid: Pt[] = [...up];
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const u = up[i];
    const d = th * (0.3 + 0.22 * (i % 2 === 0 ? 1 : 0.4)) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5 + 0.25));
    mid.push({ x: u.x, y: u.y + d });
  }
  poly(g, mid, pal[1]);
  // Lit: a thin band on the outer 60 percent of the upper edge, thickest near the tip.
  const lit: Pt[] = [];
  const i0 = Math.floor(n * (0.45 + 0.2 * rnd()));
  for (let i = i0; i <= n; i++) lit.push(up[i]);
  for (let i = n; i >= i0; i--) {
    const t = (i - i0) / Math.max(1, n - i0);
    lit.push({ x: up[i].x - s * th * 0.08, y: up[i].y + th * (0.1 + 0.16 * Math.sin(t * Math.PI)) });
  }
  if (rnd() < 0.8) poly(g, lit, pal[2]);
  if (glowG) {
    // The tips glow (the teal tipped spruce): the outer third of the lit band.
    const gl: Pt[] = [];
    const j0 = Math.floor(n * 0.62);
    for (let i = j0; i <= n; i++) gl.push(up[i]);
    for (let i = n; i >= j0; i--) gl.push({ x: up[i].x, y: up[i].y + th * 0.26 });
    gl.push({ x: tip.x + s * 2, y: tip.y + th * 0.3 });
    poly(glowG, gl, "#fff");
  }
}

interface ConiferSpec {
  /** Half width of the crown at its widest, as a share of the height. */
  halfW: number;
  /** Where the lowest branches start, share of height. */
  crownStart: number;
  whorls: number;
  /** Width profile: w = halfW * shape(t), t 0 at the crown's base, 1 at the top. */
  shape: (t: number) => number;
  /** Droop of the tip as a share of the branch length, at the bottom and at the top (negative = up). */
  droopLow: number;
  droopHigh: number;
  /** Share of whorl sides left empty (sky gaps). */
  skip: number;
  /** Clump thickness as a share of the height, bottom and top. */
  thLow: number;
  thHigh: number;
  pal: Pal;
  trunk: string;
  lean: number;
  /** Rust patches: share of clumps painted in this palette (dead branches). */
  dead?: { share: number; pal: Pal };
  glow?: boolean;
  /** Draw a narrow dark backing cone behind the whorls (fills the core, keeps the edges ragged). */
  backing: number;
}

function paintConifer(g: CanvasRenderingContext2D, glowG: CanvasRenderingContext2D | null, cx: number, by: number, H: number, sp: ConiferSpec, rnd: () => number) {
  const lean = (rnd() - 0.5) * 2 * sp.lean;
  const topX = cx + Math.tan(lean) * H;
  const xAt = (t: number) => cx + (topX - cx) * t + (t > 0.85 ? Math.sin((t - 0.85) * 18) * H * 0.006 : 0);
  trunk(g, cx, by, topX, by - H, H * 0.018, H * 0.004, sp.trunk);
  // The dark core mass: the gaps near the trunk read as deep crown, never as sky.
  if (sp.backing > 0) {
    const pts: Pt[] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = sp.crownStart + ((1 - sp.crownStart) * i) / n;
      pts.push({ x: xAt(t) - H * sp.halfW * sp.shape((t - sp.crownStart) / (1 - sp.crownStart)) * sp.backing, y: by - t * H });
    }
    for (let i = n; i >= 0; i--) {
      const t = sp.crownStart + ((1 - sp.crownStart) * i) / n;
      pts.push({ x: xAt(t) + H * sp.halfW * sp.shape((t - sp.crownStart) / (1 - sp.crownStart)) * sp.backing, y: by - t * H });
    }
    poly(g, pts, sp.pal[0]);
  }
  const N = sp.whorls;
  for (let i = 0; i < N; i++) {
    const f = (i + 0.35 * (rnd() - 0.5)) / N;
    const t = sp.crownStart + (1 - sp.crownStart) * Math.max(0, f);
    const y = by - t * H;
    const x0 = xAt(t);
    const tc = (t - sp.crownStart) / (1 - sp.crownStart);
    const w = H * sp.halfW * sp.shape(tc);
    const th = H * (sp.thLow + (sp.thHigh - sp.thLow) * tc) * (0.85 + 0.3 * rnd());
    const droopK = sp.droopLow + (sp.droopHigh - sp.droopLow) * tc;
    for (const s of rnd() < 0.5 ? [-1, 1] : [1, -1]) {
      if (rnd() < sp.skip && tc > 0.08 && tc < 0.9) continue;
      const pal = sp.dead && rnd() < sp.dead.share ? sp.dead.pal : sp.pal;
      // Uneven sides: each side its own length.
      const len = w * (0.6 + 0.6 * rnd());
      const teeth = 3 + Math.floor(rnd() * 3);
      // A shorter inner clump first on some whorls (3 to 6 per whorl in all).
      if (rnd() < 0.55 && len > H * 0.05) clump(g, rnd, x0, y + th * 0.25, s, len * (0.45 + 0.2 * rnd()), th * 0.8, len * droopK * 0.6, pal, 2 + Math.floor(rnd() * 2), null);
      clump(g, rnd, x0, y, s, len, th, len * droopK, pal, teeth, sp.glow ? glowG : null);
      // A spray hanging off the end of the longer low branches (the drooping skirts).
      if (tc < 0.55 && len > w * 0.85 && rnd() < 0.5) clump(g, rnd, x0 + s * len * 0.55, y + th * 0.5 + len * droopK * 0.3, s, len * 0.5, th * 0.7, len * droopK * 0.9 + th * 0.4, pal, 3, null);
    }
  }
  // The leader: a thin spike above the last whorl.
  const tipT = 1;
  const lx = xAt(tipT);
  poly(
    g,
    [
      { x: lx - H * 0.012, y: by - H * 0.93 },
      { x: lx + H * 0.004, y: by - H * tipT },
      { x: lx + H * 0.012, y: by - H * 0.93 },
    ],
    sp.pal[1],
  );
}

/** A spiky tuft (pine needles or a leafy lobe): a jagged ellipse in three values. */
function tuft(g: CanvasRenderingContext2D, rnd: () => number, cx: number, cy: number, rx: number, ry: number, pal: Pal, spikes: number, jag: number, glowG: CanvasRenderingContext2D | null = null, glowUnder = false) {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 + jag * (0.4 + 0.6 * rnd()) : 1 - jag * 0.5 * rnd();
    // Flatter underside.
    const yk = Math.sin(a) > 0 ? 0.75 : 1;
    pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r * yk });
  }
  poly(g, pts, pal[0]);
  // Mid: the upper two thirds, shifted up.
  const mid = pts.map((p) => ({ x: cx + (p.x - cx) * 0.86, y: cy - ry * 0.16 + (p.y - cy) * 0.78 }));
  poly(g, mid, pal[1]);
  // Lit cap: the top, shifted up more.
  const lit = pts
    .filter((p) => p.y < cy - ry * 0.05)
    .map((p) => ({ x: cx + (p.x - cx) * 0.8, y: cy - ry * 0.3 + (p.y - cy) * 0.62 }));
  poly(g, lit, pal[2]);
  if (glowG && glowUnder) {
    const under = pts.filter((p) => p.y > cy + ry * 0.2).map((p) => ({ x: p.x, y: p.y }));
    if (under.length > 2) {
      under.unshift({ x: cx - rx * 0.8, y: cy + ry * 0.2 });
      under.push({ x: cx + rx * 0.8, y: cy + ry * 0.2 });
      poly(glowG, under, "#fff");
    }
  }
}

function paintLodgepole(g: CanvasRenderingContext2D, cx: number, by: number, H: number, pal: Pal, bark: string, rnd: () => number, variant: number) {
  const lean = (rnd() - 0.5) * 0.06;
  const topX = cx + Math.tan(lean) * H;
  const xAt = (t: number) => cx + (topX - cx) * t;
  trunk(g, cx, by, topX, by - H * 0.97, H * 0.016, H * 0.006, bark);
  // Dead stubs on the bare lower trunk.
  const bare = variant === 0 ? 0.52 : 0.6;
  for (let i = 0; i < 7; i++) {
    const t = 0.18 + (bare - 0.18) * (i / 7) + 0.03 * rnd();
    const s = i % 2 === 0 ? -1 : 1;
    const x0 = xAt(t);
    const y0 = by - t * H;
    const L = H * (0.025 + 0.035 * rnd());
    poly(
      g,
      [
        { x: x0, y: y0 - H * 0.004 },
        { x: x0 + s * L, y: y0 + L * (0.2 + 0.4 * rnd()) },
        { x: x0, y: y0 + H * 0.006 },
      ],
      bark,
    );
  }
  // The crown: short branches out and up, a needle tuft at each end.
  const n = variant === 0 ? 9 : 7;
  const spots: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = bare + (0.94 - bare) * (i / (n - 1)) + 0.02 * (rnd() - 0.5);
    const s = (i + variant) % 2 === 0 ? -1 : 1;
    const reach = H * (0.05 + 0.09 * rnd()) * (1 - 0.55 * ((t - bare) / (1 - bare)));
    const x0 = xAt(t);
    const y0 = by - t * H;
    const ex = x0 + s * reach;
    const ey = y0 - reach * (0.35 + 0.4 * rnd());
    trunk(g, x0, y0, ex, ey, H * 0.004, H * 0.002, bark);
    spots.push([ex, ey, H * (0.045 + 0.03 * rnd()), H * (0.03 + 0.018 * rnd())]);
  }
  // Tufts along the trunk fill the crown's middle unevenly.
  for (let i = 0; i < 4; i++) {
    const t = bare + 0.08 + (0.85 - bare) * rnd();
    spots.push([xAt(t) + (rnd() - 0.5) * H * 0.03, by - t * H, H * (0.04 + 0.02 * rnd()), H * 0.03]);
  }
  spots.push([xAt(0.97), by - 0.955 * H, H * 0.035, H * 0.03]);
  spots.sort((a, b) => b[1] - a[1]);
  for (const [x, y, rx, ry] of spots) tuft(g, rnd, x, y, rx, ry, pal, 14 + Math.floor(rnd() * 6), 0.35);
}

function paintAspen(g: CanvasRenderingContext2D, cx: number, by: number, H: number, pal: Pal, rnd: () => number, variant: number) {
  const lean = (rnd() - 0.5) * 0.08;
  const topX = cx + Math.tan(lean) * H;
  const xAt = (t: number) => cx + (topX - cx) * t;
  // A white trunk with dark marks, forking into the crown.
  trunk(g, cx, by, topX, by - H * 0.9, H * 0.014, H * 0.005, "#cfc8b6");
  for (let i = 0; i < 9; i++) {
    const t = 0.05 + 0.5 * (i / 9) + 0.03 * rnd();
    const x = xAt(t);
    const y = by - t * H;
    const w = H * 0.012 * (1 - 0.4 * t);
    poly(
      g,
      [
        { x: x - w, y },
        { x: x + w * (0.3 + 0.7 * rnd()), y: y - H * 0.004 },
        { x: x + w * 0.2, y: y + H * 0.006 },
      ],
      "#3a342c",
    );
  }
  // The crown: 11 to 16 small round lobes in an uneven oval, bottom first.
  const n = variant === 0 ? 14 : 12;
  const cy = 0.66;
  const rx = variant === 0 ? 0.2 : 0.17;
  const ry = variant === 0 ? 0.3 : 0.33;
  const lobes: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.9;
    const t = cy + Math.sin(a) * ry * d;
    lobes.push([xAt(t) + Math.cos(a) * rx * d * H * (a > Math.PI ? 1.1 : 0.9), by - t * H, H * (0.055 + 0.035 * rnd())]);
  }
  lobes.push([xAt(0.95), by - 0.93 * H, H * 0.05]);
  lobes.sort((a, b) => b[1] - a[1]);
  // Twigs to the outer lobes.
  for (const [x, y] of lobes) {
    const t = Math.min(0.9, Math.max(0.42, (by - y) / H - 0.06));
    trunk(g, xAt(t), by - t * H, x, y, H * 0.004, H * 0.002, "#8d8676");
  }
  for (const [x, y, r] of lobes) tuft(g, rnd, x, y, r * 1.15, r, pal, 16, 0.22);
}

function paintShrub(g: CanvasRenderingContext2D, cx: number, by: number, W: number, pal: Pal, rnd: () => number, variant: number) {
  // A low ragged dome: overlapping tufts, the outer ones lower, bottom first.
  const Hs = W * (variant === 0 ? 0.55 : 0.48);
  const lobes: [number, number, number, number][] = [];
  const n = variant === 0 ? 11 : 13;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1 + (rnd() - 0.5) * 0.15;
    const top = Math.sqrt(Math.max(0, 1 - u * u));
    const y = by - Hs * (0.25 + 0.45 * top * rnd());
    lobes.push([cx + u * W * 0.4, y, W * (0.09 + 0.06 * rnd()) * (0.6 + 0.4 * top), Hs * (0.2 + 0.1 * rnd())]);
  }
  for (let i = 0; i < 4; i++) lobes.push([cx + (rnd() - 0.5) * W * 0.35, by - Hs * (0.62 + 0.18 * rnd()), W * 0.1, Hs * 0.2]);
  lobes.sort((a, b) => b[1] - a[1]);
  for (const [x, y, rx, ry] of lobes) tuft(g, rnd, x, Math.min(y, by - ry * 0.75), rx, ry, pal, 16, 0.4);
}

function paintSnag(g: CanvasRenderingContext2D, cx: number, by: number, H: number, rnd: () => number) {
  const lean = 0.04;
  const topX = cx + Math.tan(lean) * H;
  const xAt = (t: number) => cx + (topX - cx) * t;
  const dark = "#5a554c";
  const mid = "#8a8477";
  const lit = "#b1aa99";
  trunk(g, cx, by, topX, by - H * 0.94, H * 0.02, H * 0.006, mid);
  trunk(g, cx + H * 0.008, by, topX + H * 0.003, by - H * 0.94, H * 0.01, H * 0.003, dark);
  trunk(g, cx - H * 0.012, by, topX - H * 0.003, by - H * 0.9, H * 0.005, H * 0.002, lit);
  // The broken top.
  poly(
    g,
    [
      { x: topX - H * 0.008, y: by - H * 0.93 },
      { x: topX - H * 0.004, y: by - H * 1.0 },
      { x: topX + H * 0.002, y: by - H * 0.955 },
      { x: topX + H * 0.007, y: by - H * 0.93 },
    ],
    mid,
  );
  // Broken stubs, the higher ones pointing up.
  for (let i = 0; i < 8; i++) {
    const t = 0.3 + 0.62 * (i / 8) + 0.03 * rnd();
    const s = i % 2 === 0 ? -1 : 1;
    const L = H * (0.04 + 0.08 * rnd()) * (1 - 0.5 * t);
    const x0 = xAt(t);
    const y0 = by - t * H;
    const dy = L * (t > 0.6 ? -0.5 : 0.25);
    poly(
      g,
      [
        { x: x0, y: y0 - H * 0.005 },
        { x: x0 + s * L, y: y0 + dy },
        { x: x0 + s * L * 0.9, y: y0 + dy + H * 0.005 },
        { x: x0, y: y0 + H * 0.007 },
      ],
      i % 3 === 0 ? lit : mid,
    );
  }
}

function paintWillow(g: CanvasRenderingContext2D, glowG: CanvasRenderingContext2D, cx: number, by: number, H: number, rnd: () => number) {
  const pal: Pal = ["#121a22", "#1e2c36", "#2e4450"];
  // A bent trunk.
  trunk(g, cx, by, cx + H * 0.05, by - H * 0.55, H * 0.03, H * 0.016, "#1b1d24");
  trunk(g, cx + H * 0.05, by - H * 0.55, cx + H * 0.03, by - H * 0.78, H * 0.016, H * 0.008, "#1b1d24");
  // The dome: lobes.
  const lobes: [number, number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const u = (i / 11) * 2 - 1;
    const top = Math.sqrt(Math.max(0, 1 - u * u));
    lobes.push([cx + H * 0.03 + u * H * 0.36, by - H * (0.62 + 0.26 * top * (0.7 + 0.3 * rnd())), H * 0.09, H * 0.07]);
  }
  lobes.sort((a, b) => b[1] - a[1]);
  for (const [x, y, rx, ry] of lobes) tuft(g, rnd, x, y, rx, ry, pal, 14, 0.25, glowG, true);
  // Hanging strands with glowing tips (the lanterns).
  for (let i = 0; i < 16; i++) {
    const u = (i / 15) * 2 - 1 + (rnd() - 0.5) * 0.08;
    const x = cx + H * 0.03 + u * H * 0.34;
    const top = by - H * (0.6 + 0.2 * Math.sqrt(Math.max(0, 1 - u * u)));
    const len = H * (0.18 + 0.2 * rnd()) * (0.6 + 0.4 * Math.sqrt(Math.max(0, 1 - u * u)));
    const w = H * 0.006;
    poly(
      g,
      [
        { x: x - w, y: top },
        { x: x + w, y: top },
        { x: x + w * 0.4, y: top + len },
        { x: x - w * 0.4, y: top + len },
      ],
      pal[1],
    );
    const b = H * 0.014;
    const bulb: Pt[] = [];
    for (let k = 0; k < 8; k++) bulb.push({ x: x + Math.cos((k / 8) * Math.PI * 2) * b, y: top + len + b + Math.sin((k / 8) * Math.PI * 2) * b * 1.3 });
    poly(g, bulb, "#7fe3d6");
    poly(glowG, bulb, "#fff");
    // The strand's lower third glows faintly too.
    poly(
      glowG,
      [
        { x: x - w * 0.5, y: top + len * 0.7 },
        { x: x + w * 0.5, y: top + len * 0.7 },
        { x: x + w * 0.4, y: top + len },
        { x: x - w * 0.4, y: top + len },
      ],
      "#fff",
    );
  }
}

function paintElderLobe(g: CanvasRenderingContext2D, glowG: CanvasRenderingContext2D, cx: number, by: number, W: number, rnd: () => number) {
  // Fix 3: one round crown clump for the camera facing crown sprites of the
  // Great Tree and the elders (dress-lakeforest.ts): 14 leafy tufts in an
  // oval, painted bottom first, each tuft in three values (dark body, mid, a
  // lit cap), a neutral cool grey so the vertex tint makes it teal or violet.
  // The glow mask is the underside of the lowest tufts only (each later tuft
  // erases the mask under its own body), plus a few seeds hanging below.
  const pal: Pal = ["#1d222c", "#323b4a", "#56647a"];
  const ccy = by - W * 0.5;
  const RX = W * 0.37;
  const RY = W * 0.3;
  const lobes: [number, number, number, number, boolean][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
    const d = 0.78 + rnd() * 0.18;
    const y = ccy + Math.sin(a) * RY * d;
    lobes.push([cx + Math.cos(a) * RX * d, y, W * (0.15 + 0.04 * rnd()), W * (0.12 + 0.03 * rnd()), Math.sin(a) > 0.25]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4 + rnd() * 0.5;
    lobes.push([cx + Math.cos(a) * RX * 0.4, ccy + Math.sin(a) * RY * 0.35 - RY * 0.1, W * (0.16 + 0.03 * rnd()), W * (0.13 + 0.02 * rnd()), false]);
  }
  lobes.push([cx + (rnd() - 0.5) * RX * 0.3, ccy - RY * 0.72, W * 0.15, W * 0.12, false]);
  lobes.sort((a, b) => b[1] - a[1]);
  for (const [x, y, rx, ry, under] of lobes) {
    // This tuft hides the glow of the tufts painted before it.
    glowG.save();
    glowG.globalCompositeOperation = "destination-out";
    glowG.beginPath();
    glowG.ellipse(x, y - ry * 0.12, rx * 0.92, ry * 0.8, 0, 0, Math.PI * 2);
    glowG.fill();
    glowG.restore();
    tuft(g, rnd, x, y, rx, ry, pal, 18, 0.2, under ? glowG : null, under);
  }
  // Seeds hanging under the clump on fine threads.
  for (let i = 0; i < 7; i++) {
    const x = cx + (rnd() - 0.5) * RX * 1.4;
    const top = ccy + RY * (0.55 + 0.2 * rnd());
    const y = Math.min(by - W * 0.02, top + W * (0.08 + 0.1 * rnd()));
    const w = W * 0.004;
    poly(g, [{ x: x - w, y: top }, { x: x + w, y: top }, { x: x + w * 0.5, y }, { x: x - w * 0.5, y }], pal[0]);
    const r = W * 0.016;
    const pts: Pt[] = [];
    for (let k = 0; k < 7; k++) pts.push({ x: x + Math.cos((k / 7) * Math.PI * 2) * r, y: y + Math.sin((k / 7) * Math.PI * 2) * r * 1.2 });
    poly(g, pts, i % 3 === 0 ? "#b39cf2" : "#7fe3d6");
    poly(glowG, pts, "#fff");
  }
}

const PAL = {
  spruceA: ["#1f2d28", "#314a3a", "#5d7350"] as Pal,
  spruceB: ["#23302a", "#3a4f37", "#6a7a4c"] as Pal,
  spruceC: ["#1c2a29", "#2d4540", "#557060"] as Pal,
  dying: ["#4b3322", "#6f4b2e", "#957047"] as Pal,
  lodge: ["#2b3720", "#4a5d2d", "#7d8a44"] as Pal,
  fir: ["#15201c", "#213229", "#3b5040"] as Pal,
  young: ["#27392b", "#3f5838", "#6b8150"] as Pal,
  aspenA: ["#4f5d26", "#7d8a35", "#adb24f"] as Pal,
  aspenB: ["#58602a", "#8a8a38", "#bcae52"] as Pal,
  shrubA: ["#262f28", "#3b4837", "#5f6d4a"] as Pal,
  shrubB: ["#2d3024", "#474b33", "#6f7049"] as Pal,
  teal: ["#17202a", "#23333e", "#4fb3aa"] as Pal,
};
/** The colour each cell's empty texels carry (its dark body), so far mips puff into the right mass colour. */
const BLEED: readonly string[] = [
  PAL.spruceA[0],
  PAL.spruceB[0],
  PAL.spruceC[0],
  PAL.lodge[0],
  PAL.lodge[0],
  PAL.fir[0],
  PAL.young[0],
  PAL.aspenA[0],
  PAL.aspenB[0],
  PAL.shrubA[0],
  PAL.shrubB[0],
  PAL.dying[0],
  "#5a554c",
  PAL.teal[0],
  "#121a22",
  "#191d2c",
];

const spruceShape = (t: number) => Math.pow(1 - t, 0.95) * (0.92 + 0.08 * Math.sin(t * 9));
const firShape = (t: number) => Math.min(1, (1 - t) * 2.1) * (0.9 + 0.1 * Math.sin(t * 13));

/**
 * Round 1 (Lovro: "a lot of the trees have this weird thing on top of
 * them"): a conifer's drooping low branches reached below its trunk base,
 * past its cell, into the first rows of the cell under it. That cell's crop
 * box took them in, so the fir, young spruce, lodgepole b, both shrubs and
 * the elder lobe carried dark branch tips floating above their own tops.
 * Every cell now paints inside its own square, one atlas texel of guard on
 * each side (the draw down to 1024 cannot smear a neighbour across).
 */
const CLIP_GUARD = 2;

function paintCell(g: CanvasRenderingContext2D, glowG: CanvasRenderingContext2D, index: number) {
  const col = index % FOLIAGE_GRID;
  const row = Math.floor(index / FOLIAGE_GRID);
  const ox = col * CS;
  const oy = row * CS;
  for (const c of [g, glowG]) {
    c.save();
    c.beginPath();
    c.rect(ox + CLIP_GUARD, oy + CLIP_GUARD, CS - 2 * CLIP_GUARD, CS - 2 * CLIP_GUARD);
    c.clip();
  }
  try {
    paintCellContent(g, glowG, index, ox, oy);
  } finally {
    g.restore();
    glowG.restore();
  }
}

function paintCellContent(g: CanvasRenderingContext2D, glowG: CanvasRenderingContext2D, index: number, ox: number, oy: number) {
  const cx = ox + CS / 2;
  const by = oy + CS - M_BOT;
  const H = CS - M_BOT - M_TOP;
  const Wmax = CS - 2 * M_SIDE;
  const rnd = mulberry32(1000 + index * 7919);
  const spruce = (pal: Pal, extra: Partial<ConiferSpec> = {}): ConiferSpec => ({
    halfW: 0.235,
    crownStart: 0.05,
    whorls: 22,
    shape: spruceShape,
    droopLow: 0.5,
    droopHigh: -0.2,
    skip: 0.14,
    thLow: 0.05,
    thHigh: 0.03,
    pal,
    trunk: "#2b2119",
    lean: 0.05,
    backing: 0.42,
    ...extra,
  });
  switch (IDS[index][0]) {
    case "spruce-a":
      paintConifer(g, null, cx, by, H, spruce(PAL.spruceA), rnd);
      break;
    case "spruce-b":
      paintConifer(g, null, cx, by, H * 0.97, spruce(PAL.spruceB, { halfW: 0.21, whorls: 19, skip: 0.2, droopLow: 0.55, dead: { share: 0.05, pal: PAL.dying } }), rnd);
      break;
    case "spruce-c":
      paintConifer(g, null, cx, by, H, spruce(PAL.spruceC, { halfW: 0.25, whorls: 24, skip: 0.12, thLow: 0.055 }), rnd);
      break;
    case "lodgepole-a":
      paintLodgepole(g, cx, by, H, PAL.lodge, "#5a4536", rnd, 0);
      break;
    case "lodgepole-b":
      paintLodgepole(g, cx, by, H, PAL.lodge, "#54433a", rnd, 1);
      break;
    case "fir-spire":
      paintConifer(g, null, cx, by, H, spruce(PAL.fir, { halfW: 0.11, whorls: 24, shape: firShape, droopLow: 0.15, droopHigh: -0.3, skip: 0.07, thLow: 0.04, thHigh: 0.028, backing: 0.6, crownStart: 0.04 }), rnd);
      break;
    case "young-spruce":
      paintConifer(g, null, cx, by, H, spruce(PAL.young, { halfW: 0.27, crownStart: 0.0, whorls: 11, thLow: 0.08, thHigh: 0.05, skip: 0.08, droopLow: 0.22, backing: 0.5 }), rnd);
      break;
    case "aspen-a":
      paintAspen(g, cx, by, H, PAL.aspenA, rnd, 0);
      break;
    case "aspen-b":
      paintAspen(g, cx, by, H * 0.96, PAL.aspenB, rnd, 1);
      break;
    case "shrub-a":
      paintShrub(g, cx, by, Wmax, PAL.shrubA, rnd, 0);
      break;
    case "shrub-b":
      paintShrub(g, cx, by, Wmax * 0.92, PAL.shrubB, rnd, 1);
      break;
    case "spruce-dying":
      paintConifer(g, null, cx, by, H * 0.96, spruce(PAL.dying, { halfW: 0.2, skip: 0.3, whorls: 17, dead: { share: 0.3, pal: ["#3b3129", "#56493c", "#766754"] } }), rnd);
      break;
    case "snag":
      paintSnag(g, cx, by, H, rnd);
      break;
    case "spruce-teal":
      paintConifer(g, glowG, cx, by, H, spruce(PAL.teal, { halfW: 0.2, skip: 0.16, glow: true, trunk: "#1b1d24" }), rnd);
      break;
    case "willow-lobe":
      paintWillow(g, glowG, cx, by, H, rnd);
      break;
    case "elder-lobe":
      paintElderLobe(g, glowG, cx, by, Wmax, rnd);
      break;
  }
}

/** Measured crop per cell after painting: [u0, u1, v0, v1] of the painted content, in atlas uv (flipY), 16 x 4 floats. */
const rects = new Float32Array(16 * 4);
for (const c of FOLIAGE_CELLS) rects.set([c.u0, c.u1, c.v0, c.v1], c.index * 4);

/**
 * The painted content's box per cell, [u0, u1, v0, v1] in atlas uv, 16 x 4
 * floats (valid after getFoliageAtlas; before it, the whole cells). v0 is the
 * trunk's base (the cell bottom plus the margin), u centred on the trunk.
 */
export function foliageCellRects(): Float32Array {
  return rects;
}

/**
 * Round 1: the cells an overhanging conifer painted into before the clip
 * (read off the atlas dump, 2026-09-28). Their crop ran the whole cell then,
 * from its first row but one down to the trunk base, and the forest and the
 * Great Tree were sized by eye on that crop. The crop is tight now, so the
 * painted content would grow; keep[i] = tight height / old height lets a
 * consumer scale the card and keep every painted size exactly as it was.
 */
const OVERHUNG = new Set(["lodgepole-b", "fir-spire", "young-spruce", "shrub-a", "shrub-b", "willow-lobe", "elder-lobe"]);
const keep = new Float32Array(16).fill(1);

/** Per cell, the crop's height now over its height before round 1 (1 where it did not change). Valid after getFoliageAtlas. */
export function foliageCellKeep(): Float32Array {
  return keep;
}

const perRenderer = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
let paintMs = 0;
let painted = 0;

/** Paints the atlas (rgba, 1024 x 1024, bottom row first as uv runs). Browser only. */
function paintAtlas(): Uint8Array {
  const big = document.createElement("canvas");
  big.width = big.height = P;
  const g = big.getContext("2d")!;
  const mask = document.createElement("canvas");
  mask.width = mask.height = P;
  const mg = mask.getContext("2d")!;
  for (let i = 0; i < 16; i++) paintCell(g, mg, i);
  // Draw both down to 1024 once.
  const N = FOLIAGE_ATLAS_SIZE;
  const small = document.createElement("canvas");
  small.width = small.height = N;
  const sg = small.getContext("2d", { willReadFrequently: true })!;
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(big, 0, 0, N, N);
  const px = sg.getImageData(0, 0, N, N).data;
  // Only the bottom row of cells glows (13, 14, 15): read the mask there alone.
  const cellPx0 = N / FOLIAGE_GRID;
  const smallM = document.createElement("canvas");
  smallM.width = N;
  smallM.height = cellPx0;
  const smg = smallM.getContext("2d", { willReadFrequently: true })!;
  smg.imageSmoothingEnabled = true;
  smg.drawImage(mask, 0, P - CS, P, CS, 0, 0, N, cellPx0);
  const mk = smg.getImageData(0, 0, N, cellPx0).data;
  const mRow0 = N - cellPx0;
  const out = new Uint8Array(N * N * 4);
  const cellPx = N / FOLIAGE_GRID;
  const bleed = BLEED.map((h) => {
    const c = parseInt(h.slice(1), 16);
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  });
  const box = Array.from({ length: 16 }, () => [N, -1, N, -1]);
  for (let y = 0; y < N; y++) {
    const row = Math.floor(y / cellPx);
    for (let x = 0; x < N; x++) {
      const cell = row * FOLIAGE_GRID + Math.floor(x / cellPx);
      const o = (y * N + x) * 4;
      // Written bottom row first, so uv v runs up as three expects (no flipY on a data texture).
      const w = ((N - 1 - y) * N + x) * 4;
      const a = px[o + 3];
      if (a < 8) {
        const b = bleed[cell];
        out[w] = b[0];
        out[w + 1] = b[1];
        out[w + 2] = b[2];
        out[w + 3] = 0;
        continue;
      }
      // Canvas hands back straight (unpremultiplied) colour.
      out[w] = px[o];
      out[w + 1] = px[o + 1];
      out[w + 2] = px[o + 2];
      const glowK = y >= mRow0 ? mk[((y - mRow0) * N + x) * 4 + 3] / 255 : 0;
      // Foliage 0.8, glowing foliage 1.0 (see the header).
      out[w + 3] = Math.round(a * (0.8 + 0.2 * glowK));
      if (a > 100) {
        const bx = box[cell];
        if (x < bx[0]) bx[0] = x;
        if (x > bx[1]) bx[1] = x;
        if (y < bx[2]) bx[2] = y;
        if (y > bx[3]) bx[3] = y;
      }
    }
  }
  // Crop rects: symmetric about the trunk (the cell's centre), 2 texels of slack.
  for (let i = 0; i < 16; i++) {
    const c = FOLIAGE_CELLS[i];
    const [x0, x1, y0] = box[i];
    if (x1 < 0) continue;
    const cxp = (c.col + 0.5) * cellPx;
    const half = Math.min(cellPx / 2 - 1, Math.max(cxp - x0, x1 - cxp) + 2);
    const topY = Math.max(c.row * cellPx + 1, y0 - 2);
    const botY = (c.row + 1) * cellPx - (M_BOT * N) / P;
    // uv: v = 1 - y / N (flipY).
    rects.set([(cxp - half) / N, (cxp + half) / N, 1 - botY / N, 1 - topY / N], i * 4);
    if (OVERHUNG.has(c.id)) keep[i] = Math.min(1, (botY - topY) / (cellPx - 1 - (M_BOT * N) / P));
  }
  painted = 1;
  return out;
}

/** The foliage atlas for this renderer, painted on the first call. */
export function getFoliageAtlas(renderer: THREE.WebGLRenderer): THREE.Texture {
  const hit = perRenderer.get(renderer);
  if (hit) return hit;
  const t0 = performance.now();
  const N = FOLIAGE_ATLAS_SIZE;
  let data: Uint8Array;
  try {
    data = paintAtlas();
  } catch {
    data = new Uint8Array(N * N * 4);
  }
  const tex = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = "V6FoliageAtlas";
  tex.colorSpace = THREE.SRGBColorSpace;
  // paintAtlas wrote the rows bottom up already.
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  paintMs = performance.now() - t0;
  perRenderer.set(renderer, tex);
  // For the atlas shot (world-tests): the painted image, read on demand only.
  if (typeof window !== "undefined") (window as unknown as { __v6FoliageAtlasData?: () => Uint8Array }).__v6FoliageAtlasData = () => data;
  return tex;
}

export function foliageAtlasStats(): Record<string, number | string> {
  return { stub: 0, painted, paintMs: Math.round(paintMs * 100) / 100, size: FOLIAGE_ATLAS_SIZE, cells: FOLIAGE_CELLS.length, mb: Math.round(((FOLIAGE_ATLAS_SIZE * FOLIAGE_ATLAS_SIZE * 4 * 4) / 3 / 1e6) * 100) / 100 };
}
