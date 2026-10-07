/**
 * v6 quality tiers (world_art_bible_v6.md 3.2, v6_perf_and_code_audit.md 7).
 * Pure data and logic: no three, no DOM except the guarded localStorage calls,
 * so world-tests can load it under node.
 *
 *   TIERS          the table of 3.2 as data, one QualityTier per tier.
 *   pickTier       the first guess, from the GPU's name and the canvas's
 *                  physical megapixels, before the renderer exists.
 *   refineTier     one step up or down from the load probe (perf.burstProbe
 *                  on the opening frame times WORST_TO_OPENING_RATIO).
 *   headroomCheck  the re-check of a low tier (a remembered one at load, and
 *                  the scene's rest check): one step up with clear headroom.
 *   Governor       fed frame intervals while the camera moves; proposes a
 *                  pixel ratio or content step down after 1.5 s over 20 ms,
 *                  back up after 8 s under 11 ms (twice a session at most).
 *   rememberTier / recallTier   localStorage, inside try and catch.
 *
 * MSAA is decided once, before the renderer is created (pickTier). Nothing
 * here ever asks for it to change on a live canvas: the governor only moves
 * the pixel ratio and the content tier.
 */

export type TierIndex = 0 | 1 | 2 | 3;

export interface QualityTier {
  tier: TierIndex;
  name: "full" | "laptop" | "low" | "rescue";
  /** Highest pixel ratio the renderer uses (after pickTier's megapixel step). */
  pixelRatioCap: number;
  /** MSAA on the canvas (4x). Only read when the renderer is created. */
  msaa: boolean;
  reflection: {
    /** Reflection target size as a share of the drawing buffer. */
    scale: number;
    /** Widest the target may be, in pixels. */
    maxWidth: number;
    msaa: boolean;
    /** "full": sky, island, far shore, boathouse, Great Tree (1.13); "skyIsland": sky and island only; "frozen": rendered once on arrival. */
    mode: "full" | "skyIsland" | "frozen";
  };
  /** Multiplier on every tree level of detail distance. */
  treeDistance: number;
  /** Crossed cards on a near tree (plus the core); 0 = core only inside nearCoreOnlyR. */
  nearTreeCards: 0 | 2 | 3;
  /** Tier 3: inside this radius near trees draw their core only. 0 = off. */
  nearCoreOnlyR: number;
  /** Share of each cover kind's instance order that is drawn. */
  coverDensity: number;
  /** Multiplier on the cover fade distance. */
  coverFade: number;
  /** Share of particles, smoke puffs, spores, fireflies and mist cards. */
  particles: number;
  /** Share of cloud billboards drawn. */
  clouds: number;
  /** Frames per second for ambient animation while nothing moves (the idle ladder's top rate). */
  ambientFps: number;
}

export const TIERS: readonly QualityTier[] = [
  {
    tier: 0,
    name: "full",
    pixelRatioCap: 1.5,
    msaa: true,
    reflection: { scale: 0.5, maxWidth: 1024, msaa: true, mode: "full" },
    treeDistance: 1,
    nearTreeCards: 3,
    nearCoreOnlyR: 0,
    coverDensity: 1,
    coverFade: 1,
    particles: 1,
    clouds: 1,
    ambientFps: 30,
  },
  {
    tier: 1,
    name: "laptop",
    pixelRatioCap: 1.25,
    msaa: true,
    reflection: { scale: 0.35, maxWidth: 640, msaa: false, mode: "full" },
    treeDistance: 0.8,
    nearTreeCards: 3,
    nearCoreOnlyR: 0,
    coverDensity: 0.7,
    coverFade: 0.8,
    particles: 0.6,
    clouds: 1,
    ambientFps: 24,
  },
  {
    tier: 2,
    name: "low",
    pixelRatioCap: 1.0,
    msaa: false,
    reflection: { scale: 0.25, maxWidth: 512, msaa: false, mode: "skyIsland" },
    treeDistance: 0.6,
    nearTreeCards: 2,
    nearCoreOnlyR: 0,
    coverDensity: 0.4,
    coverFade: 0.6,
    particles: 0.35,
    clouds: 0.5,
    ambientFps: 15,
  },
  {
    tier: 3,
    name: "rescue",
    pixelRatioCap: 0.75,
    msaa: false,
    reflection: { scale: 0.25, maxWidth: 512, msaa: false, mode: "frozen" },
    treeDistance: 0.5,
    nearTreeCards: 0,
    nearCoreOnlyR: 300,
    coverDensity: 0.2,
    coverFade: 0.5,
    particles: 0.2,
    clouds: 0.25,
    ambientFps: 10,
  },
];

/**
 * The route's worst frame over the opening frame, burst ms at the same pixel
 * ratio. refineTier multiplies the load probe (the opening) by this to predict
 * the worst frame. v5 measured 7.42 / 2.97 = 2.5; the v6 target is about 1.3.
 * Phase C1 measured it with world-tests/v6-perf.mjs route on 2026-09-27
 * (M2 Pro, 1691x1278, PR 1.5, nothing else rendering): the turn at the pool
 * (key 23) 5.71 ms over the opening (key 0) 3.19 ms = 1.79.
 */
export const WORST_TO_OPENING_RATIO = 1.8;

/** The governor's pixel ratio ladder, highest first (3.2). */
export const PIXEL_RATIO_STEPS: readonly number[] = [1.5, 1.25, 1.0, 0.85, 0.75];

/**
 * Lowest pixel ratio the governor uses on a tier before it drops the content
 * instead: the next tier's cap (so tier 0 goes 1.5, 1.25, then tier 1's content
 * at 1.25, then 1.0, then tier 2 at 1.0, then 0.85, then tier 3, then 0.75).
 */
export const PIXEL_RATIO_FLOOR: readonly number[] = [1.25, 1.0, 0.85, 0.75];

const clampTier = (t: number): TierIndex => (t <= 0 ? 0 : t >= 3 ? 3 : (Math.round(t) as TierIndex));

/** One step down the pixel ratio ladder from `pr` (the same value when already at the bottom). */
export function stepPixelRatioDown(pr: number): number {
  for (const s of PIXEL_RATIO_STEPS) if (s < pr - 1e-6) return s;
  return pr;
}

/** A tier's settings, with its pixel ratio cap lowered by `prSteps` ladder steps (pickTier's megapixel rule). */
export function tierSpec(tier: number, prSteps = 0): QualityTier {
  const base = TIERS[clampTier(tier)];
  let cap = base.pixelRatioCap;
  for (let i = 0; i < prSteps; i++) cap = stepPixelRatioDown(cap);
  return cap === base.pixelRatioCap ? base : { ...base, pixelRatioCap: cap };
}

export interface TierPick {
  tier: TierIndex;
  /** The tier's settings, pixel ratio cap already stepped for the megapixel rule. */
  spec: QualityTier;
  /** Why: which rule matched. */
  reason: string;
  /** A software renderer (SwiftShader, llvmpipe, Microsoft Basic Render): the page goes straight to the posters. */
  software: boolean;
}

/** Software renderers: tier 3 and `software` (the page shows the posters, poster.ts). */
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|basic render driver|\bsoftware\b/i;
/**
 * GPUs that start at tier 2 with no MSAA: integrated Intel short of Iris Xe
 * (Iris Plus as "Iris(R) Plus" and "Iris(TM) Plus"), phones, and AMD's
 * smallest RDNA2 parts (Radeon 610M and 660M, "AMD Radeon(TM) 610M").
 */
const LOW_GPU = /(intel.*\b(uhd|hd)\b)|iris\s*(\((r|tm)\))?\s*plus|mali|adreno|powervr|radeon\s*(\(tm\))?\s*6[0-6]0m\b/i;
/** AMD's bigger integrated RDNA parts (680M, 7x0M, 8x0M): Iris Xe class or better, tier 1. */
const AMD_MID_IGPU = /radeon\s*(\(tm\))?\s*(6[7-9]0m|[78]\d0m)\b/i;
/** Intel Iris Xe: tier 1. */
const MID_GPU = /iris.*xe|xe graphics/i;
/** Apple M chips and discrete NVIDIA or AMD: tier 0. */
const TOP_GPU = /apple\s*m\d|apple gpu|\bm[1-9]\s*(pro|max|ultra)?\b|nvidia|geforce|rtx|gtx|quadro|radeon\s*(rx|pro|r9|vii)|amd\s*radeon\s*(rx|pro)/i;
/** AMD integrated (Vega, Radeon Graphics without a model): tier 2. */
const AMD_IGPU = /radeon\(tm\)\s*graphics|radeon graphics|vega\s*\d/i;

/**
 * The first guess, before the renderer exists (3.2 "Pick"). `gpuName` is
 * WEBGL_debug_renderer_info's UNMASKED_RENDERER_WEBGL (see perf.readGpuName);
 * `megapixels` is the canvas's physical size at the device pixel ratio
 * (innerWidth x innerHeight x dpr^2 / 1e6). Over 5 MP (a DPR 2 screen) the
 * pixel ratio cap drops one step.
 */
export function pickTier(gpuName: string | null | undefined, megapixels: number): TierPick {
  const name = (gpuName || "").trim();
  let tier: TierIndex;
  let reason: string;
  const software = !!name && SOFTWARE_GPU.test(name);
  if (!name) {
    tier = 1;
    reason = "unknown GPU (no renderer name)";
  } else if (software) {
    tier = 3;
    reason = "software renderer: " + name;
  } else if (LOW_GPU.test(name)) {
    tier = 2;
    reason = "low GPU: " + name;
  } else if (MID_GPU.test(name)) {
    tier = 1;
    reason = "Iris Xe class: " + name;
  } else if (AMD_MID_IGPU.test(name)) {
    tier = 1;
    reason = "AMD integrated, RDNA: " + name;
  } else if (AMD_IGPU.test(name)) {
    tier = 2;
    reason = "AMD integrated: " + name;
  } else if (TOP_GPU.test(name)) {
    tier = 0;
    reason = "Apple M or discrete: " + name;
  } else {
    tier = 1;
    reason = "unknown GPU: " + name;
  }
  const big = Number.isFinite(megapixels) && megapixels > 5;
  const spec = tierSpec(tier, big ? 1 : 0);
  if (big) reason += `; ${megapixels.toFixed(1)} MP, pixel ratio cap ${spec.pixelRatioCap}`;
  return { tier, spec, reason, software };
}

export interface TierRefine {
  tier: TierIndex;
  /** probeMs x worstRatio: the predicted worst frame on the route, ms. */
  predictedMs: number;
  changed: boolean;
  reason: string;
}

/**
 * One step from the load probe (3.2 "Confirm"): predicted worst frame over
 * 14 ms steps down a tier, under 5 ms steps up one (never above tier 0). At
 * most one step, so a second probe after a step down only confirms.
 */
export function refineTier(tier: number, probeMs: number, worstRatio = WORST_TO_OPENING_RATIO): TierRefine {
  const t = clampTier(tier);
  const predictedMs = probeMs * worstRatio;
  if (!Number.isFinite(predictedMs) || predictedMs <= 0) {
    return { tier: t, predictedMs, changed: false, reason: "no probe" };
  }
  if (predictedMs > 14 && t < 3) {
    return { tier: clampTier(t + 1), predictedMs, changed: true, reason: `predicted ${predictedMs.toFixed(1)} ms > 14: down` };
  }
  if (predictedMs < 5 && t > 0) {
    return { tier: clampTier(t - 1), predictedMs, changed: true, reason: `predicted ${predictedMs.toFixed(1)} ms < 5: up` };
  }
  return { tier: t, predictedMs, changed: false, reason: `predicted ${predictedMs.toFixed(1)} ms: keep` };
}

// ── Re-checking a low tier ──────────────────────────────────────────────────

/**
 * A lower tier can be wrong: a remembered one (one slow visit, battery saver,
 * heat) or one picked from a disturbed probe. The re-check climbs one step
 * when a warm, saturated measurement at the current tier predicts the tier
 * above's route worst under HEADROOM_UP_MS: 12 ms, under refineTier's 14 ms
 * down line with a margin, so the next load's probe keeps the tier it climbed
 * to. The prediction: measured x WORST_TO_OPENING_RATIO x the tier above's
 * pixels over the current ones x TIER_CONTENT_STEP.
 *
 * Frame intervals cannot show headroom (they lock to the display's rate), and
 * single synced frames at rest read 2 to 3 times high on the M2 (its GPU
 * clocks down at light load: 6.9 ms median against a 3.2 ms burst, measured
 * 2026-09-28), so the re-check uses the probe's own saturated burst.
 */
export const HEADROOM_UP_MS = 12;

/**
 * Content cost of one tier step up at the same pixel ratio. The M2 measured
 * tier 1 to tier 0 at 1920x1080 (both at pixel ratio 1) as 3.10 to 3.84 ms at
 * the route's worst (1.24) and about 1.1 at the stops; 1.15 sits between.
 */
export const TIER_CONTENT_STEP = 1.15;

// ── The load ladder's tier 2 line ──────────────────────────────────────────

/**
 * Cheap laptops (adapt3): tier 2 is kept at load when its opening, measured
 * at tier 2 (burst ms, at its cap and then at its floor of 0.85), is at most
 * this. The same rule as tier 3's poster line (28 ms, a route worst of 50):
 * the opening times WORST_TO_OPENING_RATIO is the route's worst, here 30 ms,
 * and the moving frames, which averaged 1.06 to 1.08 times the opening in the
 * adapt2 sweep, stay near 18 ms, under the governor's 20 ms step down line.
 * Before, every opening over 15.6 ms at the pick tier (a predicted worst over
 * 28) went straight to tier 3 at 0.75.
 */
export const TIER2_HOLD_MS = 16.7;

/**
 * A load measurement this close to its line (a share of the line) is taken
 * again, up to twice, and the median decides (adapt3: one burst at 27.3 ms
 * kept the 3D while a faster simulated GPU measured 30.7 and got the posters).
 */
export const NEAR_LINE_SHARE = 0.1;

/** True when `ms` is within NEAR_LINE_SHARE of `line`. */
export function nearLine(ms: number, line: number, share = NEAR_LINE_SHARE): boolean {
  return Number.isFinite(ms) && Math.abs(ms - line) <= line * share;
}

/** The median of a few measurements (the mean of the middle two for an even count). */
export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface HeadroomVerdict {
  /** Climb one step now. */
  climb: boolean;
  /** The tier to climb to (the same tier when there is none above). */
  tier: TierIndex;
  /** The predicted route worst at the tier above, ms. */
  predictedUpMs: number;
  /** Clearly no headroom (over 1.5 x the line): stop re-checking this session. */
  hopeless: boolean;
  reason: string;
}

/**
 * The re-check (see HEADROOM_UP_MS). `measuredMs` is a burst at the current
 * tier and pixel ratio (the load probe's warm fastest repeat, or the rest
 * check's). `prSteps` is pickTier's megapixel step (1 over 5 MP).
 */
export function headroomCheck(
  tier: number,
  measuredMs: number,
  pixelRatioNow: number,
  devicePixelRatio: number,
  prSteps = 0,
  worstRatio = WORST_TO_OPENING_RATIO,
  upMs = HEADROOM_UP_MS,
): HeadroomVerdict {
  const t = clampTier(tier);
  if (t === 0) return { climb: false, tier: 0, predictedUpMs: 0, hopeless: true, reason: "tier 0: nothing above" };
  if (!Number.isFinite(measuredMs) || measuredMs <= 0) return { climb: false, tier: t, predictedUpMs: NaN, hopeless: false, reason: "no measurement" };
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const up = clampTier(t - 1);
  const prUp = Math.min(dpr, tierSpec(up, prSteps).pixelRatioCap);
  const prNow = pixelRatioNow > 0 ? pixelRatioNow : 1;
  const pixelStep = Math.max(1, (prUp / prNow) ** 2);
  const predictedUpMs = measuredMs * worstRatio * pixelStep * TIER_CONTENT_STEP;
  const txt = `${measuredMs.toFixed(1)} ms at tier ${t} predicts ${predictedUpMs.toFixed(1)} ms at tier ${up}`;
  if (predictedUpMs < upMs) return { climb: true, tier: up, predictedUpMs, hopeless: false, reason: `${txt} (< ${upMs}): up` };
  return { climb: false, tier: t, predictedUpMs, hopeless: predictedUpMs > upMs * 1.5, reason: `${txt} (>= ${upMs}): keep` };
}

// ── The governor ────────────────────────────────────────────────────────────

export interface GovernorAction {
  /** The pixel ratio to set now (renderer.setPixelRatio, then resize). */
  pixelRatio: number;
  /** The content tier to apply (setQuality on every module) when it changed. */
  tier: TierIndex;
  /** True when the tier changed (not only the pixel ratio). */
  tierChanged: boolean;
  direction: "down" | "up";
  reason: string;
  /**
   * The governor's last step: nothing is left to lower and frames still
   * average over `posterMs` (poster.ts POSTER_RULES). The page shows the
   * posters. Never applied while the camera moves.
   */
  poster?: boolean;
}

export interface GovernorOptions {
  /** Average frame interval that counts as slow, ms (under 50 fps). */
  slowMs?: number;
  /** How long it must stay slow before a step down, ms. */
  slowForMs?: number;
  /** Average under this counts as fast, ms. */
  fastMs?: number;
  /** How long it must stay fast before a step up, ms. */
  fastForMs?: number;
  /** Over this average the step is applied at once, even while moving, ms. */
  urgentMs?: number;
  /** Steps up allowed per session. */
  maxUps?: number;
  /** Time constant of the frame interval average, ms. */
  smoothingMs?: number;
  /** After any change, samples are ignored this long, ms. */
  settleMs?: number;
  /** At the last step, an average over this asks for the posters, ms. */
  posterMs?: number;
  /** How long it must stay over posterMs at the last step, ms. */
  posterForMs?: number;
  /**
   * Adapt3: the quiet spell after each poster ask the page turned down (a
   * measurement at rest under the line), ms. One more decline than there are
   * entries ends the asks for the session.
   */
  posterBackoffMs?: readonly number[];
  /** Final pass F: the most one frame's interval adds to the average, ms (a lone hitch stays a blip). */
  hitchMs?: number;
}

interface GovStep {
  pixelRatio: number;
  tier: TierIndex;
}

/**
 * The governor while scrolling (3.2). Call sample() on every frame with the
 * frame interval; it only learns from frames where the camera moves, and it
 * hands back an action only when it may be applied: the camera at rest and no
 * park or click in running, or at once when frames run over 33 ms (never
 * during a park). Steps down: the pixel ratio one ladder step while it stays at
 * or above the tier's floor, else the next tier's content. Steps up undo the
 * last step down.
 */
export class Governor {
  private readonly o: Required<GovernorOptions>;
  private pr: number;
  private tier: TierIndex;
  /** The device's own pixel ratio: the ladder never goes above it. */
  private readonly devicePr: number;
  private avg = 0;
  private haveAvg = false;
  private slowSince = -1;
  private fastSince = -1;
  private posterSince = -1;
  private posterAsked = false;
  private posterQuietUntil = 0;
  /** Adapt3: asks turned down this session, and whether the asks have stopped for it. Kept across reset(). */
  private posterDeclines = 0;
  private posterStopped = false;
  private settleUntil = 0;
  private ups = 0;
  private pending: GovernorAction | null = null;
  private readonly history: GovStep[] = [];

  constructor(startTier: number, pixelRatio: number, devicePixelRatio: number, opts: GovernorOptions = {}) {
    this.o = {
      posterBackoffMs: opts.posterBackoffMs ?? [10000, 60000],
      slowMs: opts.slowMs ?? 20,
      slowForMs: opts.slowForMs ?? 1500,
      fastMs: opts.fastMs ?? 11,
      fastForMs: opts.fastForMs ?? 8000,
      urgentMs: opts.urgentMs ?? 33,
      maxUps: opts.maxUps ?? 2,
      smoothingMs: opts.smoothingMs ?? 400,
      settleMs: opts.settleMs ?? 1000,
      posterMs: opts.posterMs ?? 38,
      posterForMs: opts.posterForMs ?? 2000,
      hitchMs: opts.hitchMs ?? 60,
    };
    this.tier = clampTier(startTier);
    this.pr = pixelRatio;
    this.devicePr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  }

  /** Where the governor is now. */
  state(): { pixelRatio: number; tier: TierIndex; avgMs: number; ups: number; pending: GovernorAction | null; posterDeclines: number; posterStopped: boolean; posterQuietUntil: number } {
    return {
      pixelRatio: this.pr,
      tier: this.tier,
      avgMs: this.haveAvg ? this.avg : 0,
      ups: this.ups,
      pending: this.pending,
      posterDeclines: this.posterDeclines,
      posterStopped: this.posterStopped,
      posterQuietUntil: Math.round(this.posterQuietUntil),
    };
  }

  /** The page (or the tuning panel's override) set the tier and pixel ratio itself: start over from there. */
  reset(tier: number, pixelRatio: number, now = 0): void {
    this.tier = clampTier(tier);
    this.pr = pixelRatio;
    this.history.length = 0;
    this.pending = null;
    this.haveAvg = false;
    this.slowSince = -1;
    this.fastSince = -1;
    this.posterSince = -1;
    this.posterAsked = false;
    this.posterQuietUntil = 0;
    this.settleUntil = now + this.o.settleMs;
  }

  /** True when nothing is left to lower: tier 3 at its lowest pixel ratio. */
  atLastStep(): boolean {
    if (this.tier < 3) return false;
    const nextPr = stepPixelRatioDown(Math.min(this.pr, this.devicePr));
    return !(nextPr < Math.min(this.pr, this.devicePr) - 1e-6 && nextPr >= PIXEL_RATIO_FLOOR[3] - 1e-6);
  }

  /**
   * One frame. `intervalMs`: time since the last frame. `moving`: the camera
   * moved this frame (rail glide or flight). `parking`: a park or click in is
   * running (nothing is applied then). Returns the action to apply now, or null.
   */
  sample(intervalMs: number, now: number, moving: boolean, parking: boolean): GovernorAction | null {
    if (moving && now >= this.settleUntil && intervalMs > 0 && intervalMs < 1000) {
      // Exponential average with a time constant in ms, so 120 Hz and 60 Hz learn alike.
      // Final pass F: a frame's value counts for at most hitchMs (its time still
      // counts in full), so a lone CPU hitch (a GC or a React render on the
      // first scroll) cannot hold the average over slowMs for slowForMs on its
      // own: a frame of 300 ms or more used to. Every threshold (slow 20,
      // urgent 33, posters 38) sits under the cap, so a GPU that is really
      // slow still steps down.
      const k = this.haveAvg ? 1 - Math.exp(-intervalMs / this.o.smoothingMs) : 1;
      this.avg += (Math.min(intervalMs, this.o.hitchMs) - this.avg) * k;
      this.haveAvg = true;
      if (this.avg > this.o.slowMs) {
        if (this.slowSince < 0) this.slowSince = now;
        this.fastSince = -1;
      } else if (this.avg < this.o.fastMs) {
        if (this.fastSince < 0) this.fastSince = now;
        this.slowSince = -1;
      } else {
        this.slowSince = -1;
        this.fastSince = -1;
      }
      // The last step: frames still over posterMs for posterForMs ask for the posters (once).
      if (!this.posterStopped && !this.posterAsked && now >= this.posterQuietUntil && this.atLastStep() && this.avg > this.o.posterMs) {
        if (this.posterSince < 0) this.posterSince = now;
        if (!this.pending && now - this.posterSince >= this.o.posterForMs) {
          this.posterAsked = true;
          this.pending = {
            pixelRatio: this.pr,
            tier: this.tier,
            tierChanged: false,
            direction: "down",
            poster: true,
            reason: `avg ${this.avg.toFixed(1)} ms at tier 3, pixel ratio ${this.pr}, for ${this.o.posterForMs / 1000} s: posters`,
          };
        }
      } else if (this.avg <= this.o.posterMs) this.posterSince = -1;
      if (!this.pending && this.slowSince >= 0 && now - this.slowSince >= this.o.slowForMs) {
        this.pending = this.proposeDown();
        this.slowSince = -1;
      } else if (!this.pending && this.fastSince >= 0 && now - this.fastSince >= this.o.fastForMs) {
        this.pending = this.proposeUp();
        this.fastSince = -1;
      }
    }
    if (!this.pending || parking) return null;
    const urgent = this.pending.direction === "down" && !this.pending.poster && this.haveAvg && this.avg > this.o.urgentMs;
    if (moving && !urgent) return null;
    const act = this.pending;
    this.pending = null;
    if (act.poster) return act;
    if (act.direction === "down") this.history.push({ pixelRatio: this.pr, tier: this.tier });
    else {
      this.history.pop();
      this.ups++;
    }
    this.pr = act.pixelRatio;
    this.tier = act.tier;
    this.haveAvg = false;
    this.settleUntil = now + this.o.settleMs;
    // Cheap laptops (adapt2): the new setting is judged on its own frames. The
    // clocks used to survive the step (they kept running while the step waited
    // for a rest), so the first frame after the settle proposed the next step
    // at once: steps came about 1 s apart, each decided on one frame interval.
    this.slowSince = -1;
    this.fastSince = -1;
    this.posterSince = -1;
    return act;
  }

  /**
   * Final pass: programmatic travel (the page's travel on load, the chip's
   * travel, a scroll jump, a park flight) sweeps the camera through places
   * whose programs and buffers are still uploading, so its frames say nothing
   * about the route (a8's park came out at tier 1 after a jump). Until `until`
   * (ms, the frame clock) no frame counts, and any slow or fast spell, and a
   * step down those frames proposed, starts over. The scene calls this on
   * every travelling frame, so the hold ends that long after the last one.
   */
  hold(until: number): void {
    if (until > this.settleUntil) this.settleUntil = until;
    this.haveAvg = false;
    this.slowSince = -1;
    this.fastSince = -1;
    this.posterSince = -1;
    if (this.pending && this.pending.direction === "down") this.pending = null;
  }

  /**
   * The page measured the governor's poster ask at rest and kept the 3D (the
   * frames were slow for another reason). Adapt3: the asks back off. The
   * governor may ask again after posterBackoffMs[n] (10 s after the first
   * decline, 60 s after the second), judged on new frames; the third decline
   * ends the asks for the session. They used to come back every 10 s for
   * ever, each with a burst at rest. Returns the quiet spell, or -1 (stopped).
   */
  posterDeclined(now: number): number {
    this.posterDeclines++;
    const quiet = this.o.posterBackoffMs[this.posterDeclines - 1];
    this.clearPosterAsk();
    if (quiet === undefined) {
      this.posterStopped = true;
      return -1;
    }
    this.posterQuietUntil = now + quiet;
    return quiet;
  }

  /** The average that asks for the posters at the last step, ms (adapt3: lower after "Try 3D anyway"). */
  setPosterMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.o.posterMs = ms;
  }

  /** No more poster asks this session (the student pressed "Keep 3D"). */
  posterStop(): void {
    this.posterStopped = true;
    this.clearPosterAsk();
  }

  /**
   * Start the asks over without counting a decline: the 3D came back ("Try 3D
   * anyway"), or the student moved before the ask could be measured.
   */
  posterRearm(now: number, quietMs = 10000): void {
    this.posterStopped = false;
    this.posterDeclines = 0;
    this.clearPosterAsk();
    this.posterQuietUntil = now + quietMs;
  }

  /** The ask postponed (the camera moved before it was measured): again after `quietMs` of new slow frames, not a decline. */
  posterPostpone(now: number, quietMs = 2000): void {
    this.clearPosterAsk();
    this.posterQuietUntil = now + quietMs;
  }

  private clearPosterAsk(): void {
    this.posterAsked = false;
    this.posterSince = -1;
    if (this.pending?.poster) this.pending = null;
  }

  private proposeDown(): GovernorAction | null {
    const floor = PIXEL_RATIO_FLOOR[this.tier];
    const nextPr = stepPixelRatioDown(Math.min(this.pr, this.devicePr));
    if (nextPr < Math.min(this.pr, this.devicePr) - 1e-6 && nextPr >= floor - 1e-6) {
      return { pixelRatio: nextPr, tier: this.tier, tierChanged: false, direction: "down", reason: `avg ${this.avg.toFixed(1)} ms: pixel ratio ${this.pr} -> ${nextPr}` };
    }
    if (this.tier < 3) {
      const tier = clampTier(this.tier + 1);
      const pr = Math.min(this.pr, TIERS[tier].pixelRatioCap);
      return { pixelRatio: pr, tier, tierChanged: true, direction: "down", reason: `avg ${this.avg.toFixed(1)} ms: tier ${this.tier} -> ${tier}` };
    }
    return null;
  }

  private proposeUp(): GovernorAction | null {
    if (this.ups >= this.o.maxUps) return null;
    const last = this.history[this.history.length - 1];
    if (!last) return null;
    return {
      pixelRatio: last.pixelRatio,
      tier: last.tier,
      tierChanged: last.tier !== this.tier,
      direction: "up",
      reason: `avg ${this.avg.toFixed(1)} ms for ${this.o.fastForMs / 1000} s: back to tier ${last.tier} at ${last.pixelRatio}`,
    };
  }
}

// ── Remembering the tier ───────────────────────────────────────────────────

const STORE_KEY = "world-v6-tier";

/** Remember the tier the session settled on. Never throws. */
export function rememberTier(tier: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, String(clampTier(tier)));
  } catch {
    /* private window, blocked storage */
  }
}

/** The tier a previous visit settled on, or null. Never throws. */
export function recallTier(): TierIndex | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(STORE_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 3 ? (n as TierIndex) : null;
  } catch {
    return null;
  }
}

/** Forget the remembered tier (the tuning panel's reset). Never throws. */
export function forgetTier(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
