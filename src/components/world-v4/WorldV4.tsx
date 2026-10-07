"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { Rail } from "@/lib/world-v4/rail";
import type { AreaAnchor, ProjectedMarker, WorldFrame, WorldScene } from "@/lib/world-v4/scene";
import { STUDY_AREAS, TOTAL_LESSONS, lessonTitle, pad2, studyFor, type Study } from "./study";
import { DEFAULT_TUNING, clearTuning, loadTuning, sameTuning, sanitize, saveTuning, type Tuning } from "./tuning";
import { TuningPanel } from "./TuningPanel";
import { LabelLayout, HIDDEN, TEXT } from "./labels";
import s from "./world.module.css";

/**
 * /dev/world-v4 interface: V3's interface on the V4 route, plus a dev tuning
 * panel. The chrome, the checkpoint zoom, the keyboard and the list view are
 * V3's (src/components/world-v3/WorldV3.tsx); read its header for the frame
 * loop and the park choreography. What changed:
 *
 * THE STUDENT IS TUNABLE. V3 had one fixed fixture student. Here the tuning
 * panel sets where the student is (the frontier), how many places are
 * finished, and the locking mode, and studyFor() derives everything the
 * chrome shows from those. The same three values go to the scene.
 *
 * THE SCROLL LENGTH IS TUNABLE. Each stretch has its own scroll budget in vh.
 * The scene owns the scroll length: it keeps the spacer's height in step with
 * the budgets and the lock (bindSpacer), and setPacing() keeps the camera
 * where it is. The one case it cannot handle is a change while a place is
 * open (the page is scroll-locked), so the depth saved on open is converted
 * here through the rail.
 *
 * PROGRESS goes to scene.setProgress() as places finished plus the share of
 * the next place done; the scene passes it (and the look-mode mist) on to its
 * modules. The scene installs its own default modules (light, then blocks).
 *
 * LOCKED PLACES. In look and locked modes the places past the frontier cannot
 * be opened. Their markers, dock stops and list rows say so, and clicking one
 * shows a short hint over the dock instead of flying in.
 */

const N = STUDY_AREAS.length;
const NARROW_QUERY = "(width < 760px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const MODE_NAMES = ["hidden", "dot", "text"] as const;
/** V3's rail ended at 0.88; V4's depth is the share of the whole budget, so the route ends at 1. */
const END_DEPTH = 1;
const HINT_MS = 2400;

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
function caretFraction(depth: number, depths: Float64Array, end: number): number {
  const d0 = depths[0];
  if (depth <= d0) return (clamp01(depth / d0) * 0.5) / N;
  for (let k = 0; k < N - 1; k++) {
    const a = depths[k];
    const b = depths[k + 1];
    if (depth <= b) return (k + 0.5 + (depth - a) / Math.max(1e-6, b - a)) / N;
  }
  const last = depths[N - 1];
  return (N - 0.5 + 0.5 * clamp01((depth - last) / Math.max(1e-6, end - last))) / N;
}

/**
 * Scroll, in vh, the rail spends on the rope bridge and on the flight, both in
 * the stretch that ends at 08. The flight has its own budget and slider
 * (grey pass 3); the bridge shares 08's, so the panel shows its share.
 */
function rideVh(rail: Rail): { bridge: number; flight: number } {
  const ds = 2;
  const from = rail.stopS[N - 2];
  const to = rail.stopS[N - 1];
  let bridge = 0;
  let flight = 0;
  for (let s = from; s < to; s += ds) {
    const w = Math.min(ds, to - s);
    const k = rail.kindAtS(s + w / 2);
    if (k === "bridge") bridge += rail.densityAtS(s + w / 2) * w;
    else if (k === "flight") flight += rail.densityAtS(s + w / 2) * w;
  }
  return { bridge: Math.round(bridge), flight: Math.round(flight) };
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

function alignOf(k: number): "start" | "center" | "end" {
  return k === 0 ? "start" : k === N - 1 ? "end" : "center";
}
const stopLeft = (k: number) => `${((k + 0.5) / N) * 100}%`;

interface LabelBox {
  id: string;
  name: string;
  current: boolean;
  locked: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Test hooks: V3's names, so the v3 harnesses port over, plus the V4 extras. */
interface Harness {
  __worldReady?: boolean;
  __worldError?: string;
  __worldView?: string;
  __worldLandmarks?: string[];
  __worldHide?: (prefix: string) => number;
  __worldNames?: () => string[];
  __worldScrollFor?: (depth: number) => number;
  __worldDepthFor?: (id: string) => number;
  __worldPark?: (id: string | null) => void;
  __worldCamera?: () => ReturnType<WorldScene["cameraPose"]> | null;
  __worldLabelBoxes?: () => LabelBox[];
  __worldParkInfo?: () => unknown;
  /** The scene's railU(): the TRAIL curve parameter t, 0..1 (key i at i / (n - 1)). */
  __worldRailU?: () => number;
  /** The share of the route's length, 0..1 (the scene's routeU). */
  __worldRouteU?: () => number;
  /** The scene's lock as it sees it, and the deepest depth the scroll can reach. */
  __worldLock?: () => { mode: string; frontier: number; maxDepth: number };
  /** Read or change the dev tuning (lock, frontier, finished, scrollVh, tailVh). */
  __worldTuning?: () => Tuning;
  __worldTune?: (patch: Partial<Tuning> | "reset") => Tuning;
}
const GETTER_HOOKS = ["__worldDepth", "__worldMarkers", "__worldFrame", "__worldFrameCount"] as const;
const PLAIN_HOOKS = [
  "__worldReady",
  "__worldLandmarks",
  "__worldHide",
  "__worldNames",
  "__worldScrollFor",
  "__worldDepthFor",
  "__worldPark",
  "__worldCamera",
  "__worldLabelBoxes",
  "__worldParkInfo",
  "__worldRailU",
  "__worldRouteU",
  "__worldLock",
] as const;

function copyMarkers(ms: readonly ProjectedMarker[] | undefined) {
  return (ms ?? []).map((m) => ({ id: m.id, x: m.x, y: m.y, visible: m.visible, proximity: m.proximity }));
}

type View = "unknown" | "world" | "list";
type Phase = "loading" | "ready" | "failed";
type Dir = "none" | "fwd" | "back";

export function WorldV4() {
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, getUnknown);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getFalse);
  const [phase, setPhase] = useState<Phase>("loading");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [dir, setDir] = useState<Dir>("none");
  const [closing, setClosing] = useState(false);
  const [region, setRegion] = useState(0);
  const [hoverStop, setHoverStop] = useState<number | null>(null);
  const [hint, setHint] = useState<{ k: number; seq: number } | null>(null);
  // The server render and the first client render use the defaults; the
  // stored tuning is read once mounted (localStorage is client only).
  const [tuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [tuningLoaded, setTuningLoaded] = useState(false);

  const study = useMemo(
    () => studyFor(tuning.frontier, tuning.finished, tuning.partial, tuning.lock),
    [tuning.frontier, tuning.finished, tuning.partial, tuning.lock],
  );

  const view: View = narrow === null ? "unknown" : narrow || phase === "failed" ? "list" : "world";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
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
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  /** The readout mounts with the panel; the scene may be asleep, so fill it now. */
  const setReadout = useCallback((el: HTMLSpanElement | null) => {
    readoutRef.current = el;
    ui.current.readout = "";
    const f = lastFrame.current;
    if (el && f) applyRef.current?.(f);
  }, []);
  const rideRef = useRef<HTMLSpanElement | null>(null);
  /** Fills the panel's bridge line from the scene's rail (after a pacing change, or when it mounts). */
  const writeRide = useCallback(() => {
    const el = rideRef.current;
    const sc = sceneRef.current;
    if (!el || !sc || !ui.current.live) return;
    const r = rideVh(sc.debugRail());
    el.textContent = `the rope bridge takes ${r.bridge} vh of it; the flight, measured on the rail, ${r.flight} vh`;
  }, []);
  const setRide = useCallback(
    (el: HTMLSpanElement | null) => {
      rideRef.current = el;
      writeRide();
    },
    [writeRide],
  );
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
  const studyRef = useRef<Study>(study);
  const tuningRef = useRef<Tuning>(tuning);
  /** The tuning and progress the scene last got, so only what changed is sent. */
  const appliedRef = useRef<Tuning | null>(null);
  const progressRef = useRef(-1);

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
    hintTimer: 0,
    hintSeq: 0,
    frames: 0,
    tween: 0,
    stopTween: null as (() => void) | null,
    region: 0,
    readout: "",
  });

  useEffect(() => {
    ui.current.reduced = reduced;
  }, [reduced]);

  useLayoutEffect(() => {
    studyRef.current = study;
  }, [study]);

  // ── Tuning. Read once mounted; every later change is saved and, if the
  // pacing or the lock moved the scroll range, the camera is kept in place.
  useEffect(() => {
    const stored = loadTuning();
    if (!sameTuning(stored, DEFAULT_TUNING)) setTuning(stored);
    setTuningLoaded(true);
  }, []);

  const updateTuning = useCallback((patch: Partial<Tuning> | "reset") => {
    const prev = tuningRef.current;
    const next = patch === "reset" ? DEFAULT_TUNING : sanitize({ ...prev, ...patch }, prev);
    if (sameTuning(prev, next)) return prev;
    tuningRef.current = next;
    if (patch === "reset") clearTuning();
    else saveTuning(next);
    setTuning(next);
    return next;
  }, []);

  /** Send the scene whatever changed since it last heard. */
  const applyTuning = useCallback((scene: WorldScene, t: Tuning, st: Study) => {
    const was = appliedRef.current;
    appliedRef.current = t;
    const u = ui.current;
    const pacingChanged =
      !was ||
      was.tailVh !== t.tailVh ||
      was.flightVh !== t.flightVh ||
      was.scrollVh.some((v, k) => v !== t.scrollVh[k]);
    if (pacingChanged) {
      // setPacing keeps the camera in place on the rail. While a place is open
      // the page is scroll-locked, so the depth saved on open is carried to
      // the new budgets through the rail's distance, and the unlock uses it.
      const rail = scene.debugRail();
      const s = u.locked && u.savedDepth >= 0 ? rail.sOfDepth(u.savedDepth) : -1;
      scene.setPacing(t.scrollVh, t.tailVh, t.flightVh);
      if (s >= 0) {
        u.savedDepth = rail.depthOfS(s);
        u.savedMax = -1;
      }
      writeRide();
    }
    if (!was || was.lock !== t.lock || was.frontier !== t.frontier) {
      scene.setLock(t.lock, t.frontier);
      // The scroll range changed under an open place: come home by depth, not by pixels.
      if (u.locked) u.savedMax = -1;
    }
    // setLock also puts the places past the frontier in mist (look mode).
    if (!was || progressRef.current !== st.progress) {
      progressRef.current = st.progress;
      scene.setProgress(st.progress);
    }
  }, [writeRide]);

  useLayoutEffect(() => {
    tuningRef.current = tuning;
    const scene = sceneRef.current;
    if (!scene || !ui.current.live) return;
    applyTuning(scene, tuning, studyRef.current);
    // A place that just became locked cannot stay open (the scene has already refused it).
    const u = ui.current;
    if (u.open >= 0 && !u.closing && tuning.lock !== "open" && u.open > tuning.frontier) closeAreaRef.current?.();
  }, [tuning, applyTuning]);

  const showHint = useCallback((k: number) => {
    const u = ui.current;
    window.clearTimeout(u.hintTimer);
    u.hintSeq++;
    setHint({ k, seq: u.hintSeq });
    u.hintTimer = window.setTimeout(() => setHint(null), HINT_MS);
  }, []);

  // ── Scroll lock. Saves the exact scrollY AND the rail depth it meant; unlock
  // puts the scroll back on that depth (a resize or a pacing change while
  // parked changes what a pixel scrollY means).
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
      // The scene has the final say (park() refuses a place past the frontier too).
      const sc = sceneRef.current;
      if (studyRef.current.locked[idx] || (sc && !sc.isEnterable(STUDY_AREAS[idx].id))) {
        showHint(idx);
        return;
      }
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
    [cancelTween, lock, showHint],
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
    const f = lastFrame.current;
    if (!scene || !u.live || u.reduced || !f || f.parkProgress <= 0.001 || scene.isContextLost()) {
      finalizeClose();
      return;
    }
    // Watchdog for a lost WebGL context: 10 visible seconds without a frame.
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
  const closeAreaRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    closeAreaRef.current = closeArea;
  }, [closeArea]);

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
  // `instant` jumps (the tuning panel's jump row).
  const travel = useCallback(
    (idx: number, instant = false) => {
      const scene = sceneRef.current;
      const u = ui.current;
      if (!scene || !u.live || u.open !== -1) return;
      if (studyRef.current.unreachable[idx]) {
        showHint(idx);
        return;
      }
      const depth = scene.depthFor(STUDY_AREAS[idx].id);
      const to = Math.round(scene.scrollYForDepth(depth));
      cancelTween();
      const from = window.scrollY;
      if (instant || u.reduced || Math.abs(to - from) < 2) {
        window.scrollTo({ top: to, left: 0, behavior: "instant" });
        if (instant) scene.seedDepth(depth);
        return;
      }
      const at = lastFrame.current?.depth ?? depth;
      const span = Math.abs(depth - at) / END_DEPTH;
      const duration = Math.min(2600, 700 + span * 2600);
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
    [cancelTween, showHint],
  );

  // ── The scene. Created only on the world view, so phones never load three.js,
  // and only once the stored tuning is known, so it starts on the right budgets.
  useEffect(() => {
    if (view !== "world" || !tuningLoaded) return;
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
        layout.run(bySlot, studyRef.current.current, sizes.w, sizes.h);
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
        const cx = caretFraction(f.depth, depths, END_DEPTH) * sizes.trackW;
        if (Math.abs(cx - cache.caretX) > 0.2) {
          cache.caretX = cx;
          caret.style.transform = `translate3d(${cx.toFixed(1)}px, 0, 0)`;
        }
      }
      const cue = cueRef.current;
      if (cue) {
        const a = (1 - smooth(0.004, 0.03, f.depth / END_DEPTH)) * chrome;
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

      // The tuning panel's live readout, only while it is open.
      const out = readoutRef.current;
      if (out && sizes.h > 0) {
        const vh = (window.scrollY / sizes.h) * 100;
        const share = scene ? scene.routeU() : f.railU;
        const text = `${share.toFixed(3)} of the route · ${Math.round(vh)} vh scrolled`;
        if (text !== u.readout) {
          u.readout = text;
          out.textContent = text;
        }
      }
    };

    applyRef.current = apply;

    const fail = (e: unknown) => {
      if (disposed) return;
      w.__worldError = String(e);
      console.error("[world-v4]", e);
      setPhase("failed");
    };

    (async () => {
      let mod: typeof import("@/lib/world-v4/scene");
      try {
        mod = await import("@/lib/world-v4/scene");
      } catch (e) {
        fail(e);
        return;
      }
      if (disposed) return;
      // The budgets and the lock go in at construction: they decide what a scrollY means.
      const t = tuningRef.current;
      try {
        scene = new mod.WorldScene(stage, {
          lock: { mode: t.lock, frontier: t.frontier },
          pacing: [...t.scrollVh, t.tailVh, t.flightVh],
        });
      } catch (e) {
        fail(e);
        return;
      }
      const sc = scene;
      sceneRef.current = sc;
      appliedRef.current = t;
      progressRef.current = studyRef.current.progress;
      sc.setProgress(progressRef.current);
      // The scene keeps the spacer's height in step with the budgets and the lock.
      sc.bindSpacer(spacerRef.current);
      sc.setAnchors(ANCHORS);
      sc.onFrame(onFrame);
      sc.setPaused(document.hidden);
      sc.start();

      try {
        await sc.load();
      } catch (e) {
        fail(e);
        return;
      }
      if (disposed) return;

      for (let k = 0; k < N; k++) {
        const d = sc.depthFor(STUDY_AREAS[k].id);
        if (Number.isFinite(d)) depths[k] = d;
      }
      u.live = true;
      // The tuning may have moved on while the world was building.
      applyTuning(sc, tuningRef.current, studyRef.current);
      writeRide();
      if (u.open >= 0 && u.savedDepth >= 0) {
        // Made while a place is open (back from the list view): start at the depth saved on open.
        sc.seedDepth(u.savedDepth);
      }
      // A new scene while an area is open: put the camera where the interface says it is.
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
      w.__worldDepthFor = (id: string) => sc.depthFor(id);
      w.__worldPark = (id: string | null) => {
        if (id === null) closeArea();
        else openArea(slotOf(id), null);
      };
      w.__worldCamera = () => sc.cameraPose();
      w.__worldParkInfo = () => sc.parkInfo();
      w.__worldRailU = () => sc.railU();
      w.__worldRouteU = () => sc.routeU();
      w.__worldLock = () => {
        const l = sc.lock();
        return { mode: l.mode, frontier: l.frontier, maxDepth: lastFrame.current?.maxDepth ?? 1 };
      };
      w.__worldLabelBoxes = () => {
        const out: LabelBox[] = [];
        if (Number(markersRef.current?.style.opacity || "1") < 0.05) return out;
        const st = studyRef.current;
        for (let k = 0; k < N; k++) {
          const el = markerRefs.current[k];
          const label = labelRefs.current[k];
          if (!el || !label || el.dataset.mode !== "text") continue;
          const r = label.getBoundingClientRect();
          out.push({
            id: STUDY_AREAS[k].id,
            name: STUDY_AREAS[k].name,
            current: k === st.current,
            locked: st.locked[k],
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          });
        }
        return out;
      };
      w.__worldLandmarks = sc.landmarkNames();
      w.__worldReady = true;
      setPhase("ready");
    })();

    return () => {
      disposed = true;
      u.live = false;
      for (const k of GETTER_HOOKS) delete w[k];
      for (const k of PLAIN_HOOKS) delete w[k];
      if (scene) {
        scene.onFrame(null);
        scene.dispose();
      }
      sceneRef.current = null;
      appliedRef.current = null;
      progressRef.current = -1;
      lastFrame.current = null;
      applyRef.current = null;
    };
  }, [view, tuningLoaded, openArea, closeArea, finalizeClose, applyTuning, writeRide]);

  // The tuning hooks work on the list view too, so they live outside the scene effect.
  useEffect(() => {
    const w = window as unknown as Harness;
    w.__worldTuning = () => tuningRef.current;
    w.__worldTune = updateTuning;
    return () => {
      delete w.__worldTuning;
      delete w.__worldTune;
    };
  }, [updateTuning]);

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

  // ── The dock names the next stop under its dot; a number its box touches steps aside.
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

  // A locked marker's label is a few px wider (the lock glyph): measure again.
  useEffect(() => {
    if (view !== "world" || phase !== "ready") return;
    const layout = layoutRef.current;
    if (!layout) return;
    for (let k = 0; k < N; k++) {
      const label = labelRefs.current[k];
      if (label) layout.width[k] = label.offsetWidth;
    }
    const f = lastFrame.current;
    if (f) applyRef.current?.(f);
  }, [view, phase, study]);

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

  // ── Never leave the page scroll-locked or a timer running behind us.
  useEffect(() => {
    const u = ui.current;
    return () => {
      cancelTween();
      window.clearInterval(u.closeTimer);
      window.clearTimeout(u.hintTimer);
      if (u.locked) {
        document.body.style.overflow = u.prevOverflow;
        u.locked = false;
      }
    };
  }, [cancelTween]);

  const isOpen = openIdx !== null;
  const peek = hoverStop !== null && hoverStop !== region ? hoverStop : null;
  const nextStop = region + 1 < N ? region + 1 : -1;
  const current = study.current;
  const hereLocked = study.locked[region];

  const loading = view === "world" && phase === "loading";

  const panelBody =
    openIdx === null ? null : (
      <PanelBody
        idx={openIdx}
        study={study}
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

  const nameWithState = (k: number) =>
    study.locked[k]
      ? `${STUDY_AREAS[k].name}, locked`
      : `${STUDY_AREAS[k].name}, ${study.done[k]} of ${STUDY_AREAS[k].lessons} lessons done`;

  return (
    <main className={s.root} data-view={view} data-open={isOpen || undefined} data-lock={tuning.lock}>
      <h1 className={s.srOnly}>Course map</h1>

      {view === "world" && (
        <>
          <div ref={stageRef} className={s.stage} aria-hidden="true" />
          <div ref={spacerRef} className={s.spacer} aria-hidden="true" />
          <div ref={shadeRef} className={s.shade} aria-hidden="true" />

          <section ref={nextRef} className={s.next} aria-label="Next lesson" inert={isOpen || loading}>
            <NextBlock study={study} onContinue={(el) => openArea(current, el, study.nextLesson)} />
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
                data-state={study.state[k]}
                data-locked={study.locked[k] || undefined}
                tabIndex={-1}
                aria-label={nameWithState(k)}
                aria-disabled={study.locked[k] || undefined}
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
                  {study.locked[k] && <Lock />}
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
            <div className={s.dockHead}>
              <button
                type="button"
                className={`${s.tag} ${s.here}`}
                data-align={alignOf(region)}
                data-hidden={peek !== null || hint !== null || undefined}
                data-locked={hereLocked || undefined}
                style={{ left: stopLeft(region) }}
                aria-label={hereLocked ? `${STUDY_AREAS[region].name}, locked` : `Enter ${STUDY_AREAS[region].name}`}
                aria-disabled={hereLocked || undefined}
                onClick={(e) => openArea(region, e.currentTarget)}
              >
                <span key={`${region}-${hereLocked}`} className={s.tagIn}>
                  {hereLocked && <Lock />}
                  {STUDY_AREAS[region].name}
                  {!hereLocked && <Arrow />}
                </span>
              </button>
              {hint !== null ? (
                <span
                  className={`${s.tag} ${s.peek} ${s.hint}`}
                  data-align={alignOf(hint.k)}
                  style={{ left: stopLeft(hint.k) }}
                  role="status"
                >
                  <span key={hint.seq} className={s.tagIn}>
                    <Lock />
                    Finish {STUDY_AREAS[current].name} first
                  </span>
                </span>
              ) : (
                peek !== null && (
                  <span
                    className={`${s.tag} ${s.peek}`}
                    data-align={alignOf(peek)}
                    style={{ left: stopLeft(peek) }}
                    aria-hidden="true"
                  >
                    <span key={peek} className={s.tagIn}>
                      {study.locked[peek] && <Lock />}
                      {STUDY_AREAS[peek].name}
                    </span>
                  </span>
                )
              )}
            </div>
            <div ref={trackRef} className={s.track}>
              <span className={s.trackLine} aria-hidden="true" />
              <span className={s.trackDone} aria-hidden="true" style={{ width: `${((current + 0.5) / N) * 100}%` }} />
              <span ref={caretRef} className={s.caret} aria-hidden="true" />
              {STUDY_AREAS.map((a, k) => (
                <button
                  key={a.id}
                  ref={(el) => {
                    stopRefs.current[k] = el;
                  }}
                  type="button"
                  className={s.stop}
                  data-state={study.state[k]}
                  data-locked={study.locked[k] || undefined}
                  style={{ left: `${((k + 0.5) / N) * 100}%` }}
                  aria-label={study.unreachable[k] ? `${a.name}, locked` : `Travel to ${a.name}`}
                  aria-disabled={study.unreachable[k] || undefined}
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
            <section ref={panelRef} className={s.panel} aria-labelledby="v4-panel-title" inert={closing}>
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
        <span className={s.progress} aria-label={`${study.doneTotal} of ${TOTAL_LESSONS} lessons done`}>
          <span className={s.progressLine} aria-hidden="true">
            <i style={{ transform: `scaleX(${study.doneTotal / TOTAL_LESSONS})` }} />
          </span>
          <span aria-hidden="true">
            <b>{study.doneTotal}</b>/{TOTAL_LESSONS} lessons
          </span>
        </span>
      </header>

      {view === "list" && (
        <div className={s.list} inert={isOpen}>
          {phase === "failed" && <p className={s.note}>The 3D map could not load in this browser, so here is the list.</p>}
          <section className={s.listNext} aria-label="Next lesson">
            <NextBlock study={study} onContinue={(el) => openArea(current, el, study.nextLesson)} />
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
                  data-state={study.state[k]}
                  data-locked={study.locked[k] || undefined}
                  aria-label={nameWithState(k)}
                  aria-disabled={study.locked[k] || undefined}
                  onClick={(e) => openArea(k, e.currentTarget)}
                >
                  <span className={s.rowNum}>{pad2(k + 1)}</span>
                  <span className={s.rowText}>
                    <span className={s.rowName}>{a.name}</span>
                    <span className={s.rowMeta}>
                      {study.locked[k] && <Lock />}
                      {a.landmark}
                    </span>
                  </span>
                  <span className={s.rowDot} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {view === "list" && isOpen && (
        <section className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="v4-panel-title">
          {panelBody}
        </section>
      )}

      {/* Dev only: the builds to compare against, and the tuning panel. The
          panel stays usable while a place is open, so progress can be changed
          while looking at it (the steps rising at 6). */}
      <footer ref={footerRef} className={s.footer}>
        <span className={s.footLinks} inert={isOpen || loading}>
          <Link href="/dev/world-v3">V3</Link>
          <Link href="/dev/world-codex">Astra</Link>
        </span>
        {view === "world" && (
          <TuningPanel
            inert={loading}
            tuning={tuning}
            ready={phase === "ready"}
            readoutRef={setReadout}
            rideRef={setRide}
            onChange={updateTuning}
            onJump={(k) => travel(k, true)}
          />
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

function NextBlock({ study, onContinue }: { study: Study; onContinue: (el: HTMLElement) => void }) {
  const a = STUDY_AREAS[study.current];
  return (
    <>
      <p className={s.nextEyebrow}>Next</p>
      <h2 className={s.nextArea}>{a.name}</h2>
      <p className={s.nextLesson}>
        <span className={s.num}>{pad2(study.nextLesson + 1)}</span>
        {lessonTitle(a, study.nextLesson)}
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
  study,
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
  study: Study;
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
  const done = study.done[idx];
  const nextIdx = idx === study.current ? study.nextLesson : -1;

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
        <h2 ref={lessonHeadingRef} id="v4-panel-title" className={s.panelTitle} tabIndex={-1}>
          {lessonTitle(a, lesson)}
        </h2>
        <div className={s.video} role="img" aria-label="Lesson video placeholder">
          <span className={s.play} aria-hidden="true" />
        </div>
        {lesson + 1 < a.lessons && (
          <button type="button" className={s.upNext} onClick={() => onOpenLesson(lesson + 1)}>
            <span className={s.upNextLabel}>Next</span>
            <span className={s.upNextTitle}>{lessonTitle(a, lesson + 1)}</span>
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
      <h2 ref={headingRef} id="v4-panel-title" className={s.panelTitle} tabIndex={-1}>
        {a.name}
      </h2>
      <p className={s.desc}>{a.description}</p>
      <div className={s.areaProgress}>
        <span>
          {done} of {a.lessons} done
        </span>
        <span className={s.bar} aria-hidden="true">
          <i style={{ transform: `scaleX(${done / a.lessons})` }} />
        </span>
      </div>
      <ol className={s.lessons}>
        {a.sample.map((title, i) => {
          const state = i < done ? "done" : i === nextIdx ? "next" : "todo";
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
    <svg className={back ? s.arrowBack : s.arrow} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

/** A small padlock: this place opens once the student gets there. */
function Lock() {
  return (
    <svg className={s.lock} width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden="true">
      <rect x="1" y="4.75" width="8" height="5.5" rx="1.2" fill="currentColor" />
      <path d="M3 4.75V3.4a2 2 0 0 1 4 0v1.35" stroke="currentColor" strokeWidth="1.3" />
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
