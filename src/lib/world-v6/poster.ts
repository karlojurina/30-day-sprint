/**
 * v6 poster mode (cheap laptops, 2026-09-28). Pure data and logic: no three,
 * no DOM, so world-tests can load it under node.
 *
 * The posters are still renders of the opening and the eight stops, made on
 * the M2 at full quality by world-tests/v6-posters.mjs into
 * public/world-v6/posters/ (k0.webp, a1.webp .. a8.webp, manifest.json).
 * They are 16:9 at the rail's own vertical lens, so a viewport of 16:9 or
 * narrower shows exactly what the 3D shows there once the poster is fitted to
 * the viewport's height and centred (object-fit: cover): a centre crop of a
 * perspective render is the narrower render.
 *
 * They are used three ways:
 *   1. on load, the poster of the place the student lands on shows at once and
 *      the live 3D crossfades in only when it is ready and warm;
 *   2. as the whole map on a machine that cannot draw it (no WebGL, a software
 *      renderer, the load probe, or the governor's last step failing);
 *   3. forced from the tuning panel.
 */

export const POSTER_DIR = "/world-v6/posters";
export const POSTER_W = 1920;
export const POSTER_H = 1080;
/** The opening, then the eight stops in PLACES order. */
export const POSTER_IDS = ["k0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"] as const;
export type PosterId = (typeof POSTER_IDS)[number];

export const posterSrc = (id: string): string => `${POSTER_DIR}/${id}.webp`;

/** A place marker where it sat on the poster, as a share of the poster's width and height. */
export interface PosterMarker {
  id: string;
  fx: number;
  fy: number;
  visible: boolean;
  proximity: number;
}

export interface PosterEntry {
  id: PosterId;
  /** -1 for the opening, else the PLACES index of the stop. */
  stop: number;
  file: string;
  bytes: number;
  markers: PosterMarker[];
}

export interface PosterManifest {
  version: number;
  width: number;
  height: number;
  made: string;
  posters: PosterEntry[];
}

/**
 * When the poster replaces the 3D. Every number is a frame time in ms on the
 * machine itself (the decision is made on a measurement, never on the GPU's
 * name, except for software renderers, which are never worth a try).
 */
export const POSTER_RULES = {
  /** The opening at tier 3, measured by the load probe: over this, the route's worst (x 1.8) is over 50 ms. */
  probeTier3Ms: 28,
  /** The first single synced frame of the probe: over this the probe stops and the machine is poster class. */
  probeFirstFrameMs: 50,
  /**
   * A load probe that steps down predicting the route's worst over this, ms:
   * one tier lower would still miss 16.7 ms, so tier 3 is measured at once and
   * the tier (or the posters) is decided from that measurement. Walking down a
   * tier at a time left it to the governor, which could end on the posters for
   * a machine faster than one the tier 3 measurement kept in 3D (adapt2).
   */
  ladderDirectMs: 28,
  /** At the governor's last step (tier 3, lowest pixel ratio), moving frames averaging over this... */
  governorMs: 38,
  /**
   * Adapt3: the same after "Try 3D anyway", where the confirm is the load's
   * 28 ms line: moving frames averaged 1.06 to 1.08 times the tier 3 opening
   * in the adapt2 sweep, so 28 at the opening is about 30 moving. With 38 a
   * machine at 28 to 35 ms was never asked, so never offered the posters.
   */
  tryGovernorMs: 30,
  /** ...for this long. Applied when the camera rests, never mid scroll. */
  governorForMs: 2000,
  /**
   * ...and then a burst at rest, where the camera stopped, over this, ms: the
   * route's worst frame at tier 3 is over 50 ms (the load's own line, 28 x
   * 1.8, measured here instead of predicted). A slow average with a burst
   * under it (a queue, a stall, another tab) keeps the 3D.
   *
   * Adapt3: after "Try 3D anyway" the confirm uses the load's own line
   * instead, probeTier3Ms (28) on a tier 3 measurement: this visit's load
   * measurement at tier 3 when it was over it (the frames and the load agree,
   * no burst at rest), else a short burst at rest. It used to be 50 there too,
   * so a machine with a 28 to 50 ms opening at tier 3 was never offered the
   * posters and was measured at rest every 10 s.
   */
  governorConfirmMs: 50,
  /** Adapt3: the longest a measurement at rest (the governor's confirm, the rest check) may hold the page, ms. */
  restBurstMs: 120,
  /** Shader compiling still running this long after the warm up began: show the posters. */
  compileGiveUpMs: 15000,
  /**
   * The probe's first (cold) frame over its warm frame by more than this, ms:
   * programs linked or buffers uploaded inside the probe (SwiftShader moved a
   * 10 s compile there). The M2's own one-time cost is about 20 ms. A verdict
   * made then is applied but not remembered.
   */
  compileSpillMs: 250,
  /** A remembered poster verdict holds this long; after it the next visit probes again, ms (7 days). */
  verdictTtlMs: 7 * 24 * 3600 * 1000,
} as const;

/**
 * Why the posters are up. It decides the notice (posterNotice) and whether
 * "Try 3D anyway" is offered.
 *   slow      the load probe or the governor measured this machine too slow
 *   compile   shaders still compiling at the give up (not remembered)
 *   software  a software renderer (SwiftShader, llvmpipe, Microsoft Basic Render)
 *   nowebgl   no WebGL context at all
 *   forced    the tuning panel or ?poster=on (dev; no student notice)
 */
export type PosterKind = "slow" | "compile" | "software" | "nowebgl" | "forced";

/** The student-facing notice for a poster kind; null = no notice (forced: a dev tag only). */
export function posterNotice(kind: PosterKind | null | undefined): { text: string; button: string | null } | null {
  switch (kind) {
    case "slow":
    case "compile":
      return { text: "Your computer struggled with the 3D map, so you're seeing still views.", button: "Try 3D anyway" };
    case "software":
    case "nowebgl":
      return { text: "This browser can't show the 3D map. Here's the still version.", button: null };
    default:
      return null;
  }
}

/** Software renderers: no GPU, never worth building the 3D for. */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|basic render driver|\bsoftware\b/i;

export function isSoftwareRenderer(gpuName: string | null | undefined): boolean {
  return !!gpuName && SOFTWARE_GPU.test(gpuName);
}

/**
 * auto  the page decides (the default).
 * on    posters, no 3D (dev: ?poster=on).
 * off   3D, never posters (dev: ?poster=off).
 * try   the student pressed "Try 3D anyway" on a page that had no 3D to go
 *       back to (?poster=try, the reload): this visit builds the 3D and nothing
 *       at load puts the posters back; if the governor's last step still
 *       cannot hold the route (measured at rest), the posters are offered,
 *       never forced.
 */
export type PosterPreference = "auto" | "on" | "off" | "try";

/** `?poster=on|off|try` in the page's query; anything else is automatic. */
export function posterPreference(search: string | null | undefined): PosterPreference {
  const m = /[?&]poster=([a-z0-9]+)/i.exec(search || "");
  if (!m) return "auto";
  const v = m[1].toLowerCase();
  if (v === "try") return "try";
  return v === "on" || v === "1" || v === "force" ? "on" : v === "off" || v === "0" || v === "3d" ? "off" : "auto";
}

/** The offer shown when the 3D is struggling after "Try 3D anyway" (the posters are not forced then). */
export const POSTER_OFFER = {
  text: "The 3D map is struggling on this computer.",
  accept: "Switch to still views",
  decline: "Keep 3D",
} as const;

// ── Remembering a poster verdict ────────────────────────────────────────────

const STORE_KEY = "world-v6-poster";

/** A remembered verdict: why, and when it was made (epoch ms). */
export interface PosterVerdict {
  kind: PosterKind;
  reason: string;
  at: number;
}

/**
 * Remember that this machine could not hold the map (the probe or the
 * governor said so), with the time, so it expires (POSTER_RULES.verdictTtlMs).
 * null forgets it. Never throws.
 */
export function rememberPoster(verdict: { kind: PosterKind; reason: string } | null, now = Date.now()): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (verdict) localStorage.setItem(STORE_KEY, JSON.stringify({ v: 2, kind: verdict.kind, reason: verdict.reason.slice(0, 120), at: Math.round(now) }));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private window, blocked storage */
  }
}

/**
 * Whether any verdict is stored, valid or not, read without touching it
 * (scene.ts preloadModules: the scene's own recall decides and drops an
 * expired one, as before). Never throws.
 */
export function posterVerdictStored(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * What a previous visit remembered. `verdict` is null when there is none or it
 * no longer holds; `expired` says why it was dropped (older than the TTL, from
 * the future, or written before verdicts carried a date), and the entry is
 * removed so this visit probes again. Never throws.
 */
export function recallPosterVerdict(now = Date.now(), ttlMs: number = POSTER_RULES.verdictTtlMs): { verdict: PosterVerdict | null; expired: string | null } {
  try {
    if (typeof localStorage === "undefined") return { verdict: null, expired: null };
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return { verdict: null, expired: null };
    let v: { kind?: unknown; reason?: unknown; at?: unknown } | null = null;
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
    let expired: string | null = null;
    const at = v && typeof v.at === "number" && Number.isFinite(v.at) ? v.at : NaN;
    if (!v || typeof v !== "object" || !Number.isFinite(at)) expired = "no date (an older verdict)";
    else if (now - at > ttlMs) expired = `${((now - at) / 86400000).toFixed(1)} days old`;
    else if (at - now > 60000) expired = "dated in the future";
    if (expired) {
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {
        /* ignore */
      }
      return { verdict: null, expired };
    }
    const kind: PosterKind = v!.kind === "slow" || v!.kind === "compile" || v!.kind === "software" || v!.kind === "nowebgl" ? (v!.kind as PosterKind) : "slow";
    return { verdict: { kind, reason: typeof v!.reason === "string" ? v!.reason : "", at }, expired: null };
  } catch {
    return { verdict: null, expired: null };
  }
}

/** The verdict of a previous visit that still holds, or null. Never throws. */
export function recallPoster(now = Date.now()): PosterVerdict | null {
  return recallPosterVerdict(now).verdict;
}

// ── Scroll to posters ───────────────────────────────────────────────────────

export interface PosterBlend {
  /** The poster behind (index into POSTER_IDS). */
  a: number;
  /** The poster ahead; equal to `a` at a stop. */
  b: number;
  /** Weight of `b` over `a`, 0..1 (eased). */
  w: number;
  /** Raw share of the way from a to b, 0..1. */
  t: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Which two posters show at a scroll depth. `depths` are the posters' own
 * depths, ascending (the opening at 0, then the eight stops). The crossfade
 * runs over the middle of each stretch (35% to 65%), so a stop's poster holds
 * for a while either side of it.
 */
export function posterBlend(depth: number, depths: ArrayLike<number>, out: PosterBlend = { a: 0, b: 0, w: 0, t: 0 }): PosterBlend {
  const n = depths.length;
  if (n === 0) {
    out.a = out.b = 0;
    out.w = out.t = 0;
    return out;
  }
  if (depth <= depths[0]) {
    out.a = out.b = 0;
    out.w = out.t = 0;
    return out;
  }
  for (let i = 0; i < n - 1; i++) {
    const d0 = depths[i];
    const d1 = depths[i + 1];
    if (depth <= d1) {
      const t = clamp01((depth - d0) / Math.max(1e-6, d1 - d0));
      out.a = i;
      out.b = i + 1;
      out.t = t;
      out.w = smooth(0.35, 0.65, t);
      return out;
    }
  }
  out.a = out.b = n - 1;
  out.w = out.t = 0;
  return out;
}

/** Scale of the leaving poster (drifts forward as it fades) and of the arriving one (settles to 1). */
export function driftScale(role: "leaving" | "arriving", t: number): number {
  return role === "leaving" ? 1 + 0.07 * clamp01(t) : 1 + 0.035 * (1 - clamp01(t));
}

/** object-fit: cover of a poster in a viewport: its scale and top left, in CSS px. */
export function coverFit(vw: number, vh: number, pw = POSTER_W, ph = POSTER_H): { scale: number; ox: number; oy: number } {
  const scale = Math.max(vw / pw, vh / ph);
  return { scale, ox: (vw - pw * scale) / 2, oy: (vh - ph * scale) / 2 };
}

/**
 * The poster nearest a depth, for the first paint before the scene exists:
 * the opening until halfway to the first stop, then the nearest stop.
 */
export function landingPoster(depth: number, stopDepths: ArrayLike<number>): number {
  const all = [0];
  for (let i = 0; i < stopDepths.length; i++) all.push(stopDepths[i]);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < all.length; i++) {
    const d = Math.abs(all[i] - depth);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
