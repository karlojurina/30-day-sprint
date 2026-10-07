/**
 * v6 footprints (world_art_bible_v6.md 2.3): every module that places a solid
 * thing registers where it stands, so the ground can shade under it and the
 * cover never grows through it.
 *
 *   addFootprint({ x, z, r, kind, shade })   a disc (rocks, props, tents, landmarks)
 *   addPathLine(points, r = 4)                a polyline buffered by r (the trail "plus 4")
 *   all()                                     everything registered, in order
 *   blocked(x, z, pad)                        is (x, z) within pad of any footprint?
 *
 * Order of use: modules register in install(); surfaces.ts and cover.ts read
 * all() and call blocked() in afterAll(ctx), after every module installed. The
 * scene calls resetFootprints() before installing, so a second mount (React
 * dev) never sees the first one's list.
 *
 * blocked() is a spatial hash lookup (32 unit cells) that allocates nothing:
 * 50,000 calls take a few ms. Pure: no three, so node tests load it.
 */

export type FootprintKind = "rock" | "prop" | "building" | "tent" | "path" | "water" | "landmark";

export interface FootprintInput {
  x: number;
  z: number;
  /** Radius, world units. */
  r: number;
  kind: FootprintKind;
  /** Contact shade at the centre, 0..1 (0.6 in the bible). Defaults by kind. */
  shade?: number;
}

export interface Footprint {
  x: number;
  z: number;
  r: number;
  kind: FootprintKind;
  shade: number;
  /** Paths only: the polyline as flat x, z pairs; x, z is its first point and r its buffer. */
  line?: Float64Array;
}

/** Contact shade by kind when the caller gives none (2.3: 0.6 at the centre under solids). */
export const DEFAULT_SHADE: Readonly<Record<FootprintKind, number>> = {
  rock: 0.6,
  building: 0.6,
  landmark: 0.6,
  tent: 0.5,
  prop: 0.45,
  path: 0,
  water: 0,
};

const CELL = 32;
/** Bias so cell indices stay positive across the whole world (±2M units). */
const OFF = 1 << 16;

/**
 * A registry. The module level functions below use one shared instance; tests
 * make their own.
 */
export class Footprints {
  private readonly list: Footprint[] = [];
  /** Cell key -> indices into `list` (a disc) or -(segment id + 1) (a path segment). */
  private readonly cells = new Map<number, number[]>();
  /** Path segments: x0, z0, x1, z1, r, footprint index. */
  private seg = new Float64Array(6 * 64);
  private segN = 0;

  add(f: FootprintInput): Footprint {
    const fp: Footprint = {
      x: f.x,
      z: f.z,
      r: Math.max(0, f.r),
      kind: f.kind,
      shade: f.shade ?? DEFAULT_SHADE[f.kind],
    };
    if (!Number.isFinite(fp.x) || !Number.isFinite(fp.z) || !Number.isFinite(fp.r)) return fp;
    const id = this.list.length;
    this.list.push(fp);
    this.insertBox(fp.x - fp.r, fp.z - fp.r, fp.x + fp.r, fp.z + fp.r, id);
    return fp;
  }

  /** A polyline (points as [x, z] or {x, z}) buffered by r; one footprint of kind "path" (or `kind`). */
  addLine(points: ReadonlyArray<readonly [number, number] | { x: number; z: number }>, r = 4, kind: FootprintKind = "path", shade?: number): Footprint | null {
    const flat: number[] = [];
    for (const p of points) {
      const x = Array.isArray(p) ? (p as readonly [number, number])[0] : (p as { x: number }).x;
      const z = Array.isArray(p) ? (p as readonly [number, number])[1] : (p as { z: number }).z;
      if (Number.isFinite(x) && Number.isFinite(z)) flat.push(x, z);
    }
    if (flat.length < 2) return null;
    const fp: Footprint = { x: flat[0], z: flat[1], r: Math.max(0, r), kind, shade: shade ?? DEFAULT_SHADE[kind], line: Float64Array.from(flat) };
    const id = this.list.length;
    this.list.push(fp);
    if (flat.length === 2) {
      this.addSegment(flat[0], flat[1], flat[0], flat[1], fp.r, id);
    } else {
      for (let i = 0; i + 3 < flat.length; i += 2) this.addSegment(flat[i], flat[i + 1], flat[i + 2], flat[i + 3], fp.r, id);
    }
    return fp;
  }

  all(): readonly Footprint[] {
    return this.list;
  }

  /** True when (x, z) lies within `pad` of any footprint (inside its radius plus pad). */
  blocked(x: number, z: number, pad = 0): boolean {
    const i0 = Math.floor((x - pad) / CELL);
    const i1 = Math.floor((x + pad) / CELL);
    const j0 = Math.floor((z - pad) / CELL);
    const j1 = Math.floor((z + pad) / CELL);
    const list = this.list;
    const seg = this.seg;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bucket = this.cells.get((i + OFF) * 131072 + (j + OFF));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const id = bucket[k];
          if (id >= 0) {
            const f = list[id];
            const dx = x - f.x;
            const dz = z - f.z;
            const rr = f.r + pad;
            if (dx * dx + dz * dz < rr * rr) return true;
          } else {
            const o = (-id - 1) * 6;
            const ax = seg[o];
            const az = seg[o + 1];
            const bx = seg[o + 2] - ax;
            const bz = seg[o + 3] - az;
            const rr = seg[o + 4] + pad;
            const len2 = bx * bx + bz * bz;
            let t = len2 > 0 ? ((x - ax) * bx + (z - az) * bz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = x - (ax + bx * t);
            const dz = z - (az + bz * t);
            if (dx * dx + dz * dz < rr * rr) return true;
          }
        }
      }
    }
    return false;
  }

  /** The nearest footprint's signed clearance at (x, z): distance to its edge (negative inside), capped at maxDist. */
  clearance(x: number, z: number, maxDist = 64): number {
    let best = maxDist;
    const i0 = Math.floor((x - maxDist) / CELL);
    const i1 = Math.floor((x + maxDist) / CELL);
    const j0 = Math.floor((z - maxDist) / CELL);
    const j1 = Math.floor((z + maxDist) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bucket = this.cells.get((i + OFF) * 131072 + (j + OFF));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const id = bucket[k];
          let d: number;
          if (id >= 0) {
            const f = this.list[id];
            d = Math.hypot(x - f.x, z - f.z) - f.r;
          } else {
            const o = (-id - 1) * 6;
            const s = this.seg;
            const bx = s[o + 2] - s[o];
            const bz = s[o + 3] - s[o + 1];
            const len2 = bx * bx + bz * bz;
            let t = len2 > 0 ? ((x - s[o]) * bx + (z - s[o + 1]) * bz) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            d = Math.hypot(x - (s[o] + bx * t), z - (s[o + 1] + bz * t)) - s[o + 4];
          }
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  clear(): void {
    this.list.length = 0;
    this.cells.clear();
    this.segN = 0;
  }

  stats(): { footprints: number; discs: number; paths: number; segments: number; cells: number } {
    let paths = 0;
    for (const f of this.list) if (f.line) paths++;
    return { footprints: this.list.length, discs: this.list.length - paths, paths, segments: this.segN, cells: this.cells.size };
  }

  private addSegment(ax: number, az: number, bx: number, bz: number, r: number, fid: number) {
    if (this.segN * 6 + 6 > this.seg.length) {
      const next = new Float64Array(this.seg.length * 2);
      next.set(this.seg);
      this.seg = next;
    }
    const o = this.segN * 6;
    this.seg[o] = ax;
    this.seg[o + 1] = az;
    this.seg[o + 2] = bx;
    this.seg[o + 3] = bz;
    this.seg[o + 4] = r;
    this.seg[o + 5] = fid;
    const sid = this.segN++;
    // Walk the segment's cells (a thick line through the grid), not its whole
    // bounding box, so a long diagonal does not fill a square of cells.
    // Samples are at most half a cell apart, so every point of the segment is
    // within CELL / 4 of one; each sample's box is widened by that much.
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    const rb = r + CELL * 0.25;
    const seen = new Set<number>();
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const i0 = Math.floor((px - rb) / CELL);
      const i1 = Math.floor((px + rb) / CELL);
      const j0 = Math.floor((pz - rb) / CELL);
      const j1 = Math.floor((pz + rb) / CELL);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = (i + OFF) * 131072 + (j + OFF);
          if (seen.has(key)) continue;
          seen.add(key);
          this.push(key, -(sid + 1));
        }
      }
    }
  }

  private insertBox(x0: number, z0: number, x1: number, z1: number, id: number) {
    const i0 = Math.floor(x0 / CELL);
    const i1 = Math.floor(x1 / CELL);
    const j0 = Math.floor(z0 / CELL);
    const j1 = Math.floor(z1 / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.push((i + OFF) * 131072 + (j + OFF), id);
  }

  private push(key: number, id: number) {
    const b = this.cells.get(key);
    if (b) b.push(id);
    else this.cells.set(key, [id]);
  }
}

const shared = new Footprints();

/** Register a solid thing's footprint (install time). */
export function addFootprint(f: FootprintInput): Footprint {
  return shared.add(f);
}

/** Register a path as a polyline buffered by r (the trail registers with r 4). */
export function addPathLine(points: ReadonlyArray<readonly [number, number] | { x: number; z: number }>, r = 4, kind: FootprintKind = "path"): Footprint | null {
  return shared.addLine(points, r, kind);
}

/** Everything registered, in registration order. */
export function all(): readonly Footprint[] {
  return shared.all();
}

/** Is (x, z) within pad of any footprint? */
export function blocked(x: number, z: number, pad = 0): boolean {
  return shared.blocked(x, z, pad);
}

/** Distance from (x, z) to the nearest footprint's edge, negative inside, capped at maxDist. */
export function clearance(x: number, z: number, maxDist = 64): number {
  return shared.clearance(x, z, maxDist);
}

/** The scene calls this before installing modules. */
export function resetFootprints(): void {
  shared.clear();
}

export function footprintStats(): ReturnType<Footprints["stats"]> {
  return shared.stats();
}
