import * as THREE from "three";

/**
 * Ground height anywhere on the map, read back out of the exported terrain.
 *
 * The camera rail follows the ground with this, so it has to agree with the
 * mesh the student actually sees. It is rebuilt from the loaded glTF rather
 * than recomputed from ridge.py's terrain_h, because the web mesh is a halved,
 * possibly Draco-quantised copy of that function and the two drift apart by
 * whole units on the ridges.
 *
 * What the current asset looks like (measured 2026-09-24 on public/world/world.glb):
 * one primitive, 38,793 vertices on an exact 193 x 201 grid, 9.04 units apart
 * on x and 10 on z, one vertex per node. Nothing below depends on that: Draco
 * reorders vertices and quantises positions, so the grid is recovered from the
 * positions themselves.
 */

export interface Heightfield {
  /** World-space ground height. Bilinear; clamps to the edge outside bounds. */
  heightAt(x: number, z: number): number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Count the distinct grid lines in one axis.
 *
 * Sorted coordinates of a grid come in runs of identical values (one run per
 * column). A new run starts wherever the gap exceeds `tol`. Draco quantisation
 * moves every vertex of a column by the same amount, so runs stay intact as long
 * as `tol` is well above the quantisation step and well below the spacing.
 */
function countLines(sorted: Float32Array, tol: number): number {
  if (sorted.length === 0) return 0;
  let lines = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > tol) lines++;
  }
  return lines;
}

export function buildHeightfield(
  root: THREE.Object3D,
  meshName = "Terrain",
): Heightfield | null {
  const node = root.getObjectByName(meshName);
  if (!node) return null;

  // A glTF mesh with several primitives arrives as a Group of Meshes.
  const meshes: THREE.Mesh[] = [];
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute("position")) meshes.push(m);
  });
  if (meshes.length === 0) return null;

  node.updateWorldMatrix(true, true);

  let total = 0;
  for (const m of meshes) total += m.geometry.getAttribute("position").count;
  if (total === 0) return null;

  // World-space positions. getX/Y/Z undo interleaving and normalised
  // (quantised) storage; matrixWorld undoes any node-level dequantisation.
  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  const zs = new Float32Array(total);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let n = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute;
    const e = m.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const w = 1 / (e[3] * px + e[7] * py + e[11] * pz + e[15] || 1);
      const x = (e[0] * px + e[4] * py + e[8] * pz + e[12]) * w;
      const y = (e[1] * px + e[5] * py + e[9] * pz + e[13]) * w;
      const z = (e[2] * px + e[6] * py + e[10] * pz + e[14]) * w;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      xs[n] = x; ys[n] = y; zs[n] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      n++;
    }
  }
  if (n === 0) return null;

  const width = maxX - minX;
  const depth = maxZ - minZ;

  // The spacing a uniform grid of n vertices over this area would have. Used
  // for the clustering tolerance and as the fallback cell size when the mesh
  // turns out not to be a grid at all.
  const area = Math.max(width, 1e-6) * Math.max(depth, 1e-6);
  const avgSpacing = Math.sqrt(area / n);
  const tol = avgSpacing * 0.25;

  const sx = xs.slice(0, n).sort();
  const sz = zs.slice(0, n).sort();
  let nx = countLines(sx, tol);
  let nz = countLines(sz, tol);

  // A clean grid has nx * nz close to the vertex count. Anything else (an
  // irregular or remeshed terrain) falls back to cells at the average spacing.
  const isGrid = nx >= 2 && nz >= 2 && nx * nz <= n * 1.5 && nx * nz >= n * 0.5;
  if (!isGrid) {
    nx = Math.max(2, Math.round(width / avgSpacing) + 1);
    nz = Math.max(2, Math.round(depth / avgSpacing) + 1);
  }
  const cellX = nx > 1 ? width / (nx - 1) : 1;
  const cellZ = nz > 1 ? depth / (nz - 1) : 1;
  const invX = cellX > 0 ? 1 / cellX : 0;
  const invZ = cellZ > 0 ? 1 / cellZ : 0;

  // Bin every vertex to its nearest grid node, averaging duplicates.
  const cells = nx * nz;
  const sum = new Float64Array(cells);
  const cnt = new Uint32Array(cells);
  for (let i = 0; i < n; i++) {
    let gi = Math.round((xs[i] - minX) * invX);
    let gk = Math.round((zs[i] - minZ) * invZ);
    if (gi < 0) gi = 0; else if (gi >= nx) gi = nx - 1;
    if (gk < 0) gk = 0; else if (gk >= nz) gk = nz - 1;
    const c = gk * nx + gi;
    sum[c] += ys[i];
    cnt[c]++;
  }

  const h = new Float32Array(cells);
  const filled = new Uint8Array(cells);
  let empty = 0;
  for (let c = 0; c < cells; c++) {
    if (cnt[c] > 0) {
      h[c] = sum[c] / cnt[c];
      filled[c] = 1;
    } else {
      empty++;
    }
  }

  // Fill holes from their filled 8-neighbours, one ring per pass, so a gap
  // grows inward from its edges instead of taking one arbitrary neighbour.
  const next = new Uint8Array(cells);
  let guard = nx + nz;
  while (empty > 0 && guard-- > 0) {
    next.set(filled);
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const c = k * nx + i;
        if (filled[c]) continue;
        let s = 0, m = 0;
        for (let dk = -1; dk <= 1; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= nz) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if ((di === 0 && dk === 0) || ii < 0 || ii >= nx) continue;
            const cc = kk * nx + ii;
            if (filled[cc]) { s += h[cc]; m++; }
          }
        }
        if (m > 0) {
          h[c] = s / m;
          next[c] = 1;
          empty--;
        }
      }
    }
    filled.set(next);
  }

  const lastI = nx - 2 >= 0 ? nx - 2 : 0;
  const lastK = nz - 2 >= 0 ? nz - 2 : 0;
  const stepI = nx > 1 ? 1 : 0;
  const stepK = nz > 1 ? nx : 0;

  const heightAt = (x: number, z: number): number => {
    // NaN in, NaN out. A plausible height for a NaN camera would hide the bug.
    if (x !== x || z !== z) return NaN;
    const cx = x < minX ? minX : x > maxX ? maxX : x;
    const cz = z < minZ ? minZ : z > maxZ ? maxZ : z;
    const fx = (cx - minX) * invX;
    const fz = (cz - minZ) * invZ;
    let i = Math.floor(fx);
    let k = Math.floor(fz);
    if (i > lastI) i = lastI;
    if (k > lastK) k = lastK;
    const tx = fx - i;
    const tz = fz - k;
    const c = k * nx + i;
    const h00 = h[c];
    const h10 = h[c + stepI];
    const h01 = h[c + stepK];
    const h11 = h[c + stepK + stepI];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  };

  return { heightAt, bounds: { minX, maxX, minZ, maxZ } };
}
