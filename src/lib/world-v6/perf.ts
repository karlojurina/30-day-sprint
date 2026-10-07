import * as THREE from "three";
import { tierSpec, type QualityTier } from "./quality";

/**
 * v6 performance plumbing (world_art_bible_v6.md 3.1 and 3.2,
 * v6_perf_and_code_audit.md 5 to 7). The scene calls these; nothing here
 * keeps state between calls except the IdleLadder.
 *
 *   readGpuName()                 WEBGL_debug_renderer_info from a throwaway context
 *   rendererOptionsForTier(tier)  { antialias, pixelRatioCap, powerPreference }
 *   IdleLadder                    the ambient rate while nothing moves: the tier's rate
 *                                 for 10 s after input, 15 fps to 45 s, then 0 (stop)
 *   FramePacer                    fences: the loop skips a display frame while the GPU owes 2
 *   warmCompile(...)              every program compiled behind the loading screen
 *   burstProbe(...)               GPU ms per frame, saturated (8 renders, one sync); capped for the load
 *   quickProbe(...)               two or more synced frames, 120 ms at most, for the governor's confirm at rest
 *   createGpuLoad()               the slow GPU simulator's full screen load (dev only)
 *   measureOverdraw(...)          layers shaded per pixel: { avg, p99, max, histogram }
 */

// ── Before the renderer ─────────────────────────────────────────────────────

/**
 * The GPU's name from a throwaway WebGL context (3.2 "Pick"), or null when
 * the browser hides it. The context is released at once.
 */
export function readGpuName(): string | null {
  if (typeof document === "undefined") return null;
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    gl = (c.getContext("webgl2") as WebGL2RenderingContext | null) ?? (c.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  } finally {
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Cheap laptops: can this browser make a WebGL context at all? Checked before
 * three tries, so a browser without WebGL goes to the posters without three
 * logging its failure as errors.
 */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    gl = (c.getContext("webgl2") as WebGL2RenderingContext | null) ?? (c.getContext("webgl") as WebGLRenderingContext | null);
    return !!gl;
  } catch {
    return false;
  } finally {
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* ignore */
    }
  }
}

/** The canvas's physical megapixels at the device pixel ratio (pickTier's second argument). */
export function screenMegapixels(): number {
  if (typeof window === "undefined") return 0;
  const dpr = window.devicePixelRatio || 1;
  return (window.innerWidth * window.innerHeight * dpr * dpr) / 1e6;
}

export interface RendererOptions {
  antialias: boolean;
  pixelRatioCap: number;
  powerPreference: WebGLPowerPreference;
}

/** What the WebGLRenderer is created with for a tier (a tier object or index). */
export function rendererOptionsForTier(tier: QualityTier | number): RendererOptions {
  const spec = typeof tier === "number" ? tierSpec(tier) : tier;
  return { antialias: spec.msaa, pixelRatioCap: spec.pixelRatioCap, powerPreference: "high-performance" };
}

// ── The idle ladder ─────────────────────────────────────────────────────────

export interface IdleLadderOptions {
  /** Full ambient rate this long after the last input, ms. */
  activeMs?: number;
  /** Until this long after the last input, `slowFps`; after it, nothing. */
  sleepMs?: number;
  slowFps?: number;
}

/**
 * The ambient frame rate while the camera is at rest (3.1 "Idle"): the tier's
 * rate for 10 s after the last scroll, click, key or pointer move, then 15
 * fps, then after 45 s 0 (draw nothing until the next input). Moving frames
 * (a glide, a flight) are not governed by this: the scene draws those at the
 * display's rate as before.
 */
export class IdleLadder {
  private lastInput: number;
  private readonly activeMs: number;
  private readonly sleepMs: number;
  private readonly slowFps: number;

  constructor(now = 0, opts: IdleLadderOptions = {}) {
    this.lastInput = now;
    this.activeMs = opts.activeMs ?? 10000;
    this.sleepMs = opts.sleepMs ?? 45000;
    this.slowFps = opts.slowFps ?? 15;
  }

  /** Any input: scroll, wheel, pointer move or down, key, touch, a park call. */
  poke(now: number): void {
    this.lastInput = now;
  }

  /** ms since the last input. */
  idleFor(now: number): number {
    return now - this.lastInput;
  }

  /** The frames per second wanted for ambient animation now; 0 = stop drawing. */
  wantedFps(now: number, ambientFps: number): number {
    const idle = now - this.lastInput;
    if (idle < this.activeMs) return ambientFps;
    if (idle < this.sleepMs) return Math.min(ambientFps, this.slowFps);
    return 0;
  }

  /**
   * How long to wait before the next ambient frame, ms, given when the last
   * frame was drawn; -1 = do not schedule one (asleep until input).
   */
  waitMs(now: number, lastFrame: number, ambientFps: number): number {
    const fps = this.wantedFps(now, ambientFps);
    if (fps <= 0) return -1;
    return Math.max(0, 1000 / fps - (now - lastFrame));
  }

  /** "active", "slow" or "asleep", for the harness. */
  phase(now: number): "active" | "slow" | "asleep" {
    const idle = now - this.lastInput;
    return idle < this.activeMs ? "active" : idle < this.sleepMs ? "slow" : "asleep";
  }
}

// ── Frame pacing ────────────────────────────────────────────────────────────

/**
 * Cheap laptops (adapt2, 2026-09-28): how many frames the GPU still owes, and
 * whether the loop may submit another. world-tests/v6-backlog.mjs measured a
 * slow GPU's queue at 3, then 7, 11 and 15 frames after each governor step,
 * 200 to 250 ms from a scroll to its frame on screen. The cause was the scene's
 * own loop forking a second requestAnimationFrame chain at every step (fixed
 * in scene.ts, WorldScene.inTick); Chrome itself held the page to 3 frames.
 * This keeps the queue at 2 whatever submits frames: a fence after each
 * frame's draws says when the GPU has finished it (polled, never waited on:
 * WebGL updates a fence's status between tasks), and the loop skips a display
 * frame while `max` are unfinished. That is one frame less lag than Chrome's
 * own 3 on a GPU slower than the display. On a GPU that keeps up every fence
 * is done by the next display frame and nothing is ever skipped. WebGL 1 has
 * no fences: always ready.
 */
export class FramePacer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly fences: WebGLSync[] = [];
  private readonly max: number;
  private readonly giveUpMs: number;
  private blockedSince = -1;
  /** Display frames skipped because the GPU was behind (for the harness). */
  skipped = 0;
  /** Most frames seen in flight (for the harness). */
  peak = 0;
  /** Skips cut short by the safety valve (fences that never signalled). */
  forced = 0;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, max = 2, giveUpMs = 400) {
    const g = gl as WebGL2RenderingContext;
    this.gl = typeof g.fenceSync === "function" ? g : null;
    this.max = Math.max(1, max);
    this.giveUpMs = giveUpMs;
  }

  /** Frames submitted that the GPU has not finished (fences polled, never waited on). */
  inFlight(): number {
    const gl = this.gl;
    if (!gl) return 0;
    try {
      if (gl.isContextLost()) {
        this.fences.length = 0;
        return 0;
      }
      while (this.fences.length) {
        if (gl.getSyncParameter(this.fences[0], gl.SYNC_STATUS) !== gl.SIGNALED) break;
        gl.deleteSync(this.fences.shift()!);
      }
    } catch {
      this.fences.length = 0;
    }
    return this.fences.length;
  }

  /**
   * May the loop draw a frame now? False while `max` frames are unfinished.
   * A queue that stays blocked `giveUpMs` (a fence that never signals) is
   * dropped, so the loop can never stall on it.
   */
  ready(now: number): boolean {
    const n = this.inFlight();
    if (n < this.max) {
      this.blockedSince = -1;
      return true;
    }
    if (this.blockedSince < 0) this.blockedSince = now;
    if (now - this.blockedSince > this.giveUpMs) {
      this.clear();
      this.forced++;
      this.blockedSince = -1;
      return true;
    }
    this.skipped++;
    return false;
  }

  /** After a frame's draw calls: a fence behind them. */
  submitted(): void {
    const gl = this.gl;
    if (!gl) return;
    try {
      const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (s) this.fences.push(s);
      if (this.fences.length > this.peak) this.peak = this.fences.length;
    } catch {
      /* context lost */
    }
  }

  /** Forget every fence (after a synced measurement, or a lost context). */
  clear(): void {
    const gl = this.gl;
    for (const s of this.fences) {
      try {
        gl?.deleteSync(s);
      } catch {
        /* ignore */
      }
    }
    this.fences.length = 0;
  }
}

// ── Warm compile ────────────────────────────────────────────────────────────

export interface WarmCompileResult {
  ms: number;
  programsBefore: number;
  programsAfter: number;
  /** Objects that were hidden and made visible for the compile. */
  shown: number;
  /** Extra targets compiled for (for example the lake's reflection). */
  targets: number;
  /** A render of everything (frustum culling off) into a tiny target, so every buffer is on the GPU. */
  uploaded: boolean;
  /** Programs still compiling when the wait gave up (0 = all ready). */
  pending: number;
}

export interface WarmCompileOptions {
  /** Also render the whole scene once, frustum culling off, into a 4x4 target, so no buffer uploads mid scroll. Default true. */
  upload?: boolean;
  /** Longest wait for the driver to finish compiling, over all passes, ms. Default 15000. */
  maxMs?: number;
}

/**
 * Compile every program behind the loading screen (3.1 "Load", audit 5.1):
 * every object made visible (lights too, so the light count matches the
 * lights-always-visible rule), compileAsync for the screen, again with each
 * extra target bound (the lake's reflection renders in linear output, a second
 * program per material), then optionally one draw of everything into a tiny
 * target to upload the buffers. Visibility, frustum culling and the render
 * target are restored before it returns, even when a step throws.
 */
/**
 * C1: renderer.compileAsync, guarded. three's own version throws inside a
 * timer ("reading 'isReady'") and never resolves when a material loses its
 * program between compile() and the poll (a module swaps or disposes it, or a
 * remount disposes the scene mid-warm). Here a material with no program counts
 * as done, and the wait gives up after `maxMs` so the load can never hang.
 */
export function safeCompileAsync(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, maxMs = 15000): Promise<number> {
  let materials: Set<THREE.Material>;
  try {
    materials = renderer.compile(scene, camera) as unknown as Set<THREE.Material>;
  } catch (e) {
    return Promise.reject(e);
  }
  const t0 = performance.now();
  // Cheap laptops: the wait is for the driver (fxc on Windows can take many
  // seconds). It used to give up after 4 s, and every program still compiling
  // then compiled inside the load probe (read as a slow GPU) and the first
  // scroll. Now it waits up to maxMs (15 s) and says how many are unfinished,
  // so the scene can show the posters instead of a frozen page.
  return new Promise((resolve) => {
    const check = () => {
      try {
        materials.forEach((m) => {
          const prog = (renderer.properties.get(m) as { currentProgram?: { isReady?: () => boolean } }).currentProgram;
          if (!prog || typeof prog.isReady !== "function" || prog.isReady()) materials.delete(m);
        });
      } catch {
        materials.clear();
      }
      if (materials.size === 0 || performance.now() - t0 > maxMs) {
        resolve(materials.size);
        return;
      }
      setTimeout(check, 16);
    };
    check();
  });
}

export async function warmCompile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  extraTargets: ReadonlyArray<THREE.WebGLRenderTarget | null | undefined> = [],
  opts: WarmCompileOptions = {},
): Promise<WarmCompileResult> {
  const t0 = performance.now();
  const programsBefore = renderer.info.programs?.length ?? 0;
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  const prevTarget = renderer.getRenderTarget();
  let targets = 0;
  let uploaded = false;
  let pending = 0;
  let tiny: THREE.WebGLRenderTarget | null = null;
  const culled: THREE.Object3D[] = [];
  const budget = opts.maxMs ?? 15000;
  const left = () => Math.max(50, budget - (performance.now() - t0));
  try {
    renderer.setRenderTarget(null);
    pending = await safeCompileAsync(renderer, scene, camera, left());
    for (const t of extraTargets) {
      if (!t) continue;
      renderer.setRenderTarget(t);
      pending += await safeCompileAsync(renderer, scene, camera, left());
      targets++;
    }
    if (opts.upload !== false && pending === 0) {
      // Cheap laptops: flagged like the screen, so this pass draws with the
      // screen's own programs (sRGB output, the grade). A plain target is
      // linear with no tone mapping: three made a third program per material
      // for it that no frame ever used (the baseline counted 152 programs).
      tiny = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
      (tiny as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
      tiny.texture.colorSpace = renderer.outputColorSpace;
      scene.traverse((o) => {
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      renderer.setRenderTarget(tiny);
      renderer.render(scene, camera);
      uploaded = true;
    }
  } finally {
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
    renderer.setRenderTarget(prevTarget);
    tiny?.dispose();
  }
  return {
    ms: Math.round(performance.now() - t0),
    programsBefore,
    programsAfter: renderer.info.programs?.length ?? 0,
    shown: hidden.length,
    targets,
    uploaded,
    pending,
  };
}

// ── Burst probe ─────────────────────────────────────────────────────────────

export interface BurstResult {
  /** Fastest repeat, ms per frame. */
  ms: number;
  /** Median repeat, ms per frame. */
  med: number;
  triangles: number;
  calls: number;
  /** Wall time the probe took, ms. */
  took: number;
  /**
   * The first synced frame, ms: the cold one. It carries one-time costs (on
   * the M2 about 20 ms: 22.9 against a steady 3.7), so nothing is decided on it.
   */
  cold: number;
  /** The second synced frame, ms: the warm one. The early stop and the fit read this. */
  first: number;
  /** True when the probe stopped early: the warm frame (the cold one too) was over `stopOverMs`. */
  capped: boolean;
}

export interface BurstOptions {
  /** Renders per repeat (the most; a slow frame gets fewer, see maxMs). */
  renders?: number;
  repeats?: number;
  /** Warm up before timing (the GPU clocks up), ms. */
  warmMs?: number;
  /**
   * Wall time the whole probe may take, ms (0 = no limit, the harness's old
   * behaviour). With a limit the renders per repeat shrink to fit a slow
   * frame, and at least two repeats run.
   */
  maxMs?: number;
  /** One synced frame over this stops the probe at once (the machine is poster class), ms. 0 = off. */
  stopOverMs?: number;
  /**
   * When the warm frame is under fastUnderMs, the probe may run up to
   * fastMaxMs instead of maxMs. A fast GPU needs the longer warm up to read
   * true (at 120 ms the M2 read about 2x high and a lowered tier never
   * climbed back), and on a fast GPU the longer burst is not a visible hitch.
   */
  fastUnderMs?: number;
  fastMaxMs?: number;
}

/**
 * GPU ms per frame with the GPU saturated (audit 1): `renders` back to back,
 * one 1 pixel readPixels to wait for them, `repeats` times after a warm up,
 * the fastest kept. Apple GPUs clock down at light load, so one synced frame
 * reads 30 to 60 percent high; the burst repeats to within 2 percent.
 *
 * Cheap laptops: the load probe passes maxMs 400 and stopOverMs 50. It draws
 * one synced frame that only warms up (the cold frame: clock ramp, first use
 * uploads, on the M2 about 20 ms more than a steady frame), then a second,
 * warm one. When the warm frame is over 50 ms as well it stops there (a slow
 * GPU used to be held for 48 frames, about 7 s at 150 ms a frame); a slow
 * cold frame alone decides nothing. Otherwise the renders per repeat shrink
 * so the warm up and the repeats fit in about 0.4 s, the old probe's length
 * on a fast GPU, and the fastest repeat is the answer.
 */
export function burstProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: BurstOptions = {}): BurstResult {
  let maxMs = opts.maxMs ?? 0;
  let K = opts.renders ?? 8;
  let reps = opts.repeats ?? 5;
  let warmMs = opts.warmMs ?? 250;
  const stopOver = opts.stopOverMs ?? 0;
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(null);
  const start = performance.now();
  const info = () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls });
  try {
    // The cold frame: timed for the report, never decided on.
    const c0 = performance.now();
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const cold = performance.now() - c0;
    // The warm frame: it says how slow this machine is.
    const f0 = performance.now();
    renderer.render(scene, camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const first = performance.now() - f0;
    if (stopOver > 0 && first > stopOver) {
      return { ms: +first.toFixed(3), med: +first.toFixed(3), ...info(), took: Math.round(performance.now() - start), cold: +cold.toFixed(3), first: +first.toFixed(3), capped: true };
    }
    if (maxMs > 0 && opts.fastUnderMs && opts.fastMaxMs && first < opts.fastUnderMs) maxMs = Math.max(maxMs, opts.fastMaxMs);
    if (maxMs > 0) {
      // Fit: half the budget warms the GPU up (Apple GPUs read 30-60% high
      // without it), the other half holds the repeats.
      const perFrame = Math.max(0.25, first);
      warmMs = Math.min(warmMs, maxMs * 0.5);
      K = Math.max(1, Math.min(K, Math.floor((maxMs * 0.5) / Math.max(2, reps) / perFrame)));
      reps = Math.max(2, Math.min(reps, Math.floor((maxMs * 0.5) / (K * perFrame))));
    }
    while (performance.now() - start < warmMs) {
      for (let i = 0; i < K; i++) renderer.render(scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (maxMs > 0 && performance.now() - start > maxMs * 0.5) break;
    }
    const per: number[] = [];
    for (let j = 0; j < reps; j++) {
      const a = performance.now();
      for (let i = 0; i < K; i++) renderer.render(scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      per.push((performance.now() - a) / K);
      if (maxMs > 0 && j >= 1 && performance.now() - start > maxMs) break;
    }
    per.sort((x, y) => x - y);
    return {
      ms: +per[0].toFixed(3),
      med: +per[Math.floor(per.length / 2)].toFixed(3),
      ...info(),
      took: Math.round(performance.now() - start),
      cold: +cold.toFixed(3),
      first: +first.toFixed(3),
      capped: false,
    };
  } finally {
    renderer.setRenderTarget(prevTarget);
  }
}

/**
 * Cheap laptops (adapt3): a short measurement at rest, for a GPU already known
 * to be slow (the governor only asks at tier 3's lowest pixel ratio after 2 s
 * of moving frames over 38 ms). Synced frames one at a time while the next
 * still fits in `budgetMs`, at most `maxFrames`; the fastest is the answer.
 * No saturating burst: on such a GPU one frame already keeps it busy for 20 ms
 * or more, and it was just clocked up by the scroll. The governor's confirm
 * used burstProbe with 300 ms and took about 360 ms at 35 ms frames, a visible
 * hitch on the machines it protects. Here: 120 ms at most while frames are
 * under 60 ms, and never fewer than `minFrames` (2): a first frame read once
 * at 68.7 ms on a GPU whose next frames took 20.6 and 24.5 (adapt3,
 * v6-restburst.mjs), and one frame alone would have decided on it. The caller
 * waits for the frames already queued (perf.FramePacer) first.
 */
export function quickProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, budgetMs = 120, maxFrames = 4, minFrames = 2): BurstResult {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(null);
  const start = performance.now();
  const frames: number[] = [];
  try {
    for (let i = 0; i < Math.max(1, maxFrames); i++) {
      const a = performance.now();
      renderer.render(scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const f = performance.now() - a;
      frames.push(f);
      if (i + 1 >= minFrames && performance.now() - start + f > budgetMs) break;
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
  }
  const sorted = frames.slice().sort((x, y) => x - y);
  return {
    ms: +sorted[0].toFixed(3),
    med: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
    triangles: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
    took: Math.round(performance.now() - start),
    cold: +frames[0].toFixed(3),
    first: +(frames[1] ?? frames[0]).toFixed(3),
    capped: false,
  };
}

// ── Slow GPU simulator (dev only) ──────────────────────────────────────────

/**
 * A full screen quad that costs GPU time per pixel and changes nothing on
 * screen (alpha 0 through normal blending; the loop's result feeds the alpha
 * through a uniform that is 0, which no compiler can fold). It is drawn in
 * every render (the probe, every frame, the lake's reflection), so the M2
 * behaves like a slower GPU at every tier and pixel ratio. The scene sets
 * `iters` from a calibration (WorldScene.simulateSlowGpu).
 */
export interface GpuLoad {
  mesh: THREE.Mesh;
  setIters(n: number): void;
  iters(): number;
  dispose(): void;
}

export function createGpuLoad(): GpuLoad {
  const uniforms = { uIters: { value: 0 }, uZero: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    name: "SlowGpuLoad",
    uniforms,
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform int uIters;
      uniform float uZero;
      void main() {
        vec2 p = gl_FragCoord.xy * 0.013;
        float v = 0.5;
        for (int i = 0; i < 65536; i++) {
          if (i >= uIters) break;
          v = fract(sin(v * 12.9898 + p.x + float(i) * 0.37) * 43758.5453 + p.y);
        }
        gl_FragColor = vec4(v, v, v, v * uZero);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "SlowGpuLoad";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6;
  return {
    mesh,
    setIters(n: number) {
      uniforms.uIters.value = Math.max(0, Math.min(65536, Math.round(n)));
    },
    iters: () => uniforms.uIters.value,
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
    },
  };
}

// ── Overdraw ────────────────────────────────────────────────────────────────

export interface OverdrawResult {
  /** Mean layers per pixel, every pixel counted (sky included). */
  avg: number;
  /** 99th percentile of layers per pixel. */
  p99: number;
  max: number;
  /** histogram[k] = pixels shaded k times; the last bin holds k >= its index. */
  histogram: number[];
  width: number;
  height: number;
  mode: "visible" | "raster";
  ms: number;
  /** With keepCounts: layers per pixel, w x h, bottom row first (readPixels order). */
  counts?: Uint8Array;
}

export interface OverdrawOptions {
  /**
   * "visible" (default): every material keeps its own shaders and state and
   * only increments the stencil where a fragment passes the depth test and
   * survives its shader (a discarded alpha cutout does not count): the layers
   * that actually land, in the real draw order.
   * "raster": every material swapped for an additive 1/255 white one with the
   * same depth test, depth write, side and transparency (the bible's
   * wording): counts every fragment rasterised, cutouts included, but the
   * vertex shaders are three's own (no wind, no camera facing, no far plane
   * pin), so camera facing cards and the sky dome are approximate.
   */
  mode?: "visible" | "raster";
  /** Scale of the drawing buffer to measure at (1 = full). */
  scale?: number;
  /** Highest count told apart (the top bin). */
  levels?: number;
  /** Also return the per pixel counts (for a heat map). */
  keepCounts?: boolean;
}

type MatLike = THREE.Material & { fog?: boolean };

interface StencilSave {
  stencilWrite: boolean;
  stencilFunc: THREE.StencilFunc;
  stencilRef: number;
  stencilFuncMask: number;
  stencilWriteMask: number;
  stencilFail: THREE.StencilOp;
  stencilZFail: THREE.StencilOp;
  stencilZPass: THREE.StencilOp;
}

function materialsOf(o: THREE.Object3D): THREE.Material[] | null {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!m) return null;
  return Array.isArray(m) ? m : [m];
}

/**
 * Layers shaded per pixel at this camera (3.1 "Overdraw at stops", target
 * average 1.8, 99th percentile 5). Renders into its own target (no MSAA, a
 * stencil buffer), reads it back and restores every material, the clear
 * colour, the background and the render target. The scene's own
 * onBeforeRender hooks run as in a real frame (the lake's reflection renders
 * into its own target and is not counted here).
 */
export function measureOverdraw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: OverdrawOptions = {}): OverdrawResult {
  const t0 = performance.now();
  const mode = opts.mode ?? "visible";
  const levels = Math.max(2, Math.min(255, opts.levels ?? 32));
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const scale = Math.max(0.1, Math.min(1, opts.scale ?? 1));
  const w = Math.max(1, Math.round(size.x * scale));
  const h = Math.max(1, Math.round(size.y * scale));
  const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: true, samples: 0 });
  target.texture.colorSpace = THREE.NoColorSpace;

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const one = 1 / 255;

  const stencilSaved = new Map<THREE.Material, StencilSave>();
  const swapped: Array<[THREE.Object3D, THREE.Material | THREE.Material[]]> = [];
  const made = new Map<THREE.Material, THREE.Material>();
  const instColors: Array<[THREE.InstancedMesh, THREE.InstancedBufferAttribute]> = [];
  const quadMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(one, one, one),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let pixels: Uint8Array | null = null;
  try {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.autoClear = true;

    if (mode === "visible") {
      scene.traverse((o) => {
        const mats = materialsOf(o);
        if (!mats) return;
        for (const m of mats) {
          if (stencilSaved.has(m)) continue;
          stencilSaved.set(m, {
            stencilWrite: m.stencilWrite,
            stencilFunc: m.stencilFunc,
            stencilRef: m.stencilRef,
            stencilFuncMask: m.stencilFuncMask,
            stencilWriteMask: m.stencilWriteMask,
            stencilFail: m.stencilFail,
            stencilZFail: m.stencilZFail,
            stencilZPass: m.stencilZPass,
          });
          m.stencilWrite = true;
          m.stencilFunc = THREE.AlwaysStencilFunc;
          m.stencilRef = 0;
          m.stencilFuncMask = 0xff;
          m.stencilWriteMask = 0xff;
          m.stencilFail = THREE.KeepStencilOp;
          m.stencilZFail = THREE.KeepStencilOp;
          m.stencilZPass = THREE.IncrementStencilOp;
        }
      });
      renderer.render(scene, camera);
      // Restore now, so the quads below are the only stencil readers.
      for (const [m, s] of stencilSaved) Object.assign(m, s);
      stencilSaved.clear();
      // Count: one additive 1/255 quad per level where level <= stencil.
      renderer.autoClear = false;
      renderer.clearColor();
      quadMat.stencilWrite = true;
      quadMat.stencilFunc = THREE.LessEqualStencilFunc;
      quadMat.stencilFuncMask = 0xff;
      quadMat.stencilWriteMask = 0x00;
      quadMat.stencilFail = THREE.KeepStencilOp;
      quadMat.stencilZFail = THREE.KeepStencilOp;
      quadMat.stencilZPass = THREE.KeepStencilOp;
      for (let k = 1; k <= levels; k++) {
        quadMat.stencilRef = k;
        renderer.render(quadScene, quadCam);
      }
    } else {
      scene.fog = null;
      scene.traverse((o) => {
        const mats = materialsOf(o);
        if (!mats) return;
        const repl = mats.map((m) => {
          let r = made.get(m);
          if (!r) {
            const base = {
              color: new THREE.Color(one, one, one),
              blending: THREE.AdditiveBlending,
              transparent: m.transparent,
              depthTest: m.depthTest,
              depthWrite: m.depthWrite,
              side: m.side,
              toneMapped: false,
            };
            const mm = m as MatLike;
            r = (o as THREE.Points).isPoints
              ? new THREE.PointsMaterial({ ...base, size: (m as THREE.PointsMaterial).size ?? 1, sizeAttenuation: (m as THREE.PointsMaterial).sizeAttenuation ?? true })
              : (o as THREE.Line).isLine
                ? new THREE.LineBasicMaterial(base)
                : (o as THREE.Sprite).isSprite
                  ? new THREE.SpriteMaterial(base)
                  : new THREE.MeshBasicMaterial({ ...base, fog: false });
            if (mm.fog !== undefined) (r as MatLike).fog = false;
            made.set(m, r);
          }
          return r;
        });
        const mesh = o as THREE.Mesh;
        swapped.push([o, mesh.material]);
        mesh.material = Array.isArray(mesh.material) ? repl : repl[0];
        // Instance colours would scale the 1/255 count: off for the pass.
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh && im.instanceColor) {
          instColors.push([im, im.instanceColor]);
          im.instanceColor = null;
        }
      });
      renderer.render(scene, camera);
    }

    pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  } finally {
    for (const [m, s] of stencilSaved) Object.assign(m, s);
    for (const [o, m] of swapped) (o as THREE.Mesh).material = m;
    for (const [im, c] of instColors) im.instanceColor = c;
    for (const m of made.values()) m.dispose();
    scene.background = prevBackground;
    scene.fog = prevFog;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    target.dispose();
    quad.geometry.dispose();
    quadMat.dispose();
  }

  const top = mode === "visible" ? levels : 255;
  const hist = new Array<number>(Math.min(top, 64) + 1).fill(0);
  const last = hist.length - 1;
  let sum = 0;
  let max = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = pixels ? pixels[i * 4] : 0;
    sum += v;
    if (v > max) max = v;
    hist[v > last ? last : v]++;
  }
  let run = 0;
  let p99 = 0;
  const want = n * 0.99;
  for (let k = 0; k < hist.length; k++) {
    run += hist[k];
    if (run >= want) {
      p99 = k;
      break;
    }
  }
  let counts: Uint8Array | undefined;
  if (opts.keepCounts && pixels) {
    counts = new Uint8Array(n);
    for (let i = 0; i < n; i++) counts[i] = pixels[i * 4];
  }
  return { avg: +(sum / n).toFixed(3), p99, max, histogram: hist, width: w, height: h, mode, ms: Math.round(performance.now() - t0), counts };
}
