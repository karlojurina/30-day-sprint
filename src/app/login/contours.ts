/**
 * The login's ground (Lovro, 2026-10-19: the map is a surprise for after
 * sign-in, so the login shows none of it): the contour lines of a made-up
 * terrain, a map nobody has drawn yet. Pure noise from a fixed seed, so every
 * build draws the same lines and none of them is the world's.
 *
 * Runs on the server only (page.tsx is a server component and the page is
 * built once per deploy), so the lines are in the HTML as two SVG paths: no
 * picture to download, no script in the browser.
 *
 * How: a height field (gradient noise, its coordinates bent by more noise so
 * the slopes sweep), traced level by level with marching squares, each level's
 * pieces joined into lines, thinned until a line strays at most EPS px from
 * the traced one (Ramer-Douglas-Peucker), and written as smooth curves in
 * relative path data. Every fifth level is an index line, as on a survey map.
 */

/** The field in CSS px. The page centres it and fades it out before its edges. */
export const FIELD_W = 2000;
export const FIELD_H = 1300;

const SEED = 20261019;
/** Grid step of the traced field, px. */
const CELL = 8;
/** Median distance between neighbouring lines, px. */
const SPACING = 34;
/** How far a thinned line may stray from the traced one, px. */
const EPS = 1.5;
/** Lines shorter than this are specks, px. */
const MIN_LENGTH = 80;
/** The terrain's largest features are about this wide, px. */
const SCALE = 820;

// ── The field ───────────────────────────────────────────────────────────────

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ SEED;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise, about -0.7 to 0.7. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    const a = hash(cx, cy) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fade(fx);
  const v = fade(fy);
  const top = corner(ix, iy, fx, fy) * (1 - u) + corner(ix + 1, iy, fx - 1, fy) * u;
  const bottom =
    corner(ix, iy + 1, fx, fy - 1) * (1 - u) + corner(ix + 1, iy + 1, fx - 1, fy - 1) * u;
  return top * (1 - v) + bottom * v;
}

/** Octaves of noise, each turned against the last so no grid shows. */
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    amp *= 0.5;
  }
  return sum;
}

function height(x: number, y: number): number {
  const px = x / SCALE;
  const py = y / SCALE;
  const qx = px + 0.6 * fbm(px + 3.1, py + 7.7, 3);
  const qy = py + 0.6 * fbm(px - 5.3, py + 1.9, 3);
  return fbm(qx, qy, 3);
}

// ── Tracing ─────────────────────────────────────────────────────────────────

type Line = { pts: number[]; closed: boolean };

/** One level's lines, as flat [x0, y0, x1, y1, ...] in px. */
function trace(f: Float32Array, nx: number, ny: number, level: number): Line[] {
  const hCount = (nx - 1) * ny;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = f[j * nx + i];
      const b = f[j * nx + i + 1];
      const c = f[(j + 1) * nx + i + 1];
      const d = f[(j + 1) * nx + i];
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = j * (nx - 1) + i;
      const bottom = (j + 1) * (nx - 1) + i;
      const left = hCount + j * nx + i;
      const right = left + 1;
      const centreAbove = (a + b + c + d) / 4 > level;
      switch (code) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: // b and d above
          if (centreAbove) { link(left, top); link(bottom, right); }
          else { link(top, right); link(left, bottom); }
          break;
        case 10: // a and c above
          if (centreAbove) { link(top, right); link(left, bottom); }
          else { link(left, top); link(bottom, right); }
          break;
      }
    }
  }

  const point = (id: number, out: number[]) => {
    if (id < hCount) {
      const j = Math.floor(id / (nx - 1));
      const i = id - j * (nx - 1);
      const v0 = f[j * nx + i];
      const t = (level - v0) / (f[j * nx + i + 1] - v0);
      out.push((i + t) * CELL, j * CELL);
    } else {
      const k = id - hCount;
      const j = Math.floor(k / nx);
      const i = k - j * nx;
      const v0 = f[j * nx + i];
      const t = (level - v0) / (f[(j + 1) * nx + i] - v0);
      out.push(i * CELL, (j + t) * CELL);
    }
  };

  const seen = new Set<number>();
  const walk = (start: number): Line => {
    const ids = [start];
    seen.add(start);
    let prev = -1;
    let cur = start;
    for (;;) {
      const next = links.get(cur)!.find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      ids.push(next);
      seen.add(next);
      prev = cur;
      cur = next;
    }
    const closed = ids.length > 2 && links.get(cur)!.includes(start);
    const pts: number[] = [];
    for (const id of ids) point(id, pts);
    return { pts, closed };
  };

  const lines: Line[] = [];
  // Open lines first, from an end at the field's edge; then the loops.
  for (const [id, ns] of links) if (ns.length === 1 && !seen.has(id)) lines.push(walk(id));
  for (const id of links.keys()) if (!seen.has(id)) lines.push(walk(id));
  return lines;
}

/** Ramer-Douglas-Peucker: the fewest points within EPS of the traced line. */
function thin(pts: number[], closed: boolean): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const ax = pts[2 * s];
    const ay = pts[2 * s + 1];
    const dx = pts[2 * e] - ax;
    const dy = pts[2 * e + 1] - ay;
    const len = Math.hypot(dx, dy);
    let far = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const px = pts[2 * i] - ax;
      const py = pts[2 * i + 1] - ay;
      const dist = len > 1e-9 ? Math.abs(dy * px - dx * py) / len : Math.hypot(px, py);
      if (dist > far) {
        far = dist;
        at = i;
      }
    }
    if (far > EPS) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  // Points under 2px from the last kept one go too: they add nothing to the curve.
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const last = out.length - 2;
    if (last >= 0 && i < n - 1 && Math.hypot(pts[2 * i] - out[last], pts[2 * i + 1] - out[last + 1]) < 2) continue;
    out.push(pts[2 * i], pts[2 * i + 1]);
  }
  // A loop's last point sits one cell from its first: dropped too when under 2px from it.
  const m = out.length;
  if (closed && m > 6 && Math.hypot(out[m - 2] - out[0], out[m - 1] - out[1]) < 2) out.length = m - 2;
  return out;
}

/**
 * The parts of a line inside the field's inscribed ellipse. The page's mask
 * fades the field out by that ellipse, so anything past it is never seen.
 */
function clip(line: Line): Line[] {
  const { pts, closed } = line;
  const n = pts.length / 2;
  const inside: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const ex = pts[2 * i] / (FIELD_W / 2) - 1;
    const ey = pts[2 * i + 1] / (FIELD_H / 2) - 1;
    inside.push(ex * ex + ey * ey <= 1);
  }
  if (inside.every(Boolean)) return [line];
  // A loop is read from just past a point outside, so no part wraps its seam.
  const start = closed ? (inside.indexOf(false) + 1) % n : 0;
  const parts: Line[] = [];
  let part: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (inside[i]) part.push(pts[2 * i], pts[2 * i + 1]);
    else if (part.length) {
      parts.push({ pts: part, closed: false });
      part = [];
    }
  }
  if (part.length) parts.push({ pts: part, closed: false });
  return parts;
}

function length(pts: number[], closed: boolean): number {
  let sum = 0;
  for (let i = 2; i < pts.length; i += 2) sum += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  if (closed) sum += Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]);
  return sum;
}

/**
 * Path data: each line one smooth curve through its points. Cubic segments
 * whose handles mirror across every point (the first "c", then "s"), so a
 * line never kinks, even with its numbers in whole px. A point's handle runs
 * along its neighbours' chord, a third of its shorter side long, so a short
 * side never overshoots.
 */
function pathData(lines: Line[]): string {
  let d = "";
  const put = (cmd: string, nums: number[]) => {
    d += cmd;
    nums.forEach((v, k) => (d += k === 0 || v < 0 ? `${v}` : ` ${v}`));
  };
  for (const { pts, closed } of lines) {
    const n = pts.length / 2;
    const side = (i: number, j: number) =>
      i === j ? Infinity : Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1]);
    const hx = new Float64Array(n);
    const hy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = closed ? (i - 1 + n) % n : Math.max(i - 1, 0);
      const q = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      const dx = pts[2 * q] - pts[2 * p];
      const dy = pts[2 * q + 1] - pts[2 * p + 1];
      const arm = Math.min(side(i, p), side(i, q)) / 3 / (Math.hypot(dx, dy) || 1);
      hx[i] = dx * arm;
      hy[i] = dy * arm;
    }
    let x = Math.round(pts[0]);
    let y = Math.round(pts[1]);
    d += `M${x} ${y}`;
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % n;
      const ex = Math.round(pts[2 * j]);
      const ey = Math.round(pts[2 * j + 1]);
      const c2 = [Math.round(pts[2 * j] - hx[j]) - x, Math.round(pts[2 * j + 1] - hy[j]) - y];
      if (i === 0) {
        const c1 = [Math.round(pts[2 * i] + hx[i]) - x, Math.round(pts[2 * i + 1] + hy[i]) - y];
        put("c", [...c1, ...c2, ex - x, ey - y]);
      } else {
        put("s", [...c2, ex - x, ey - y]);
      }
      x = ex;
      y = ey;
    }
    if (closed) d += "z";
  }
  return d;
}

function draw(): { minor: string; index: string } {
  const nx = Math.ceil(FIELD_W / CELL) + 1;
  const ny = Math.ceil(FIELD_H / CELL) + 1;
  const f = new Float32Array(nx * ny);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const h = height(i * CELL, j * CELL);
      f[j * nx + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }

  // The interval that puts neighbouring lines SPACING px apart at the median slope.
  const slopes: number[] = [];
  for (let j = 1; j < ny - 1; j += 2) {
    for (let i = 1; i < nx - 1; i += 2) {
      const gx = (f[j * nx + i + 1] - f[j * nx + i - 1]) / (2 * CELL);
      const gy = (f[(j + 1) * nx + i] - f[(j - 1) * nx + i]) / (2 * CELL);
      slopes.push(Math.hypot(gx, gy));
    }
  }
  slopes.sort((a, b) => a - b);
  const interval = SPACING * slopes[slopes.length >> 1];

  const minor: Line[] = [];
  const index: Line[] = [];
  for (let k = Math.ceil(lo / interval); k * interval < hi; k++) {
    for (const line of trace(f, nx, ny, k * interval).flatMap(clip)) {
      if (length(line.pts, line.closed) < MIN_LENGTH) continue;
      (k % 5 === 0 ? index : minor).push({ pts: thin(line.pts, line.closed), closed: line.closed });
    }
  }
  return { minor: pathData(minor), index: pathData(index) };
}

export const CONTOURS = draw();
