"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { AreaAnchor, ProjectedMarker, WorldFrame, WorldScene, WorldSceneOptions } from "@/lib/world-v3/scene";
import {
  STUDY_AREAS,
  CURRENT_AREA,
  NEXT_LESSON,
  TOTAL_LESSONS,
  DONE_LESSONS,
  areaState,
  pad2,
} from "@/lib/world-v3/study";
import { LabelLayout, HIDDEN, TEXT } from "./labels";
import s from "./world.module.css";

/**
 * /dev/world-v3 interface.
 *
 * FRAME LOOP. The scene calls onFrame once per rendered frame, outside React.
 * Everything that moves every frame (markers, the park choreography, the dock
 * caret, the scroll cue) is written straight to the DOM through refs, as
 * transform and opacity only. No React state per frame, no left/top, and no
 * layout reads inside the callback: label sizes, reserved rects and the track
 * width are measured on resize and cached.
 *
 * THE CHECKPOINT ZOOM. Clicking a place calls scene.park(id): the SAME main
 * camera flies in to that place. The panel is not animated by CSS; it reads
 * frame.parkProgress, the value driving the camera, so the panel and the
 * camera arrive together and leave together. Scroll is locked while parked and
 * the exact scrollY is put back once the camera is home.
 *
 * NO PROVIDERS. Fixture data only (study.ts). StudentProvider POSTs on mount.
 *
 * PITCH. ?pitch=low asks the scene for V2's 5-7 degree camera instead of V3's
 * game pitch (8 -> 16), so Lovro can compare the two. It is read once and
 * handed to the scene's constructor. The dev footer's toggle is a real page
 * load, and it carries the rail depth across it so both pitches show the same
 * place.
 */

const PRIMARY_GLB = "/world-v3/world.glb";
const FALLBACK_GLB = "/world/world.glb";
const DRACO_PATH = "/world-v3/draco/";
const MAX_DEPTH = 0.88;
const N = STUDY_AREAS.length;
const NARROW_QUERY = "(width < 760px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const MODE_NAMES = ["hidden", "dot", "text"] as const;

const ANCHORS: AreaAnchor[] = STUDY_AREAS.map((a) => ({ id: a.id, depth: a.depth, landmark: a.mesh }));

function slotOf(id: string): number {
  for (let k = 0; k < N; k++) if (STUDY_AREAS[k].id === id) return k;
  return -1;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Where the dock caret sits, 0..1 along the track. Stops sit at (k + 0.5) / N,
 * so depth 0 is the track's start, each area's depth lands exactly on its
 * stop, and the end of the rail is the track's end.
 */
function caretFraction(depth: number, depths: Float64Array): number {
  const d0 = depths[0];
  if (depth <= d0) return (clamp01(depth / d0) * 0.5) / N;
  for (let k = 0; k < N - 1; k++) {
    const a = depths[k];
    const b = depths[k + 1];
    if (depth <= b) return (k + 0.5 + (depth - a) / Math.max(1e-6, b - a)) / N;
  }
  const last = depths[N - 1];
  return (N - 0.5 + 0.5 * clamp01((depth - last) / Math.max(1e-6, MAX_DEPTH - last))) / N;
}

function subscribeQuery(query: string) {
  return (notify: () => void) => {
    const m = matchMedia(query);
    m.addEventListener("change", notify);
    return () => m.removeEventListener("change", notify);
  };
}
const subscribeNarrow = subscribeQuery(NARROW_QUERY);
const getNarrow = () => matchMedia(NARROW_QUERY).matches;
const subscribeReduced = subscribeQuery(REDUCED_QUERY);
const getReduced = () => matchMedia(REDUCED_QUERY).matches;
const getUnknown = () => null;
const getFalse = () => false;

/** The scene's names: "v3" is the game pitch the footer calls Game, "low" is V2's. */
type PitchMode = NonNullable<WorldSceneOptions["pitch"]>;
const readPitch = (): PitchMode =>
  new URLSearchParams(window.location.search).get("pitch") === "low" ? "low" : "v3";
const getGamePitch = (): PitchMode => "v3";
const subscribeNever = () => () => {};
/** sessionStorage key: the rail depth to reopen at after the pitch toggle's page load. */
const CARRY_KEY = "world-v3:carry-depth";

function takeCarriedDepth(): number | null {
  try {
    const v = sessionStorage.getItem(CARRY_KEY);
    if (v === null) return null;
    sessionStorage.removeItem(CARRY_KEY);
    const d = Number(v);
    return Number.isFinite(d) && d >= 0 && d <= MAX_DEPTH ? d : null;
  } catch {
    return null;
  }
}

/**
 * Where a dock tag sits against its stop. The two end stops hang their tag
 * inward so it never leaves the dock; every other stop centres it.
 */
function alignOf(k: number): "start" | "center" | "end" {
  return k === 0 ? "start" : k === N - 1 ? "end" : "center";
}
const stopLeft = (k: number) => `${((k + 0.5) / N) * 100}%`;

interface LabelBox {
  id: string;
  name: string;
  current: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Test hooks, same names as /dev/world so world-tests drive both routes. */
interface Harness {
  __worldReady?: boolean;
  __worldError?: string;
  __worldAsset?: string;
  /** The pitch handed to the scene: "v3" (the game pitch) or "low" (?pitch=low). */
  __worldPitch?: PitchMode;
  __worldView?: string;
  __worldLandmarks?: string[];
  __worldHide?: (prefix: string) => number;
  __worldNames?: () => string[];
  __worldScrollFor?: (depth: number) => number;
  __worldPark?: (id: string | null) => void;
  __worldCamera?: () => ReturnType<WorldScene["cameraPose"]> | null;
  __worldLabelBoxes?: () => LabelBox[];
  __worldParkInfo?: () => ReturnType<WorldScene["parkInfo"]> | null;
}
const GETTER_HOOKS = ["__worldDepth", "__worldMarkers", "__worldFrame", "__worldFrameCount"] as const;
const PLAIN_HOOKS = [
  "__worldReady",
  "__worldAsset",
  "__worldPitch",
  "__worldLandmarks",
  "__worldHide",
  "__worldNames",
  "__worldScrollFor",
  "__worldPark",
  "__worldCamera",
  "__worldLabelBoxes",
  "__worldParkInfo",
] as const;

function copyMarkers(ms: readonly ProjectedMarker[] | undefined) {
  return (ms ?? []).map((m) => ({ id: m.id, x: m.x, y: m.y, visible: m.visible, proximity: m.proximity }));
}

type View = "unknown" | "world" | "list";
type Phase = "loading" | "ready" | "failed";
type Dir = "none" | "fwd" | "back";

export function WorldV3() {
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, getUnknown);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getFalse);
  const pitch = useSyncExternalStore(subscribeNever, readPitch, getGamePitch);
  const [phase, setPhase] = useState<Phase>("loading");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [dir, setDir] = useState<Dir>("none");
  const [closing, setClosing] = useState(false);
  const [region, setRegion] = useState(0);
  const [hoverStop, setHoverStop] = useState<number | null>(null);

  const view: View = narrow === null ? "unknown" : narrow || phase === "failed" ? "list" : "world";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const layoutRef = useRef<LabelLayout | null>(null);
  const lastFrame = useRef<WorldFrame | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const markersRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLSpanElement | null>(null);
  const cueRef = useRef<HTMLDivElement | null>(null);
  const shadeRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelInnerRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const lessonHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const markerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const stopRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const numRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const depthsRef = useRef<Float64Array>(Float64Array.from(STUDY_AREAS.map((a) => a.depth)));
  /** Viewport and track sizes the frame loop reads. Written only by the measure effect. */
  const sizesRef = useRef({ w: 0, h: 0, trackW: 0 });
  const applyRef = useRef<((f: WorldFrame) => void) | null>(null);

  /** Mirror of the interaction state for code that runs outside React. */
  const ui = useRef({
    open: -1,
    closing: false,
    lesson: -1,
    lessonReturn: -1,
    reduced: false,
    live: false,
    locked: false,
    savedY: 0,
    /** Rail depth and scroll range at lock time: a resize while parked changes what savedY means. */
    savedDepth: -1,
    savedMax: -1,
    prevOverflow: "",
    trigger: null as HTMLElement | null,
    focusLesson: -1,
    pendingFocus: false,
    returnFocus: -1,
    closeTimer: 0,
    frames: 0,
    tween: 0,
    stopTween: null as (() => void) | null,
    region: 0,
  });

  useEffect(() => {
    ui.current.reduced = reduced;
  }, [reduced]);

  // ── Scroll lock. Saves the exact scrollY AND the rail depth it meant; unlock
  // puts the scroll back on that depth. The spacer is 640vh, so after a resize
  // the same pixel scrollY is another place (a laptop-sized window came home
  // at Video Ads II instead of Video Ads I).
  const lock = useCallback(() => {
    const u = ui.current;
    if (u.locked) return;
    u.savedY = window.scrollY;
    const scene = sceneRef.current;
    u.savedDepth = scene ? scene.scrollDepth() : -1;
    u.savedMax = document.documentElement.scrollHeight - window.innerHeight;
    u.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    u.locked = true;
  }, []);
  /** Scroll back to where the lock was taken: the same px if nothing was resized, else the same depth. */
  const restoreScroll = useCallback(() => {
    const u = ui.current;
    const scene = sceneRef.current;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const top = scene && u.savedDepth >= 0 && Math.abs(max - u.savedMax) > 0.5 ? Math.round(scene.scrollYForDepth(u.savedDepth)) : u.savedY;
    if (Math.abs(window.scrollY - top) >= 1) window.scrollTo({ top, left: 0, behavior: "instant" });
  }, []);
  const unlock = useCallback(() => {
    const u = ui.current;
    if (!u.locked) return;
    document.body.style.overflow = u.prevOverflow;
    u.locked = false;
    restoreScroll();
  }, [restoreScroll]);

  const cancelTween = useCallback(() => {
    const u = ui.current;
    if (u.tween) cancelAnimationFrame(u.tween);
    u.tween = 0;
    if (u.stopTween) {
      const stop = u.stopTween;
      u.stopTween = null;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("pointerdown", stop);
    }
  }, []);

  // ── Park / unpark.
  const openArea = useCallback(
    (idx: number, trigger: HTMLElement | null, focusLesson = -1) => {
      const u = ui.current;
      if (idx < 0 || idx >= N) return;
      if (u.open === idx && !u.closing) return;
      cancelTween();
      window.clearInterval(u.closeTimer);
      if (u.open === -1) {
        lock();
        u.trigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }
      u.open = idx;
      u.closing = false;
      u.lesson = -1;
      u.lessonReturn = -1;
      u.focusLesson = focusLesson;
      u.pendingFocus = true;
      setOpenIdx(idx);
      setLesson(null);
      setDir("none");
      setClosing(false);
      sceneRef.current?.park(STUDY_AREAS[idx].id);
    },
    [cancelTween, lock],
  );

  const finalizeClose = useCallback(() => {
    const u = ui.current;
    if (u.open === -1) return;
    window.clearInterval(u.closeTimer);
    u.returnFocus = u.open;
    u.open = -1;
    u.closing = false;
    u.lesson = -1;
    unlock();
    setOpenIdx(null);
    setLesson(null);
    setClosing(false);
    setDir("none");
  }, [unlock]);

  const closeArea = useCallback(() => {
    const u = ui.current;
    if (u.open === -1 || u.closing) return;
    u.closing = true;
    setClosing(true);
    const scene = sceneRef.current;
    // The camera flies home to the depth the page scroll says, so the scroll
    // goes back on the saved depth first (it is still locked while flying).
    if (u.locked) restoreScroll();
    scene?.park(null);
    // The camera never left (list view, reduced motion, or closed before the
    // first flight frame), or no frame will come (WebGL context lost):
    // nothing to wait for.
    const f = lastFrame.current;
    if (!scene || !u.live || u.reduced || !f || f.parkProgress <= 0.001 || scene.isContextLost()) {
      finalizeClose();
      return;
    }
    // Normally the frame loop finalizes when parkProgress reaches 0. This
    // watchdog only fires when frames have stopped for good (a lost WebGL
    // context): 10 visible seconds without one. A hidden tab does not count,
    // its frames resume on return and finish the flight, and a slow machine's
    // frames still count as frames, so it gets the whole flight back.
    let seen = u.frames;
    let stalls = 0;
    window.clearInterval(u.closeTimer);
    u.closeTimer = window.setInterval(() => {
      if (u.frames !== seen || document.hidden) {
        seen = u.frames;
        stalls = 0;
      } else if (++stalls >= 10) {
        finalizeClose();
      }
    }, 1000);
  }, [finalizeClose, restoreScroll]);

  const openLesson = useCallback((i: number) => {
    const u = ui.current;
    u.lesson = i;
    u.lessonReturn = -1;
    setDir("fwd");
    setLesson(i);
  }, []);

  const backToArea = useCallback(() => {
    const u = ui.current;
    u.lessonReturn = u.lesson;
    u.lesson = -1;
    setDir("back");
    setLesson(null);
  }, []);

  // ── Dock travel: tween the page scroll, the camera glides after it.
  const travel = useCallback(
    (idx: number) => {
      const scene = sceneRef.current;
      const u = ui.current;
      if (!scene || !u.live || u.open !== -1) return;
      const depth = scene.depthFor(STUDY_AREAS[idx].id);
      const to = Math.round(scene.scrollYForDepth(depth));
      cancelTween();
      const from = window.scrollY;
      if (u.reduced || Math.abs(to - from) < 2) {
        window.scrollTo({ top: to, left: 0, behavior: "instant" });
        return;
      }
      const at = lastFrame.current?.depth ?? depth;
      const duration = Math.min(2200, 700 + Math.abs(depth - at) * 2000);
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        window.scrollTo({ top: from + (to - from) * easeInOutCubic(t), left: 0, behavior: "instant" });
        if (t < 1) u.tween = requestAnimationFrame(step);
        else cancelTween();
      };
      // Any real input takes the scroll back.
      const stop = () => cancelTween();
      u.stopTween = stop;
      window.addEventListener("wheel", stop, { passive: true });
      window.addEventListener("touchstart", stop, { passive: true });
      window.addEventListener("keydown", stop);
      window.addEventListener("pointerdown", stop);
      u.tween = requestAnimationFrame(step);
    },
    [cancelTween],
  );

  // ── The scene. Created only on the world view, so phones never load three.js.
  useEffect(() => {
    if (view !== "world") return;
    const stage = stageRef.current;
    if (!stage) return;
    const u = ui.current;
    const w = window as unknown as Harness & Record<string, unknown>;
    const layout = layoutRef.current ?? (layoutRef.current = new LabelLayout(N));
    const depths = depthsRef.current;
    const sizes = sizesRef.current;
    const bySlot: Array<ProjectedMarker | null> = new Array(N).fill(null);
    const domMode = new Uint8Array(N).fill(255);
    const domStem = new Float32Array(N).fill(-1);
    const domX = new Int32Array(N).fill(-99999);
    const domY = new Int32Array(N).fill(-99999);
    const cache = {
      p: -1,
      markersA: -1,
      markersLive: true,
      panelEl: null as HTMLElement | null,
      panelP: -1,
      caretX: -1,
      cue: -1,
      cueOff: false,
    };
    let disposed = false;
    let scene: WorldScene | null = null;
    w.__worldView = "world";

    const onFrame = (f: WorldFrame) => {
      lastFrame.current = f;
      u.frames++;
      if (u.closing && f.parkedId === null && (u.reduced || f.parkProgress <= 1e-4)) finalizeClose();
      apply(f);
    };

    /** Every per-frame DOM write. Also run once after a measure, because the scene sleeps when idle. */
    const apply = (f: WorldFrame) => {
      const p = u.reduced ? (u.open >= 0 && !u.closing ? 1 : 0) : clamp01(f.parkProgress);
      const chrome = 1 - smooth(0, 0.5, p);
      const markersA = 1 - smooth(0, 0.3, p);

      if (p !== cache.p) {
        cache.p = p;
        const lift = `translate3d(0, ${(p * 14).toFixed(2)}px, 0)`;
        const a = chrome.toFixed(3);
        const next = nextRef.current;
        if (next) {
          next.style.opacity = a;
          next.style.transform = lift;
        }
        const dock = dockRef.current;
        if (dock) {
          dock.style.opacity = a;
          dock.style.transform = lift;
        }
        shadeRef.current?.style.setProperty("--shade-bottom", a);
        const markers = markersRef.current;
        if (markers) {
          markers.style.opacity = markersA.toFixed(3);
          const live = p < 0.02;
          if (live !== cache.markersLive) {
            cache.markersLive = live;
            markers.style.pointerEvents = live ? "" : "none";
          }
        }
      }

      // Panel rides the same progress value as the camera.
      const panel = panelRef.current;
      if (panel && (panel !== cache.panelEl || p !== cache.panelP)) {
        cache.panelEl = panel;
        cache.panelP = p;
        panel.style.transform = `translate3d(calc(${(p - 1).toFixed(4)} * (100% + 220px)), 0, 0)`;
        panel.style.opacity = clamp01(p * 2.5).toFixed(3);
        const inner = panelInnerRef.current;
        if (inner) {
          const c = smooth(0.35, 1, p);
          inner.style.opacity = c.toFixed(3);
          inner.style.transform = `translate3d(${((1 - c) * -20).toFixed(2)}px, 0, 0)`;
        }
      } else if (!panel) {
        cache.panelEl = null;
      }

      // Markers: skipped entirely while they are faded out.
      if (markersA > 0.001 && f.markers) {
        bySlot.fill(null);
        const ms = f.markers;
        for (let i = 0; i < ms.length; i++) {
          const k = slotOf(ms[i].id);
          if (k >= 0) bySlot[k] = ms[i];
        }
        layout.run(bySlot, CURRENT_AREA, sizes.w, sizes.h);
        for (let k = 0; k < N; k++) {
          const el = markerRefs.current[k];
          if (!el) continue;
          const mode = layout.mode[k];
          if (mode !== domMode[k]) {
            domMode[k] = mode;
            el.dataset.mode = MODE_NAMES[mode];
            el.tabIndex = mode === HIDDEN ? -1 : 0;
            if (mode === HIDDEN) el.setAttribute("aria-hidden", "true");
            else el.removeAttribute("aria-hidden");
          }
          const stem = mode === TEXT ? layout.stem[k] : 0;
          if (stem !== domStem[k]) {
            domStem[k] = stem;
            if (stem > 0) el.style.setProperty("--stem", `${24 + stem}px`);
            else el.style.removeProperty("--stem");
          }
          const mk = bySlot[k];
          if (mode !== HIDDEN && mk) {
            const x = Math.round(mk.x);
            const y = Math.round(mk.y);
            if (x !== domX[k] || y !== domY[k]) {
              domX[k] = x;
              domY[k] = y;
              el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
          }
        }
      }

      // Where on the rail we are: the dock's current stop and its caret.
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < N; k++) {
        const d = Math.abs(depths[k] - f.depth);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best !== u.region) {
        u.region = best;
        setRegion(best);
      }
      const caret = caretRef.current;
      if (caret) {
        const cx = caretFraction(f.depth, depths) * sizes.trackW;
        if (Math.abs(cx - cache.caretX) > 0.2) {
          cache.caretX = cx;
          caret.style.transform = `translate3d(${cx.toFixed(1)}px, 0, 0)`;
        }
      }
      const cue = cueRef.current;
      if (cue) {
        const a = (1 - smooth(0.004, 0.03, f.depth)) * chrome;
        if (Math.abs(a - cache.cue) > 0.004 || (a === 0 && cache.cue !== 0)) {
          cache.cue = a;
          cue.style.opacity = a.toFixed(3);
        }
        const off = a <= 0.001;
        if (off !== cache.cueOff) {
          cache.cueOff = off;
          if (off) cue.dataset.off = "";
          else delete cue.dataset.off;
        }
      }
    };

    applyRef.current = apply;

    const fail = (e: unknown) => {
      if (disposed) return;
      w.__worldError = String(e);
      console.error("[world-v3]", e);
      setPhase("failed");
    };

    // Start the world's bytes now, in parallel with the scene chunk: the glb
    // request used to begin 0.65-1.7 s after navigation, once the chunk ran.
    // World view only, so phones on the list view never download it.
    const preloads = [PRIMARY_GLB, `${DRACO_PATH}draco_wasm_wrapper.js`, `${DRACO_PATH}draco_decoder.wasm`].map((href) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "fetch";
      link.crossOrigin = "anonymous";
      link.href = href;
      document.head.appendChild(link);
      return link;
    });

    (async () => {
      let mod: typeof import("@/lib/world-v3/scene");
      try {
        mod = await import("@/lib/world-v3/scene");
      } catch (e) {
        fail(e);
        return;
      }
      if (disposed) return;
      // Back from the pitch toggle's page load: put the scroll on the depth it
      // left from BEFORE the scene exists, since the scene reads its starting
      // depth off the page scroll when it is made.
      const carried = u.open < 0 ? takeCarriedDepth() : null;
      if (carried !== null) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0) window.scrollTo({ top: Math.round((carried / MAX_DEPTH) * max), left: 0, behavior: "instant" });
      }
      const pitchMode = readPitch();
      try {
        scene = new mod.WorldScene(stage, { pitch: pitchMode });
      } catch (e) {
        fail(e);
        return;
      }
      const sc = scene;
      sceneRef.current = sc;
      // A scene made while a place is open (back from the list view): the page
      // is locked and its scroll may have been clamped, so the rail starts at
      // the depth saved when the place was opened.
      if (u.open >= 0 && u.savedDepth >= 0) sc.seedDepth(u.savedDepth);
      sc.setAnchors(ANCHORS);
      sc.onFrame(onFrame);
      sc.setPaused(document.hidden);
      sc.start();

      const loadOpts = { dracoPath: DRACO_PATH };
      let asset = PRIMARY_GLB;
      try {
        await sc.load(PRIMARY_GLB, loadOpts);
      } catch (first) {
        if (disposed) return;
        console.warn(`[world-v3] ${PRIMARY_GLB} did not load, falling back to ${FALLBACK_GLB}`, first);
        asset = FALLBACK_GLB;
        try {
          await sc.load(FALLBACK_GLB, loadOpts);
        } catch (second) {
          fail(second);
          return;
        }
      }
      if (disposed) return;

      for (let k = 0; k < N; k++) {
        const d = sc.depthFor(STUDY_AREAS[k].id);
        if (Number.isFinite(d)) depths[k] = d;
      }
      u.live = true;
      // A new scene while an area is open (a resize back from the list view,
      // or a hot reload): put the camera where the interface says it is.
      if (u.open >= 0) {
        if (u.closing) finalizeClose();
        else sc.park(STUDY_AREAS[u.open].id);
      }

      Object.defineProperty(w, "__worldDepth", { configurable: true, get: () => lastFrame.current?.depth });
      Object.defineProperty(w, "__worldFrameCount", { configurable: true, get: () => u.frames });
      Object.defineProperty(w, "__worldMarkers", {
        configurable: true,
        get: () => copyMarkers(lastFrame.current?.markers),
      });
      Object.defineProperty(w, "__worldFrame", {
        configurable: true,
        get: () => {
          const f = lastFrame.current;
          if (!f) return null;
          return {
            depth: f.depth,
            parkedId: f.parkedId,
            parkProgress: f.parkProgress,
            flight: f.flight,
            triangles: f.triangles,
            calls: f.calls,
            markers: copyMarkers(f.markers),
          };
        },
      });
      w.__worldHide = (prefix: string) => {
        let n = 0;
        sc.debugScene()?.traverse((o) => {
          if (o.name.startsWith(prefix) && o.visible) {
            o.visible = false;
            n++;
          }
        });
        // The scene sleeps when idle; setPaused(false) is its wake call, so the hide renders now.
        sc.setPaused(document.hidden);
        return n;
      };
      w.__worldNames = () => {
        const names = new Set<string>();
        sc.debugScene()?.traverse((o) => {
          if (o.name) names.add(o.name.replace(/[._]\d+$/, ""));
        });
        return [...names].sort();
      };
      w.__worldScrollFor = (d: number) => sc.scrollYForDepth(d);
      w.__worldPark = (id: string | null) => {
        if (id === null) closeArea();
        else openArea(slotOf(id), null);
      };
      w.__worldCamera = () => sc.cameraPose();
      w.__worldParkInfo = () => sc.parkInfo();
      w.__worldLabelBoxes = () => {
        const out: LabelBox[] = [];
        if (Number(markersRef.current?.style.opacity || "1") < 0.05) return out;
        for (let k = 0; k < N; k++) {
          const el = markerRefs.current[k];
          const label = labelRefs.current[k];
          if (!el || !label || el.dataset.mode !== "text") continue;
          const r = label.getBoundingClientRect();
          out.push({
            id: STUDY_AREAS[k].id,
            name: STUDY_AREAS[k].name,
            current: k === CURRENT_AREA,
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          });
        }
        return out;
      };
      w.__worldAsset = asset;
      w.__worldPitch = pitchMode;
      w.__worldLandmarks = sc.landmarkNames();
      w.__worldReady = true;
      setPhase("ready");
    })();

    return () => {
      disposed = true;
      u.live = false;
      for (const link of preloads) link.remove();
      for (const k of GETTER_HOOKS) delete w[k];
      for (const k of PLAIN_HOOKS) delete w[k];
      if (scene) {
        scene.onFrame(null);
        scene.dispose();
      }
      sceneRef.current = null;
      lastFrame.current = null;
      applyRef.current = null;
    };
  }, [view, openArea, closeArea, finalizeClose]);

  useEffect(() => {
    if (view === "list") (window as unknown as Harness).__worldView = "list";
  }, [view]);

  // ── Pause when the tab is hidden: a background rAF loop still burns battery.
  useEffect(() => {
    if (view !== "world") return;
    const onVisibility = () => sceneRef.current?.setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [view]);

  // ── The dock names the next stop under its dot. On a narrow dock a long name
  // ("Creative Strategy") runs over its neighbours' numbers, so any number the
  // name's box touches steps aside. Layout reads, so only on a region change
  // or a resize, never per frame.
  const fitDock = useCallback(() => {
    const nums = numRefs.current;
    let l = 0;
    let r = 0;
    let named = false;
    for (let k = 0; k < N; k++) {
      const el = nums[k];
      if (!el || el.dataset.name === undefined) continue;
      const b = el.getBoundingClientRect();
      l = b.left;
      r = b.right;
      named = true;
    }
    for (let k = 0; k < N; k++) {
      const el = nums[k];
      if (!el || el.dataset.name !== undefined) continue;
      let covered = false;
      if (named) {
        const b = el.getBoundingClientRect();
        covered = b.right + 6 > l && b.left - 6 < r;
      }
      if (covered) el.dataset.covered = "";
      else delete el.dataset.covered;
    }
  }, []);

  useLayoutEffect(() => {
    if (view === "world") fitDock();
  }, [view, region, fitDock]);

  // ── Measure once and on resize, never inside the frame loop.
  useEffect(() => {
    if (view !== "world" || phase !== "ready") return;
    const measure = () => {
      fitDock();
      const layout = layoutRef.current;
      const stage = stageRef.current;
      const sizes = sizesRef.current;
      if (!layout || !stage) return;
      sizes.w = stage.clientWidth;
      sizes.h = stage.clientHeight;
      for (let k = 0; k < N; k++) {
        const label = labelRefs.current[k];
        if (!label) continue;
        layout.width[k] = label.offsetWidth;
        layout.height[k] = label.offsetHeight;
      }
      layout.clearReserved();
      for (const el of [headerRef.current, nextRef.current, dockRef.current, footerRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        layout.addReserved(r.left - 8, r.top - 8, r.right + 8, r.bottom + 8);
      }
      sizes.trackW = trackRef.current?.clientWidth ?? 0;
      const f = lastFrame.current;
      if (f) applyRef.current?.(f);
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    window.addEventListener("resize", measure);
    return () => {
      alive = false;
      window.removeEventListener("resize", measure);
    };
  }, [view, phase, fitDock]);

  // ── Focus: into the panel on open, back to the trigger once the camera is home.
  useEffect(() => {
    const u = ui.current;
    if (openIdx !== null) {
      if (!u.pendingFocus) return;
      u.pendingFocus = false;
      const target = u.focusLesson >= 0 ? rowRefs.current[u.focusLesson] : headingRef.current;
      target?.focus({ preventScroll: true });
      return;
    }
    if (u.returnFocus < 0) return;
    const idx = u.returnFocus;
    u.returnFocus = -1;
    let target = u.trigger;
    u.trigger = null;
    if (target && (!target.isConnected || target.dataset.mode === "hidden")) target = null;
    target = target ?? stopRefs.current[idx] ?? listRowRefs.current[idx] ?? null;
    target?.focus({ preventScroll: true });
  }, [openIdx]);

  // The view switched (world <-> list) with a place open: the panel moved into
  // the sheet or back, and focus was left on <body>.
  const prevView = useRef<View>(view);
  useEffect(() => {
    const was = prevView.current;
    prevView.current = view;
    if (was === view || was === "unknown" || ui.current.open < 0) return;
    (lessonHeadingRef.current ?? headingRef.current)?.focus({ preventScroll: true });
  }, [view]);

  useEffect(() => {
    if (openIdx === null) return;
    const u = ui.current;
    if (lesson !== null) {
      lessonHeadingRef.current?.focus({ preventScroll: true });
    } else if (u.lessonReturn >= 0) {
      rowRefs.current[u.lessonReturn]?.focus({ preventScroll: true });
      u.lessonReturn = -1;
    }
  }, [lesson, openIdx]);

  // ── Escape backs out one level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const u = ui.current;
      if (u.open === -1 || u.closing) return;
      e.preventDefault();
      if (u.lesson >= 0) backToArea();
      else closeArea();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backToArea, closeArea]);

  // ── Never leave the page scroll-locked behind us.
  useEffect(() => {
    const u = ui.current;
    return () => {
      cancelTween();
      window.clearInterval(u.closeTimer);
      if (u.locked) {
        document.body.style.overflow = u.prevOverflow;
        u.locked = false;
      }
    };
  }, [cancelTween]);

  const isOpen = openIdx !== null;
  /** A stop other than the one the camera is at, hovered or focused: its name shows above it. */
  const peek = hoverStop !== null && hoverStop !== region ? hoverStop : null;
  const nextStop = region + 1 < N ? region + 1 : -1;

  /** The pitch toggle is a real page load; the depth comes along through sessionStorage. */
  const carryDepth = () => {
    const scene = sceneRef.current;
    const d = scene && ui.current.live ? scene.scrollDepth() : null;
    if (d === null) return;
    try {
      sessionStorage.setItem(CARRY_KEY, d.toFixed(5));
    } catch {
      /* private window: the new page just opens at the shore */
    }
  };
  // The loading cover sits over the world view but is not a wall to the
  // keyboard: Tab reached Continue under it and Enter opened a place unseen.
  const loading = view === "world" && phase === "loading";

  const panelBody =
    openIdx === null ? null : (
      <PanelBody
        idx={openIdx}
        backLabel={view === "list" ? "All areas" : "Map"}
        lesson={lesson}
        dir={dir}
        onBack={closeArea}
        onOpenLesson={openLesson}
        onBackToArea={backToArea}
        headingRef={headingRef}
        lessonHeadingRef={lessonHeadingRef}
        rowRefs={rowRefs}
      />
    );

  return (
    <main className={s.root} data-view={view} data-open={isOpen || undefined}>
      <h1 className={s.srOnly}>Course map</h1>

      {view === "world" && (
        <>
          <div ref={stageRef} className={s.stage} aria-hidden="true" />
          <div className={s.spacer} aria-hidden="true" />
          <div ref={shadeRef} className={s.shade} aria-hidden="true" />

          <section ref={nextRef} className={s.next} aria-label="Next lesson" inert={isOpen || loading}>
            <NextBlock onContinue={(el) => openArea(CURRENT_AREA, el, NEXT_LESSON)} />
          </section>

          <div ref={markersRef} className={s.markers} inert={isOpen || loading}>
            {STUDY_AREAS.map((a, k) => (
              <button
                key={a.id}
                ref={(el) => {
                  markerRefs.current[k] = el;
                }}
                type="button"
                className={s.marker}
                data-mode="hidden"
                data-state={areaState(k)}
                tabIndex={-1}
                aria-label={`${a.name}, ${a.done} of ${a.lessons} lessons done`}
                onClick={(e) => openArea(k, e.currentTarget)}
              >
                <span className={s.pin} aria-hidden="true" />
                <span className={s.stem} aria-hidden="true" />
                <span
                  ref={(el) => {
                    labelRefs.current[k] = el;
                  }}
                  className={s.label}
                  aria-hidden="true"
                >
                  {a.name}
                </span>
              </button>
            ))}
          </div>

          <div ref={cueRef} className={s.cue} aria-hidden="true">
            <span>Scroll</span>
            <i className={s.cueLine} />
          </div>

          <nav ref={dockRef} className={s.dock} aria-label="Areas" inert={isOpen || loading}>
            {/* Above the track: the stop the camera is at, as a tag you click to
                go in, or the name of the stop under the pointer or focus. */}
            <div className={s.dockHead}>
              <button
                type="button"
                className={`${s.tag} ${s.here}`}
                data-align={alignOf(region)}
                data-hidden={peek !== null || undefined}
                style={{ left: stopLeft(region) }}
                aria-label={`Enter ${STUDY_AREAS[region].name}`}
                onClick={(e) => openArea(region, e.currentTarget)}
              >
                <span key={region} className={s.tagIn}>
                  {STUDY_AREAS[region].name}
                  <Arrow />
                </span>
              </button>
              {peek !== null && (
                <span
                  className={`${s.tag} ${s.peek}`}
                  data-align={alignOf(peek)}
                  style={{ left: stopLeft(peek) }}
                  aria-hidden="true"
                >
                  <span key={peek} className={s.tagIn}>
                    {STUDY_AREAS[peek].name}
                  </span>
                </span>
              )}
            </div>
            <div ref={trackRef} className={s.track}>
              <span className={s.trackLine} aria-hidden="true" />
              <span
                className={s.trackDone}
                aria-hidden="true"
                style={{ width: `${((CURRENT_AREA + 0.5) / N) * 100}%` }}
              />
              <span ref={caretRef} className={s.caret} aria-hidden="true" />
              {STUDY_AREAS.map((a, k) => (
                <button
                  key={a.id}
                  ref={(el) => {
                    stopRefs.current[k] = el;
                  }}
                  type="button"
                  className={s.stop}
                  data-state={areaState(k)}
                  style={{ left: `${((k + 0.5) / N) * 100}%` }}
                  aria-label={`Travel to ${a.name}`}
                  aria-current={region === k ? "location" : undefined}
                  onClick={() => travel(k)}
                  onPointerEnter={() => setHoverStop(k)}
                  onPointerLeave={() => setHoverStop(null)}
                  onFocus={() => setHoverStop(k)}
                  onBlur={() => setHoverStop(null)}
                >
                  <span className={s.stopDot} aria-hidden="true" />
                  <span
                    ref={(el) => {
                      numRefs.current[k] = el;
                    }}
                    className={s.stopNum}
                    data-name={k === nextStop || undefined}
                    data-align={k === nextStop ? alignOf(k) : undefined}
                    aria-hidden="true"
                  >
                    {k === nextStop ? a.name : pad2(k + 1)}
                  </span>
                </button>
              ))}
            </div>
          </nav>

          {isOpen && (
            <section
              ref={panelRef}
              className={s.panel}
              aria-labelledby="v2-panel-title"
              inert={closing}
            >
              <div ref={panelInnerRef} className={s.panelInner}>
                {panelBody}
              </div>
            </section>
          )}
        </>
      )}

      <header ref={headerRef} className={s.header} inert={view === "list" && isOpen}>
        <span className={s.brand}>
          <Mark />
          ecomtalent
        </span>
        <span className={s.progress} aria-label={`${DONE_LESSONS} of ${TOTAL_LESSONS} lessons done`}>
          <span className={s.progressLine} aria-hidden="true">
            <i style={{ transform: `scaleX(${DONE_LESSONS / TOTAL_LESSONS})` }} />
          </span>
          <span aria-hidden="true">
            <b>{DONE_LESSONS}</b>/{TOTAL_LESSONS} lessons
          </span>
        </span>
      </header>

      {view === "list" && (
        <div className={s.list} inert={isOpen}>
          {phase === "failed" && (
            <p className={s.note}>The 3D map could not load in this browser, so here is the list.</p>
          )}
          <section className={s.listNext} aria-label="Next lesson">
            <NextBlock onContinue={(el) => openArea(CURRENT_AREA, el, NEXT_LESSON)} />
          </section>
          <ol className={s.areaList}>
            {STUDY_AREAS.map((a, k) => (
              <li key={a.id}>
                <button
                  ref={(el) => {
                    listRowRefs.current[k] = el;
                  }}
                  type="button"
                  className={s.areaRow}
                  data-state={areaState(k)}
                  aria-label={`${a.name}, ${a.done} of ${a.lessons} lessons done`}
                  onClick={(e) => openArea(k, e.currentTarget)}
                >
                  <span className={s.rowNum}>{pad2(k + 1)}</span>
                  <span className={s.rowText}>
                    <span className={s.rowName}>{a.name}</span>
                    <span className={s.rowMeta}>{a.landmark}</span>
                  </span>
                  <span className={s.rowDot} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {view === "list" && isOpen && (
        <section className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="v2-panel-title">
          {panelBody}
        </section>
      )}

      {/* Dev only, for Lovro's A/B: the other three builds, and the camera pitch. */}
      <footer ref={footerRef} className={s.footer} inert={isOpen || loading}>
        <Link href="/dev/world-codex">Astra</Link>
        <Link href="/dev/world-v2">V2</Link>
        <Link href="/dev/world">Original</Link>
        {view === "world" && (
          <span className={s.pitch} role="group" aria-label="Camera pitch">
            <span aria-hidden="true">Pitch</span>
            {/* Plain links: a pitch change is a fresh scene, so a full page load. */}
            <a href="/dev/world-v3" aria-current={pitch === "v3" || undefined} onClick={carryDepth}>
              Game
            </a>
            <span className={s.slash} aria-hidden="true">
              /
            </span>
            <a href="/dev/world-v3?pitch=low" aria-current={pitch === "low" || undefined} onClick={carryDepth}>
              Low
            </a>
          </span>
        )}
      </footer>

      {view !== "list" && (
        <div className={s.loading} data-done={phase === "ready" || undefined} role="status" aria-live="polite">
          <span className={s.loadingLine} aria-hidden="true" />
          <span>{phase === "ready" ? "" : "Loading"}</span>
        </div>
      )}
    </main>
  );
}

function NextBlock({ onContinue }: { onContinue: (el: HTMLElement) => void }) {
  const a = STUDY_AREAS[CURRENT_AREA];
  return (
    <>
      <p className={s.nextEyebrow}>Next</p>
      <h2 className={s.nextArea}>{a.name}</h2>
      <p className={s.nextLesson}>
        <span className={s.num}>{pad2(NEXT_LESSON + 1)}</span>
        {a.sample[NEXT_LESSON]}
      </p>
      <button type="button" className={s.primary} onClick={(e) => onContinue(e.currentTarget)}>
        Continue
        <Arrow />
      </button>
    </>
  );
}

function PanelBody({
  idx,
  backLabel,
  lesson,
  dir,
  onBack,
  onOpenLesson,
  onBackToArea,
  headingRef,
  lessonHeadingRef,
  rowRefs,
}: {
  idx: number;
  /** "Map" over the 3D world; in the list view there is no map to go back to. */
  backLabel: string;
  lesson: number | null;
  dir: Dir;
  onBack: () => void;
  onOpenLesson: (i: number) => void;
  onBackToArea: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  lessonHeadingRef: RefObject<HTMLHeadingElement | null>;
  rowRefs: RefObject<Array<HTMLButtonElement | null>>;
}) {
  const a = STUDY_AREAS[idx];
  const nextIdx = idx === CURRENT_AREA ? NEXT_LESSON : -1;

  if (lesson !== null) {
    return (
      <div className={s.view} data-dir={dir} key={`lesson-${lesson}`}>
        <button type="button" className={s.back} onClick={onBackToArea}>
          <Arrow back />
          {a.name}
        </button>
        <p className={s.panelEyebrow}>
          <span className={s.accent}>{pad2(lesson + 1)}</span>
          <span className={s.sep}>/</span>
          {pad2(a.lessons)}
        </p>
        <h2 ref={lessonHeadingRef} id="v2-panel-title" className={s.panelTitle} tabIndex={-1}>
          {a.sample[lesson]}
        </h2>
        <div className={s.video} role="img" aria-label="Lesson video placeholder">
          <span className={s.play} aria-hidden="true" />
        </div>
        {lesson + 1 < a.sample.length && (
          <button type="button" className={s.upNext} onClick={() => onOpenLesson(lesson + 1)}>
            <span className={s.upNextLabel}>Next</span>
            <span className={s.upNextTitle}>{a.sample[lesson + 1]}</span>
            <Arrow />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={s.view} data-dir={dir} key="area">
      <button type="button" className={s.back} onClick={onBack}>
        <Arrow back />
        {backLabel}
      </button>
      <p className={s.panelEyebrow}>
        <span className={s.accent}>{pad2(idx + 1)}</span>
        <span className={s.sep}>/</span>
        {a.landmark}
      </p>
      <h2 ref={headingRef} id="v2-panel-title" className={s.panelTitle} tabIndex={-1}>
        {a.name}
      </h2>
      <p className={s.desc}>{a.description}</p>
      <div className={s.areaProgress}>
        <span>
          {a.done} of {a.lessons} done
        </span>
        <span className={s.bar} aria-hidden="true">
          <i style={{ transform: `scaleX(${a.done / a.lessons})` }} />
        </span>
      </div>
      <ol className={s.lessons}>
        {a.sample.map((title, i) => {
          const state = i < a.done ? "done" : i === nextIdx ? "next" : "todo";
          return (
            <li key={title}>
              <button
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                type="button"
                className={s.lesson}
                data-state={state}
                aria-label={`Lesson ${i + 1}, ${title}${state === "done" ? ", done" : state === "next" ? ", next" : ""}`}
                onClick={() => onOpenLesson(i)}
              >
                <span className={s.lessonMark} aria-hidden="true" />
                <span className={s.lessonNum} aria-hidden="true">
                  {pad2(i + 1)}
                </span>
                <span className={s.lessonTitle}>{title}</span>
                {state === "next" && (
                  <span className={s.nextTag} aria-hidden="true">
                    Next
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {a.lessons > a.sample.length && <p className={s.more}>+{a.lessons - a.sample.length} more lessons</p>}
      {a.feature && (
        <div className={s.feature}>
          <span className={s.diamond} aria-hidden="true" />
          {a.feature.title}
        </div>
      )}
    </div>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className={back ? s.arrowBack : s.arrow}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 8h10.5M9.5 4.5 13 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A half sun on a horizon line: the world's one light source. */
function Mark() {
  return (
    <svg className={s.mark} width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 12.5a5.5 5.5 0 0 1 11 0Z" fill="currentColor" className={s.markSun} />
      <path d="M2 12.5h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
