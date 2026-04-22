/**
 * Expedition map — path math.
 *
 * Builds an explorer path that actually USES the whole region rectangle
 * (corners included), then places lessons on it with variable spacing and
 * a tiny deterministic jitter so nothing feels algorithmic.
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

// Strip x-bounds align with the painted regions in the new panoramic mural
// (public/regions/expedition-map.png). Image reads ~22% sea / 28% forest /
// 28% mountains / 22% valley left-to-right within the painted area
// (x=120 to x=3080, total 2960px wide).
export const REGION_STRIPS: RegionStripMap = {
  r1: { xStart: 120,  xEnd: 770,  yTop: 180, yBot: 1220, image: "/regions/region-sea.png" },
  r2: { xStart: 770,  xEnd: 1600, yTop: 180, yBot: 1220, image: "/regions/region-forest.png" },
  r3: { xStart: 1600, xEnd: 2430, yTop: 180, yBot: 1220, image: "/regions/region-mountains.png" },
  r4: { xStart: 2430, xEnd: 3080, yTop: 180, yBot: 1220, image: "/regions/region-harbor.png" },
};

export interface Point {
  x: number;
  y: number;
}

export interface SampledPoint extends Point {
  t: number;
}

/**
 * Build waypoints for the explorer path — each region's path follows the
 * actual painted terrain in /regions/expedition-map.png:
 *   r1 SEA      — hugs the shoreline, around the dock and sailboat
 *   r2 FOREST   — winds through pine hillside past the cabins
 *   r3 MOUNTAINS — climbs the visible switchback up to the snowy peak
 *   r4 VALLEY   — descends the trail and curves around the lake to the cabin
 */
export function buildExplorerWaypoints(): Point[] {
  const wp: Point[] = [];
  const { r1, r2, r3, r4 } = REGION_STRIPS;

  const P = (r: RegionStrip, tx: number, ty: number): Point => ({
    x: r.xStart + (r.xEnd - r.xStart) * tx,
    y: r.yTop + (r.yBot - r.yTop) * ty,
  });

  // R1 SEA — start near the dock, sweep along the water and shore, climb
  // the rocks to where the forest begins. Stays in the lower half of the
  // region (the sky has nothing for a path to do).
  wp.push(P(r1, 0.10, 0.68));   // dock
  wp.push(P(r1, 0.22, 0.78));   // along the water
  wp.push(P(r1, 0.38, 0.86));   // bottom of the bay
  wp.push(P(r1, 0.55, 0.80));   // curve up around the rocks
  wp.push(P(r1, 0.72, 0.62));   // climbing the shore
  wp.push(P(r1, 0.86, 0.48));   // approach the forest line
  wp.push(P(r1, 0.96, 0.40));   // exit east into the forest

  // R2 FOREST — wind UP and DOWN through the pine hillside, past the cabins
  // (which sit in the lower-mid third of this region in the painting).
  wp.push(P(r2, 0.06, 0.36));   // entry from the sea side
  wp.push(P(r2, 0.18, 0.58));   // descend into trees
  wp.push(P(r2, 0.28, 0.74));   // bottom of forest near water
  wp.push(P(r2, 0.42, 0.66));   // pass first cabin cluster
  wp.push(P(r2, 0.52, 0.45));   // climb back up among trees
  wp.push(P(r2, 0.62, 0.55));   // back down past the second cabin
  wp.push(P(r2, 0.74, 0.62));
  wp.push(P(r2, 0.86, 0.50));   // climb toward the mountain base
  wp.push(P(r2, 0.96, 0.42));   // exit east into the foothills

  // R3 MOUNTAINS — follow the visible switchback in the painting. The
  // trail enters low-left, zigzags upward through the rocks, peaks high,
  // then drops down toward the valley on the right.
  wp.push(P(r3, 0.06, 0.55));   // entry from forest
  wp.push(P(r3, 0.16, 0.42));   // first switch
  wp.push(P(r3, 0.08, 0.30));
  wp.push(P(r3, 0.22, 0.20));   // up the ridge
  wp.push(P(r3, 0.36, 0.28));
  wp.push(P(r3, 0.48, 0.12));   // approach the high pass
  wp.push(P(r3, 0.60, 0.18));   // peak / pass crossing
  wp.push(P(r3, 0.72, 0.32));   // start descending the far side
  wp.push(P(r3, 0.82, 0.50));
  wp.push(P(r3, 0.92, 0.65));   // exit down into the valley

  // R4 VALLEY — descend from the mountain pass, curve around the lake,
  // end near the small cabin on the water's edge.
  wp.push(P(r4, 0.06, 0.55));   // entry from mountains
  wp.push(P(r4, 0.20, 0.68));   // descending into the bowl
  wp.push(P(r4, 0.34, 0.58));   // crossing the upper valley
  wp.push(P(r4, 0.46, 0.72));   // approach the lake
  wp.push(P(r4, 0.58, 0.82));   // along the lake's edge
  wp.push(P(r4, 0.72, 0.74));   // by the cabin
  wp.push(P(r4, 0.86, 0.62));   // final waypoint
  wp.push(P(r4, 0.94, 0.50));

  return wp;
}

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

export interface PlacedLesson {
  lessonId: string;
  regionId: string;
  x: number;
  y: number;
  t: number;
  indexInRegion: number;
}

// Tiny, deterministic hash → [0, 1) so jitter is stable per lesson ID.
function hash01(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  // unbias to [0, 1)
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Place lessons along their region's t-range with:
 *   - uneven spacing — a light ease-in-out so middle nodes breathe and the
 *     ends feel pinned. No two gaps are identical.
 *   - perpendicular jitter — a few-pixel nudge off the path axis, derived
 *     deterministically from the lesson id, so each position looks
 *     hand-placed but doesn't change between renders.
 *   - gate breathing room — the discount gate (is_gate) gets extra space
 *     before AND after it so its banner can't overlap neighboring nodes.
 */
export function placeLessons(
  sampled: { points: SampledPoint[] },
  lessons: {
    id: string;
    region_id: string;
    is_gate?: boolean | null;
    is_boss?: boolean | null;
  }[]
): PlacedLesson[] {
  type Rec = {
    lessons: { id: string; is_gate?: boolean | null; is_boss?: boolean | null }[];
    tRange: [number, number] | null;
  };
  const byRegion: Record<string, Rec> = {};
  const regionIds = ["r1", "r2", "r3", "r4"] as const;
  for (const id of regionIds) byRegion[id] = { lessons: [], tRange: null };
  for (const l of lessons) {
    if (byRegion[l.region_id]) byRegion[l.region_id].lessons.push(l);
  }

  // Figure out t-range per region
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
    if (!rec.tRange || rec.lessons.length === 0) continue;
    const [t0, t1] = rec.tRange;
    const pad = 0.035;
    const tStart = t0 + (t1 - t0) * pad;
    const tEnd = t1 - (t1 - t0) * pad;
    const span = tEnd - tStart;

    // Variable-spacing weights — bias toward more spacing around gates.
    const n = rec.lessons.length;
    const weights: number[] = rec.lessons.map((_, i) => {
      // Light ease-in-out so middle nodes have a touch more space
      const u = n === 1 ? 0.5 : i / (n - 1);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * u);
      // Slight irregular jitter in the spacing so it never lines up too neatly
      const id = rec.lessons[i].id;
      const wiggle = 0.85 + hash01(id + "-w") * 0.3;
      return (0.6 + eased * 0.8) * wiggle;
    });

    // Extra weight BEFORE and AFTER the gate for breathing room
    for (let i = 0; i < n; i++) {
      if (rec.lessons[i].is_gate) {
        if (i > 0) weights[i - 1] *= 1.8;
        weights[i] *= 2.2;
      }
    }

    const totalW = weights.reduce((a, b) => a + b, 0);
    let acc = 0;

    rec.lessons.forEach((lesson, i) => {
      acc += weights[i];
      const progress = totalW > 0 ? acc / totalW : (i + 1) / n;
      const t = tStart + span * (progress - weights[i] / (2 * totalW));
      const pt = nodeAt(sampled, Math.min(Math.max(t, tStart), tEnd));

      // Perpendicular jitter — off-path nudge. Compute the path tangent at
      // this t, rotate 90°, scale by a hash-driven amount.
      const tangentT1 = Math.min(1, Math.max(0, t + 0.002));
      const tangentT0 = Math.min(1, Math.max(0, t - 0.002));
      const p1 = nodeAt(sampled, tangentT1);
      const p0 = nodeAt(sampled, tangentT0);
      const tx = p1.x - p0.x;
      const ty = p1.y - p0.y;
      const mag = Math.hypot(tx, ty) || 1;
      const nx = -ty / mag;
      const ny = tx / mag;

      // Jitter magnitude: ~0-16px, biased lower for gate/boss so they feel
      // anchored. Sign is also hashed so jitter can go either side.
      const jitterMag = lesson.is_gate || lesson.is_boss ? 0 : hash01(lesson.id + "-j") * 16;
      const jitterSign = hash01(lesson.id + "-s") > 0.5 ? 1 : -1;
      const dx = nx * jitterMag * jitterSign;
      const dy = ny * jitterMag * jitterSign;

      result.push({
        lessonId: lesson.id,
        regionId: rId,
        x: pt.x + dx,
        y: pt.y + dy,
        t,
        indexInRegion: i,
      });
    });
  }

  return result;
}
