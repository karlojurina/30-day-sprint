/**
 * Expedition map — path math.
 * Builds the explorer path (waypoints per region), constructs a smooth
 * Catmull-Rom bezier, and samples points along it so lessons can be placed.
 */

export const MAP_W = 3200;
export const MAP_H = 1400;

export interface RegionStrip {
  xStart: number;
  xEnd: number;
  yTop: number;
  yBot: number;
  image: string;
}

export type RegionStripMap = Record<"r1" | "r2" | "r3" | "r4", RegionStrip>;

// Region strips — each is a big rectangle the path must fill.
// No vertical overlap; they tile the chart horizontally.
export const REGION_STRIPS: RegionStripMap = {
  r1: { xStart: 120,  xEnd: 920,  yTop: 180, yBot: 1220, image: "/regions/region-sea.png" },
  r2: { xStart: 920,  xEnd: 1720, yTop: 180, yBot: 1220, image: "/regions/region-forest.png" },
  r3: { xStart: 1720, xEnd: 2480, yTop: 180, yBot: 1220, image: "/regions/region-mountains.png" },
  r4: { xStart: 2480, xEnd: 3080, yTop: 180, yBot: 1220, image: "/regions/region-harbor.png" },
};

export interface Point {
  x: number;
  y: number;
}

export interface SampledPoint extends Point {
  t: number;
}

/**
 * Build waypoints for the explorer path — each region has its own character.
 */
export function buildExplorerWaypoints(): Point[] {
  const wp: Point[] = [];
  const { r1, r2, r3, r4 } = REGION_STRIPS;

  const P = (r: RegionStrip, tx: number, ty: number): Point => ({
    x: r.xStart + (r.xEnd - r.xStart) * tx,
    y: r.yTop + (r.yBot - r.yTop) * ty,
  });

  // R1 SEA — sail across open water with a detour to an island
  wp.push(P(r1, 0.06, 0.18));
  wp.push(P(r1, 0.20, 0.42));
  wp.push(P(r1, 0.38, 0.70));
  wp.push(P(r1, 0.56, 0.82));
  wp.push(P(r1, 0.72, 0.62));
  wp.push(P(r1, 0.82, 0.38));
  wp.push(P(r1, 0.70, 0.22));
  wp.push(P(r1, 0.86, 0.14));

  // R2 FOREST — zigzag through trees, reach all four sectors
  wp.push(P(r2, 0.08, 0.24));
  wp.push(P(r2, 0.22, 0.62));
  wp.push(P(r2, 0.36, 0.82));
  wp.push(P(r2, 0.52, 0.52));
  wp.push(P(r2, 0.42, 0.28));
  wp.push(P(r2, 0.62, 0.18));
  wp.push(P(r2, 0.80, 0.42));
  wp.push(P(r2, 0.92, 0.72));

  // R3 MOUNTAINS — switchbacks climbing up, over a pass, down the far side
  wp.push(P(r3, 0.06, 0.78));
  wp.push(P(r3, 0.18, 0.58));
  wp.push(P(r3, 0.10, 0.38));
  wp.push(P(r3, 0.28, 0.22));
  wp.push(P(r3, 0.48, 0.14));
  wp.push(P(r3, 0.68, 0.28));
  wp.push(P(r3, 0.82, 0.52));
  wp.push(P(r3, 0.92, 0.80));

  // R4 HARBOR — sweep down to the docks at sunset
  wp.push(P(r4, 0.10, 0.40));
  wp.push(P(r4, 0.30, 0.22));
  wp.push(P(r4, 0.50, 0.36));
  wp.push(P(r4, 0.40, 0.60));
  wp.push(P(r4, 0.62, 0.74));
  wp.push(P(r4, 0.82, 0.58));
  wp.push(P(r4, 0.92, 0.40));

  return wp;
}

/**
 * Catmull-Rom spline converted to cubic bezier path string.
 */
export function catmullRomToBezier(points: Point[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Sample N evenly-spaced points along the Catmull-Rom spline of the given waypoints.
 */
export function samplePath(
  spine: Point[],
  samples = 1400
): { points: SampledPoint[]; length: number } {
  const dense: Point[] = [];
  const N = 24;
  for (let i = 0; i < spine.length - 1; i++) {
    const p0 = spine[i - 1] || spine[i];
    const p1 = spine[i];
    const p2 = spine[i + 1];
    const p3 = spine[i + 2] || p2;
    for (let j = 0; j < N; j++) {
      const t = j / N;
      const tt = t * t;
      const ttt = tt * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);
      dense.push({ x, y });
    }
  }
  dense.push(spine[spine.length - 1]);

  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  const out: SampledPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const target = (i / (samples - 1)) * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    out.push({ ...dense[lo], t: i / (samples - 1) });
  }
  return { points: out, length: total };
}

export function nodeAt(
  sampled: { points: SampledPoint[] },
  t: number
): SampledPoint {
  const idx = Math.max(
    0,
    Math.min(sampled.points.length - 1, Math.round(t * (sampled.points.length - 1)))
  );
  return sampled.points[idx];
}

/**
 * Place lessons along their region's t-range on the sampled path.
 */
export interface PlacedLesson {
  lessonId: string;
  regionId: string;
  x: number;
  y: number;
  t: number;
  indexInRegion: number;
}

export function placeLessons(
  sampled: { points: SampledPoint[] },
  lessons: { id: string; region_id: string }[]
): PlacedLesson[] {
  type Record = { lessonIds: string[]; tRange: [number, number] | null };
  const byRegion: globalThis.Record<string, Record> = {};
  const regionIds = ["r1", "r2", "r3", "r4"] as const;
  for (const id of regionIds) {
    byRegion[id] = { lessonIds: [], tRange: null };
  }
  for (const l of lessons) {
    if (byRegion[l.region_id]) {
      byRegion[l.region_id].lessonIds.push(l.id);
    }
  }

  // Figure out t-range (min/max t) for each region based on path x
  for (let i = 0; i < sampled.points.length; i++) {
    const p = sampled.points[i];
    let region: string | null = null;
    for (const rId of regionIds) {
      const s = REGION_STRIPS[rId];
      if (p.x >= s.xStart && p.x <= s.xEnd) {
        region = rId;
        break;
      }
    }
    if (!region) continue;
    const t = i / (sampled.points.length - 1);
    const rec = byRegion[region];
    if (!rec.tRange) rec.tRange = [t, t];
    else rec.tRange[1] = t;
  }

  const result: PlacedLesson[] = [];
  for (const rId of regionIds) {
    const rec = byRegion[rId];
    if (!rec.tRange || rec.lessonIds.length === 0) continue;
    const [t0, t1] = rec.tRange;
    const pad = 0.04;
    const tStart = t0 + (t1 - t0) * pad;
    const tEnd = t1 - (t1 - t0) * pad;
    rec.lessonIds.forEach((lessonId, i) => {
      const f = rec.lessonIds.length === 1 ? 0.5 : i / (rec.lessonIds.length - 1);
      const t = tStart + (tEnd - tStart) * f;
      const pt = nodeAt(sampled, t);
      result.push({
        lessonId,
        regionId: rId,
        x: pt.x,
        y: pt.y,
        t,
        indexInRegion: i,
      });
    });
  }
  return result;
}
