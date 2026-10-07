import * as THREE from "three";

/**
 * v6 noise texture (world_art_bible_v6.md 2.3, v6_techniques.md 3): one
 * 256x256 RGBA tileable texture, generated at load from a fixed seed (the same
 * every load, nothing downloaded), that replaces per pixel fbm with texture
 * reads.
 *
 *   R  value noise, 3 octaves (periods 8, 16 and 32 across the tile)
 *   G  cellular: distance to the nearest of 16x16 jittered cells (F1), 0 at a
 *      cell's point, about 1 at its edge (ripple cells, clumps)
 *   B  stretched strokes: value noise 8 across by 64 down, so it runs along
 *      +u (grass lying along the slope, brush strokes; rotate uv to aim it)
 *   A  blue noise: white noise high passed twice and equalised to uniform (dither)
 *
 * All four channels tile at the edge, so RepeatWrapping shows no seam, and
 * each is spread over 0..1 (R and B equalised, so pStep thresholds are
 * shares). Linear data: NoColorSpace, mipmapped.
 *
 * getNoiseTexture(renderer) caches one texture per renderer; the pixel data is
 * made once per page. NOISE_TEX_GLSL holds pStep and the sampling helpers
 * (fragment shaders: pStep uses fwidth).
 */

export const NOISE_SIZE = 256;

/** The GLSL uniform name the helpers' docs use; any name works. */
export const NOISE_UNIFORM = "uNoiseTex";

/**
 * GLSL helpers for vertex and fragment shaders. Declare
 * `uniform sampler2D uNoiseTex;` yourself and pass it in; in a fragment
 * shader also paste NOISE_TEX_FRAG_GLSL after this for pStep and pBands3.
 *
 *   float pStep(float e, float v)             posterised step, one pixel edge (fwidth): fragment only
 *   float pStepW(float e, float v, float w)   the same with an explicit edge width (vertex safe)
 *   float pBands3(float v, float a, float b)  0, 0.5 or 1 with one pixel edges at a and b: fragment only
 *   float pBandsW(float v, float a, float b, float w)  the same with an explicit edge width
 *   vec4  nTex(sampler2D t, vec2 xz, float tile)             the texture at world xz, one tile per `tile` units
 *   vec4  nTexRot(sampler2D t, vec2 xz, float tile, float a) the same, rotated a radians (breaks the tiling's grid)
 *   vec4  nTexStretch(sampler2D t, vec2 xz, float tile, vec2 dir, float k)  stretched k:1 along dir (unit)
 *   float nFbm2(sampler2D t, vec2 xz, float tile)            R at two scales (tile and tile / 4.3, rotated), 0..1
 *   float nBlue(sampler2D t, vec2 fragCoord)                 the A channel per screen pixel, -0.5..0.5
 */
export const NOISE_TEX_GLSL = /* glsl */ `
float pStepW( float e, float v, float w ) { return smoothstep( e - w, e + w, v ); }
float pBandsW( float v, float a, float b, float w ) { return 0.5 * pStepW( a, v, w ) + 0.5 * pStepW( b, v, w ); }
vec4 nTex( sampler2D t, vec2 xz, float tile ) { return texture2D( t, xz / tile ); }
vec4 nTexRot( sampler2D t, vec2 xz, float tile, float a ) {
  float c = cos( a ), s = sin( a );
  return texture2D( t, vec2( c * xz.x - s * xz.y, s * xz.x + c * xz.y ) / tile );
}
vec4 nTexStretch( sampler2D t, vec2 xz, float tile, vec2 dir, float k ) {
  vec2 q = vec2( dot( xz, dir ) / k, dot( xz, vec2( -dir.y, dir.x ) ) );
  return texture2D( t, q / tile );
}
float nFbm2( sampler2D t, vec2 xz, float tile ) {
  return texture2D( t, xz / tile ).r * 0.68 + nTexRot( t, xz, tile / 4.3, 0.61 ).r * 0.32;
}
float nBlue( sampler2D t, vec2 fragCoord ) { return texture2D( t, fragCoord / ${NOISE_SIZE.toFixed(1)} ).a - 0.5; }
`;

/**
 * Fragment only (uses fwidth, which a vertex shader cannot call): append after
 * NOISE_TEX_GLSL in fragment shaders.
 */
export const NOISE_TEX_FRAG_GLSL = /* glsl */ `
float pStep( float e, float v ) { float w = fwidth( v ) * 1.1 + 0.0015; return smoothstep( e - w, e + w, v ); }
float pBands3( float v, float a, float b ) { return 0.5 * pStep( a, v ) + 0.5 * pStep( b, v ); }
`;

// ── Generation ─────────────────────────────────────────────────────────────

/** mulberry32: small, fast, seeded. */
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

/** Periodic value noise into `out` (+= amp * noise), lattice gx by gy over the tile, smoothstep blend. */
function addValueNoise(out: Float32Array, n: number, gx: number, gy: number, amp: number, rand: () => number) {
  const lat = new Float32Array(gx * gy);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  // Per column and per row: the two lattice indices and the eased weight.
  const c0 = new Int32Array(n);
  const c1 = new Int32Array(n);
  const tx = new Float32Array(n);
  const r0 = new Int32Array(n);
  const r1 = new Int32Array(n);
  const ty = new Float32Array(n);
  const axis = (g: number, i0: Int32Array, i1: Int32Array, t: Float32Array, stride: number) => {
    const f = g / n;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * f - 0.5;
      const a = Math.floor(u);
      const w = u - a;
      const aw = ((a % g) + g) % g;
      i0[k] = aw * stride;
      i1[k] = ((aw + 1) % g) * stride;
      t[k] = w * w * (3 - 2 * w);
    }
  };
  axis(gx, c0, c1, tx, 1);
  axis(gy, r0, r1, ty, gx);
  for (let y = 0; y < n; y++) {
    const ra = r0[y];
    const rb = r1[y];
    const wy = ty[y];
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const ca = c0[x];
      const cb = c1[x];
      const wx = tx[x];
      const a = lat[ra + ca] + (lat[ra + cb] - lat[ra + ca]) * wx;
      const b = lat[rb + ca] + (lat[rb + cb] - lat[rb + ca]) * wx;
      out[row + x] += amp * (a + (b - a) * wy);
    }
  }
}

/** Remap `src` so its values are spread uniformly over 0..1 (rank by a 4096 bin histogram). */
function equalise(src: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const v = src[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const B = 4096;
  const k = (B - 1e-3) / (hi - lo || 1);
  const bin = new Uint16Array(len);
  const hist = new Uint32Array(B);
  for (let i = 0; i < len; i++) {
    const b = ((src[i] - lo) * k) | 0;
    bin[i] = b;
    hist[b]++;
  }
  const cdf = new Float32Array(B);
  let run = 0;
  for (let b = 0; b < B; b++) {
    cdf[b] = (run + hist[b] * 0.5) / len;
    run += hist[b];
  }
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = cdf[bin[i]];
  return out;
}

/** Periodic high pass: each value minus the mean of its 3 x 3 block (wrapped), in place. */
function highPassWrap(v: Float32Array, n: number): void {
  const src = v.slice();
  const m = n - 1;
  for (let y = 0; y < n; y++) {
    const up = (y === 0 ? m : y - 1) * n;
    const mid = y * n;
    const dn = (y === m ? 0 : y + 1) * n;
    for (let x = 0; x < n; x++) {
      const l = x === 0 ? m : x - 1;
      const r = x === m ? 0 : x + 1;
      const sum =
        src[up + l] + src[up + x] + src[up + r] + src[mid + l] + src[mid + x] + src[mid + r] + src[dn + l] + src[dn + x] + src[dn + r];
      v[mid + x] = src[mid + x] - sum / 9;
    }
  }
}

let cached: { data: Uint8Array<ArrayBuffer>; ms: number } | null = null;

/** The RGBA bytes (256 x 256 x 4), made once per page. */
export function noiseData(): { data: Uint8Array<ArrayBuffer>; ms: number } {
  if (cached) return cached;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const n = NOISE_SIZE;
  const N = n * n;
  const rand = rng(0x5eed06);

  // R: value noise, 3 octaves.
  const r = new Float32Array(N);
  addValueNoise(r, n, 8, 8, 0.57, rand);
  addValueNoise(r, n, 16, 16, 0.29, rand);
  addValueNoise(r, n, 32, 32, 0.14, rand);
  const R = equalise(r);

  // G: cellular F1, 16 x 16 cells, one jittered point each, wrapped. The
  // distance field is smooth inside each cell, so it is computed at half
  // resolution (8 x 8 pixel blocks) and upsampled bilinearly, wrapped.
  const C = 16;
  const h = n >> 1;
  const cs = h / C;
  const px = new Float32Array(C * C);
  const py = new Float32Array(C * C);
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      px[j * C + i] = (i + 0.12 + 0.76 * rand()) * cs;
      py[j * C + i] = (j + 0.12 + 0.76 * rand()) * cs;
    }
  }
  const Gh = new Float32Array(h * h);
  const inv = 1 / (cs * 0.95);
  const qx = new Float32Array(9);
  const qy = new Float32Array(9);
  for (let cj = 0; cj < C; cj++) {
    for (let ci = 0; ci < C; ci++) {
      let q = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        const wj = (jj + C) % C;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const wi = (ii + C) % C;
          qx[q] = px[wj * C + wi] + (ii - wi) * cs;
          qy[q] = py[wj * C + wi] + (jj - wj) * cs;
          q++;
        }
      }
      for (let y = cj * cs; y < (cj + 1) * cs; y++) {
        const fy = y + 0.5;
        for (let x = ci * cs; x < (ci + 1) * cs; x++) {
          const fx = x + 0.5;
          let best = Infinity;
          for (let k = 0; k < 9; k++) {
            const dx = fx - qx[k];
            const dy = fy - qy[k];
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
          }
          const v = Math.sqrt(best) * inv;
          Gh[y * h + x] = v > 1 ? 1 : v;
        }
      }
    }
  }
  // Pixel (x, y) at full size sits at (x - 0.5) / 2 in half size texel centres.
  const G = new Float32Array(N);
  for (let y = 0; y < n; y++) {
    const sy = (y - 0.5) * 0.5;
    const y0 = Math.floor(sy);
    const wy = sy - y0;
    const ya = ((y0 + h) % h) * h;
    const yb = ((y0 + 1) % h) * h;
    for (let x = 0; x < n; x++) {
      const sx = (x - 0.5) * 0.5;
      const x0 = sx < 0 ? -1 : sx | 0;
      const wx = sx - x0;
      const xa = x0 < 0 ? h - 1 : x0;
      const xb = x0 + 1 >= h ? 0 : x0 + 1;
      const t = Gh[ya + xa] + (Gh[ya + xb] - Gh[ya + xa]) * wx;
      const u = Gh[yb + xa] + (Gh[yb + xb] - Gh[yb + xa]) * wx;
      G[y * n + x] = t + (u - t) * wy;
    }
  }

  // B: strokes along +u (8 across, 64 down), two octaves, equalised.
  const b = new Float32Array(N);
  addValueNoise(b, n, 8, 64, 0.7, rand);
  addValueNoise(b, n, 16, 128, 0.3, rand);
  const Bc = equalise(b);

  // A: blue noise: white noise twice high passed (minus its 3 x 3 mean), equalised.
  const white = new Float32Array(N);
  for (let i = 0; i < N; i++) white[i] = rand();
  highPassWrap(white, n);
  highPassWrap(white, n);
  const A = equalise(white);

  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    data[o] = (R[i] * 255 + 0.5) | 0;
    data[o + 1] = (G[i] * 255 + 0.5) | 0;
    data[o + 2] = (Bc[i] * 255 + 0.5) | 0;
    data[o + 3] = (A[i] * 255 + 0.5) | 0;
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  cached = { data, ms: t1 - t0 };
  return cached;
}

const perRenderer = new WeakMap<THREE.WebGLRenderer, THREE.DataTexture>();

/**
 * The noise texture for this renderer (made on the first call, then cached).
 * RepeatWrapping, linear with mipmaps, NoColorSpace. Never dispose it from a
 * module: other modules share it (the scene disposes with the renderer).
 */
export function getNoiseTexture(renderer: THREE.WebGLRenderer): THREE.DataTexture {
  const hit = perRenderer.get(renderer);
  if (hit) return hit;
  const { data } = noiseData();
  const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = "V6Noise";
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  perRenderer.set(renderer, tex);
  return tex;
}

/** A uniform holding the noise texture, for a ShaderMaterial or onBeforeCompile. */
export function noiseUniform(renderer: THREE.WebGLRenderer): { value: THREE.Texture } {
  return { value: getNoiseTexture(renderer) };
}

/** Generation time and size, for the load report. */
export function noiseStats(): { ms: number; bytes: number; bytesWithMips: number } {
  const { data, ms } = noiseData();
  return { ms: Math.round(ms * 100) / 100, bytes: data.byteLength, bytesWithMips: Math.round((data.byteLength * 4) / 3) };
}
