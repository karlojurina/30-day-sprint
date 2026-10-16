import * as THREE from "three";
import { SKY_MARKS } from "./layout";
import type { LightModule } from "./light";
import type { InstallFn, WorldCtx, WorldModule } from "./modules";
import { areaShare, type WorldProgress } from "./progress";

/**
 * v6 night sky (world_art_bible_v6.md 1.17, 2.5): the aurora and the eight
 * constellations. The Milky Way, the big moon and the stars (three sizes, two
 * tints, crosses on the brightest) are the sky dome's and the star field's in
 * light.ts; this module adds what sits on top of them.
 *
 *   Aurora         4 ribbons of 64 segments over the north, teal at the
 *                  bottom edge fading to violet at the top, curtain folds that
 *                  drift slowly. Additive, no depth write, pinned to the far
 *                  plane like the dome. 1 draw call.
 *   Constellations one per course area, per area from setWorldProgress
 *                  (lesson counts; setProgress's scalar is the fallback).
 *                  Creative Strategy is the hero: one star per lesson it
 *                  counts (the number the map is given), at seeded random
 *                  places in the telescope's lens, each its own size;
 *                  watching k of its lessons lights exactly k stars, always
 *                  the same ones in the same order, and every lit star after
 *                  the first draws one thin line to its nearest lit
 *                  neighbour. The other places keep their landmark shapes
 *                  (SKY_MARKS in layout.ts): finished ones are drawn
 *                  faintly, every other one shows FEW quiet stars and no
 *                  lines. Stars as instanced sprites, lines as thin quads:
 *                  2 calls.
 *
 * Map review, 2026-10-15 (Lovro's Loom 11:50 to 13:23, plan item 13): "I
 * watched six lessons, but only three lit up" (the hero was a 9 star
 * telescope and star k lit at k / 9 of the lessons), "make them the amount of
 * lessons", "more random", lines "very thin and very deliberate", and the
 * stars "too harsh, you can literally see the edge, too literal, all the same
 * size; the stars in the background are much better, ours a bit bigger". So
 * the hero's stars are scattered with a minimum gap (HERO_FIELD), sized star
 * by star, drawn as soft round glows with no cross, and every star and line
 * is written straight to the screen the way light.ts's star field is (no
 * colour space encode: the encode lifted a glow's faint tail into a visible
 * rim). Lines are about a pixel wide whatever the screen.
 *
 * Round 1 (Lovro's second walkthrough, decision 46): the star signs show ONLY
 * through the telescope (the Creative Strategy park), never on the rail or at
 * the a7 stop. They fade in with scene.userData.telescopeK (0 on the rail, 1
 * parked) as the camera leaves the objective. Through the telescope they are
 * one star chart, the stargazer's map of the whole course: Creative Strategy
 * round SKY_MARKS' a7 place (where the telescope points, the hero of the
 * frame), the other seven small around it in route order (CHART), in the
 * part of the 18 degree frame the lesson panel leaves free. The aurora is not
 * gated: it stays at a7 and on the rail.
 *
 * Map review wave 3: the lens is vertical, so a window narrower than about
 * 0.95 of its height left Creative Strategy's rightmost stars past the right
 * edge, and under about 1,040 px wide the panel stops narrowing at 300 px and
 * reaches toward its leftmost. On such a window the whole chart is moved and,
 * when it has to be, drawn smaller about its middle, as one figure, so every
 * one of its stars stands between the panel and the window's right edge
 * (fitFor). Wider windows draw it exactly as laid out.
 *
 * Everything fades with the light's star level (state.stars), so it is gone by
 * day and full at night.
 */

/** Constellation shapes of the chart's places: stars in a unit box (x right, y up, -0.5..0.5) and the lines between them. The hero has no shape (heroLayout). */
const SHAPES: Record<string, { p: ReadonlyArray<readonly [number, number]>; l: ReadonlyArray<readonly [number, number]> }> = {
  signpost: {
    p: [[0, -0.5], [0, -0.05], [0, 0.45], [-0.38, 0.38], [0.38, 0.3], [-0.32, 0.08], [0.3, 0.02]],
    l: [[0, 1], [1, 2], [2, 3], [2, 4], [1, 5], [1, 6]],
  },
  lookout: {
    p: [[-0.3, -0.5], [0.3, -0.5], [-0.18, 0.1], [0.18, 0.1], [-0.25, 0.3], [0.25, 0.3], [0, 0.5]],
    l: [[0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [4, 6], [5, 6]],
  },
  waterfall: {
    p: [[-0.38, 0.45], [0, 0.45], [0.38, 0.45], [0.06, 0.15], [0, -0.15], [0.05, -0.4], [-0.32, -0.5], [0.36, -0.5]],
    l: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [5, 7]],
  },
  "trail hut": {
    p: [[-0.36, -0.42], [0.36, -0.42], [-0.36, 0.05], [0.36, 0.05], [0, 0.45], [0.12, -0.42], [0.12, -0.12]],
    l: [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 4], [5, 6]],
  },
  boathouse: {
    p: [[-0.28, -0.2], [0.28, -0.2], [-0.28, 0.15], [0.28, 0.15], [0, 0.45], [-0.5, -0.36], [0.5, -0.36], [0.56, -0.12]],
    l: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [5, 0], [1, 6], [6, 7]],
  },
  "great tree": {
    p: [[0, -0.5], [0, -0.08], [-0.42, 0.1], [0.42, 0.1], [-0.24, 0.4], [0.24, 0.4], [0, 0.5], [-0.16, -0.5], [0.16, -0.5]],
    l: [[7, 0], [0, 8], [0, 1], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6]],
  },
  arch: {
    p: [[-0.36, -0.5], [-0.36, 0.0], [-0.3, 0.3], [0, 0.45], [0.3, 0.3], [0.36, 0.0], [0.36, -0.5], [0, 0.02]],
    l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
  },
};

const D2R = Math.PI / 180;
/**
 * Round 1: the star chart through the telescope. Each place other than a7 as
 * [dh, dv, size]: its centre in degrees right of and above the Creative
 * Strategy constellation's centre (SKY_MARKS a7, where TELESCOPE aims), on
 * the view plane, and its size in degrees. Route order runs down the left,
 * along the bottom, up the right, then the hero, then Job Board over the
 * tube's left end. Laid out for the park's rest view (az 296.5, el 30, lens
 * 18: the hero sits 3.5 right of centre and the panel covers the frame's left
 * ~30%), clear of the hero's stars and the frame's edges.
 */
const CHART: Readonly<Record<string, readonly [number, number, number]>> = {
  a1: [-5.4, -3.8, 2.4],
  a2: [-5.4, -7.2, 2.4],
  a3: [-1.7, -7.5, 2.4],
  a4: [2.1, -7.5, 2.4],
  a5: [6.0, -5.6, 2.4],
  a6: [6.2, -1.8, 2.4],
  a8: [-3.2, 5.0, 2.4],
};
/** The chart's small constellations draw at this share of the hero's brightness, so the hero leads.
 *  0 turns the chart off: the telescope then shows the Creative Strategy constellation alone. */
const CHART_ALPHA = 0.42;
/**
 * Final pass (the chart was busy: all eight drawn at once). Three tiers now:
 * Creative Strategy is the hero (one star per lesson, lit as they are
 * watched); the places the student has FINISHED are drawn faintly (thin
 * lines, small soft stars); every other place shows only a few quiet stars
 * (FEW of its points, as tiny dots like the star field's), so the chart reads
 * as one constellation in a sky with the student's past in it.
 * Star states (aState): 0 hidden, 1 quiet, 2 hero unlit, 3 hero lit,
 * 4 hero finished, 5 a finished place on the chart.
 */
const FEW = 3;
/** Line strength of a finished place on the chart, as a share of the hero's lines. */
const DONE_LINE = 0.45;
/** Telescope park progress (telescopeK) over which the chart fades in. */
const TEL_FADE: readonly [number, number] = [0.5, 0.9];
/**
 * Map review 2026-10-15: where Creative Strategy's stars may go, on CHART's
 * plane (degrees right of and above the a7 centre). The park's rest view
 * (scene.ts: az 296.5, el 30, lens 18) puts the lens's clear disc
 * (world.module.css .lens: 46vh round a point 17vh right of and 2vh above the
 * frame's centre) at (0.06, -0.69), radius 8.3; the stars keep inside 7 of
 * it (39vh), right of xMin (7vh left of the frame's centre: the telescope's
 * panel ends 48px short of 10.7vh, .panel[data-tel]), under yMax (40vh up:
 * the sky caption is the strip above), and `clear` beyond every chart
 * place's half size, so a finished place never mixes with them.
 */
const HERO_FIELD = { cx: 0.06, cy: -0.69, r: 7, xMin: -4.3, yMax: 6.2, clear: 0.8 } as const;
/** The minimum gap between two of its stars, as a share of the even spacing (sqrt(area / n)): random, never touching. */
const HERO_GAP = 0.62;
/** The first star to light is the one nearest this point (the lens's left, by the panel); the rest light outward from it. */
const HERO_START: readonly [number, number] = [-3.5, -0.5];
const HERO_SEED = 23;
/** At most this many stars (the field holds about this many with a gap); a place with more lessons lights them in proportion. */
const HERO_MAX = 96;
/** Half size of a hero star's sprite (radians), times the star's own size (0.65 to 1.6): at 1278px high a core about 6px across in a glow about 16px round. */
const HERO_HALF = 0.46 * D2R;
/** A hero line stops this far short of each star's centre (degrees), times the star's size. */
const HERO_LINE_GAP = 0.24;
/** A hero line's strength at its centre (alpha), and once the place is finished. */
const HERO_LINE = 0.32;
const HERO_LINE_DONE = 0.38;
/** Half size of a chart place's quiet star (radians); a finished place's are CHART_DONE times it. */
const CHART_HALF = 0.065 * D2R;
const CHART_DONE = 1.7;
/** Lines: the quad's half width on the sky (radians), room for the soft profile at any lens the park passes; the profile's sigma (CSS px). */
const LINE_QUAD = 0.06 * D2R;
const LINE_SIGMA = 0.6;

/**
 * Map review wave 3, narrow and portrait windows. The telescope's rest view
 * as scene.ts parks it (TEL_PARK_LOOK_OFF, TEL_PARK_FOV): 3.5 degrees left of
 * and 1 below where the telescope points (SKY_MARKS a7), through an 18 degree
 * lens, vertical, so every window sees the same height of sky and a narrow
 * one less of its width.
 */
const REST_OFF: readonly [number, number] = [3.5, 1];
const REST_FOV = 18;
/** How far (CSS px) a fitted chart keeps Creative Strategy's stars from the panel and from the window's right edge. */
const FIT_PAD = 32;

/**
 * Where the telescope's panel ends (CSS px from the left) at a window w x h:
 * its width is world.module.css .panel[data-tel], its left edge WorldV6.tsx's
 * placePanel (the gutter plus 8: 36 under 1100 px wide, 48 up to 2200, 64 from
 * there).
 */
function telPanelRight(w: number, h: number): number {
  if (w >= 2200) return 64 + Math.min(432, w / 2 - 0.107 * h - 112);
  return (w < 1100 ? 36 : 48) + Math.min(404, Math.max(300, w / 2 - 0.107 * h - 84));
}

/** The chart fitted to a narrow window, on the rest view's screen (vh from its centre, x right, y up): x' = x0 + s (x - xa), y' = ym + s (y - ym). */
interface ChartFit {
  s: number;
  xa: number;
  x0: number;
  ym: number;
}

/** A hash in 0..1 (light.ts's hash1). */
function hash01(i: number, seed: number): number {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function inHeroField(x: number, y: number): boolean {
  const F = HERO_FIELD;
  if (x < F.xMin || y > F.yMax || (x - F.cx) ** 2 + (y - F.cy) ** 2 > F.r * F.r) return false;
  for (const id in CHART) {
    const c = CHART[id];
    const rr = c[2] / 2 + F.clear;
    if ((x - c[0]) ** 2 + (y - c[1]) ** 2 < rr * rr) return false;
  }
  return true;
}

let heroArea = 0;
/** The field's area (square degrees), counted once on a grid. */
function heroFieldArea(): number {
  if (heroArea > 0) return heroArea;
  const F = HERO_FIELD;
  const N = 48;
  let hit = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) if (inHeroField(F.cx - F.r + (2 * F.r * (i + 0.5)) / N, F.cy - F.r + (2 * F.r * (j + 0.5)) / N)) hit++;
  }
  heroArea = (hit / (N * N)) * 4 * F.r * F.r;
  return heroArea;
}

/** One of Creative Strategy's stars: where (CHART's plane, degrees), the earlier star its line goes to (-1 for the first), its size and brightness, its warmth. */
interface HeroStar {
  x: number;
  y: number;
  parent: number;
  size: number;
  bright: number;
  warm: number;
}

/**
 * n stars for Creative Strategy, in the order they light. Placed at random
 * (seeded, so every page draws the same sky) inside HERO_FIELD, each at least
 * the gap from the others; the gap starts at HERO_GAP of the even spacing and
 * gives way 8% at a time if 400 tries in a row miss. Lit in the order of a
 * minimum spanning tree grown from the star nearest HERO_START (Prim's): each
 * next star is the unlit one nearest to any lit one, and its line goes to
 * that lit star. So the lit stars are always one figure, every line is the
 * shortest link there is, and no two lines cross.
 */
function heroLayout(n: number): { stars: HeroStar[]; gap: number } {
  const F = HERO_FIELD;
  const count = Math.max(0, Math.min(HERO_MAX, Math.floor(n)));
  const pts: [number, number][] = [];
  let g = count > 0 ? HERO_GAP * Math.sqrt(heroFieldArea() / count) : 0;
  for (let t = 0, miss = 0; pts.length < count; t++) {
    const x = F.cx - F.r + 2 * F.r * hash01(t, HERO_SEED);
    const y = F.cy - F.r + 2 * F.r * hash01(t, HERO_SEED + 1);
    if (inHeroField(x, y) && pts.every((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 >= g * g)) {
      pts.push([x, y]);
      miss = 0;
    } else if (++miss > 400) {
      g *= 0.92;
      miss = 0;
    }
  }
  // The tree is grown on the plane the lines are straight on (tan of the
  // offsets: planeDir), so the shortest links never cross on the screen.
  const tp = pts.map(([x, y]): [number, number] => [Math.tan(x * D2R), Math.tan(y * D2R)]);
  const t0: [number, number] = [Math.tan(HERO_START[0] * D2R), Math.tan(HERO_START[1] * D2R)];
  const d2 = (a: readonly [number, number], b: readonly [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const order: number[] = [];
  const from: number[] = [];
  if (count > 0) {
    let cur = 0;
    for (let i = 1; i < count; i++) if (d2(tp[i], t0) < d2(tp[cur], t0)) cur = i;
    const lit = new Array<boolean>(count).fill(false);
    const best = new Array<number>(count).fill(Infinity);
    const via = new Array<number>(count).fill(-1);
    for (let step = 0; step < count; step++) {
      lit[cur] = true;
      order.push(cur);
      from.push(via[cur]);
      let next = -1;
      for (let i = 0; i < count; i++) {
        if (lit[i]) continue;
        const d = d2(tp[i], tp[cur]);
        if (d < best[i]) {
          best[i] = d;
          via[i] = cur;
        }
        if (next < 0 || best[i] < best[next]) next = i;
      }
      cur = next;
    }
  }
  const rank = new Array<number>(count).fill(-1);
  order.forEach((p, k) => (rank[p] = k));
  const stars = order.map((p, k): HeroStar => {
    // Sized by where the star was placed, so a star keeps its look; most are
    // small, a few big, and the big ones brighter, as stars read.
    const m = hash01(p, HERO_SEED + 5);
    return {
      x: pts[p][0],
      y: pts[p][1],
      parent: k === 0 ? -1 : rank[from[k]],
      size: 0.65 + 0.95 * m * m,
      bright: 0.72 + 0.28 * m,
      warm: hash01(p, HERO_SEED + 7) < 0.25 ? 0.35 : 1,
    };
  });
  return { stars, gap: g };
}

/** Aurora ribbons: azimuth from, to (compass), base elevation, height, strength. */
// Fix round 3: the a7 frame now looks at bearing 46, 8 up (el -12 to 28):
// curtains over the north east, behind the telescope's tube, and on over the
// north.
const AURORA: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [5, 70, 14, 11, 1.0],
  [25, 95, 19, 8, 0.7],
  [330, 30, 10, 8, 0.45],
  // Final cleanup: a fainter curtain behind the Creative Strategy mark (az
  // 300, el 31), so the telescope park's end frame (18 lens) lands on aurora
  // again after the three above moved to the a7 frame's north east. Outside
  // the a7 frame (az ~13-79); same mesh, same draw call.
  [274, 328, 25, 13, 0.55],
];
const AURORA_SEGS = 64;

function dirOf(azDeg: number, elDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = azDeg * D2R;
  const e = elDeg * D2R;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** A point of a constellation on the sky: its centre, size and the unit box offset. */
function markDir(m: { az: number; el: number; size: number }, x: number, y: number): THREE.Vector3 {
  const el = m.el + y * m.size;
  const az = m.az + (x * m.size) / Math.max(0.3, Math.cos(el * D2R));
  return dirOf(az, el);
}

const FAR_VS = /* glsl */ `
  vec4 farClip(vec3 d) {
    vec4 c = projectionMatrix * viewMatrix * vec4(d * 1000.0 + cameraPosition, 1.0);
    return vec4(c.xy, c.w * 0.99999, c.w);
  }
`;

export const install: InstallFn = (ctx: WorldCtx): WorldModule => {
  const t0 = performance.now();
  const light = (ctx.scene.userData.light as LightModule | undefined) ?? null;
  const group = new THREE.Group();
  group.name = "NightSky";
  ctx.scene.add(group);
  const disposables: { dispose(): void }[] = [];
  const uNight = { value: 0 };
  const uTime = { value: 0 };
  /** Final pass: the moon's direction and how much of it shows (light state), for the aurora's clearing round it. */
  const uMoonDir = { value: new THREE.Vector3(0, 1, 0) };
  const uMoonVis = { value: 0 };
  /** Round 1: the star chart's share, 0 on the rail and at a7, 1 through the telescope. */
  const uTel = { value: 0 };

  // ── Aurora ──
  const aPos: number[] = [];
  const aUv: number[] = [];
  const aIdx: number[] = [];
  AURORA.forEach(([az0, az1, el0, h, k], r) => {
    const v0 = aPos.length / 3;
    for (let i = 0; i <= AURORA_SEGS; i++) {
      const t = i / AURORA_SEGS;
      const az = az0 + (az1 - az0) * t;
      // A slow wave along the ribbon: its base rises and falls.
      const el = el0 + Math.sin(t * 5.3 + r * 1.7) * 1.6 + Math.sin(t * 13.1 + r) * 0.5;
      for (let j = 0; j < 2; j++) {
        const d = dirOf(az, el + j * h);
        aPos.push(d.x, d.y, d.z);
        aUv.push(t, j, k + r * 10);
      }
    }
    for (let i = 0; i < AURORA_SEGS; i++) {
      const a = v0 + i * 2;
      aIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const auroraGeo = new THREE.BufferGeometry();
  auroraGeo.setAttribute("position", new THREE.Float32BufferAttribute(aPos, 3));
  auroraGeo.setAttribute("aUv", new THREE.Float32BufferAttribute(aUv, 3));
  auroraGeo.setIndex(aIdx);
  const auroraMat = new THREE.ShaderMaterial({
    name: "V6Aurora",
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: { uNight, uTime, uMoonDir, uMoonVis },
    vertexShader: /* glsl */ `
      attribute vec3 aUv;
      varying vec3 vUv;
      varying vec3 vDir;
      ${FAR_VS}
      void main() {
        vUv = aUv;
        vDir = normalize(position);
        gl_Position = farClip(vDir);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uTime;
      uniform vec3 uMoonDir;
      uniform float uMoonVis;
      varying vec3 vUv;
      varying vec3 vDir;
      float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      float n1(float x) { float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main() {
        float t = vUv.x;
        float v = vUv.y;
        float k = fract(vUv.z / 10.0) * 10.0;
        float seed = floor(vUv.z / 10.0);
        // Curtain folds: vertical rays that drift slowly along the ribbon.
        float x = t * 38.0 + seed * 7.0;
        float rays = 0.45 + 0.55 * n1(x + uTime * 0.25) * n1(x * 0.37 - uTime * 0.12 + 3.0);
        // Bright lower edge, a long fade up, soft ends. Fix round 1 (judge 1):
        // the ends fade over a third of the ribbon each way, and a slow noise
        // along it frays the curtain (its height and its strength), so the
        // ribbons dissolve instead of stopping on a straight edge.
        float fray = n1(t * 5.0 + seed * 3.7 + uTime * 0.03);
        float top = 0.55 + 0.45 * n1(t * 7.0 + seed * 5.3 - uTime * 0.02);
        // Fix round 2 (judge 2): the lower edge fades over a fifth of the
        // ribbon (was 8%), so the bright band has no crisp line under it.
        float edge = smoothstep(0.0, 0.22, v) * pow(max(1.0 - v / top, 0.0), 1.6);
        float ends = smoothstep(0.0, 0.35, t) * smoothstep(1.0, 0.65, t) * (0.3 + 0.7 * fray);
        vec3 teal = vec3(0.12, 0.85, 0.62);
        vec3 violet = vec3(0.45, 0.22, 0.75);
        vec3 col = mix(teal, violet, smoothstep(0.15, 0.8, v));
        float a = edge * ends * rays * k * uNight * 0.34;
        // Final pass: the bright moon outshines the curtain round it (a soft
        // clearing from ~3 to ~10 degrees), so the disc stays a clean shape
        // where it sits inside the aurora at a7 (light.ts NIGHT_MOON).
        float cm = dot(normalize(vDir), uMoonDir);
        a *= 1.0 - 0.8 * uMoonVis * smoothstep(0.9848, 0.9986, cm);
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const aurora = new THREE.Mesh(auroraGeo, auroraMat);
  aurora.name = "Aurora";
  aurora.frustumCulled = false;
  aurora.renderOrder = -880;
  group.add(aurora);
  disposables.push(auroraGeo, auroraMat);

  // ── Constellations ──
  // Round 1: every place but a7 moves onto the telescope's chart (CHART),
  // placed on the view plane around the hero's centre. Map review
  // 2026-10-15: the hero has no shape; its stars (heroLayout, one per
  // lesson) are built when the page says how many lessons it has.
  const hero = SKY_MARKS.find((m) => m.id === "a7") ?? SKY_MARKS[0];
  const heroIdx = SKY_MARKS.findIndex((m) => m.id === hero.id);
  const fwd = dirOf(hero.az, hero.el);
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const upv = new THREE.Vector3().crossVectors(right, fwd);
  /** A point of CHART's plane (degrees right of and above the hero's centre) as a direction. */
  const planeDir = (x: number, y: number) =>
    fwd.clone().addScaledVector(right, Math.tan(x * D2R)).addScaledVector(upv, Math.tan(y * D2R)).normalize();
  // Wave 3: the telescope's rest view (REST_OFF, REST_FOV), to fit the chart to narrow windows.
  const restF = dirOf(hero.az - REST_OFF[0], hero.el - REST_OFF[1]);
  const restR = new THREE.Vector3().crossVectors(restF, new THREE.Vector3(0, 1, 0)).normalize();
  const restU = new THREE.Vector3().crossVectors(restR, restF);
  const restTan = Math.tan((REST_FOV / 2) * D2R);
  /** Where direction d shows in the rest view: vh from the screen's centre, x right, y up. */
  const restVh = (d: THREE.Vector3): [number, number] => {
    const z = d.dot(restF);
    return [(d.dot(restR) / z / restTan) * 50, (d.dot(restU) / z / restTan) * 50];
  };
  /** Direction d where the fit puts it (null: as laid out). */
  const fitDir = (d: THREE.Vector3, f: ChartFit | null, out: THREE.Vector3): THREE.Vector3 => {
    if (!f) return out.copy(d);
    const [x, y] = restVh(d);
    const nx = f.x0 + f.s * (x - f.xa);
    const ny = f.ym + f.s * (y - f.ym);
    return out.copy(restF).addScaledVector(restR, (nx / 50) * restTan).addScaledVector(restU, (ny / 50) * restTan).normalize();
  };
  /**
   * The fit that puts every one of Creative Strategy's stars (dirs) between
   * the panel and the window's right edge, FIT_PAD clear of both: moved across
   * when they fit, drawn smaller when they do not (filling the room, about
   * their vertical middle). null where they stand there already, as on every
   * window wider than about 0.95 of its height.
   */
  const fitFor = (dirs: readonly THREE.Vector3[], w: number, h: number): ChartFit | null => {
    if (!dirs.length || !(w > 0) || !(h > 0)) return null;
    const lo = ((telPanelRight(w, h) + FIT_PAD - w / 2) / h) * 100;
    const hi = ((w / 2 - FIT_PAD) / h) * 100;
    let xa = Infinity;
    let xb = -Infinity;
    let ya = Infinity;
    let yb = -Infinity;
    for (const d of dirs) {
      const [x, y] = restVh(d);
      xa = Math.min(xa, x);
      xb = Math.max(xb, x);
      ya = Math.min(ya, y);
      yb = Math.max(yb, y);
    }
    if (xa >= lo && xb <= hi) return null;
    const s = Math.max(0.2, Math.min(1, (hi - lo) / Math.max(1e-6, xb - xa)));
    return { s, xa, x0: s < 1 || xb <= hi ? lo : hi - (xb - xa), ym: (ya + yb) / 2 };
  };
  const sameFit = (a: ChartFit | null, b: ChartFit | null) =>
    a === b || (!!a && !!b && Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.xa - b.xa) < 1e-6 && Math.abs(a.x0 - b.x0) < 1e-6 && Math.abs(a.ym - b.ym) < 1e-6);
  const marks = SKY_MARKS.flatMap((m, i) => {
    const c = CHART[m.id];
    if (!c || i === heroIdx) return [];
    const d = planeDir(c[0], c[1]);
    const el = Math.asin(d.y) / D2R;
    const az = (Math.atan2(d.x, -d.z) / D2R + 360) % 360;
    return [{ i, m: { az, el, size: c[2] }, shape: SHAPES[m.shape] ?? SHAPES.signpost }];
  });
  /** Final pass: the FEW points of a shape that stay as quiet stars, spread
   *  apart (farthest point first), so they read as loose stars, not a shape. */
  const fewOf = (p: ReadonlyArray<readonly [number, number]>): Set<number> => {
    const pick = [0];
    while (pick.length < Math.min(FEW, p.length)) {
      let best = -1;
      let bestD = -1;
      for (let j = 0; j < p.length; j++) {
        if (pick.includes(j)) continue;
        const d = Math.min(...pick.map((q) => Math.hypot(p[j][0] - p[q][0], p[j][1] - p[q][1])));
        if (d > bestD) {
          bestD = d;
          best = j;
        }
      }
      pick.push(best);
    }
    return new Set(pick);
  };

  // The chart's stars, laid out once: direction (build draws it through the
  // fit), brightness and warmth, area, one of the FEW. The hero's go after them.
  const chartNat: THREE.Vector3[] = [];
  const chartLook: number[] = [];
  const chartArea: number[] = [];
  const chartFew: boolean[] = [];
  for (const { i, m, shape } of marks) {
    const few = fewOf(shape.p);
    shape.p.forEach(([x, y], k) => {
      chartNat.push(markDir(m, x, y));
      chartLook.push(1, 1);
      chartArea.push(i);
      chartFew.push(few.has(k));
    });
  }
  const chartN = chartArea.length;

  // Lines as thin quads on the sky: per vertex a point, the side vector and
  // [area, across (-1 or 1), along (0 at the start, 1 at the end), 0].
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const AB = new THREE.Vector3();
  const A2 = new THREE.Vector3();
  const B2 = new THREE.Vector3();
  const side = new THREE.Vector3();
  /** The line from A to B, cut short by `cutA` and `cutB` of its length at its ends. */
  const pushLine = (pos: number[], sides: number[], data: number[], area: number, cutA: number, cutB: number) => {
    AB.subVectors(B, A);
    A2.copy(A).addScaledVector(AB, cutA);
    B2.copy(A).addScaledVector(AB, 1 - cutB);
    side.crossVectors(AB, A2).normalize();
    for (const [p, across, along] of [
      [A2, -1, 0],
      [A2, 1, 0],
      [B2, -1, 1],
      [B2, 1, 1],
    ] as const) {
      pos.push(p.x, p.y, p.z);
      sides.push(side.x, side.y, side.z);
      data.push(area, across, along, 0);
    }
  };
  /** The chart's lines: the area and both ends as laid out (build draws them through the fit). */
  const chartLines: { area: number; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  for (const { i, m, shape } of marks) {
    for (const [a, b] of shape.l) chartLines.push({ area: i, a: markDir(m, shape.p[a][0], shape.p[a][1]), b: markDir(m, shape.p[b][0], shape.p[b][1]) });
  }
  const chartLineN = chartLines.length;

  // ── Constellations: stars ──
  const quad = new THREE.PlaneGeometry(2, 2);
  const starGeo = new THREE.InstancedBufferGeometry();
  const starMat = new THREE.ShaderMaterial({
    name: "V6ConstellationStars",
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: { uNight, uTel, uChart: { value: CHART_ALPHA } },
    vertexShader: /* glsl */ `
      attribute vec4 aDir;
      attribute vec2 aLook;
      attribute float aState;
      varying vec2 vQ;
      varying float vState;
      varying vec2 vLook;
      ${FAR_VS}
      void main() {
        vec3 d = normalize(aDir.xyz);
        vec3 r = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
        vec3 u = cross(r, d);
        // States (nightsky.ts FEW): 0 hidden, 1 quiet, 2 hero unlit, 3 hero
        // lit, 4 hero finished, 5 a finished place on the chart. aDir.w is
        // the star's half size: hidden stars collapse to a point, an unlit
        // hero star takes a little over half its lit room, a finished place's grow.
        float sz = aState < 0.5 ? 0.0 : aState < 1.5 ? 1.0 : aState < 2.5 ? 0.55 : aState < 4.5 ? 1.0 : ${CHART_DONE.toFixed(2)};
        vQ = position.xy;
        vState = aState;
        vLook = aLook;
        gl_Position = farClip(normalize(d + (r * position.x + u * position.y) * aDir.w * sz));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uTel;
      uniform float uChart;
      varying vec2 vQ;
      varying float vState;
      varying vec2 vLook;
      void main() {
        float r2 = dot(vQ, vQ);
        // Map review 2026-10-15: round soft glows, no cross, written straight
        // to the screen as light.ts's star field is (the colour space encode
        // lifted a glow's faint tail into a visible rim). Every profile has
        // died away before the sprite's edge.
        float a;
        float warm;
        if (vState < 1.5) {
          // Quiet: a tiny cool dot, like the star field's middle size.
          a = 0.5 * exp(-r2 * 14.0);
          warm = 0.0;
        } else if (vState < 2.5) {
          // A hero lesson not watched yet: a small dim cool point, findable, clearly not lit.
          a = vLook.x * (0.42 * exp(-r2 * 30.0) + 0.08 * exp(-r2 * 6.0));
          warm = 0.0;
        } else if (vState < 4.5) {
          // A hero lesson watched: a bright core in a soft halo; a little brighter once the place is finished.
          a = vLook.x * (exp(-r2 * 110.0) + 0.28 * exp(-r2 * 9.0)) * (vState > 3.5 ? 1.12 : 1.0);
          warm = vLook.y;
        } else {
          // A finished place on the chart: a small warm star, a soft halo.
          a = uChart * (exp(-r2 * 40.0) + 0.15 * exp(-r2 * 6.0));
          warm = 1.0;
        }
        a *= (1.0 - smoothstep(0.55, 1.0, r2)) * uNight * uTel;
        if (a < 0.004) discard;
        vec3 col = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.93, 0.8), warm);
        gl_FragColor = vec4(col, min(a, 1.0));
      }`,
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.name = "ConstellationStars";
  starMesh.frustumCulled = false;
  starMesh.renderOrder = -870;
  group.add(starMesh);

  // ── Constellations: lines ──
  // Per area: strength and width (set in apply). The hero's lines join lit
  // stars only; a finished place on the chart draws its shape's lines at
  // DONE_LINE; every other place draws none.
  const uLineA = { value: new Array<number>(8).fill(0) };
  const uLineW = { value: new Array<number>(8).fill(1) };
  /** The line profile's sigma in device pixels (LINE_SIGMA x the pixel ratio, kept in update). */
  const uSig = { value: LINE_SIGMA };
  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.ShaderMaterial({
    name: "V6ConstellationLines",
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: { uNight, uTel, uLineA, uLineW, uSig, uHalf: { value: LINE_QUAD } },
    vertexShader: /* glsl */ `
      attribute vec3 aSide;
      attribute vec4 aLine;
      attribute float aLit;
      uniform float uLineA[8];
      uniform float uLineW[8];
      uniform float uHalf;
      varying float vA;
      varying float vW;
      varying vec2 vTS;
      ${FAR_VS}
      void main() {
        int k = int(aLine.x + 0.5);
        vA = uLineA[k] * aLit;
        vW = uLineW[k];
        vTS = aLine.yz;
        gl_Position = farClip(normalize(normalize(position) + aSide * aLine.y * uHalf));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uTel;
      uniform float uSig;
      varying float vA;
      varying float vW;
      varying vec2 vTS;
      void main() {
        // Map review 2026-10-15: about a pixel wide on any screen and through
        // any lens: a gaussian across the line, measured in pixels from the
        // derivatives, faded at both ends, written straight to the screen.
        float g = length(vec2(dFdx(vTS.x), dFdy(vTS.x)));
        float d = abs(vTS.x) / max(g, 1e-5);
        float s = uSig * vW;
        float ends = smoothstep(0.0, 0.1, vTS.y) * smoothstep(1.0, 0.9, vTS.y);
        float a = vA * exp(-0.5 * d * d / (s * s)) * ends * uNight * uTel;
        if (a < 0.004) discard;
        gl_FragColor = vec4(1.0, 0.92, 0.78, a);
      }`,
  });
  const lines = new THREE.Mesh(lineGeo, lineMat);
  lines.name = "ConstellationLines";
  lines.frustumCulled = false;
  lines.renderOrder = -875;
  group.add(lines);
  disposables.push(starGeo, starMat, quad, lineGeo, lineMat);

  // ── The hero's stars, rebuilt when its lesson count changes ──
  /** The lesson count the hero's stars stand for, and how many are drawn (HERO_MAX caps it). */
  let heroLessons = 0;
  let heroN = 0;
  let heroGap = 0;
  let heroMs = 0;
  let nStars = 0;
  let nLines = 0;
  let stateAttr = new THREE.InstancedBufferAttribute(new Float32Array(0), 1);
  let lineLitAttr = new THREE.Float32BufferAttribute(new Float32Array(0), 1);
  /** Wave 3: the hero's layout for its count (a refit does not lay it out again), its stars as laid out, the window the chart is fitted to (CSS px) and the fit. */
  let laid: { n: number; stars: HeroStar[]; gap: number } | null = null;
  let heroNat: THREE.Vector3[] = [];
  let fitW = 0;
  let fitH = 0;
  let fit: ChartFit | null = null;
  const P = new THREE.Vector3();
  const build = (n: number) => {
    const b0 = performance.now();
    if (!laid || laid.n !== n) laid = { n, ...heroLayout(n) };
    const { stars, gap } = laid;
    heroN = stars.length;
    heroGap = gap;
    heroNat = stars.map((s) => planeDir(s.x, s.y));
    fit = fitFor(heroNat, fitW, fitH);
    const heroDirs = heroNat.map((d) => fitDir(d, fit, new THREE.Vector3()));
    const dirs: number[] = [];
    for (const d of chartNat) {
      fitDir(d, fit, P);
      dirs.push(P.x, P.y, P.z, CHART_HALF);
    }
    const look = chartLook.slice();
    stars.forEach((s, k) => {
      const d = heroDirs[k];
      dirs.push(d.x, d.y, d.z, HERO_HALF * s.size);
      look.push(s.bright, s.warm);
    });
    nStars = chartN + heroN;
    // The chart's lines, shortened at both ends so they stop short of the
    // stars. A fitted chart keeps the stars' size, so the cuts grow as it
    // shrinks and the gaps stay as wide.
    const sc = fit ? fit.s : 1;
    const pos: number[] = [];
    const sides: number[] = [];
    const data: number[] = [];
    for (const l of chartLines) {
      fitDir(l.a, fit, A);
      fitDir(l.b, fit, B);
      pushLine(pos, sides, data, l.area, Math.min(0.3, 0.12 / sc), Math.min(0.3, 0.12 / sc));
    }
    // One line per star after the first, to the lit star it grew from (in
    // star order, so line k - 1 belongs to star k), stopping short of both.
    stars.forEach((s, k) => {
      if (s.parent < 0) return;
      const p = stars[s.parent];
      A.copy(heroDirs[s.parent]);
      B.copy(heroDirs[k]);
      const len = Math.max(1e-3, sc * Math.hypot(s.x - p.x, s.y - p.y));
      pushLine(pos, sides, data, heroIdx, Math.min(0.3, (HERO_LINE_GAP * p.size) / len), Math.min(0.3, (HERO_LINE_GAP * s.size) / len));
    });
    nLines = data.length / 16;
    const idx: number[] = [];
    for (let l = 0; l < nLines; l++) idx.push(l * 4, l * 4 + 2, l * 4 + 1, l * 4 + 1, l * 4 + 2, l * 4 + 3);
    // The old buffers go; the next frame uploads these.
    starGeo.dispose();
    lineGeo.dispose();
    starGeo.index = quad.index;
    starGeo.setAttribute("position", quad.getAttribute("position"));
    starGeo.setAttribute("aDir", new THREE.InstancedBufferAttribute(new Float32Array(dirs), 4));
    starGeo.setAttribute("aLook", new THREE.InstancedBufferAttribute(new Float32Array(look), 2));
    stateAttr = new THREE.InstancedBufferAttribute(new Float32Array(nStars), 1);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    starGeo.setAttribute("aState", stateAttr);
    starGeo.instanceCount = nStars;
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    lineGeo.setAttribute("aSide", new THREE.Float32BufferAttribute(sides, 3));
    lineGeo.setAttribute("aLine", new THREE.Float32BufferAttribute(data, 4));
    lineLitAttr = new THREE.Float32BufferAttribute(new Float32Array(nLines * 4), 1);
    lineLitAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute("aLit", lineLitAttr);
    lineGeo.setIndex(idx);
    heroMs = performance.now() - b0;
  };
  build(0);

  // ── Progress ──
  // Final pass: per area, from the lesson counts (setWorldProgress). The
  // scalar setProgress (places finished + the share of the next) stays as the
  // fallback for a page that has not sent lesson counts yet; it knows no
  // lesson count, so the hero has no stars until the page sends one.
  let progress = 0;
  let hasWorld = false;
  const shares = new Array<number>(SKY_MARKS.length).fill(0);
  /** Creative Strategy's lessons watched, and its stars lit. */
  let heroDone = 0;
  let heroLit = 0;
  const apply = () => {
    const st = stateAttr.array as Float32Array;
    for (let s = 0; s < chartN; s++) st[s] = (shares[chartArea[s]] ?? 0) >= 1 ? 5 : chartFew[s] ? 1 : 0;
    // Map review 2026-10-15: one star per lesson, so k watched light the
    // first k stars (in proportion only past HERO_MAX).
    const finished = heroLessons > 0 && heroDone >= heroLessons;
    heroLit = finished ? heroN : heroN === heroLessons ? Math.min(heroN, heroDone) : Math.floor((heroDone * heroN) / Math.max(1, heroLessons));
    for (let k = 0; k < heroN; k++) st[chartN + k] = finished ? 4 : k < heroLit ? 3 : 2;
    stateAttr.needsUpdate = true;
    // A chart line is gated by its area's strength; a hero line draws once
    // the star it leads to is lit (the star it comes from lit before it).
    const lit = lineLitAttr.array as Float32Array;
    lit.fill(1, 0, chartLineN * 4);
    for (let k = 1; k < heroN; k++) lit.fill(k < heroLit ? 1 : 0, (chartLineN + k - 1) * 4, (chartLineN + k) * 4);
    lineLitAttr.needsUpdate = true;
    for (let i = 0; i < 8; i++) {
      const share = shares[i] ?? 0;
      if (i === heroIdx) {
        uLineA.value[i] = finished ? HERO_LINE_DONE : HERO_LINE;
        uLineW.value[i] = 1;
      } else {
        uLineA.value[i] = share >= 1 ? HERO_LINE * DONE_LINE : 0;
        uLineW.value[i] = 0.85;
      }
    }
    progress = shares.reduce((a, b) => a + b, 0);
  };
  const setProgress = (p: number) => {
    if (hasWorld) return;
    const v = Math.max(0, Math.min(SKY_MARKS.length, Number.isFinite(p) ? p : 0));
    for (let i = 0; i < shares.length; i++) shares[i] = Math.min(1, Math.max(0, v - i));
    heroDone = Math.floor((shares[heroIdx] ?? 0) * heroLessons + 1e-6);
    apply();
  };
  const setWorldProgress = (wp: WorldProgress) => {
    if (!wp.lessons.length) return;
    hasWorld = true;
    // The hero's star count is the lesson count the map is given (the
    // lessons that count: the catalog's feature rows are not in it).
    const n = Math.max(0, Math.floor(wp.lessons[heroIdx] ?? 0));
    if (n !== heroLessons) {
      heroLessons = n;
      build(n);
    }
    for (let i = 0; i < shares.length; i++) shares[i] = areaShare(wp, i);
    heroDone = Math.min(n, Math.max(0, Math.floor(wp.done[heroIdx] ?? 0)));
    apply();
  };
  setProgress(0);

  let lastNight = -1;
  let lastAim = 0;
  const viewSize = new THREE.Vector2();
  const update = (time: number) => {
    const s = light?.state;
    const night = s ? Math.min(1, Math.max(0, s.stars)) * (1 - s.under) : 0;
    uNight.value = night;
    uTime.value = time;
    uSig.value = LINE_SIGMA * (ctx.renderer ? ctx.renderer.getPixelRatio() : 1);
    if (s) {
      uMoonDir.value.copy(s.moonDir).normalize();
      uMoonVis.value = s.moonVis;
    }
    const aimK = Math.min(1, Math.max(0, Number(ctx.scene.userData.telescopeK) || 0));
    const changed = Math.abs(night - lastNight) > 1e-4 || Math.abs(aimK - lastAim) > 1e-4;
    lastNight = night;
    lastAim = aimK;
    // Round 1: the star signs only through the telescope (smoothstep over TEL_FADE).
    const tt = Math.min(1, Math.max(0, (aimK - TEL_FADE[0]) / (TEL_FADE[1] - TEL_FADE[0])));
    uTel.value = tt * tt * (3 - 2 * tt);
    // Nothing to draw by day: skip the three calls entirely; off the telescope, the two chart calls.
    group.visible = night > 0.1;
    starMesh.visible = uTel.value > 0.002;
    lines.visible = starMesh.visible;
    // Wave 3: a window of another size may need the chart fitted again (fitFor).
    let refit = false;
    if (ctx.renderer) {
      ctx.renderer.getSize(viewSize);
      if (viewSize.x !== fitW || viewSize.y !== fitH) {
        fitW = viewSize.x;
        fitH = viewSize.y;
        if (!sameFit(fitFor(heroNat, fitW, fitH), fit)) {
          build(heroLessons);
          apply();
          refit = true;
        }
      }
    }
    return changed || refit || (night > 0.05 && !ctx.reducedMotion);
  };
  update(0);

  const buildMs = performance.now() - t0;
  const nightsky: WorldModule & { setProgress(p: number): void; setWorldProgress(p: WorldProgress): void } = {
    name: "nightsky",
    update,
    isAnimating: () => uNight.value > 0.05 && !ctx.reducedMotion,
    setProgress,
    setWorldProgress,
    dispose() {
      ctx.scene.remove(group);
      for (const d of disposables) d.dispose();
    },
    stats: () => ({
      triangles: AURORA.length * AURORA_SEGS * 2 + nStars * 2 + nLines * 2,
      instances: nStars,
      calls: group.visible ? 1 + (starMesh.visible ? 2 : 0) : 0,
      constellationStars: nStars,
      // Map review 2026-10-15 (world-tests/v6-stars.mjs): Creative Strategy's
      // stars are instances heroFirst to heroFirst + heroStars - 1, in the
      // order they light; heroLines of their lines are drawn.
      heroLessons,
      heroStars: heroN,
      heroLit,
      heroLines: Math.max(0, heroLit - 1),
      heroFirst: chartN,
      heroGapDeg: Math.round(heroGap * 100) / 100,
      // Wave 3: 0 when the chart is drawn as laid out; on a narrow window the scale it is fitted at (1: moved only).
      heroFit: fit ? Math.round(fit.s * 1000) / 1000 : 0,
      heroBuildMs: Math.round(heroMs * 100) / 100,
      progress: Math.round(progress * 100) / 100,
      buildMs: Math.round(buildMs * 10) / 10,
    }),
  };
  return nightsky;
};
