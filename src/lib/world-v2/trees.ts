import * as THREE from "three";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";

/**
 * The triangle budget, and the two tools the scene uses to fix it.
 *
 * Measured on public/world/world.glb (2026-09-24): 5.71M of the 5.88M drawn
 * triangles are 1,100 kit trees built from 12 prototypes at ~5,188 triangles
 * each, for objects 2-8 units tall. On the v2 rail (shots/v2/rail-poses.json)
 * the nearest tree in frame is 256-451 units away and never more than 68 px
 * tall on a 1278 px viewport; only the parked zoom brings trees closer.
 *
 * WHAT FITS UNDER 1.5M (world-tests/v2-trees.mjs, confirmed by renderer.info in
 * world-tests/v2-tree-render.mjs; ~172k of every total is non-tree meshes):
 *   - near the PATH at full detail does not fit at any useful band: the median
 *     tree is 148 units from the path, so lateral bands 180 / 260 / 350 draw
 *     3.95M / 5.13M / 5.79M;
 *   - every tree at 0.15: 0.87M, and from the rail it differs from full detail
 *     by <= 0.18/255 mean, <= 0.45% of pixels by more than 12/255;
 *   - every tree at 0.15 plus full detail within 60 units of the 8 landmarks
 *     (97 trees): 1.29M. The near tier only shows when the camera parks at a
 *     place, so key it on the landmark, not the path;
 *   - near the path at 0.3 (band 180) plus 0.15 beyond: 1.37M; band 260: 1.56M.
 *
 * WHY THIS IS NOT ONE CALL TO SimplifyModifier. The leafy prototypes (Normal*,
 * Birch*) are 1,000-2,000 disconnected pieces: two-triangle leaf cards that
 * hold ~98% of the visible surface, plus branch tubes that hold 65-70% of the
 * triangles and ~2% of the surface. Edge collapse on the whole mesh deletes the
 * smallest open pieces first, which is exactly the leaf cards, and it overshoots
 * its target ~2x because a card loses a triangle per collapsed vertex. So:
 *
 *   - leaf cards (pieces of <= 2 triangles) are THINNED: an evenly spread subset
 *     survives, each grown about its own centre by 1/sqrt(kept fraction) so the
 *     canopy keeps its total leaf area and therefore its density and outline;
 *   - solid pieces (trunk, branches, pine tiers) go through SimplifyModifier one
 *     piece at a time, each to its own share of the budget;
 *   - specks (solid pieces under 4% of the prototype's size: pine cones, twig
 *     stubs) are dropped, since at distance they are sub-pixel.
 *
 * Normals are CARRIED, never recomputed: the leafy kit trees use custom canopy
 * normals (25-48% of leaf corners point well away from their face normal) and
 * recomputing them turns the soft canopy into a flicker of lit and dark cards.
 */

/** Pieces with at most this many triangles are leaf cards. */
const CARD_MAX_TRIS = 2;
/**
 * A simplified solid piece never goes below this many triangles. At 4 a pine's
 * 26-triangle needle fan collapsed to a sliver and the pines lost half their
 * silhouette (measured IoU 0.46); 8 keeps the fan's outline.
 */
const MIN_SOLID_TRIS = 8;
/** Solid pieces smaller than this fraction of the prototype's diagonal are specks. */
const SPECK_EXTENT = 0.04;
/** On a tree with leaf cards, the trunk and branches get at most this share of the budget... */
const SOLID_SHARE = 0.25;
/** ...and cards never grow by more than this, so the canopy does not balloon. */
const MAX_CARD_SCALE = 2.0;
/**
 * How far a grown card is pulled back toward the canopy centre, as a fraction
 * of (growth x card size). 0 let the canopy grow 15-29% (measured coverage
 * 1.15-1.29 at ratio 0.15); 0.5 shrank it to 0.87-0.93.
 */
const CARD_PULL = 0.3;
/**
 * On a tree with leaf cards, when the floors of all solid pieces would eat more
 * than this share of the solid budget, the smallest-area pieces are dropped
 * until they do not. Without
 * it a leafy tree's 35 branch tubes each got the floor and the trunk, the one
 * tube you can actually see, got the floor too and vanished.
 */
const FLOOR_SHARE = 0.6;

interface Welded {
  count: number;
  pos: Float32Array;
  nor: Float32Array | null;
  col: Float32Array | null;
  colSize: number;
  uv: Float32Array | null;
  /** Triangles as welded vertex indices, degenerate ones removed. */
  tris: Uint32Array;
}

function weld(
  geometry: THREE.BufferGeometry,
  triStart: number,
  triCount: number,
): Welded {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const nor = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  const col = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  // Well above float noise, well below any real edge in these kits, and above
  // mergeVertices' 1e-4 default so SimplifyModifier finds nothing left to merge.
  const inv = 1 / Math.max(diag * 2e-6, 2e-4);

  const colSize = col ? Math.min(col.itemSize, 4) : 0;
  const cap = pos.count;
  const wPos = new Float32Array(cap * 3);
  const wNor = nor ? new Float32Array(cap * 3) : null;
  const wCol = col ? new Float32Array(cap * colSize) : null;
  const wUv = uv ? new Float32Array(cap * 2) : null;
  const hits = new Uint32Array(cap);
  const remap = new Int32Array(pos.count).fill(-1);
  const byKey = new Map<string, number>();
  let count = 0;

  const vertexOf = (src: number): number => {
    const known = remap[src];
    if (known >= 0) return known;
    const x = pos.getX(src), y = pos.getY(src), z = pos.getZ(src);
    const key = Math.round(x * inv) + "," + Math.round(y * inv) + "," + Math.round(z * inv);
    let w = byKey.get(key);
    if (w === undefined) {
      w = count++;
      byKey.set(key, w);
      wPos[w * 3] = x; wPos[w * 3 + 1] = y; wPos[w * 3 + 2] = z;
      if (wUv && uv) { wUv[w * 2] = uv.getX(src); wUv[w * 2 + 1] = uv.getY(src); }
    }
    // Average normals and colours across the weld; the kit has no hard edges
    // at shared positions (measured: 0-6 per prototype), so this blurs nothing.
    if (wNor && nor) {
      wNor[w * 3] += nor.getX(src); wNor[w * 3 + 1] += nor.getY(src); wNor[w * 3 + 2] += nor.getZ(src);
    }
    if (wCol && col) {
      wCol[w * colSize] += col.getX(src);
      if (colSize > 1) wCol[w * colSize + 1] += col.getY(src);
      if (colSize > 2) wCol[w * colSize + 2] += col.getZ(src);
      if (colSize > 3) wCol[w * colSize + 3] += col.getW(src);
    }
    hits[w]++;
    remap[src] = w;
    return w;
  };

  const tris = new Uint32Array(triCount * 3);
  let t = 0;
  for (let f = triStart; f < triStart + triCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    const a = vertexOf(i0), b = vertexOf(i1), c = vertexOf(i2);
    if (a === b || b === c || a === c) continue;
    tris[t++] = a; tris[t++] = b; tris[t++] = c;
  }

  for (let w = 0; w < count; w++) {
    if (wNor) {
      const nx = wNor[w * 3], ny = wNor[w * 3 + 1], nz = wNor[w * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      wNor[w * 3] = nx / l; wNor[w * 3 + 1] = ny / l; wNor[w * 3 + 2] = nz / l;
    }
    if (wCol && hits[w] > 1) for (let k = 0; k < colSize; k++) wCol[w * colSize + k] /= hits[w];
  }

  return {
    count,
    pos: wPos,
    nor: wNor,
    col: wCol,
    colSize,
    uv: wUv,
    tris: tris.subarray(0, t),
  };
}

interface Piece {
  tris: number[]; // offsets into Welded.tris, in steps of 3
  area: number;
  cx: number; cy: number; cz: number; // area-weighted centre
  extent: number; // bbox diagonal
}

/** Connected pieces by shared (welded) vertices. */
function pieces(w: Welded): Piece[] {
  const parent = new Int32Array(w.count);
  for (let i = 0; i < w.count; i++) parent[i] = i;
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const tris = w.tris;
  for (let t = 0; t < tris.length; t += 3) {
    const a = find(tris[t]);
    parent[find(tris[t + 1])] = a;
    parent[find(tris[t + 2])] = a;
  }
  const byRoot = new Map<number, Piece & { bb: number[] }>();
  const p = w.pos;
  for (let t = 0; t < tris.length; t += 3) {
    const r = find(tris[t]);
    let piece = byRoot.get(r);
    if (!piece) {
      piece = { tris: [], area: 0, cx: 0, cy: 0, cz: 0, extent: 0, bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
      byRoot.set(r, piece);
    }
    piece.tris.push(t);
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    piece.area += area;
    piece.cx += area * (p[a] + p[b] + p[c]) / 3;
    piece.cy += area * (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    piece.cz += area * (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        if (p[v + k] < piece.bb[k]) piece.bb[k] = p[v + k];
        if (p[v + k] > piece.bb[k + 3]) piece.bb[k + 3] = p[v + k];
      }
    }
  }
  const out: Piece[] = [];
  for (const piece of byRoot.values()) {
    const s = piece.area || 1;
    piece.cx /= s; piece.cy /= s; piece.cz /= s;
    if (piece.area === 0) {
      // Zero-area piece: fall back to its bbox centre so thinning can still sort it.
      piece.cx = (piece.bb[0] + piece.bb[3]) / 2;
      piece.cy = (piece.bb[1] + piece.bb[4]) / 2;
      piece.cz = (piece.bb[2] + piece.bb[5]) / 2;
    }
    piece.extent = Math.hypot(piece.bb[3] - piece.bb[0], piece.bb[4] - piece.bb[1], piece.bb[5] - piece.bb[2]);
    out.push(piece);
  }
  return out;
}

/** Output under construction. */
class Sink {
  pos: number[] = [];
  nor: number[] | null;
  col: number[] | null;
  uv: number[] | null;
  idx: number[] = [];
  constructor(w: Welded) {
    this.nor = w.nor ? [] : null;
    this.col = w.col ? [] : null;
    this.uv = w.uv ? [] : null;
  }
  get vertexCount() {
    return this.pos.length / 3;
  }
}

/**
 * Copy one leaf card, grown by `scale` about its own centre, and pulled toward
 * the canopy centre (hx, hy, hz) by the amount it grew, so the canopy's outer
 * edge stays where it was instead of ballooning by half a card all round.
 */
function emitCard(
  w: Welded,
  piece: Piece,
  scale: number,
  sink: Sink,
  hx: number,
  hy: number,
  hz: number,
) {
  const local = new Map<number, number>();
  let cx = piece.cx, cy = piece.cy, cz = piece.cz;
  if (scale > 1) {
    const dx = cx - hx, dy = cy - hy, dz = cz - hz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 1e-6) {
      const pull = Math.min((scale - 1) * piece.extent * CARD_PULL, d * 0.5);
      const k = (d - pull) / d;
      cx = hx + dx * k; cy = hy + dy * k; cz = hz + dz * k;
    }
  }
  for (const t of piece.tris) {
    for (let e = 0; e < 3; e++) {
      const v = w.tris[t + e];
      let o = local.get(v);
      if (o === undefined) {
        o = sink.vertexCount;
        local.set(v, o);
        sink.pos.push(
          cx + (w.pos[v * 3] - piece.cx) * scale,
          cy + (w.pos[v * 3 + 1] - piece.cy) * scale,
          cz + (w.pos[v * 3 + 2] - piece.cz) * scale,
        );
        if (sink.nor && w.nor) sink.nor.push(w.nor[v * 3], w.nor[v * 3 + 1], w.nor[v * 3 + 2]);
        if (sink.col && w.col) for (let k = 0; k < 3; k++) sink.col.push(k < w.colSize ? w.col[v * w.colSize + k] : 1);
        if (sink.uv && w.uv) sink.uv.push(w.uv[v * 2], w.uv[v * 2 + 1]);
      }
      sink.idx.push(o);
    }
  }
}

/** One solid piece as its own small indexed geometry, for SimplifyModifier. */
function pieceGeometry(w: Welded, piece: Piece): THREE.BufferGeometry {
  const local = new Map<number, number>();
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  for (const t of piece.tris) {
    for (let e = 0; e < 3; e++) {
      const v = w.tris[t + e];
      let o = local.get(v);
      if (o === undefined) {
        o = pos.length / 3;
        local.set(v, o);
        pos.push(w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]);
        if (w.nor) nor.push(w.nor[v * 3], w.nor[v * 3 + 1], w.nor[v * 3 + 2]);
        if (w.col) for (let k = 0; k < 3; k++) col.push(k < w.colSize ? w.col[v * w.colSize + k] : 1);
        if (w.uv) uv.push(w.uv[v * 2], w.uv[v * 2 + 1]);
      }
      idx.push(o);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (w.nor) g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  if (w.col) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  if (w.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function triCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  return idx ? idx.count / 3 : g.getAttribute("position").count / 3;
}

/**
 * Edge-collapse one piece down to about `target` triangles.
 *
 * SimplifyModifier counts VERTICES removed, not triangles, so the count is an
 * estimate from the piece's own triangles-per-vertex, with one corrective
 * second pass when the first lands well above target.
 */
function collapsePiece(
  modifier: SimplifyModifier,
  g: THREE.BufferGeometry,
  target: number,
): THREE.BufferGeometry {
  let current = g;
  for (let pass = 0; pass < 2; pass++) {
    const t = triCount(current);
    const v = current.getAttribute("position").count;
    if (t <= target * 1.15 || v <= 4) break;
    const remove = Math.min(v - 4, Math.max(1, Math.round(((t - target) * v) / t)));
    const next = modifier.modify(current, remove);
    if (current !== g) current.dispose();
    current = next;
  }
  return current;
}

function emitGeometry(g: THREE.BufferGeometry, sink: Sink) {
  const base = sink.vertexCount;
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const c = g.getAttribute("color");
  const u = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    sink.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (sink.nor) {
      if (n) sink.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      else sink.nor.push(0, 1, 0);
    }
    if (sink.col) {
      if (c) sink.col.push(c.getX(i), c.getY(i), c.getZ(i));
      else sink.col.push(1, 1, 1);
    }
    if (sink.uv) {
      if (u) sink.uv.push(u.getX(i), u.getY(i));
      else sink.uv.push(0, 0);
    }
  }
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i++) sink.idx.push(base + idx.getX(i));
  else for (let i = 0; i < p.count; i++) sink.idx.push(base + i);
}

/** 30-bit Morton code, so evenly spaced picks along it are spread in space. */
function morton(x: number, y: number, z: number): number {
  const spread = (v: number) => {
    v = Math.max(0, Math.min(1023, Math.floor(v * 1023)));
    v = (v | (v << 16)) & 0x030000ff;
    v = (v | (v << 8)) & 0x0300f00f;
    v = (v | (v << 4)) & 0x030c30c3;
    v = (v | (v << 2)) & 0x09249249;
    return v;
  };
  return spread(x) | (spread(y) << 1) | (spread(z) << 2);
}

export interface SimplifyStats {
  sourceTris: number;
  targetTris: number;
  tris: number;
  cards: number;
  cardsKept: number;
  cardScale: number;
  solids: number;
  solidsDropped: number;
}

/** Simplify one triangle range (the whole geometry, or one material group). */
function simplifyRange(
  geometry: THREE.BufferGeometry,
  triStart: number,
  triCountIn: number,
  ratio: number,
  sink: Sink | null,
  modifier: SimplifyModifier,
  stats: SimplifyStats,
): Sink {
  const w = weld(geometry, triStart, triCountIn);
  const out = sink ?? new Sink(w);
  const all = pieces(w);
  const total = w.tris.length / 3;
  const budget = Math.max(1, Math.round(ratio * total));

  let diag = 0;
  {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < w.count; i++) {
      const x = w.pos[i * 3], y = w.pos[i * 3 + 1], z = w.pos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  }

  const cards: Piece[] = [];
  const solids: Piece[] = [];
  let dropped = 0;
  for (const piece of all) {
    if (piece.tris.length <= CARD_MAX_TRIS) cards.push(piece);
    else if (piece.extent < diag * SPECK_EXTENT) dropped++;
    else solids.push(piece);
  }
  const cardTris = cards.reduce((s, c) => s + c.tris.length, 0);
  const floorOf = (p: Piece) => Math.min(p.tris.length, MIN_SOLID_TRIS);

  // Split the budget. Cards carry the canopy, so the trunk and branches get a
  // quarter at most; whatever the cards cannot use goes back to the solids.
  const allSolidTris = solids.reduce((s, c) => s + c.tris.length, 0);
  const solidCap = cards.length ? Math.round(budget * SOLID_SHARE) : budget;
  // Keep the largest-area pieces whose floors fit in FLOOR_SHARE of that cap.
  // Only when cards carry the canopy: there the small solids are branches
  // hidden inside it. On a pine the solids ARE the silhouette (needle fans), and
  // dropping them cost PineTree_5 half its outline (IoU 0.79 -> 0.35), so a
  // card-less tree keeps every piece at its floor and runs over its ratio.
  if (cards.length && allSolidTris > solidCap) {
    solids.sort((a, b) => b.area - a.area);
    let floors = 0;
    let keepN = 0;
    for (const p of solids) {
      if (keepN > 0 && floors + floorOf(p) > solidCap * FLOOR_SHARE) break;
      floors += floorOf(p);
      keepN++;
    }
    dropped += solids.length - keepN;
    solids.length = keepN;
  }
  const solidTris = solids.reduce((s, c) => s + c.tris.length, 0);
  const solidFloor = solids.reduce((s, p) => s + floorOf(p), 0);
  let solidBudget = Math.min(solidTris, Math.max(solidFloor, solidCap));
  const keep = cardTris > 0 ? Math.min(1, Math.max(0, (budget - solidBudget) / cardTris)) : 0;
  if (keep >= 1 && cards.length) solidBudget = Math.min(solidTris, Math.max(solidFloor, budget - cardTris));

  // Cards: an even spread along a space-filling order, grown to keep the area.
  const scale = keep > 0 ? Math.min(MAX_CARD_SCALE, 1 / Math.sqrt(keep)) : 1;
  let kept = 0;
  if (cards.length && keep > 0) {
    let bx = Infinity, by = Infinity, bz = Infinity, ex = -Infinity, ey = -Infinity, ez = -Infinity;
    for (const c of cards) {
      if (c.cx < bx) bx = c.cx; if (c.cx > ex) ex = c.cx;
      if (c.cy < by) by = c.cy; if (c.cy > ey) ey = c.cy;
      if (c.cz < bz) bz = c.cz; if (c.cz > ez) ez = c.cz;
    }
    const sx = 1 / Math.max(ex - bx, 1e-6), sy = 1 / Math.max(ey - by, 1e-6), sz = 1 / Math.max(ez - bz, 1e-6);
    // Area-weighted centre of all the cards: the point grown cards are pulled toward.
    let hx = 0, hy = 0, hz = 0, ha = 0;
    for (const c of cards) { hx += c.cx * c.area; hy += c.cy * c.area; hz += c.cz * c.area; ha += c.area; }
    if (ha > 0) { hx /= ha; hy /= ha; hz /= ha; } else { hx = (bx + ex) / 2; hy = (by + ey) / 2; hz = (bz + ez) / 2; }
    const order = cards
      .map((c) => ({ c, k: morton((c.cx - bx) * sx, (c.cy - by) * sy, (c.cz - bz) * sz) }))
      .sort((a, b) => a.k - b.k);
    let acc = 0.5;
    for (const { c } of order) {
      acc += keep;
      if (acc >= 1) {
        acc -= 1;
        emitCard(w, c, keep >= 1 ? 1 : scale, out, hx, hy, hz);
        kept++;
      }
    }
  }

  // Solids: triangles in proportion to each piece's SURFACE AREA, floored, with
  // the scale found by bisection so the sum fits the solid budget. By area,
  // because a uniform ratio starved exactly the pieces that carry the outline
  // (a pine's needle fans: 89% of its area in 26-triangle pieces) while tubes
  // hidden inside a canopy kept their share.
  if (solids.length) {
    const targetAt = (p: Piece, k: number) =>
      Math.min(p.tris.length, Math.max(floorOf(p), Math.round(p.area * k)));
    const sumAt = (k: number) => solids.reduce((s, p) => s + targetAt(p, k), 0);
    let hi = 0;
    for (const p of solids) hi = Math.max(hi, p.tris.length / Math.max(p.area, 1e-9));
    let lo = 0;
    if (sumAt(hi) <= solidBudget) lo = hi;
    else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (sumAt(mid) <= solidBudget) lo = mid; else hi = mid; }
    for (const p of solids) {
      const target = targetAt(p, lo);
      const g = pieceGeometry(w, p);
      if (target >= p.tris.length) {
        emitGeometry(g, out);
        g.dispose();
        continue;
      }
      const s = collapsePiece(modifier, g, target);
      emitGeometry(s, out);
      if (s !== g) s.dispose();
      g.dispose();
    }
  }

  stats.sourceTris += total;
  stats.targetTris += budget;
  stats.cards += cards.length;
  stats.cardsKept += kept;
  stats.cardScale = Math.max(stats.cardScale, kept ? (keep >= 1 ? 1 : scale) : 0);
  stats.solids += solids.length;
  stats.solidsDropped += dropped;
  return out;
}

/**
 * A far-distance copy of `geometry` with about `ratio` of its triangles.
 *
 * `ratio` is the fraction of TRIANGLES kept (0.1-0.2 for trees seen from the
 * rail). Keeps position, normal, uv and color (RGB; an alpha channel, if any,
 * is dropped). Material groups are simplified separately and preserved, so a
 * trunk-and-leaves geometry with two materials stays two groups. Returns a new
 * indexed geometry; the input is not modified. Stats land in
 * `result.userData.simplify`.
 *
 * Runs synchronously: 5-70 ms per kit prototype, 126-160 ms for all 12 in
 * headless Chrome (180-280 ms in node). Build each prototype's copy once, at
 * load, ideally after the first frame is on screen.
 */
export function simplifyForDistance(
  geometry: THREE.BufferGeometry,
  ratio: number,
): THREE.BufferGeometry {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0.005, ratio)) : 1;
  if (r >= 1 || !geometry.getAttribute("position")) return geometry.clone();

  const modifier = new SimplifyModifier();
  const stats: SimplifyStats = {
    sourceTris: 0, targetTris: 0, tris: 0, cards: 0, cardsKept: 0, cardScale: 0, solids: 0, solidsDropped: 0,
  };
  const total = triCount(geometry);
  const ranges = geometry.groups.length
    ? geometry.groups.map((g) => ({
        start: Math.floor(g.start / 3),
        count: Math.floor(Math.min(g.count, total * 3 - g.start) / 3),
        materialIndex: g.materialIndex ?? 0,
      }))
    : [{ start: 0, count: total, materialIndex: 0 }];

  let sink: Sink | null = null;
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (const range of ranges) {
    if (range.count <= 0) continue;
    const before = sink ? sink.idx.length : 0;
    sink = simplifyRange(geometry, range.start, range.count, r, sink, modifier, stats);
    groups.push({ start: before, count: sink.idx.length - before, materialIndex: range.materialIndex });
  }

  const out = new THREE.BufferGeometry();
  if (!sink || sink.idx.length === 0) {
    out.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    out.userData.simplify = stats;
    return out;
  }
  out.setAttribute("position", new THREE.Float32BufferAttribute(sink.pos, 3));
  if (sink.nor) out.setAttribute("normal", new THREE.Float32BufferAttribute(sink.nor, 3));
  if (sink.col) out.setAttribute("color", new THREE.Float32BufferAttribute(sink.col, 3));
  if (sink.uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uv, 2));
  out.setIndex(sink.idx);
  if (!sink.nor) out.computeVertexNormals();
  if (geometry.groups.length) for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  stats.tris = sink.idx.length / 3;
  out.userData.simplify = stats;
  return out;
}

/**
 * Partition instance matrices into the ones drawn at full detail and the rest.
 *
 * `distance(m)` is whatever "near" means to the caller (lateral distance to the
 * walking path, distance to the camera). An instance is near when its distance
 * is <= nearBand; NaN counts as far. Returns indices into `matrices`.
 */
export function splitByDistance(
  matrices: THREE.Matrix4[],
  distance: (m: THREE.Matrix4) => number,
  nearBand: number,
): { near: number[]; far: number[] } {
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < matrices.length; i++) {
    if (distance(matrices[i]) <= nearBand) near.push(i);
    else far.push(i);
  }
  return { near, far };
}
