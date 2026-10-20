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
  type ReactNode,
  type RefObject,
} from "react";
import type { Rail } from "@/lib/world-v6/rail";
import type { AreaAnchor, ProjectedMarker, WorldFrame, WorldScene } from "@/lib/world-v6/scene";
import { STUDY_AREAS, isAction, lessonTitle, pad2, studyFor, type Study, type StudyArea } from "./study";
import { BOUNTY_NAME, type WorldBounty, type WorldDiscount, type WorldSource } from "./source";
import {
  WorldContentContext,
  contentOf,
  lessonDone,
  lessonLength,
  notRecorded,
  placeMinutes,
  progressOf,
  useContent,
  type WorldContent,
} from "./content";
import { areaShare, type WorldProgress } from "@/lib/world-v6/progress";
import { SKY_MARKS } from "@/lib/world-v6/layout";
import { CHECKPOINT, type CheckpointLook } from "@/lib/world-v6/checkpoint";
import { BOUNTY } from "@/lib/world-v6/bounty";
import { DISCOUNT_PERCENT } from "@/lib/world/discount";
import { checkpointView, discountRule, shortDate, type CheckpointView } from "./checkpointView";
import { CARD_HINTS, anchorCard, placeCard, placePanel, type Box, type Placement } from "./cardPlace";
import { DEFAULT_TUNING, clearTuning, loadTuning, sameTuning, sanitize, saveTuning, type Tuning } from "./tuning";
import { TuningPanel } from "./TuningPanel";
import { LabelLayout, HIDDEN, LIFT, TEXT } from "./labels";
import {
  POSTER_DIR,
  POSTER_H,
  POSTER_IDS,
  POSTER_OFFER,
  POSTER_W,
  coverFit,
  driftScale,
  landingPoster,
  posterBlend,
  posterNotice,
  posterPreference,
  posterSrc,
  type PosterKind,
  type PosterManifest,
} from "@/lib/world-v6/poster";
import { benchText, runBench, type BenchResult } from "./bench";
import tokens from "./tokens.module.css";
import s from "./world.module.css";

/**
 * /dev/world-v6 interface: V3's interface on the V4 route, plus a dev tuning
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
 * be opened. Their markers, timeline marks and list rows say so, and clicking
 * one shows a short hint over the timeline instead of flying in.
 *
 * PROGRESS AND THE PANEL (2026-09-28, Lovro's picks from options A and B,
 * world_overnight_log.md 46). The fixture becomes a WorldProgress for the
 * scene (scene.setWorldProgress, beside setProgress). When the camera rests at
 * the student's place, THE CARD sits beside its landmark in the quiet part of
 * the frame, joined by a thin leader: where, how far, the next lesson and one
 * Watch button. It shrinks back into the place's label as soon as the camera
 * moves. When the place is off screen, THE CHIP on the bottom-left edge keeps
 * Watch one click away and points toward it. Clicking a place opens THE PANEL
 * in the click-in frame's quiet side, joined to the landmark the same way.
 * A place reaching 100% in the session calls the scene's celebrate(k) and the
 * card turns into a one-line done card. The old Next block and dock are gone;
 * the timeline at the bottom replaces the dock. Card, chip and panel are
 * positioned from the frame loop only when they change (cardPlace.ts), never
 * per frame, and go solid (no backdrop filter) at tiers 2 and 3 and in poster
 * mode.
 *
 * A SOURCE (2026-10-07, world_v6_wiring_prd.md WI-2). With no props this is
 * the dev page described above. Given a `source` (source.ts) it shows that
 * student in the app: the words and counts come from the source (content.ts),
 * the lock and the frontier too, and no tuning is read from or saved to
 * localStorage. It changes no progress and opens no lesson itself: opening and
 * closing a place, Watch, a panel row and the feature row call the source,
 * whose host changes the address, and one effect brings the component to
 * source.openK. A place opening, the card showing the next lesson and the
 * pointer or the keyboard on a panel row tell the source which lesson may be
 * opened next (source.onPrefetch), so its video can be asked for before the
 * click. While source.paused (a lesson page is open over the map) the
 * scene draws nothing, the root is inert, and new progress waits until it
 * closes; the stylesheet hides every layer of the interface under an inert
 * root, so only the picture is left behind the lesson. A place the address
 * named at load opens from its own stop (the scroll is put there first), and
 * focus goes into the panel when a lesson page closes over an open place. The
 * TUNE panel, the footer links and the bench exist only without a source.
 * Geometry (N, ANCHORS, slotOf, the depths) reads STUDY_AREAS either way.
 *
 * THE DISCOUNT CHECKPOINT (2026-10-14, source.discount). Between the Trail
 * Hut and the Boathouse the trail passes a cache on the saddle
 * (src/lib/world-v6/checkpoint.ts): a ninth anchor in the scene, slot CP of
 * the marker arrays, with its own marker ("30% off"), a tag on the timeline
 * between the 4th and 5th places, and a segment with the days left in the
 * header's group (2026-10-15: the header's course bar and its notch are
 * gone). Any of them opens its
 * panel (CheckpointBody): the camera parks at the cache from wherever it is
 * (its own park pose; no stop and no scroll budget on the rail), the scroll
 * locks as for a place, Esc and Back come home. A place opening gives way to
 * nothing: the checkpoint's panel closes into it. What shows comes from
 * checkpointView.ts; the cache's look goes to the scene (setCheckpoint). The
 * tag and on phones a row under Video Ads II's show for every student and
 * state (Lovro's second Loom, 2026-10-16: "clickable at all times"), and so
 * does the marker while the camera is near the cache (CP_SHOW_WITHIN; from
 * far away its plaque hung on the arrival card): where the offer is closed
 * for the student the panel says why, and Apply is there, greyed out, only
 * while it can still be earned. The header's segment shows only while the
 * offer is open to the student or their application is in (checkpointView.ts
 * `header`). In poster mode the marker stands where the posters' manifest has
 * the cache, by the same rule, so no poster shows it (only a1's has the cache
 * in frame, 3,750 away). With no discount on the source none of it shows and
 * the cache stands closed.
 *
 * THE AD BOUNTY CHECKPOINT (map review 2026-10-15, plan item 18). "How To Win
 * On The Ad Bounty Program" is a lesson outside the count (the feature row of
 * Creative Strategy in the catalog), and it is no longer a row of that place's
 * panel: it is the one lesson of a checkpoint of its own, the bounty board on
 * the isle past the rope bridge (src/lib/world-v6/bounty.ts; dress-sky.ts
 * builds the board, LM_Bounty). A tenth anchor, slot BT, with its own marker
 * ("Ad Bounty"), a tag on the timeline between the 7th and 8th places, and on
 * phones a row under Creative Strategy's. Any of them opens its panel
 * (BountyBody) the way the discount's opens (openCheckpoint(el, "bounty")):
 * the camera parks at the board (BOUNTY.park), the scroll locks, Esc and Back
 * come home. The two checkpoints share the panel's slot and state; `cpKind`
 * says which one is up. The panel's row opens the lesson's page
 * (source.onFeature), which the host opens over the checkpoint. Always open:
 * it never locks and shows whenever the course has the lesson
 * (source.bounty; the dev page's fixture row without a source).
 *
 * THE WELCOME (2026-10-19, Lovro, the launch night). With a source the map
 * opens on a welcome over the opening's sky, in Lovro's words and no others:
 * "Welcome, {first name}" (source.firstName; "Welcome" without one), "This is
 * your map through the course." and a Continue button. It replaces the
 * arrival's own trip: the map no longer flies to the student's place 900 ms
 * after it is ready (a button that left before it could be read), Continue
 * makes that same trip (travel to the student's place, the first one for a
 * new student). It fades out over the first 40% of the scroll to the first
 * place and comes back at the top; pointer-events none but the button, gone
 * from the tab order once faded. The scroll cue above the timeline ("Scroll"
 * and a chevron that bobs a few times) fades out as the scroll starts. On
 * phones the same two lines head the list, with no button and no cue. The
 * dev page has no source and no welcome, and keeps the old arrival.
 */

const N = STUDY_AREAS.length;
/** The window.__world* test hooks: every build but production. */
const HOOKS = process.env.NODE_ENV !== "production";
const NARROW_QUERY = "(width < 760px)";
/** Final pass C: the place whose click-in goes through the telescope (scene.ts TEL_PARK_PLACE, a7). */
const TEL_K = SKY_MARKS.findIndex((m) => m.id === "a7");
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const MODE_NAMES = ["hidden", "dot", "text"] as const;
/** V3's rail ended at 0.88; V4's depth is the share of the whole budget, so the route ends at 1. */
const END_DEPTH = 1;
/** The welcome (with a source) fades out between these shares of the way to the first place, and back in at the top. */
const WELCOME_FADE: readonly [number, number] = [0.03, 0.4];
const HINT_MS = 2400;
/** The camera counts as resting once it is this close (depth) to where the scroll says. */
const SETTLE_EPS = 2.5e-4;
/** ...and no scroll has come in for this long. */
const REST_MS = 160;
/** How near its stop (vh of scroll) the camera must rest for the card to show. */
const ARRIVE_VH = 32;
/** The panel's place in the click-in frame: under the header, off the left edge. */
const PANEL_TOP = 92;
/** Auto-travel to the student's place starts this long after the world is ready (the dev page: with a source the welcome's Continue makes the trip). */
const ARRIVE_DELAY_MS = 900;
/**
 * Long travel (final pass B). A hop longer than this (depth) no longer scrubs
 * the route: from a8 back to a4 that flew 12 scenes, day to night and back, in
 * 0.6 s. The frame the student is looking at is frozen over the canvas, the
 * camera jumps under it to just before the destination, and the frozen frame
 * dissolves while the camera glides the last stretch into the stop. 0.07
 * keeps the glide from the opening to the Landing (0.061) and dissolves every
 * hop between two places (0.08 and up).
 */
const LONG_HOP = 0.07;
/** How far before the stop (depth) the camera lands, to glide the rest. */
const LAND_DEPTH = 0.015;
/** The dissolve and the glide after the jump, ms. */
const DISSOLVE_MS = 700;
const LAND_MS = 1200;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
/**
 * Poster mode (final pass E): a poster's pin this close under the header's
 * safe line gets a box down its landmark (POSTER_BOX_HALF px either side,
 * POSTER_BOX_DROP of the poster's height down) for the labels to slide into.
 */
const POSTER_TOP_BAND = 90;
const POSTER_BOX_HALF = 24;
const POSTER_BOX_DROP = 0.12;

/** The discount checkpoint's slot in the marker arrays: after the eight places. slotOf() never returns it. */
const CP = N;
/** The Ad Bounty checkpoint's slot (plan item 18), after the discount's. */
const BT = N + 1;
/** Every marker slot: the eight places and the two checkpoints. */
const SLOTS = N + 2;
/** Opened this close (depth) to the rail point that frames the cache, with its marker on screen, the camera parks from where it is. */
const CP_NEAR = 0.02;
/**
 * The 30%'s marker, and the cache's hover and click, only while the camera is
 * this close to the cache on the ground (the second fix round, 2026-10-17).
 * From the opening (4,340 away) and the Introduction (3,750) the cache is a
 * speck in the far gully, and on 16:9 and wider windows its plaque hung on the
 * arrival card, or pushed the card off its corner. On today's route the plaque
 * is up from 611 to 288 away, after Video Ads II's stop (803). The timeline's
 * tag and the phone's row show at all times; so does poster mode's tag (no
 * poster has the cache near).
 */
const CP_SHOW_WITHIN = 1500;

/** Which checkpoint's panel is up: the discount's cache, or the Ad Bounty's board. */
type Cp = "discount" | "bounty";
const cpAnchor = (kind: Cp) => (kind === "bounty" ? BOUNTY.id : CHECKPOINT.id);

const ANCHORS: AreaAnchor[] = [
  ...STUDY_AREAS.map((a) => ({ id: a.id, depth: a.depth, landmark: a.mesh })),
  // No places: the scene gives them no stop and no lock, and parks at CHECKPOINT.park and BOUNTY.park.
  { id: CHECKPOINT.id, depth: 0, landmark: CHECKPOINT.mesh },
  { id: BOUNTY.id, depth: 0, landmark: BOUNTY.mesh },
];

/** A picked anchor's slot: a place's, CP or BT for a checkpoint while it shows, else -1. */
function pickSlot(id: string | null, cpShown: boolean, btShown: boolean): number {
  if (id === CHECKPOINT.id) return cpShown ? CP : -1;
  if (id === BOUNTY.id) return btShown ? BT : -1;
  return id ? slotOf(id) : -1;
}

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
  /** Cheap laptops: poster mode as the scene and the page see it. */
  __worldPoster?: () => unknown;
  /** Progress UI (2026-09-28): the card, the chip, the panel and the timeline as drawn. */
  __worldUi?: () => unknown;
  /** The WorldProgress the scene was last given. */
  __worldProgress?: () => WorldProgress | null;
  /** How many times this page has called scene.celebrate(). */
  __worldCelebrations?: number;
  /** ?bench=1: the results, once the bench has run. */
  __worldBench?: BenchResult | null;
  /** A checkpoint ("discount", the default, or "bounty"): shown, its look, its marker and panel, and the rail depth that frames it (depth). */
  __worldCheckpoint?: (which?: Cp) => unknown;
}
/** Where the hooks go: the window, or in a production build an object nobody else holds. */
const harness = () => (HOOKS ? window : {}) as unknown as Harness & Record<string, unknown>;
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
  "__worldPoster",
  "__worldUi",
  "__worldProgress",
  "__worldCelebrations",
  "__worldCheckpoint",
] as const;

/** A transparent pixel: the landing poster's fallback below 760 px, where the page is a list and needs no poster. */
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const NP = POSTER_IDS.length;

/** The scene draws nothing while the tab is hidden, or while a lesson page is open over the map (source.paused). */
const scenePaused = (source: WorldSource | undefined) => document.hidden || !!source?.paused;

function copyMarkers(ms: readonly ProjectedMarker[] | undefined) {
  return (ms ?? []).map((m) => ({ id: m.id, x: m.x, y: m.y, visible: m.visible, proximity: m.proximity }));
}

type View = "unknown" | "world" | "list";
type Phase = "loading" | "ready" | "failed";
type Dir = "none" | "fwd" | "back";

/**
 * `corner`: the host's group at the header's right end, the brand alone at the
 * left (2026-10-15, Lovro's review): the student's streak, achievements, the
 * Playbook and Sign out (src/components/world/WorldCorner.tsx). The map calls
 * it with its discount segment (null without a discount on the source), which the
 * group puts after the achievements, and with whether the checkpoint's panel
 * is up (open and not closing), which closes the achievements list as a place
 * opening does. It is laid out by its own stylesheet, which reads this root's
 * data-view, data-open and data-solid. The dev page
 * has none, and shows the segment in a pill of its own.
 */
type Corner = (discount: ReactNode, checkpointOpen: boolean) => ReactNode;

/** A checkpoint's tag on the timeline, between the place it follows and the next (`gates` in WorldV6View). */
interface Gate {
  key: string;
  /** The place it follows (0-based). */
  after: number;
  /** Its look: the discount's locked, ready, pending, done or closed (checkpointView.ts); the Ad Bounty's open, or done once watched. */
  state: CheckpointView["tag"] | "open";
  /** Its shape: the discount's price tag, the Ad Bounty's pinned notice. */
  glyph: "tag" | "notice";
  /** The words on the tag: "30% off", "Ad Bounty". */
  text: string;
  /** The tip on hover and focus: what it is, then where it stands. */
  tip: { lead: string; tail: string };
  /** What a screen reader hears. */
  label: string;
  ref?: RefObject<HTMLButtonElement | null>;
  open: (trigger: HTMLElement | null) => void;
}

export function WorldV6({ source, corner }: { source?: WorldSource; corner?: Corner } = {}) {
  // The course's words and counts, for the map and every component under it (content.ts).
  const content = useMemo(() => contentOf(source), [source]);
  return (
    <WorldContentContext.Provider value={content}>
      <WorldV6View source={source} content={content} corner={corner} />
    </WorldContentContext.Provider>
  );
}

function WorldV6View({
  source,
  content,
  corner,
}: {
  source: WorldSource | undefined;
  content: WorldContent;
  corner?: Corner;
}) {
  const hasSource = source !== undefined;
  /** A lesson page is open over the map (always false on the dev page). */
  const paused = source?.paused ?? false;
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, getUnknown);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, getFalse);
  const [phase, setPhase] = useState<Phase>("loading");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [dir, setDir] = useState<Dir>("none");
  const [closing, setClosing] = useState(false);
  const [hoverStop, setHoverStop] = useState<number | null>(null);
  /** The content tier the scene runs at (0..3): 2 and 3 get solid surfaces, no backdrop filter. */
  const [tier, setTier] = useState(0);
  /** The place that reached 100% in this session: its card is the done card until Start. */
  const [doneCard, setDoneCard] = useState<number | null>(null);
  /** The place panel shows the watched lessons folded into one row until Show. */
  const [showWatched, setShowWatched] = useState(false);
  const [hint, setHint] = useState<{ k: number; seq: number } | null>(null);
  /** A checkpoint's panel is open (the map's own: it has no address), and closing; cpKind says which. */
  const [cpOpen, setCpOpen] = useState(false);
  const [cpClosing, setCpClosing] = useState(false);
  const [cpKind, setCpKind] = useState<Cp>("discount");
  /** The timeline's checkpoint tag the pointer or the keyboard is on (its key). */
  const [gateTip, setGateTip] = useState<string | null>(null);
  // The server render and the first client render use the defaults; the
  // stored tuning is read once mounted (localStorage is client only).
  const [devTuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [tuningLoaded, setTuningLoaded] = useState(false);
  // With a source nothing is tuned: the default pacing, the source's lock, and
  // the frontier where its student is. It goes to the scene the same way.
  const sourceLock = source?.lock;
  const sourceFrontier = source?.study.current;
  const tuning = useMemo<Tuning>(
    () =>
      sourceLock === undefined || sourceFrontier === undefined
        ? devTuning
        : { ...DEFAULT_TUNING, lock: sourceLock, frontier: sourceFrontier },
    [devTuning, sourceLock, sourceFrontier],
  );
  // Cheap laptops: poster mode (poster.ts), the landing poster, and ?bench=1.
  const [poster, setPoster] = useState<{ reason: string; kind: PosterKind | null; headless: boolean; canTry: boolean } | null>(null);
  const [posterReady, setPosterReady] = useState(false);
  // After "Try 3D anyway": the posters offered (not forced) when the 3D still cannot cope.
  const [posterOffer, setPosterOffer] = useState<string | null>(null);
  const [bench, setBench] = useState<{ status: string; result: BenchResult | null; copied: string } | null>(null);
  const posterRef = useRef<HTMLDivElement | null>(null);
  const posterImgs = useRef<Array<HTMLImageElement | null>>([]);
  const manifestRef = useRef<PosterManifest | null>(null);

  const fixtureStudy = useMemo(
    () => studyFor(tuning.frontier, tuning.finished, tuning.partial, tuning.lock),
    [tuning.frontier, tuning.finished, tuning.partial, tuning.lock],
  );
  const study = source ? source.study : fixtureStudy;
  const areas = content.areas;
  /** The student's discount (with a source that knows it) and what the map shows of it. */
  const discount = source?.discount ?? null;
  const cpView = useMemo<CheckpointView | null>(
    () => (discount ? checkpointView(discount.state, discount.now, study.place, CHECKPOINT.after) : null),
    [discount, study.place],
  );
  // Shown for every student and state once the source knows the discount (Lovro's second Loom, 2026-10-16).
  const cpShown = cpView !== null;
  const cpLook: CheckpointLook = cpView?.look ?? "closed";
  /** The Ad Bounty's one lesson (plan item 18): its checkpoint shows whenever the course has it. */
  const bounty = useMemo(() => bountyOf(source, areas), [source, areas]);
  const btShown = bounty !== null;

  const view: View = narrow === null ? "unknown" : narrow || phase === "failed" ? "list" : "world";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const snapRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<LabelLayout | null>(null);
  const lastFrame = useRef<WorldFrame | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const markersRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const doneElRef = useRef<HTMLElement | null>(null);
  const chipRef = useRef<HTMLElement | null>(null);
  const leaderRef = useRef<SVGPathElement | null>(null);
  /** The diamond at the leader's landmark end, for the panel (the markers are hidden while parked). */
  const leaderPinRef = useRef<SVGGElement | null>(null);
  const timelineRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLSpanElement | null>(null);
  const cueRef = useRef<HTMLDivElement | null>(null);
  /** The welcome over the opening (with a source), faded by the frame loop. */
  const welcomeRef = useRef<HTMLElement | null>(null);
  const shadeRef = useRef<HTMLDivElement | null>(null);
  /** Final pass C: the telescope's lens (vignette) and its caption, faded by the a7 park. */
  const lensRef = useRef<HTMLDivElement | null>(null);
  const lensCapRef = useRef<HTMLParagraphElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelInnerRef = useRef<HTMLDivElement | null>(null);
  /** The checkpoint's panel, its heading, the timeline's tag; and whether it shows and how, for code outside React. */
  const cpPanelRef = useRef<HTMLElement | null>(null);
  const cpHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const cpTagRef = useRef<HTMLButtonElement | null>(null);
  const cpRef = useRef<{ shown: boolean; look: CheckpointLook }>({ shown: false, look: "closed" });
  /** The Ad Bounty's timeline tag, and whether its checkpoint shows, for code outside React. */
  const btTagRef = useRef<HTMLButtonElement | null>(null);
  const btRef = useRef(btShown);
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
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const depthsRef = useRef<Float64Array>(Float64Array.from(STUDY_AREAS.map((a) => a.depth)));
  /** Viewport and track sizes the frame loop reads, and the free band between the header and the timeline. Written only by the measure effect. */
  const sizesRef = useRef({ w: 0, h: 0, trackW: 0, safeT: 80, safeB: 0 });
  const applyRef = useRef<((f: WorldFrame) => void) | null>(null);
  const studyRef = useRef<Study>(study);
  const tuningRef = useRef<Tuning>(tuning);
  /** The source and its areas, for the callbacks and the frame loop (undefined: the dev page). */
  const sourceRef = useRef<WorldSource | undefined>(source);
  const areasRef = useRef<readonly StudyArea[]>(areas);
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
    /** Long travel: the frozen frame's state (LONG_HOP). */
    snap: null as { phase: "want" | "jumped"; land: number; landY: number; to: number; frames: number; timer: number } | null,
    /** The labels during a dissolve: 0 shown, -1 hidden, else the time their fade in began. */
    markHold: 0,
    region: 0,
    readout: "",
    /** Poster mode: the posters are the map. */
    poster: false,
    posterSeq: 0,
    /** Last scroll event (the card waits for the scroll and the camera to rest). */
    scrollAt: 0,
    restTimer: 0,
    celebrateTimer: 0,
    arriveTimer: 0,
    /** The place whose done card is up (reached 100% this session), or -1. */
    doneK: -1,
    /** The progress the scene last got. */
    wp: null as WorldProgress | null,
    /** With a source: the place the address named when the page loaded, until it has opened (reconcile); else -1. */
    seedK: source?.openK ?? -1,
    /** That place is waiting under a lesson page, and the page scroll is locked for it (reconcile). */
    seedHold: false,
    /** A checkpoint's panel: open, flying home, what opened it, focus to go back once home, and which checkpoint. */
    cp: false,
    cpClosing: false,
    cpTrigger: null as HTMLElement | null,
    cpReturn: false,
    cpKind: "discount" as Cp,
    /** The Ad Bounty's page was opened by its address with no checkpoint panel under it: the checkpoint opens once the page closes (reconcile). */
    bountySeed: false,
    /** The phone list has been up since the scene last ran (a resize under 760 px): the next scene starts where the student was. */
    fromList: false,
    /** The camera's rail depth when the 3D last gave way to the list; -1 when it never did. */
    listDepth: -1,
  });

  useEffect(() => {
    ui.current.reduced = reduced;
  }, [reduced]);

  useLayoutEffect(() => {
    studyRef.current = study;
  }, [study]);

  useLayoutEffect(() => {
    sourceRef.current = source;
    areasRef.current = areas;
  }, [source, areas]);

  // A lesson page opened over the map, or closed (source.paused; never on the
  // dev page): the scene stops drawing, or wakes before the held progress goes in.
  useLayoutEffect(() => {
    sceneRef.current?.setPaused(scenePaused(sourceRef.current));
  }, [paused]);

  // ── Tuning. Read once mounted; every later change is saved and, if the
  // pacing or the lock moved the scroll range, the camera is kept in place.
  // With a source there is no stored tuning to wait for.
  useEffect(() => {
    if (!hasSource) {
      const stored = loadTuning();
      if (!sameTuning(stored, DEFAULT_TUNING)) setTuning(stored);
    }
    setTuningLoaded(true);
  }, [hasSource]);

  const updateTuning = useCallback((patch: Partial<Tuning> | "reset") => {
    const prev = tuningRef.current;
    // With a source the tuning is the source's: nothing to change, nothing stored.
    if (sourceRef.current) return prev;
    const next = patch === "reset" ? DEFAULT_TUNING : sanitize({ ...prev, ...patch }, prev);
    if (sameTuning(prev, next)) return prev;
    tuningRef.current = next;
    if (patch === "reset") clearTuning();
    else saveTuning(next);
    setTuning(next);
    return next;
  }, []);

  /**
   * A place reached 100% in this session: the scene's moment (celebrate, from
   * the world builder; polled for a while in case its module is still
   * installing), then the done card in place of the arrival card.
   */
  const celebrate = useCallback((k: number) => {
    const u = ui.current;
    u.doneK = k;
    setDoneCard(k);
    window.clearTimeout(u.celebrateTimer);
    let tries = 40;
    const run = () => {
      const sc = sceneRef.current as (WorldScene & { celebrate?: (area: number) => void }) | null;
      if (!sc) return;
      if (typeof sc.celebrate === "function") {
        const w = harness();
        w.__worldCelebrations = (w.__worldCelebrations ?? 0) + 1;
        try {
          sc.celebrate(k);
        } catch (e) {
          console.error("[world-v6] celebrate threw", e);
        }
        return;
      }
      if (--tries > 0) u.celebrateTimer = window.setTimeout(run, 500);
    };
    run();
    // The scene may be asleep with the arrival card up: redraw once the done card has rendered.
    requestAnimationFrame(() => {
      const f = lastFrame.current;
      if (f) applyRef.current?.(f);
    });
  }, []);

  /** The per-lesson progress for the scene; a place just finished gets its moment. */
  const sendProgress = useCallback(
    (scene: WorldScene, st: Study) => {
      const u = ui.current;
      const wp = progressOf(areasRef.current, st);
      const prev = u.wp;
      u.wp = wp;
      scene.setWorldProgress(wp);
      let justDone = -1;
      if (sourceRef.current) {
        // A real student can finish any place, and more than one between two
        // sends (a lesson page was open): the first that went from under 100% to 100%.
        if (prev && u.live) {
          for (let k = 0; k < N; k++) {
            if (areaShare(prev, k) < 1 && areaShare(wp, k) >= 1) {
              justDone = k;
              break;
            }
          }
        }
      } else if (
        prev &&
        u.live &&
        prev.current < N &&
        wp.current !== prev.current &&
        areaShare(prev, prev.current) < 1 &&
        areaShare(wp, prev.current) >= 1
      ) {
        justDone = prev.current;
      }
      if (justDone >= 0) {
        celebrate(justDone);
      } else if (u.doneK >= 0 && areaShare(wp, u.doneK) < 1) {
        // The tuning took that place back below 100%: no done card for it.
        u.doneK = -1;
        setDoneCard(null);
      }
    },
    [celebrate],
  );

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
    // A lesson page is open over the map: the progress waits, and goes in once when it closes.
    if (sourceRef.current?.paused) return;
    // setLock also puts the places past the frontier in mist (look mode).
    if (!was || progressRef.current !== st.progress) {
      progressRef.current = st.progress;
      scene.setProgress(st.progress);
    }
    sendProgress(scene, st);
  }, [writeRide, sendProgress]);

  useLayoutEffect(() => {
    tuningRef.current = tuning;
    const scene = sceneRef.current;
    if (!scene || !ui.current.live) return;
    applyTuning(scene, tuning, studyRef.current);
    // A place that just became locked cannot stay open (the scene has already refused it).
    const u = ui.current;
    if (u.open >= 0 && !u.closing && tuning.lock !== "open" && u.open > tuning.frontier) closeAreaRef.current?.();
    // With a source the study moves without the tuning (a lesson watched), and
    // `paused` turning false sends what was held. On the dev page neither adds a run.
  }, [tuning, study, paused, applyTuning]);

  /** Dev (TUNE): the next lesson at the student's place counts as watched; the last one finishes the place. */
  const watchNext = useCallback(() => {
    const t = tuningRef.current;
    const st = studyRef.current;
    const k = st.place;
    if (k >= N) return;
    const n = areasRef.current[k].lessons;
    if (st.done[k] + 1 < n) updateTuning({ frontier: k, partial: st.done[k] + 1 });
    else updateTuning({ finished: Math.max(t.finished, k + 1), frontier: Math.min(N - 1, k + 1), partial: 0 });
  }, [updateTuning]);

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

  /** Long travel: dissolve the frozen frame away (the camera already jumped) or drop it (it had not). */
  const fadeSnap = useCallback((ms: number) => {
    const u = ui.current;
    const s = u.snap;
    u.snap = null;
    if (s) window.clearTimeout(s.timer);
    const cv = snapRef.current;
    if (!cv) return;
    if (s?.phase === "want" || ms <= 0) {
      cv.style.transition = "none";
      cv.style.opacity = "0";
      u.markHold = 0;
      return;
    }
    cv.style.transition = `opacity ${ms}ms cubic-bezier(0.33, 0, 0.2, 1)`;
    cv.style.opacity = "0";
    u.markHold = performance.now();
  }, []);

  const cancelTween = useCallback(() => {
    const u = ui.current;
    if (u.tween) cancelAnimationFrame(u.tween);
    u.tween = 0;
    if (u.snap) fadeSnap(u.snap.phase === "jumped" ? 300 : 0);
    if (u.stopTween) {
      const stop = u.stopTween;
      u.stopTween = null;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("pointerdown", stop);
    }
  }, [fadeSnap]);

  /** The scroll tween behind every travel. Needs u.stopTween armed by the caller. */
  const glideRef = useRef((from: number, to: number, duration: number, ease: (t: number) => number) => {
    const u = ui.current;
    if (u.tween) cancelAnimationFrame(u.tween);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      window.scrollTo({ top: from + (to - from) * ease(t), left: 0, behavior: "instant" });
      if (t < 1) u.tween = requestAnimationFrame(step);
      else cancelTweenRef.current();
    };
    u.tween = requestAnimationFrame(step);
  });
  const cancelTweenRef = useRef(cancelTween);
  useEffect(() => {
    cancelTweenRef.current = cancelTween;
  }, [cancelTween]);

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
      // The checkpoint's panel gives way to the place; the scroll lock carries over.
      if (u.cp) {
        u.cp = false;
        u.cpClosing = false;
        setCpOpen(false);
        setCpClosing(false);
      }
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
      setShowWatched(false);
      setLesson(null);
      setDir("none");
      setClosing(false);
      sceneRef.current?.park(STUDY_AREAS[idx].id);
      // With a source the address follows, unless it is the address that opened this place.
      const src = sourceRef.current;
      if (src && src.openK !== idx) src.onOpenArea(idx);
      // Its first lesson not done is the likeliest click: ask for its video while the camera flies in.
      if (src?.onPrefetch) {
        for (let i = 0; i < src.areas[idx].lessons; i++) {
          if (src.isDone(idx, i)) continue;
          src.onPrefetch(idx, i);
          break;
        }
      }
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
    // With a source the address follows, unless it is the address that closed this place.
    const src = sourceRef.current;
    if (src && src.openK !== null) src.onCloseArea();
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

  /**
   * The discount checkpoint's panel. It opens as a place does: the scroll
   * locks and the camera parks at the cache (CHECKPOINT.park). An open
   * place's panel gives way to it (the address goes back to the map). From
   * far away (the cache's marker is not on screen: the header's chip on day
   * one, the timeline's tag) the scroll first jumps to the rail point that
   * frames the cache, as an address naming a place does (reconcile), so the
   * cache opens in its own sunset light after a short flight, and Back leaves
   * the student on the trail in front of it. The next video the offer asks
   * for is asked for ahead.
   *
   * `kind` "bounty" opens the Ad Bounty's checkpoint the same way (plan item
   * 18), parked at the board. One checkpoint's panel up gives way to the
   * other's (the header's discount from the bounty's panel): its scroll lock
   * ends and the other's jump and lock follow, as from a place.
   */
  const openCheckpoint = useCallback(
    (trigger: HTMLElement | null, kind: Cp = "discount") => {
      const u = ui.current;
      const shown = kind === "bounty" ? btRef.current : cpRef.current.shown;
      if (!shown || (u.cp && !u.cpClosing && u.cpKind === kind)) return;
      cancelTween();
      window.clearInterval(u.closeTimer);
      if (u.cp && u.cpKind !== kind) {
        u.cp = false;
        u.cpClosing = false;
        unlock();
      }
      if (u.open >= 0) {
        const src = sourceRef.current;
        if (src && src.openK !== null) src.onCloseArea();
        u.open = -1;
        u.closing = false;
        u.lesson = -1;
        setOpenIdx(null);
        setLesson(null);
        setClosing(false);
        setDir("none");
        // The place's scroll lock ends here; the checkpoint takes its own below.
        unlock();
      }
      const sc = sceneRef.current;
      const id = cpAnchor(kind);
      // With no 3D at all (a headless scene: ?poster=on, a software renderer, a remembered verdict) no
      // landmark is built and depthFor gives 0, the opening: the panel opens over the poster the student
      // is on instead, and Back leaves them there (the second fix round, 2026-10-17).
      if (!u.cp && sc && u.live && !sc.posterState().headless) {
        const depth = sc.depthFor(id);
        const m = lastFrame.current?.markers.find((x) => x.id === id);
        const at = lastFrame.current?.depth ?? -1;
        if (!m?.visible || Math.abs(depth - at) > CP_NEAR) {
          window.scrollTo({ top: Math.round(sc.scrollYForDepth(depth)), left: 0, behavior: "instant" });
          sc.seedDepth(depth);
        }
      }
      if (!u.cp) {
        lock();
        const was = document.activeElement;
        u.cpTrigger = trigger ?? (was instanceof HTMLElement && was !== document.body ? was : null);
      }
      u.cp = true;
      u.cpClosing = false;
      u.cpKind = kind;
      setCpKind(kind);
      setCpOpen(true);
      setCpClosing(false);
      sceneRef.current?.park(id);
      const d = sourceRef.current?.discount;
      if (kind === "discount" && d?.next) sourceRef.current?.onPrefetch?.(d.next.k, d.next.i);
    },
    [cancelTween, lock, unlock],
  );

  const finalizeCheckpoint = useCallback(() => {
    const u = ui.current;
    if (!u.cp) return;
    window.clearInterval(u.closeTimer);
    u.cp = false;
    u.cpClosing = false;
    u.cpReturn = true;
    unlock();
    setCpOpen(false);
    setCpClosing(false);
  }, [unlock]);

  /** Back to the map: the camera flies home to the depth the page scroll says, as closeArea does. */
  const closeCheckpoint = useCallback(() => {
    const u = ui.current;
    if (!u.cp || u.cpClosing) return;
    u.cpClosing = true;
    setCpClosing(true);
    if (u.locked) restoreScroll();
    const scene = sceneRef.current;
    scene?.park(null);
    const f = lastFrame.current;
    if (!scene || !u.live || u.reduced || !f || f.parkProgress <= 0.001 || scene.isContextLost()) {
      finalizeCheckpoint();
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
        finalizeCheckpoint();
      }
    }, 1000);
  }, [finalizeCheckpoint, restoreScroll]);

  // What shows and the cache's look, for the frame loop and the scene; an
  // offer that stops showing (its window ran out) closes its panel. The same
  // for the Ad Bounty's checkpoint, which shows while the course has its lesson.
  useLayoutEffect(() => {
    cpRef.current = { shown: cpShown, look: cpLook };
    btRef.current = btShown;
    sceneRef.current?.setCheckpoint(cpLook);
    const u = ui.current;
    if (u.cp && ((u.cpKind === "discount" && !cpShown) || (u.cpKind === "bounty" && !btShown))) closeCheckpoint();
    const f = lastFrame.current;
    if (f) applyRef.current?.(f);
  }, [cpShown, cpLook, btShown, closeCheckpoint]);

  const openLesson = useCallback((i: number) => {
    const u = ui.current;
    // With a source a lesson is a page of the host's: the panel's placeholder view never opens.
    const src = sourceRef.current;
    if (src) {
      if (u.open >= 0) src.onWatch(u.open, i);
      return;
    }
    u.lesson = i;
    u.lessonReturn = -1;
    setDir("fwd");
    setLesson(i);
  }, []);

  /** Watch: open the place and play the lesson straight away (lessons play, they are never checked off). */
  const watch = useCallback(
    (k: number, i: number, el: HTMLElement | null) => {
      if (k < 0 || k >= N) return;
      // With a source: ask for the lesson's page and change nothing here (the address opens the place).
      const src = sourceRef.current;
      if (src) {
        if (i >= 0) src.onWatch(k, i);
        return;
      }
      openArea(k, el, i);
      if (ui.current.open === k && i >= 0) openLesson(i);
    },
    [openArea, openLesson],
  );

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
      // Any real input takes the scroll back.
      const stop = () => cancelTween();
      u.stopTween = stop;
      window.addEventListener("wheel", stop, { passive: true });
      window.addEventListener("touchstart", stop, { passive: true });
      window.addEventListener("keydown", stop);
      window.addEventListener("pointerdown", stop);
      const at = lastFrame.current?.depth ?? depth;
      // Long travel: freeze the frame, jump under it, dissolve into a short glide (LONG_HOP).
      // The next rendered frame is copied in onFrame (the WebGL buffer is only
      // readable in the task that drew it); seedDepth wakes the scene for it.
      if (Math.abs(depth - at) > LONG_HOP) {
        const land = Math.max(0, depth - LAND_DEPTH);
        const landY = Math.round(scene.scrollYForDepth(land));
        if (u.poster || !snapRef.current) {
          // Posters: a cut to the landing, then the glide.
          window.scrollTo({ top: landY, left: 0, behavior: "instant" });
          scene.seedDepth(land);
          glideRef.current(landY, to, LAND_MS, easeOutCubic);
          return;
        }
        u.markHold = -1;
        u.snap = { phase: "want", land, landY, to, frames: 0, timer: 0 };
        // No frame within 400 ms (a hidden tab, a lost context): travel as before.
        u.snap.timer = window.setTimeout(() => {
          if (u.snap?.phase !== "want") return;
          fadeSnap(0);
          glideRef.current(window.scrollY, to, Math.min(2600, 700 + (Math.abs(depth - at) / END_DEPTH) * 2600), easeInOutCubic);
        }, 400);
        scene.seedDepth(at);
        return;
      }
      const span = Math.abs(depth - at) / END_DEPTH;
      glideRef.current(from, to, Math.min(2600, 700 + span * 2600), easeInOutCubic);
    },
    [cancelTween, fadeSnap, showHint],
  );

  /**
   * With a source the address says which place is open (source.openK): bring
   * the component to it. Nothing is reported back, since openArea and
   * closeArea skip the callback when the source already says so. The world
   * view waits for the scene, which calls this again once it is live; the list
   * view acts at once.
   *
   * A place the address named at load (a deep link) opens with the page still
   * at the top, so the camera would fly in from the opening frame and home to
   * it on close, with no arrival after. The scroll is put on the place's stop
   * first (travel's instant jump), so it opens from its own stop and closes
   * back to it. Under a lesson page that waits until the page closes: nothing
   * moves behind a lesson. The page scroll is locked for the wait, as it is
   * under any lesson page, so the page is still at the top when it ends.
   */
  const reconcile = useCallback(
    (inWorld: boolean) => {
      const src = sourceRef.current;
      if (!src) return;
      const u = ui.current;
      const want = src.openK ?? -1;
      // The lesson page a place was waiting under has closed: the wait's scroll lock goes.
      if (u.seedHold && !src.paused) {
        u.seedHold = false;
        unlock();
      }
      // The Ad Bounty's page opened by its address (a refresh, a link from
      // outside the map) has no checkpoint panel under it: the checkpoint
      // opens once the page closes, so the page's back link and Esc come home
      // to the panel (plan item 18), as a place named by a lesson's address
      // opens once its page closes (below). Nothing moves behind the page.
      if (src.bountyOpen && !u.cp) u.bountySeed = true;
      if (u.bountySeed && !src.paused) {
        if (want >= 0) u.bountySeed = false;
        else if (!inWorld || u.live) {
          u.bountySeed = false;
          openCheckpoint(null, "bounty");
          return;
        }
      }
      // Already there, or already closing toward it.
      if (want === (u.closing ? -1 : u.open)) return;
      if (inWorld && !u.live) return;
      if (want < 0) {
        closeArea();
        return;
      }
      if (inWorld && want === u.seedK && u.open === -1 && window.scrollY < 2) {
        if (src.paused) {
          if (!u.locked) {
            lock();
            u.seedHold = true;
          }
          return;
        }
        travel(want, true);
      }
      u.seedK = -1;
      openArea(want, null);
      // Once it is open the scroll lock is the open place's.
      if (u.open === want) u.seedHold = false;
    },
    [openArea, closeArea, travel, lock, unlock, openCheckpoint],
  );
  const openK = source ? source.openK : null;
  useEffect(() => {
    if (view !== "unknown") reconcile(view === "world");
    // `paused`: a place that waited under a lesson page opens when the page closes.
  }, [openK, view, paused, reconcile]);

  /**
   * Long travel, per rendered frame: copy the frame the student sees, show it
   * over the canvas and jump the camera under it; once the destination has
   * drawn a few frames, dissolve it while the glide runs into the stop.
   */
  const stepSnap = useCallback(() => {
    const u = ui.current;
    const s = u.snap;
    const scene = sceneRef.current;
    if (!s || !scene) return;
    if (s.phase === "want") {
      const gl = stageRef.current?.querySelector("canvas");
      const cv = snapRef.current;
      const ctx = cv?.getContext("2d", { alpha: false });
      if (!gl || !cv || !ctx || gl.width < 2 || gl.style.visibility === "hidden") return;
      if (cv.width !== gl.width || cv.height !== gl.height) {
        cv.width = gl.width;
        cv.height = gl.height;
      }
      ctx.drawImage(gl, 0, 0);
      cv.style.transition = "none";
      cv.style.opacity = "1";
      s.phase = "jumped";
      window.clearTimeout(s.timer);
      // After this frame's task: the copy is taken, the camera may move.
      queueMicrotask(() => {
        if (u.snap !== s) return;
        window.scrollTo({ top: s.landY, left: 0, behavior: "instant" });
        scene.seedDepth(s.land);
        s.frames = u.frames;
        glideRef.current(s.landY, s.to, LAND_MS, easeOutCubic);
        // A destination that never draws (a stall) still dissolves.
        s.timer = window.setTimeout(() => {
          if (u.snap === s) fadeSnap(DISSOLVE_MS);
        }, 450);
      });
      return;
    }
    // Two frames of the destination drawn (uploads done behind the frozen frame).
    if (s.frames >= 0 && u.frames - s.frames >= 3) fadeSnap(DISSOLVE_MS);
  }, [fadeSnap]);

  // ── Posters (cheap laptops). The landing poster is in the server HTML (k0),
  // swapped for the nearest stop's when the page opens scrolled; the live 3D
  // crossfades in once it has drawn a few frames. In poster mode every poster
  // loads and the frame loop crossfades them by depth (apply, below).
  const loadManifest = useCallback(() => {
    if (manifestRef.current) return;
    fetch("/world-v6/posters/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: PosterManifest | null) => {
        if (m && Array.isArray(m.posters)) manifestRef.current = m;
        const f = lastFrame.current;
        if (f) applyRef.current?.(f);
      })
      .catch(() => {});
  }, []);

  const showPosterLayer = useCallback((all: boolean) => {
    const layer = posterRef.current;
    if (layer) layer.dataset.show = "";
    if (!all) return;
    posterImgs.current.forEach((img, i) => {
      if (img && i > 0 && !img.getAttribute("src")) img.src = posterSrc(POSTER_IDS[i]);
    });
  }, []);

  /** Fade the posters out once the 3D has drawn `n` frames (or after 1.5 s, reduced motion draws one). */
  const revealLive = useCallback((n = 3) => {
    const u = ui.current;
    const seq = ++u.posterSeq;
    const from = u.frames;
    const t0 = performance.now();
    const step = () => {
      if (seq !== u.posterSeq || u.poster) return;
      const drawn = u.frames - from;
      if (drawn >= n || (drawn >= 1 && performance.now() - t0 > 1500) || performance.now() - t0 > 4000) {
        const layer = posterRef.current;
        if (layer) delete layer.dataset.show;
        posterImgs.current.forEach((img) => {
          if (!img) return;
          img.style.opacity = "";
          img.style.transform = "";
        });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  useLayoutEffect(() => {
    if (view !== "world") return;
    // The nearest poster to where the page opened (scroll restored on reload).
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const k = max > 0 && window.scrollY > 0 ? landingPoster(window.scrollY / max, depthsRef.current) : 0;
    if (k > 0) {
      const img = posterImgs.current[k];
      if (img) {
        img.src = posterSrc(POSTER_IDS[k]);
        img.dataset.on = "";
      }
      if (posterImgs.current[0]) delete posterImgs.current[0].dataset.on;
    }
    const first = posterImgs.current[k];
    if (first?.complete && first.naturalWidth > 1) setPosterReady(true);
  }, [view]);

  // ── The scene. Created only on the world view, so phones never load three.js,
  // and only once the stored tuning is known, so it starts on the right budgets.
  useEffect(() => {
    if (view !== "world" || !tuningLoaded) return;
    const stage = stageRef.current;
    if (!stage) return;
    const u = ui.current;
    const w = harness();
    // The eight places and the two checkpoints (slots CP and BT).
    const layout = layoutRef.current ?? (layoutRef.current = new LabelLayout(SLOTS));
    const depths = depthsRef.current;
    const sizes = sizesRef.current;
    const bySlot: Array<ProjectedMarker | null> = new Array(SLOTS).fill(null);
    const domMode = new Uint8Array(SLOTS).fill(255);
    const domStem = new Float32Array(SLOTS).fill(-1);
    const domShift = new Int32Array(SLOTS);
    const domX = new Int32Array(SLOTS).fill(-99999);
    const domY = new Int32Array(SLOTS).fill(-99999);
    // Round 1: the whole landmark is the button. The pointer's place (slot, or
    // -1), picked on pointer events only (at most once per animation frame),
    // never in the frame loop. The scene lifts the hovered landmark's light.
    const hover = { x: 0, y: 0, has: false, raf: 0, timer: 0, slot: -1 };
    const setHover = (k: number, redraw = true) => {
      if (k === hover.slot) return;
      const was = markerRefs.current[hover.slot];
      if (was) delete was.dataset.hover;
      hover.slot = k;
      const el = markerRefs.current[k];
      if (el) el.dataset.hover = "";
      stage.style.cursor = k < 0 ? "" : k < N && studyRef.current.locked[k] ? "not-allowed" : "pointer";
      sceneRef.current?.setHoverAnchor(k < 0 ? null : k === CP ? CHECKPOINT.id : k === BT ? BOUNTY.id : STUDY_AREAS[k].id);
      // The scene may be asleep: lay the labels out now.
      const f = lastFrame.current;
      if (redraw && f) apply(f);
    };
    const cache = {
      p: -1,
      markersA: -1,
      markersLive: true,
      panelEl: null as HTMLElement | null,
      panelP: -1,
      caretX: -1,
      cue: -1,
      cueOff: false,
      welcome: -1,
      /** The welcome's data-on as last written: 1, 0, or -1 before the first frame. */
      welcomeOn: -1,
      // The card (2026-09-28): which element and place are up, and where it was placed from.
      cardEl: null as HTMLElement | null,
      cardK: -1,
      /** The arrival card's last placement, and the done card's anchor to it (anchorCard). */
      cardH: -1,
      cardPl: null as { k: number; x: number; y: number; h: number; side: Placement["side"]; pinX: number; pinY: number } | null,
      anchor: null as { k: number; x: number; y: number; h: number; side: Placement["side"]; pinX: number; pinY: number } | null,
      pinX: NaN,
      pinY: NaN,
      vw: 0,
      vh: 0,
      chip: false,
      chipDir: "",
      leader: "",
      /** The panel's placement: made once per open (and per resize), the leader once the camera has arrived. */
      panelFor: -1,
      panelVw: 0,
      panelPinX: NaN,
      panelPinY: NaN,
      tuning: null as Tuning | null,
      totalVh: 1,
      /** Final pass C: how far into the telescope park (0 elsewhere). */
      tel: -1,
      /** The checkpoint's panel, as the place panel's above. */
      cpEl: null as HTMLElement | null,
      cpP: -1,
      cpVw: 0,
      cpPinX: NaN,
      cpPinY: NaN,
    };
    const cardPl: Placement = { x: 0, y: 0, side: "r", d: "", overlap: 0 };
    const panelPl: Placement = { x: 0, y: 0, side: "l", d: "", overlap: 0 };
    const cpPl: Placement = { x: 0, y: 0, side: "l", d: "", overlap: 0 };
    const box: Box = { l: 0, t: 0, r: 0, b: 0 };
    /** Final pass: the other places' plaques on screen, which the card keeps off (cardPlace avoid);
     *  the Ad Bounty's, which shows across the island from Creative Strategy's stop; and the
     *  30%'s, which shows for every student since 2026-10-16, near the cache since 2026-10-17
     *  (no stop's card meets it on today's route). */
    const avoidBoxes: Box[] = [];
    const plaquesBesides = (k: number): Box[] => {
      avoidBoxes.length = 0;
      for (let j = 0; j <= BT; j++) {
        if (j === k) continue;
        const el = markerRefs.current[j];
        const label = labelRefs.current[j];
        if (!el || !label || el.dataset.mode !== "text") continue;
        const r = label.getBoundingClientRect();
        if (r.width > 0) avoidBoxes.push({ l: r.left - 8, t: r.top - 8, r: r.right + 8, b: r.bottom + 8 });
      }
      return avoidBoxes;
    };
    /** The landmark's box on screen, clipped to the frame, into `box`; false when there is none. */
    const boxOf = (m: ProjectedMarker | null): boolean => {
      if (!m) return false;
      const l = Math.max(0, m.rl ?? NaN);
      const r = Math.min(sizes.w, m.rr ?? NaN);
      const t = Math.max(0, m.rt ?? NaN);
      const b = Math.min(sizes.h, m.rb ?? NaN);
      if (!(r - l > 2) || !(b - t > 2)) return false;
      box.l = l;
      box.r = r;
      box.t = t;
      box.b = b;
      return true;
    };
    const setLeader = (d: string) => {
      if (d === cache.leader) return;
      cache.leader = d;
      // The pin is the panel's; any new path hides it until the panel places it again.
      leaderPinRef.current?.setAttribute("visibility", "hidden");
      const el = leaderRef.current;
      if (!el) return;
      if (d) el.setAttribute("d", d);
      else el.removeAttribute("d");
    };
    let disposed = false;
    let scene: WorldScene | null = null;
    /** The camera is within CP_SHOW_WITHIN of the cache: apply() reads it off the scene each frame. */
    let cpNear = false;
    let offPoster: (() => void) | null = null;
    let offOffer: (() => void) | null = null;
    let onPointerMove: ((e: PointerEvent) => void) | null = null;
    let onPointerLeave: (() => void) | null = null;
    let onScrollPick: (() => void) | null = null;
    let onStageClick: ((e: MouseEvent) => void) | null = null;
    let clearHover: (() => void) | null = null;
    let offTier: (() => void) | null = null;
    // The progress surfaces as mounted with this scene (cleared on the way out).
    const uiEls = [cardRef.current, doneElRef.current, chipRef.current];
    const welcomeEl = welcomeRef.current;
    const markerEls = markerRefs.current;
    const leaderEl = leaderRef.current;
    const leaderPinEl = leaderPinRef.current;
    w.__worldView = "world";
    w.__worldCelebrations = 0;
    // The card waits for the scroll to stop; the scene may sleep once the camera settles, so look again then.
    const onScrollRest = () => {
      u.scrollAt = performance.now();
      window.clearTimeout(u.restTimer);
      u.restTimer = window.setTimeout(() => {
        const f = lastFrame.current;
        if (f) applyRef.current?.(f);
      }, REST_MS + 40);
    };
    window.addEventListener("scroll", onScrollRest, { passive: true });

    // Poster mode: which posters show, their drift, and the labels where the
    // 3D had them (the manifest), all from the frame's depth or park.
    const pBlend = { a: 0, b: 0, w: 0, t: 0 };
    const pDepths = new Float64Array(NP);
    const pOp = new Float32Array(NP).fill(-1);
    const pScale = new Float32Array(NP).fill(-1);
    // The eight places, then the 30%'s cache and the Ad Bounty's board (2026-10-16 fix round: the
    // manifest has had both since the posters of that day, and poster mode drew neither). pickSlot
    // puts a checkpoint's in its slot only while it shows, as for the live frame's markers: the
    // 30%'s only near the cache (CP_SHOW_WITHIN), which keeps it off a1's poster.
    const pMarkers: ProjectedMarker[] = [...STUDY_AREAS.map((a) => a.id), CHECKPOINT.id, BOUNTY.id].map((id) => ({ id, x: 0, y: 0, visible: false, proximity: 0, enterable: true, beyond: false }));
    const posterFrame = (f: WorldFrame): { markers: ProjectedMarker[]; k: number } => {
      pDepths[0] = 0;
      for (let k = 0; k < N && k + 1 < NP; k++) pDepths[k + 1] = depths[k];
      const parked = f.parkedId ? slotOf(f.parkedId) : -1;
      let a: number;
      let b: number;
      let wgt: number;
      let t: number;
      if (parked >= 0) {
        a = b = parked + 1;
        wgt = 0;
        t = 0;
      } else {
        posterBlend(f.depth, pDepths, pBlend);
        a = pBlend.a;
        b = pBlend.b;
        wgt = pBlend.w;
        t = pBlend.t;
      }
      // Parked: a slow push toward the place as the panel opens.
      const zoom = parked >= 0 ? 1 + 0.05 * clamp01(f.parkProgress) : 1;
      const scaleOf = (i: number) => (i === a ? (a === b ? zoom : driftScale("leaving", t)) : i === b ? driftScale("arriving", t) : 1);
      for (let i = 0; i < NP; i++) {
        const img = posterImgs.current[i];
        if (!img) continue;
        const op = i === a ? 1 : i === b ? wgt : 0;
        const sc = scaleOf(i);
        if (op !== pOp[i]) {
          pOp[i] = op;
          img.style.opacity = op.toFixed(3);
        }
        if (Math.abs(sc - pScale[i]) > 1e-4) {
          pScale[i] = sc;
          img.style.transform = sc === 1 ? "" : `scale(${sc.toFixed(4)})`;
        }
      }
      // Labels: the nearer poster's, faded out through the middle of the crossfade.
      const towardB = a !== b && t >= 0.5;
      const mi = towardB ? b : a;
      const k = a === b ? 1 : towardB ? smooth(0.65, 0.8, t) : 1 - smooth(0.2, 0.35, t);
      const entry = manifestRef.current?.posters[mi];
      const sc = scaleOf(mi);
      const fit = coverFit(sizes.w, sizes.h, POSTER_W, POSTER_H);
      const cx = sizes.w / 2;
      const cy = sizes.h / 2;
      for (let j = 0; j < pMarkers.length; j++) {
        const pm = pMarkers[j];
        const mm = entry?.markers.find((m) => m.id === pm.id);
        const live = f.markers?.find((m) => m.id === pm.id);
        if (live) {
          pm.enterable = live.enterable;
          pm.beyond = live.beyond;
        }
        if (!mm) {
          pm.visible = false;
          continue;
        }
        const x0 = fit.ox + mm.fx * POSTER_W * fit.scale;
        const y0 = fit.oy + mm.fy * POSTER_H * fit.scale;
        pm.x = cx + (x0 - cx) * sc;
        pm.y = cy + (y0 - cy) * sc;
        pm.visible = mm.visible && k > 0.02;
        pm.proximity = mm.proximity;
        // Final pass E: a pin in the header's band (a3's, fy 0.067, is the falls' top) gets a
        // box reaching down its landmark, so the labels slide it under the header as the live
        // scene's do (labels.ts slide) and it still points at the landmark. Elsewhere none.
        if (pm.visible && pm.y >= 0 && pm.y < sizes.safeT + POSTER_TOP_BAND && pm.x >= 0 && pm.x <= sizes.w) {
          pm.rl = pm.x - POSTER_BOX_HALF;
          pm.rr = pm.x + POSTER_BOX_HALF;
          pm.rt = pm.y + LIFT;
          pm.rb = pm.y + POSTER_BOX_DROP * POSTER_H * fit.scale * sc;
        } else {
          pm.rl = pm.rr = pm.rt = pm.rb = NaN;
        }
      }
      return { markers: pMarkers, k: entry ? k : 0 };
    };

    const onFrame = (f: WorldFrame) => {
      lastFrame.current = f;
      u.frames++;
      if (u.snap) stepSnap();
      if (u.closing && f.parkedId === null && (u.reduced || f.parkProgress <= 1e-4)) finalizeClose();
      if (u.cpClosing && f.parkedId === null && (u.reduced || f.parkProgress <= 1e-4)) finalizeCheckpoint();
      apply(f);
    };

    /** Every per-frame DOM write. Also run once after a measure, because the scene sleeps when idle. */
    const apply = (f: WorldFrame) => {
      const p = u.reduced ? ((u.open >= 0 && !u.closing) || (u.cp && !u.cpClosing) ? 1 : 0) : clamp01(f.parkProgress);
      const chrome = 1 - smooth(0, 0.5, p);
      const pf = u.poster ? posterFrame(f) : null;
      // Long travel: the labels wait under the frozen frame and fade in with the dissolve.
      let dz = 1;
      if (u.markHold < 0) dz = 0;
      else if (u.markHold > 0) {
        dz = smooth(0.35, 1, (performance.now() - u.markHold) / DISSOLVE_MS);
        if (dz >= 1) u.markHold = 0;
      }
      const markersA = (1 - smooth(0, 0.3, p)) * (pf ? pf.k : 1) * dz;
      const frameMarkers = pf ? pf.markers : f.markers;
      const st = studyRef.current;

      if (p !== cache.p) {
        cache.p = p;
        const a = chrome.toFixed(3);
        const tl = timelineRef.current;
        if (tl) {
          tl.style.opacity = a;
          tl.style.transform = `translate3d(0, ${(p * 14).toFixed(2)}px, 0)`;
        }
        shadeRef.current?.style.setProperty("--shade-bottom", a);
      }
      // Final pass C: through the telescope. The lens closes in as the camera
      // passes the tube (a soft circle round the hero constellation) and the
      // caption comes up as it arrives. Opacity only: no repaint per frame.
      const tel = !u.poster && u.open === TEL_K ? p : 0;
      if (tel !== cache.tel) {
        cache.tel = tel;
        const lens = lensRef.current;
        if (lens) lens.style.opacity = smooth(0.12, 0.5, tel).toFixed(3);
        const cap = lensCapRef.current;
        if (cap) cap.style.opacity = smooth(0.8, 1, tel).toFixed(3);
      }
      const markers = markersRef.current;
      if (markers && markersA !== cache.markersA) {
        cache.markersA = markersA;
        markers.style.opacity = markersA.toFixed(3);
        const live = p < 0.02 && markersA > 0.3;
        if (live !== cache.markersLive) {
          cache.markersLive = live;
          markers.style.pointerEvents = live ? "" : "none";
        }
      }

      // The 30% in the world only near the cache (CP_SHOW_WITHIN). In poster mode the scene's camera follows the scroll too.
      if (cpRef.current.shown && scene) {
        const c = scene.cameraPose();
        cpNear = Math.hypot(c.x - CHECKPOINT.x, c.z - CHECKPOINT.z) <= CP_SHOW_WITHIN;
      } else cpNear = false;
      bySlot.fill(null);
      if (frameMarkers) {
        for (let i = 0; i < frameMarkers.length; i++) {
          const k = pickSlot(frameMarkers[i].id, cpRef.current.shown && cpNear, btRef.current);
          if (k >= 0) bySlot[k] = frameMarkers[i];
        }
      }

      // Markers: skipped entirely while they are faded out.
      if (markersA > 0.001 && frameMarkers) {
        layout.run(bySlot, Math.min(st.place, N - 1), sizes.w, sizes.h, hover.slot);
        for (let k = 0; k < SLOTS; k++) {
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
          // Round 1: the pin may have slid into the landmark's visible part, and
          // the plaque may sit off centre on its stem near a side edge.
          const shift = mode === TEXT ? Math.round(layout.shift[k]) : 0;
          if (shift !== domShift[k]) {
            domShift[k] = shift;
            if (shift !== 0) el.style.setProperty("--shift", `${shift}px`);
            else el.style.removeProperty("--shift");
          }
          if (mode !== HIDDEN && bySlot[k]) {
            const x = Math.round(layout.px[k]);
            const y = Math.round(layout.py[k]);
            if (x !== domX[k] || y !== domY[k]) {
              domX[k] = x;
              domY[k] = y;
              el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
          }
        }
      }

      // Round 1: a place opening (from the keyboard, the timeline) ends the hover.
      if (hover.slot >= 0 && !cache.markersLive) setHover(-1, false);

      // ── The card and the chip (2026-09-28). Decided from numbers the frame
      // already has; the DOM changes only when what shows changes.
      const t = tuningRef.current;
      if (t !== cache.tuning) {
        cache.tuning = t;
        let sum = t.tailVh + t.flightVh;
        for (let k = 0; k < t.scrollVh.length; k++) sum += t.scrollVh[k];
        cache.totalVh = Math.max(1, sum);
      }
      const nowMs = performance.now();
      const target = sizes.h > 0 ? Math.min(f.maxDepth, (window.scrollY * 100) / sizes.h / cache.totalVh) : f.depth;
      const busy = u.open >= 0 || u.closing || u.cp || u.cpClosing || !u.live;
      const resting =
        !busy && !u.tween && p === 0 && f.flight >= 0.999 && Math.abs(f.depth - target) < SETTLE_EPS && nowMs - u.scrollAt > REST_MS;
      const win = ARRIVE_VH / cache.totalVh;
      const place = st.place < N ? st.place : -1;
      // Final pass E: with every place done the card waits at the arch and says so (FinishedBody).
      const home = place >= 0 ? place : N - 1;
      let cardK = -1;
      let cardDone = false;
      if (resting) {
        if (u.doneK >= 0 && Math.abs(f.depth - depths[u.doneK]) < win) {
          cardK = u.doneK;
          cardDone = true;
        } else if (Math.abs(f.depth - depths[home]) < win) {
          cardK = home;
        }
      }
      const cm = cardK >= 0 ? bySlot[cardK] : null;
      if (cardK >= 0 && (!cm || !cm.visible)) cardK = -1;
      const cardEl = cardK < 0 ? null : cardDone ? doneElRef.current : cardRef.current;
      if (cardEl !== cache.cardEl || cardK !== cache.cardK) {
        // The done card replacing the arrival card at the same place keeps its spot.
        // (A frame or two without a card can come between them, so it is matched by place.)
        cache.anchor = cardDone && cardK >= 0 && cache.cardPl && cache.cardPl.k === cardK ? { ...cache.cardPl } : null;
        if (cache.cardEl && cache.cardEl !== cardEl) delete cache.cardEl.dataset.show;
        const was = cache.cardK >= 0 ? markerRefs.current[cache.cardK] : null;
        if (was) delete was.dataset.card;
        cache.cardEl = cardEl;
        cache.cardK = cardK;
        cache.pinX = NaN;
        if (cardEl && cardK >= 0) {
          const m = markerRefs.current[cardK];
          if (m) m.dataset.card = "";
          // The card puts the student's next lesson and its Watch button up: ask for that video now.
          if (!cardDone && cardK === place && st.placeNext >= 0) sourceRef.current?.onPrefetch?.(cardK, st.placeNext);
          // Resting at the next place ends the done moment for the last one.
          if (!cardDone && u.doneK >= 0 && cardK !== u.doneK) {
            u.doneK = -1;
            setDoneCard(null);
          }
        } else if (!cardEl) {
          setLeader("");
        }
      }
      if (cardEl && cm) {
        const lm = layout.mode[cardK];
        const px = lm !== HIDDEN ? layout.px[cardK] : cm.x;
        const py = lm !== HIDDEN ? layout.py[cardK] : cm.y;
        // NaN (just reset) must count as moved: !(|d| <= 0.75), never |d| > 0.75.
        // Its height too: the done card is placed on the frame it switches in,
        // before React has filled it (final pass B: it then sat over the hut).
        const cardH = cardEl.offsetHeight;
        if (!(Math.abs(px - cache.pinX) <= 0.75) || !(Math.abs(py - cache.pinY) <= 0.75) || sizes.w !== cache.vw || sizes.h !== cache.vh || cardH !== cache.cardH) {
          cache.cardH = cardH;
          cache.pinX = px;
          cache.pinY = py;
          cache.vw = sizes.w;
          cache.vh = sizes.h;
          if (cache.anchor) anchorCard(cardPl, cache.anchor, px, py, cardEl.offsetWidth, cardEl.offsetHeight, sizes.w, sizes.safeT, sizes.safeB);
          else placeCard(cardPl, CARD_HINTS[cardK], px, py, boxOf(cm) ? box : null, cardEl.offsetWidth, cardEl.offsetHeight, sizes.w, sizes.safeT, sizes.safeB, plaquesBesides(cardK));
          if (!cardDone) cache.cardPl = { k: cardK, x: cardPl.x, y: cardPl.y, h: cardEl.offsetHeight, side: cardPl.side, pinX: px, pinY: py };
          cardEl.style.translate = `${Math.round(cardPl.x)}px ${Math.round(cardPl.y)}px`;
          cardEl.dataset.side = cardPl.side;
          cardEl.dataset.overlap = String(cardPl.overlap);
          setLeader(cardPl.d);
        }
        if (cardEl.dataset.show === undefined) cardEl.dataset.show = "";
      }

      // The chip: the student's place is off screen (and no card is up).
      const pm = place >= 0 ? bySlot[place] : null;
      const chipOn = !busy && cardK < 0 && place >= 0 && !u.tween && markersA > 0.3 && !(pm && pm.visible);
      const chip = chipRef.current;
      if (chip && chipOn !== cache.chip) {
        cache.chip = chipOn;
        if (chipOn) chip.dataset.show = "";
        else delete chip.dataset.show;
      }
      if (chip && chipOn) {
        const dir = depths[place] < f.depth ? "back" : "ahead";
        if (dir !== cache.chipDir) {
          cache.chipDir = dir;
          chip.dataset.dir = dir;
        }
      }

      // ── The panel: in the click-in frame's quiet side, riding the camera's progress.
      const panel = panelRef.current;
      if (panel && (panel !== cache.panelEl || p !== cache.panelP || sizes.w !== cache.panelVw || u.open !== cache.panelFor)) {
        const fresh = panel !== cache.panelEl || u.open !== cache.panelFor || sizes.w !== cache.panelVw;
        cache.panelEl = panel;
        cache.panelP = p;
        if (fresh) {
          cache.panelFor = u.open;
          cache.panelVw = sizes.w;
          cache.panelPinX = NaN;
          const left = sizes.w < 1100 ? 28 : sizes.w >= 2200 ? 56 : 40;
          placePanel(panelPl, 0, 0, null, panel.offsetWidth, panel.offsetHeight, sizes.w, PANEL_TOP, left + 8);
        }
        const c = smooth(0.3, 1, p);
        panel.style.opacity = c.toFixed(3);
        panel.style.transform = `translate3d(${Math.round(panelPl.x)}px, ${(panelPl.y + (1 - c) * 14).toFixed(1)}px, 0)`;
      } else if (!panel) {
        cache.panelEl = null;
        cache.panelFor = -1;
      }
      if (panel && u.open >= 0 && !u.closing) {
        const m = bySlot[u.open];
        if (p >= 0.999 && m && m.visible) {
          if (!(Math.abs(m.x - cache.panelPinX) <= 0.75) || !(Math.abs(m.y - cache.panelPinY) <= 0.75)) {
            cache.panelPinX = m.x;
            cache.panelPinY = m.y;
            const left = sizes.w < 1100 ? 28 : sizes.w >= 2200 ? 56 : 40;
            placePanel(panelPl, m.x, m.y, boxOf(m) ? box : null, panel.offsetWidth, panel.offsetHeight, sizes.w, PANEL_TOP, left + 8);
            panel.dataset.overlap = String(panelPl.overlap);
            setLeader(panelPl.d);
            const pin = leaderPinRef.current;
            if (pin) {
              pin.setAttribute("transform", `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`);
              pin.setAttribute("visibility", "visible");
            }
          }
        } else if (cache.leader && !cardEl) {
          cache.panelPinX = NaN;
          setLeader("");
        }
      } else if (!cardEl && cache.leader && (u.open >= 0 || u.closing)) {
        setLeader("");
      }

      // The checkpoint's panel: the same place in the frame, joined to the cache's pin.
      const cpPanel = cpPanelRef.current;
      const panelLeft = sizes.w < 1100 ? 28 : sizes.w >= 2200 ? 56 : 40;
      if (cpPanel && (cpPanel !== cache.cpEl || p !== cache.cpP || sizes.w !== cache.cpVw)) {
        const fresh = cpPanel !== cache.cpEl || sizes.w !== cache.cpVw;
        cache.cpEl = cpPanel;
        cache.cpP = p;
        if (fresh) {
          cache.cpVw = sizes.w;
          cache.cpPinX = NaN;
          placePanel(cpPl, 0, 0, null, cpPanel.offsetWidth, cpPanel.offsetHeight, sizes.w, PANEL_TOP, panelLeft + 8);
        }
        // Not parked (the list's sheet, a scene that is not live): it shows at once.
        const c = u.live && !u.reduced ? smooth(0.3, 1, p) : 1;
        cpPanel.style.opacity = c.toFixed(3);
        cpPanel.style.transform = `translate3d(${Math.round(cpPl.x)}px, ${(cpPl.y + (1 - c) * 14).toFixed(1)}px, 0)`;
      } else if (!cpPanel) {
        cache.cpEl = null;
      }
      if (cpPanel && u.cp && !u.cpClosing) {
        const m = bySlot[u.cpKind === "bounty" ? BT : CP];
        if (p >= 0.999 && m && m.visible) {
          if (!(Math.abs(m.x - cache.cpPinX) <= 0.75) || !(Math.abs(m.y - cache.cpPinY) <= 0.75)) {
            cache.cpPinX = m.x;
            cache.cpPinY = m.y;
            placePanel(cpPl, m.x, m.y, boxOf(m) ? box : null, cpPanel.offsetWidth, cpPanel.offsetHeight, sizes.w, PANEL_TOP, panelLeft + 8);
            cpPanel.dataset.overlap = String(cpPl.overlap);
            cpPanel.style.transform = `translate3d(${Math.round(cpPl.x)}px, ${cpPl.y.toFixed(1)}px, 0)`;
            setLeader(cpPl.d);
            const pin = leaderPinRef.current;
            if (pin) {
              pin.setAttribute("transform", `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`);
              pin.setAttribute("visibility", "visible");
            }
          }
        }
      } else if (!cardEl && cache.leader && u.cpClosing) {
        cache.cpPinX = NaN;
        setLeader("");
      }

      // Where on the rail we are: the timeline's caret.
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
        // Gone once the scroll has started: 3 vh in it fades, by 30 vh it is out (2026-10-19).
        const a = (1 - smooth(0.0015, 0.015, f.depth / END_DEPTH)) * chrome;
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
      // The welcome (with a source): out over the first 40% of the way to the
      // first place, back at the top, and away while a place or a checkpoint is up.
      const welcome = welcomeRef.current;
      if (welcome) {
        const wa = (1 - smooth(WELCOME_FADE[0], WELCOME_FADE[1], f.depth / Math.max(1e-6, depths[0]))) * chrome;
        if (Math.abs(wa - cache.welcome) > 0.004 || (wa === 0 && cache.welcome !== 0)) {
          cache.welcome = wa;
          welcome.style.opacity = wa.toFixed(3);
        }
        // Hidden until the loop has drawn a frame (the stylesheet), and once
        // faded out: then it takes no click and no Tab.
        const on = wa > 0.001 ? 1 : 0;
        if (on !== cache.welcomeOn) {
          cache.welcomeOn = on;
          if (on) welcome.dataset.on = "";
          else delete welcome.dataset.on;
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
      console.error("[world-v6]", e);
      setPhase("failed");
    };

    (async () => {
      let mod: typeof import("@/lib/world-v6/scene");
      try {
        mod = await import("@/lib/world-v6/scene");
      } catch (e) {
        fail(e);
        return;
      }
      if (disposed) return;
      // The budgets and the lock go in at construction: they decide what a scrollY means.
      const t = tuningRef.current;
      const query = new URLSearchParams(window.location.search);
      try {
        scene = new mod.WorldScene(stage, {
          lock: { mode: t.lock, frontier: t.frontier },
          pacing: [...t.scrollVh, t.tailVh, t.flightVh],
          poster: posterPreference(window.location.search),
          slowGpu: Math.max(1, Number(query.get("slowgpu")) || 1),
          coldStall: query.get("coldstall") ? { ms: Number(query.get("coldstall")) || 0, frames: Number(query.get("coldframes")) || 1 } : undefined,
        });
      } catch (e) {
        fail(e);
        return;
      }
      const sc = scene;
      sceneRef.current = sc;
      // Poster mode: on now (no WebGL, a software renderer, ?poster=on, a
      // remembered verdict) or later (the load probe, the governor, the panel).
      const enterPoster = (reason: string) => {
        u.poster = true;
        u.posterSeq++;
        const ps = sc.posterState();
        setPoster({ reason, kind: ps.kind, headless: ps.headless, canTry: ps.canTry });
        showPosterLayer(true);
        loadManifest();
        const f = lastFrame.current;
        if (f) apply(f);
      };
      const ps0 = sc.posterState();
      if (ps0.reason) enterPoster(ps0.reason);
      offOffer = sc.onPosterOffer((reason) => {
        if (!disposed) setPosterOffer(reason);
      });
      offPoster = sc.onPoster((reason) => {
        if (disposed) return;
        if (reason) enterPoster(reason);
        else {
          u.poster = false;
          setPoster(null);
          revealLive();
        }
      });
      w.__worldPoster = () => ({
        ...sc.posterState(),
        layerShown: posterRef.current?.dataset.show !== undefined,
        shown: posterImgs.current.map((img, i) => ({ id: POSTER_IDS[i], opacity: img ? Number(img.style.opacity || (img.dataset.on !== undefined ? 1 : 0)) : 0, loaded: !!img && img.complete && img.naturalWidth > 1 })),
        manifest: !!manifestRef.current,
      });
      appliedRef.current = t;
      progressRef.current = studyRef.current.progress;
      sc.setProgress(progressRef.current);
      u.wp = progressOf(areasRef.current, studyRef.current);
      sc.setWorldProgress(u.wp);
      sc.setCheckpoint(cpRef.current.look);
      offTier = sc.onQualityTier((tierNow) => {
        if (!disposed) setTier(tierNow);
      });
      // The scene keeps the spacer's height in step with the budgets and the lock.
      sc.bindSpacer(spacerRef.current);
      sc.setAnchors(ANCHORS);
      sc.onFrame(onFrame);
      sc.setPaused(scenePaused(sourceRef.current));
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
      // Back from the phone list (the window widened past 760 px): the camera
      // where it was when the list took over, or at the student's place when
      // the page opened narrow. The list's own scroll means nothing here.
      if (u.fromList) {
        u.fromList = false;
        const home = u.listDepth >= 0 ? u.listDepth : sc.depthFor(STUDY_AREAS[Math.min(studyRef.current.place, N - 1)].id);
        if (u.open >= 0 && u.savedDepth < 0) {
          // A place opened on the list: it closes onto that depth too.
          u.savedDepth = home;
          u.savedMax = -1;
        } else if (u.cp && u.savedDepth < 0) {
          // A checkpoint opened on the list: it closes in front of it, as one opened from far on the map does.
          // With no 3D (headless) it has no landmark and no depth of its own: the place the list was on.
          u.savedDepth = sc.posterState().headless ? home : sc.depthFor(cpAnchor(u.cpKind));
          u.savedMax = -1;
        } else if (u.open < 0 && !u.cp && Number.isFinite(home)) {
          window.scrollTo({ top: Math.round(sc.scrollYForDepth(home)), left: 0, behavior: "instant" });
          sc.seedDepth(home);
        }
      }
      if ((u.open >= 0 || u.cp) && u.savedDepth >= 0) {
        // Made while a place or a checkpoint is open (back from the list view): start at the depth saved on open.
        sc.seedDepth(u.savedDepth);
      }
      // A new scene while an area is open: put the camera where the interface says it is.
      if (u.open >= 0) {
        if (u.closing) finalizeClose();
        else sc.park(STUDY_AREAS[u.open].id);
      } else if (u.cp) {
        // The same for a checkpoint's panel (fix round, 2026-10-16): the new scene stood on the trail under it.
        if (u.cpClosing) finalizeCheckpoint();
        else sc.park(cpAnchor(u.cpKind));
      }
      // With a source: the place the address names opens now that the scene can fly there.
      reconcile(true);

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
        sc.setPaused(scenePaused(sourceRef.current));
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
        if (id === null) {
          if (u.cp) closeCheckpoint();
          else closeArea();
        } else if (id === CHECKPOINT.id) openCheckpoint(null);
        else if (id === BOUNTY.id) openCheckpoint(null, "bounty");
        else openArea(slotOf(id), null);
      };
      w.__worldCheckpoint = (which: Cp = "discount") => {
        const id = cpAnchor(which);
        const m = lastFrame.current?.markers.find((x) => x.id === id) ?? null;
        const el = markerRefs.current[which === "bounty" ? BT : CP];
        const up = u.cp && u.cpKind === which;
        const r = up ? (cpPanelRef.current?.getBoundingClientRect() ?? null) : null;
        return {
          shown: which === "bounty" ? btRef.current : cpRef.current.shown,
          /** The 30%: the camera within CP_SHOW_WITHIN of the cache, where its marker and click are on. */
          near: which === "bounty" ? null : cpNear,
          look: which === "bounty" ? null : cpRef.current.look,
          open: up,
          closing: up && u.cpClosing,
          mode: el?.dataset.mode ?? null,
          marker: m ? { x: Math.round(m.x), y: Math.round(m.y), visible: m.visible } : null,
          panel: r ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null,
          /** The rail depth that frames it (scene depthFor: 400 back along the view, rail.ts sNearest). */
          depth: sc.depthFor(id),
        };
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
            name: areasRef.current[k].name,
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
      w.__worldProgress = () => u.wp;
      w.__worldUi = () => {
        const rect = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const up = (el: HTMLElement | null) => (el && el.dataset.show !== undefined ? el : null);
        const card = up(cardRef.current);
        const done = up(doneElRef.current);
        const chip = up(chipRef.current);
        const panel = panelRef.current;
        return {
          view: { w: window.innerWidth, h: window.innerHeight },
          tier: Number(stage.closest("main")?.dataset.tier ?? 0),
          place: studyRef.current.place,
          doneK: u.doneK,
          card: card ? { ...rect(card), side: card.dataset.side, overlap: Number(card.dataset.overlap ?? 0), at: cache.cardK } : null,
          done: done ? { ...rect(done), side: done.dataset.side, overlap: Number(done.dataset.overlap ?? 0), at: cache.cardK } : null,
          chip: chip ? { ...rect(chip), dir: chip.dataset.dir ?? null } : null,
          panel: panel ? { ...rect(panel), overlap: Number(panel.dataset.overlap ?? 0), open: u.open } : null,
          leader: cache.leader || null,
          header: rect(headerRef.current),
          timeline: rect(timelineRef.current),
        };
      };

      // Round 1: hover and click the landmark itself. The label buttons stay
      // the keyboard and screen reader way in; this is the pointer's.
      const canPick = () => u.live && !u.poster && u.open === -1 && !u.cp && cache.markersLive;
      const runPick = () => {
        hover.raf = 0;
        if (!hover.has || !canPick()) {
          setHover(-1);
          return;
        }
        const id = sc.pickAnchor(hover.x, hover.y);
        setHover(pickSlot(id, cpRef.current.shown && cpNear, btRef.current));
      };
      const schedulePick = () => {
        if (!hover.raf) hover.raf = requestAnimationFrame(runPick);
      };
      onPointerMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        hover.x = e.clientX;
        hover.y = e.clientY;
        hover.has = true;
        schedulePick();
      };
      onPointerLeave = () => {
        hover.has = false;
        schedulePick();
      };
      // The camera glides on after the wheel stops, so look again once it has.
      onScrollPick = () => {
        if (!hover.has) return;
        schedulePick();
        window.clearTimeout(hover.timer);
        hover.timer = window.setTimeout(schedulePick, 450);
      };
      onStageClick = (e: MouseEvent) => {
        if (!canPick()) return;
        const id = sc.pickAnchor(e.clientX, e.clientY);
        const k = pickSlot(id, cpRef.current.shown && cpNear, btRef.current);
        if (k < 0) return;
        e.preventDefault();
        setHover(-1);
        if (k === CP) openCheckpoint(markerRefs.current[CP] ?? null);
        else if (k === BT) openCheckpoint(markerRefs.current[BT] ?? null, "bounty");
        else openArea(k, markerRefs.current[k] ?? null);
      };
      stage.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerleave", onPointerLeave);
      stage.addEventListener("click", onStageClick);
      window.addEventListener("scroll", onScrollPick, { passive: true });
      clearHover = () => {
        cancelAnimationFrame(hover.raf);
        window.clearTimeout(hover.timer);
        hover.raf = 0;
        hover.has = false;
        setHover(-1);
      };

      w.__worldReady = true;
      setPhase("ready");
      // The live 3D takes over from the landing poster once it has drawn.
      if (!u.poster) revealLive();

      // Arrival: from the opening frame the camera travels to the student's
      // place, where the card waits (option A's "after login"). Not when the
      // page opened scrolled, and not under automation unless ?arrive=1, so
      // the render harnesses keep the page where they put it.
      const arrive = query.get("arrive");
      const automated = typeof navigator !== "undefined" && navigator.webdriver && arrive !== "1";
      // With a source: no bench, and no arrival of its own. The welcome holds
      // the student at the opening and its Continue makes this trip
      // (2026-10-19); before it, the address naming a place or a lesson page
      // being open held it back too.
      const src = sourceRef.current;
      const benching = !src && query.get("bench") === "1";
      if (arrive !== "0" && !automated && !benching && !src && window.scrollY < 2) {
        window.clearTimeout(u.arriveTimer);
        u.arriveTimer = window.setTimeout(() => {
          // Final pass E: a student with every place done travels to the arch (the ending, decision 55).
          const k = Math.min(studyRef.current.place, N - 1);
          if (!disposed && window.scrollY < 2 && u.open < 0 && !sourceRef.current?.paused) travel(k);
        }, ARRIVE_DELAY_MS);
      }

      // ?bench=1: run the route alone and show what this machine did.
      if (benching) {
        setBench({ status: "Starting", result: null, copied: "" });
        await new Promise((r) => setTimeout(r, 1200));
        if (disposed) return;
        try {
          const result = await runBench(sc, STUDY_AREAS, (status) => {
            if (!disposed) setBench({ status, result: null, copied: "" });
          });
          if (disposed) return;
          w.__worldBench = result;
          setBench({ status: "Done", result, copied: "" });
        } catch (e) {
          if (!disposed) setBench({ status: `The bench failed: ${String(e)}`, result: null, copied: "" });
        }
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("scroll", onScrollRest);
      window.clearTimeout(u.restTimer);
      // A remount (fast refresh, the view flipping) must not leave a card up with no loop behind it.
      for (const el of uiEls) if (el) delete el.dataset.show;
      if (welcomeEl) delete welcomeEl.dataset.on;
      for (const el of markerEls) if (el) delete el.dataset.card;
      leaderEl?.removeAttribute("d");
      leaderPinEl?.setAttribute("visibility", "hidden");
      window.clearTimeout(u.arriveTimer);
      window.clearTimeout(u.celebrateTimer);
      offTier?.();
      clearHover?.();
      if (onPointerMove) stage.removeEventListener("pointermove", onPointerMove);
      if (onPointerLeave) stage.removeEventListener("pointerleave", onPointerLeave);
      if (onStageClick) stage.removeEventListener("click", onStageClick);
      if (onScrollPick) window.removeEventListener("scroll", onScrollPick);
      offPoster?.();
      offOffer?.();
      setPosterOffer(null);
      u.live = false;
      u.poster = false;
      for (const k of GETTER_HOOKS) delete w[k];
      for (const k of PLAIN_HOOKS) delete w[k];
      delete w.__worldBench;
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
  }, [view, tuningLoaded, openArea, closeArea, finalizeClose, openCheckpoint, closeCheckpoint, finalizeCheckpoint, applyTuning, writeRide, showPosterLayer, loadManifest, revealLive, travel, stepSnap, reconcile]);

  // The tuning hooks work on the list view too, so they live outside the scene effect.
  useEffect(() => {
    const w = harness();
    w.__worldTuning = () => tuningRef.current;
    w.__worldTune = updateTuning;
    return () => {
      delete w.__worldTuning;
      delete w.__worldTune;
    };
  }, [updateTuning]);

  useEffect(() => {
    if (view === "list") harness().__worldView = "list";
  }, [view]);

  // ── Between the 3D map and the phone list (a resize across 760 px). The list
  // opens at its top, whatever the page scroll was on the map. Leaving the 3D,
  // the camera's depth is kept (the last frame, read before the scene effect's
  // own clean-up empties it), and the next scene starts there (above).
  useLayoutEffect(() => {
    const u = ui.current;
    if (view === "list") {
      u.fromList = true;
      // A place left open keeps its depth for the way back; on the list its scroll is the top.
      if (u.locked) {
        u.savedY = 0;
        u.savedMax = -1;
      }
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    if (view !== "world") return;
    return () => {
      const f = lastFrame.current;
      if (f) u.listDepth = f.depth;
    };
  }, [view]);

  // ── Pause when the tab is hidden: a background rAF loop still burns battery.
  useEffect(() => {
    if (view !== "world") return;
    const onVisibility = () => sceneRef.current?.setPaused(scenePaused(sourceRef.current));
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [view]);

  // ── Measure once and on resize, never inside the frame loop.
  useEffect(() => {
    if (view !== "world" || phase !== "ready") return;
    const measure = () => {
      const layout = layoutRef.current;
      const stage = stageRef.current;
      const sizes = sizesRef.current;
      if (!layout || !stage) return;
      sizes.w = stage.clientWidth;
      sizes.h = stage.clientHeight;
      for (let k = 0; k < SLOTS; k++) {
        const label = labelRefs.current[k];
        if (!label) continue;
        layout.width[k] = label.offsetWidth;
        layout.height[k] = label.offsetHeight;
      }
      layout.clearReserved();
      for (const el of [headerRef.current, timelineRef.current, footerRef.current, chipRef.current]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        layout.addReserved(r.left - 8, r.top - 8, r.right + 8, r.bottom + 8);
      }
      sizes.trackW = trackRef.current?.clientWidth ?? 0;
      // The card keeps to the band between the header and the timeline.
      sizes.safeT = (headerRef.current?.getBoundingClientRect().bottom ?? 72) + 8;
      sizes.safeB = (timelineRef.current?.getBoundingClientRect().top ?? sizes.h - 80) - 14;
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
  }, [view, phase]);

  // A locked marker's label is a few px wider (the lock glyph), and the
  // checkpoints' say something else in each state: measure again.
  useEffect(() => {
    if (view !== "world" || phase !== "ready") return;
    const layout = layoutRef.current;
    if (!layout) return;
    for (let k = 0; k < SLOTS; k++) {
      const label = labelRefs.current[k];
      if (label) {
        layout.width[k] = label.offsetWidth;
        layout.height[k] = label.offsetHeight;
      }
    }
    const f = lastFrame.current;
    if (f) applyRef.current?.(f);
  }, [view, phase, study, cpView, bounty]);

  // ── Focus: into the panel on open, back to the trigger once the camera is home.
  // With a source a place can open under a lesson page, where the root is inert
  // and nothing in it takes focus: the step waits for the page to close. A
  // lesson page closing over a place that was already open does the same, so
  // the keyboard lands in the panel (the sheet on phones) and not on <body>:
  // on the next lesson's Watch when the place has one, else on its heading.
  const wasPaused = useRef(paused);
  useEffect(() => {
    const u = ui.current;
    const back = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (openIdx !== null) {
      if (paused || (!u.pendingFocus && !back)) return;
      u.pendingFocus = false;
      const st = studyRef.current;
      const next = openIdx === st.place ? st.placeNext : -1;
      const target = back
        ? ((next >= 0 ? rowRefs.current[next] : null) ?? headingRef.current)
        : u.focusLesson >= 0
          ? rowRefs.current[u.focusLesson]
          : headingRef.current;
      target?.focus({ preventScroll: true });
      return;
    }
    if (u.returnFocus < 0) return;
    const idx = u.returnFocus;
    u.returnFocus = -1;
    let target = u.trigger;
    u.trigger = null;
    if (target && (!target.isConnected || target.dataset.mode === "hidden")) target = null;
    // The card or chip that opened the place is hidden while the camera flies home: the timeline takes focus.
    const box = target?.closest("section");
    if (target && box && (box === cardRef.current || box === doneElRef.current || box === chipRef.current) && box.dataset.show === undefined) target = null;
    target = target ?? stopRefs.current[idx] ?? listRowRefs.current[idx] ?? null;
    target?.focus({ preventScroll: true });
  }, [openIdx, paused]);

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
      // A lesson page is open over the map: the key is its own.
      if (sourceRef.current?.paused) return;
      const u = ui.current;
      if (u.cp) {
        if (!u.cpClosing) {
          e.preventDefault();
          closeCheckpoint();
        }
        return;
      }
      if (u.open === -1 || u.closing) return;
      e.preventDefault();
      if (u.lesson >= 0) backToArea();
      else closeArea();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backToArea, closeArea, closeCheckpoint]);

  // ── The checkpoint's panel: focus to its heading on open, back to what opened it once home.
  // cpKind is in the deps because one checkpoint's panel can give way to the
  // other's (the header's discount from the bounty's panel) with cpOpen true
  // throughout: the new panel's heading takes focus then too.
  useEffect(() => {
    const u = ui.current;
    if (cpOpen) {
      if (!paused) cpHeadingRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!u.cpReturn) return;
    u.cpReturn = false;
    let target = u.cpTrigger;
    u.cpTrigger = null;
    if (target && (!target.isConnected || target.dataset.mode === "hidden" || target.closest("[inert]"))) target = null;
    (target ?? (u.cpKind === "bounty" ? btTagRef.current : cpTagRef.current))?.focus({ preventScroll: true });
  }, [cpOpen, cpKind, paused]);

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
  const current = study.current;
  const place = study.place;
  const placeArea = place < N ? areas[place] : null;

  // The arrival card's body. When the student's place moves on (the place the
  // card sits beside was just finished and the done card takes over), the old
  // body is held through the card's 200 ms fade, so the card beside the
  // finished landmark never flashes the next place's name (integration check,
  // 2026-09-28: "05 Boathouse, Static Ads" showed beside the Trail Hut).
  const [cardView, setCardView] = useState<{ k: number; study: Study }>(() => ({ k: place, study }));
  useEffect(() => {
    if (cardView.k === place && cardView.study === study) return;
    const t = window.setTimeout(() => setCardView({ k: place, study }), cardView.k === place ? 0 : 260);
    return () => window.clearTimeout(t);
  }, [place, study, cardView]);

  const loading = view === "world" && phase === "loading";

  /**
   * "Try the 3D map": back to the live 3D, or a reload into it when this page
   * never built one. The reload asks for ?poster=try: the 3D stays up, and if
   * it still cannot cope the posters are offered again (?poster=off used to
   * drop every fallback for the visit).
   */
  const tryLive = () => {
    const sc = sceneRef.current;
    if (sc && sc.setPoster(false)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("poster", "try");
    window.location.replace(url.toString());
  };
  const copyBench = () => {
    const r = bench?.result;
    if (!r) return;
    const text = benchText(r) + "\n\n" + JSON.stringify(r);
    const blocked = () => setBench((b) => (b ? { ...b, copied: "Copy blocked: select the text above" } : b));
    if (!navigator.clipboard) {
      blocked();
      return;
    }
    navigator.clipboard.writeText(text).then(() => setBench((b) => (b ? { ...b, copied: "Copied" } : b)), blocked);
  };

  const panelBody =
    openIdx === null ? null : (
      <PanelBody
        idx={openIdx}
        study={study}
        backLabel={view === "list" ? "All areas" : "Back to map"}
        lesson={lesson}
        dir={dir}
        showWatched={showWatched}
        onShowWatched={() => setShowWatched(true)}
        onBack={closeArea}
        onOpenLesson={openLesson}
        onPrefetch={(i) => source?.onPrefetch?.(openIdx, i)}
        onBackToArea={backToArea}
        headingRef={headingRef}
        lessonHeadingRef={lessonHeadingRef}
        rowRefs={rowRefs}
      />
    );

  const nameWithState = (k: number) =>
    study.locked[k]
      ? `${areas[k].name}, locked`
      : `${areas[k].name}, ${study.done[k]} of ${areas[k].lessons} lessons done`;

  /**
   * The checkpoints on the timeline, each a tag between the place it follows
   * and the next: the discount's whenever the source knows it (every state
   * since 2026-10-16), and the Ad Bounty's after Creative Strategy (plan item
   * 18), always.
   */
  const gates: Gate[] = [];
  if (cpView) {
    gates.push({
      key: "discount",
      after: CHECKPOINT.after,
      state: cpView.tag,
      glyph: "tag",
      // "30% off", never "30%" alone: on a progress bar that reads as how far along.
      text: cpView.label.lead,
      tip: { lead: cpView.label.lead, tail: cpView.chip.tail },
      label: cpAria(cpView),
      ref: cpTagRef,
      open: openCheckpoint,
    });
  }
  if (bounty) {
    gates.push({
      key: "bounty",
      after: BOUNTY.after,
      state: bounty.done ? "done" : "open",
      glyph: "notice",
      text: BOUNTY_NAME,
      tip: { lead: BOUNTY_NAME, tail: bounty.done ? "Watched" : "1 lesson" },
      label: bountyAria(bounty),
      ref: btTagRef,
      open: (el) => openCheckpoint(el, "bounty"),
    });
  }

  /**
   * The discount in the header's group: the offer and where it stands, one click to its panel.
   * Only while the offer is open to the student or their application is in (checkpointView.ts
   * `header`); the tag, the marker and the phone's row show in every state. Null without a
   * discount on the source.
   */
  const discountSeg = cpView?.header ? (
    <button
      type="button"
      className={s.cpChip}
      data-cp={cpView.tag}
      data-ready={cpView.chip.ready || undefined}
      aria-label={`${cpView.chip.lead}, ${cpView.chip.tail}. Open the discount checkpoint`}
      onClick={(e) => openCheckpoint(e.currentTarget)}
    >
      <TagGlyph className={s.cpChipGlyph} />
      <b>{cpView.chip.lead}</b>
      <span className={s.cpChipTail}>{cpView.chip.tail}</span>
    </button>
  ) : null;

  return (
    <main
      className={`${tokens.tokens} ${s.root}`}
      data-view={view}
      data-open={isOpen || cpOpen || undefined}
      data-lock={tuning.lock}
      data-loading={loading || undefined}
      data-poster={posterReady || undefined}
      data-tier={tier}
      data-solid={tier >= 2 || poster !== null || undefined}
      // A lesson page is open over the map (source.paused): nothing here takes a click, a key or a reader.
      inert={paused || undefined}
      aria-hidden={paused || undefined}
    >
      <h1 className={s.srOnly}>Course map</h1>

      {view === "world" && <div ref={stageRef} className={s.stage} aria-hidden="true" />}
      {/* Long travel: the frozen frame the camera jumps under (LONG_HOP). */}
      {view === "world" && <canvas ref={snapRef} className={s.snap} aria-hidden="true" />}
      {/* Cheap laptops: the posters (poster.ts). In the server HTML, so the opening shows before any script runs. */}
      {view !== "list" && (
        <div ref={posterRef} className={s.poster} data-show="" aria-hidden="true">
          {POSTER_IDS.map((id, i) =>
            i === 0 ? (
              <picture key={id}>
                <source media="(min-width: 760px)" srcSet={posterSrc(id)} />
                <img
                  ref={(el) => {
                    posterImgs.current[0] = el;
                  }}
                  className={s.posterImg}
                  src={BLANK_GIF}
                  alt=""
                  data-on=""
                  draggable={false}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth > 1 && e.currentTarget.dataset.on !== undefined) setPosterReady(true);
                  }}
                />
              </picture>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={id}
                ref={(el) => {
                  posterImgs.current[i] = el;
                }}
                className={s.posterImg}
                alt=""
                decoding="async"
                draggable={false}
                onLoad={(e) => {
                  if (e.currentTarget.dataset.on !== undefined) setPosterReady(true);
                }}
              />
            ),
          )}
        </div>
      )}

      {view === "world" && (
        <>
          <div ref={spacerRef} className={s.spacer} aria-hidden="true" />
          <div ref={shadeRef} className={s.shade} aria-hidden="true" />
          {/* Final pass C: the telescope's lens and the sky caption (a7's click-in only). */}
          <div ref={lensRef} className={s.lens} aria-hidden="true" />
          <p ref={lensCapRef} className={s.lensCap} aria-hidden="true">
            <SkyCaption study={study} />
          </p>

          {/* The leader from a landmark's pin to the card or the panel (cardPlace.ts). */}
          <svg className={s.leader} aria-hidden="true">
            <path ref={leaderRef} />
            <g ref={leaderPinRef} className={s.leaderPin} visibility="hidden">
              <circle r="12" />
              <rect x="-5.5" y="-5.5" width="11" height="11" rx="1.5" transform="rotate(45)" />
            </g>
          </svg>

          {/* The welcome (2026-10-19), with a source: over the opening, faded by
              the frame loop. Ahead of the card in the tab order, so at the top
              Tab lands on Continue; once it has faded the card's Watch is first. */}
          {hasSource && (
            <section ref={welcomeRef} className={s.welcome} aria-labelledby="welcome-title" inert={isOpen || cpOpen || loading}>
              <WelcomeWords name={source?.firstName ?? null} />
              {/* The arrival's trip: to the student's place (the arch once every place is done). */}
              <button
                type="button"
                className={`${s.primary} ${s.welcomeGo}`}
                onClick={() => travel(Math.min(studyRef.current.place, N - 1))}
              >
                Continue
                <Arrow />
              </button>
            </section>
          )}

          {/* The card: beside the student's place when the camera rests there.
              First in the tab order, so Tab lands on Watch. */}
          <section
            ref={cardRef}
            className={s.card}
            aria-label={cardView.k < N ? "Your place" : "Course done"}
            data-side="r"
          >
            {cardView.k < N ? (
              <CardBody
                k={cardView.k}
                study={cardView.study}
                onWatch={(el) => watch(cardView.k, cardView.study.placeNext, el)}
              />
            ) : (
              <FinishedBody study={cardView.study} />
            )}
          </section>
          {/* The done card: a place reached 100% in this session. */}
          <section ref={doneElRef} className={`${s.card} ${s.cardDone}`} aria-label="Place done" data-side="r">
            {doneCard !== null && (
              <DoneBody
                k={doneCard}
                next={study.place > doneCard && study.place < N ? study.place : -1}
                last={doneRun(study, doneCard)}
                finished={study.place >= N ? study : null}
                onStart={() => {
                  const u = ui.current;
                  const k = doneCard;
                  // Several places can finish in one update: go to the first one not done.
                  const next = studyRef.current.place;
                  u.doneK = -1;
                  setDoneCard(null);
                  if (next > k && next < N) travel(next);
                  else openArea(k, null);
                }}
              />
            )}
          </section>
          {/* The chip: the student's place is off screen; Watch stays one click away. */}
          <section ref={chipRef} className={s.chip} aria-label="Your place" data-dir="ahead">
            {placeArea && (
              <>
                <button
                  type="button"
                  className={s.chipGo}
                  aria-label={`Go to ${placeArea.name}`}
                  onClick={() => travel(place)}
                >
                  <Arrow />
                </button>
                <span className={s.chipText}>
                  <span className={s.eyebrow}>
                    <span className={s.accent}>{pad2(place + 1)}</span>
                    {placeArea.name}
                  </span>
                  <span className={s.prog}>
                    <Ticks k={place} n={placeArea.lessons} done={study.done[place]} next={study.placeNext} />
                    <PlaceCount k={place} done={study.done[place]} short />
                  </span>
                </span>
                {/* No Watch when every lesson left has no video yet (map-model.ts): the arrow still goes there. */}
                {!notRecorded(placeArea, study.placeNext) && (
                  <button
                    type="button"
                    className={`${s.primary} ${s.primarySm}`}
                    onClick={(e) => watch(place, study.placeNext, e.currentTarget)}
                  >
                    <Play />
                    Watch
                  </button>
                )}
              </>
            )}
          </section>

          <div ref={cueRef} className={s.cue} aria-hidden="true">
            <span>Scroll</span>
            <svg className={s.cueChevron} width="14" height="8" viewBox="0 0 14 8" fill="none">
              <path d="M1.5 1.5 7 6.5l5.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div ref={markersRef} className={s.markers} inert={isOpen || cpOpen || loading}>
            {areas.map((a, k) => (
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
                  {!study.locked[k] && (
                    <span className={s.labelCount}>
                      {study.done[k]}/{a.lessons}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {/* The discount checkpoint (slot CP), after the places, so a place's index is still its own. */}
            {cpView && (
              <button
                ref={(el) => {
                  markerRefs.current[CP] = el;
                }}
                type="button"
                className={`${s.marker} ${s.cpMarker}`}
                data-mode="hidden"
                data-cp={cpView.tag}
                tabIndex={-1}
                aria-label={cpAria(cpView)}
                onClick={(e) => openCheckpoint(e.currentTarget)}
              >
                <span className={s.pin} aria-hidden="true" />
                <span className={s.stem} aria-hidden="true" />
                <span
                  ref={(el) => {
                    labelRefs.current[CP] = el;
                  }}
                  className={s.label}
                  aria-hidden="true"
                >
                  <TagGlyph className={s.cpLabelGlyph} />
                  {cpView.label.lead}
                  {cpView.label.tail && <span className={s.labelCount}>{cpView.label.tail}</span>}
                </span>
              </button>
            )}
            {/* The Ad Bounty checkpoint (slot BT, plan item 18): the board on the isle past the rope bridge. */}
            {bounty && (
              <button
                ref={(el) => {
                  markerRefs.current[BT] = el;
                }}
                type="button"
                className={`${s.marker} ${s.cpMarker}`}
                data-mode="hidden"
                data-bounty={bounty.done ? "done" : "open"}
                tabIndex={-1}
                aria-label={bountyAria(bounty)}
                onClick={(e) => openCheckpoint(e.currentTarget, "bounty")}
              >
                <span className={s.pin} aria-hidden="true" />
                <span className={s.stem} aria-hidden="true" />
                <span
                  ref={(el) => {
                    labelRefs.current[BT] = el;
                  }}
                  className={s.label}
                  aria-hidden="true"
                >
                  <NoticeGlyph className={s.cpLabelGlyph} />
                  {BOUNTY_NAME}
                  {bounty.done && <span className={s.labelCount}>Watched</span>}
                </span>
              </button>
            )}
          </div>

          {/* The timeline: the course in one bar. A cell per place, filled by its
              lessons, under the place's diamond (the student's highlighted);
              the checkpoints' tags between places; the camera's caret. */}
          <nav ref={timelineRef} className={s.timeline} aria-label="Places" inert={isOpen || cpOpen || loading}>
            <span className={s.tlCount} aria-label={`${study.doneTotal} of ${content.total} lessons done`}>
              <span aria-hidden="true">
                <b>{study.doneTotal}</b>/{content.total}
              </span>
              <span className={s.tlUnit} aria-hidden="true">
                lessons
              </span>
            </span>
            <div ref={trackRef} className={s.track}>
              {areas.map((a, k) => (
                <span
                  key={a.id}
                  className={s.cell}
                  data-state={study.state[k]}
                  data-locked={study.locked[k] || undefined}
                  style={{ left: `${(k / N) * 100}%`, width: `${100 / N}%` }}
                  aria-hidden="true"
                >
                  <i style={{ width: `${(Math.min(study.done[k], a.lessons) / Math.max(1, a.lessons)) * 100}%` }} />
                </span>
              ))}
              <span ref={caretRef} className={s.caret} aria-hidden="true" />
              {areas.map((a, k) => (
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
                  aria-current={k === place ? "step" : undefined}
                  onClick={() => travel(k)}
                  onPointerEnter={() => setHoverStop(k)}
                  onPointerLeave={() => setHoverStop(null)}
                  onFocus={() => setHoverStop(k)}
                  onBlur={() => setHoverStop(null)}
                >
                  <span className={s.stopDot} aria-hidden="true" />
                  {hoverStop === k && hint === null && (
                    <span className={s.stopTip} data-align={alignOf(k)} aria-hidden="true">
                      {study.locked[k] && <Lock />}
                      {a.name}
                      {!study.locked[k] && (
                        <span className={s.labelCount}>
                          {study.done[k]}/{a.lessons}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              ))}
              {/* The checkpoints: a tag on a post over the bar between the place each follows and the next, after the stops. */}
              {gates.map((g) => (
                <button
                  key={g.key}
                  ref={g.ref}
                  type="button"
                  className={s.gate}
                  data-gate={g.key}
                  data-cp={g.state}
                  style={{ left: `${((g.after + 1) / N) * 100}%` }}
                  aria-label={g.label}
                  onClick={(e) => g.open(e.currentTarget)}
                  onPointerEnter={() => setGateTip(g.key)}
                  onPointerLeave={() => setGateTip(null)}
                  onFocus={() => setGateTip(g.key)}
                  onBlur={() => setGateTip(null)}
                >
                  <span className={s.gateTag} aria-hidden="true">
                    {g.glyph === "notice" ? <NoticeGlyph className={s.gateGlyph} /> : <TagGlyph className={s.gateGlyph} />}
                    {g.text}
                  </span>
                  {gateTip === g.key && hint === null && (
                    <span className={s.stopTip} aria-hidden="true">
                      {g.tip.lead}
                      {g.tip.tail && <span className={s.labelCount}>{g.tip.tail}</span>}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {hint !== null && (
              <span className={s.hint} role="status">
                <span key={hint.seq} className={s.hintIn}>
                  <Lock />
                  Finish {areas[current].name} first
                </span>
              </span>
            )}
          </nav>

          {poster && !isOpen && (() => {
            // The notice follows why the posters are up (poster.ts posterNotice).
            // Forced from Tune or ?poster=on: no student notice, a small dev tag.
            const note = posterNotice(poster.kind);
            if (!note) {
              return (
                <p className={s.posterDev} data-poster-kind={poster.kind ?? ""}>
                  posters: forced
                </p>
              );
            }
            return (
              <p className={s.posterNote} role="status" data-poster-kind={poster.kind ?? ""}>
                {note.text}
                {note.button && poster.canTry && (
                  <button type="button" className={s.posterTry} onClick={tryLive}>
                    {note.button}
                  </button>
                )}
              </p>
            );
          })()}

          {posterOffer && !poster && !isOpen && (
            <p className={s.posterNote} role="status" data-poster-offer="">
              {POSTER_OFFER.text}
              <button type="button" className={s.posterTry} onClick={() => sceneRef.current?.answerPosterOffer(true)}>
                {POSTER_OFFER.accept}
              </button>
              <button type="button" className={s.posterTry} onClick={() => sceneRef.current?.answerPosterOffer(false)}>
                {POSTER_OFFER.decline}
              </button>
            </p>
          )}

          {bench && (
            <section className={s.bench} aria-label="Bench results">
              <p className={s.benchHead}>
                <b>Bench</b> {bench.result ? "done" : bench.status}
              </p>
              {bench.result ? (
                <>
                  <pre className={s.benchText}>{benchText(bench.result)}</pre>
                  <div className={s.benchRow}>
                    <button type="button" className={s.jump} onClick={copyBench}>
                      Copy results
                    </button>
                    <span>{bench.copied}</span>
                    <button type="button" className={s.jump} onClick={() => setBench(null)}>
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <p className={s.benchWait}>Leave the page alone for about 40 seconds.</p>
              )}
            </section>
          )}

          {isOpen && (
            <section
              ref={panelRef}
              className={s.panel}
              aria-labelledby="v4-panel-title"
              inert={closing}
              // Final pass D: through the telescope the panel keeps off the hero constellation (world.module.css).
              data-tel={(openIdx === TEL_K && poster === null) || undefined}
            >
              <div ref={panelInnerRef} className={s.panelInner}>
                {panelBody}
              </div>
            </section>
          )}

          {cpOpen && cpKind === "discount" && discount && cpView && (
            <section ref={cpPanelRef} className={`${s.panel} ${s.cpPanel}`} aria-labelledby="cp-panel-title" inert={cpClosing}>
              <div className={s.panelInner}>
                <CheckpointBody
                  discount={discount}
                  cv={cpView}
                  backLabel="Back to map"
                  onBack={closeCheckpoint}
                  headingRef={cpHeadingRef}
                />
              </div>
            </section>
          )}

          {cpOpen && cpKind === "bounty" && bounty && (
            <section ref={cpPanelRef} className={`${s.panel} ${s.cpPanel} ${s.btPanel}`} aria-labelledby="bounty-panel-title" inert={cpClosing}>
              <div className={s.panelInner}>
                <BountyBody bounty={bounty} backLabel="Back to map" onBack={closeCheckpoint} headingRef={cpHeadingRef} />
              </div>
            </section>
          )}
        </>
      )}

      {/* The brand alone at the left; the student's group at the right
          (Lovro's review, 2026-10-15). The course's progress is the timeline's. */}
      <header ref={headerRef} className={s.header} inert={view === "list" && isOpen}>
        <BrandMark />
        <span className={s.headerEnd}>
          {corner ? corner(discountSeg, cpOpen && !cpClosing) : discountSeg && <span className={s.soloPill}>{discountSeg}</span>}
        </span>
      </header>

      {view === "list" && <PhoneWorld place={study.place} />}
      {view === "list" && (
        <div className={s.list} inert={isOpen}>
          {phase === "failed" && <p className={s.note}>The 3D map could not load in this browser, so here is the list.</p>}
          {/* The welcome's two lines (2026-10-19), with a source: no button and no cue here. */}
          {hasSource && (
            <div className={s.listWelcome}>
              <WelcomeWords name={source?.firstName ?? null} />
            </div>
          )}
          <section className={s.listNext} aria-label="Next lesson">
            <NextBlock study={study} onWatch={(el) => watch(place, study.placeNext, el)} />
          </section>
          {/* The course's count over its places: a phone has no timeline, and the header's
              01/08 went (2026-10-15). Once every place is done, the Next block says it. */}
          {study.place < N && <FinishedCount study={study} className={s.listCourse} />}
          <ol className={s.areaList}>
            {areas.map((a, k) => (
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
                {/* The 30% follows Video Ads II (Lovro's second Loom, 2026-10-16): the same slimmer row, there for every student and state, opening the checkpoint's sheet. */}
                {k === CHECKPOINT.after && cpView && (
                  <button
                    type="button"
                    className={`${s.areaRow} ${s.cpRow}`}
                    data-cp={cpView.tag}
                    aria-label={cpAria(cpView)}
                    onClick={(e) => openCheckpoint(e.currentTarget)}
                  >
                    <span className={s.rowNum} aria-hidden="true">
                      <TagGlyph className={s.cpRowGlyph} />
                    </span>
                    <span className={s.rowText}>
                      <span className={s.rowName}>{cpView.label.lead}</span>
                      <span className={s.rowMeta}>Checkpoint · {cpView.chip.tail}</span>
                    </span>
                  </button>
                )}
                {/* The Ad Bounty's checkpoint follows Creative Strategy (plan item 18): a slimmer row under its place's, in the same item, so the eight places keep their rows. */}
                {k === BOUNTY.after && bounty && (
                  <button
                    type="button"
                    className={`${s.areaRow} ${s.cpRow}`}
                    data-cp={bounty.done ? "done" : "open"}
                    aria-label={bountyAria(bounty)}
                    onClick={(e) => openCheckpoint(e.currentTarget, "bounty")}
                  >
                    <span className={s.rowNum} aria-hidden="true">
                      <NoticeGlyph className={s.cpRowGlyph} />
                    </span>
                    <span className={s.rowText}>
                      <span className={s.rowName}>{BOUNTY_NAME}</span>
                      <span className={s.rowMeta}>Checkpoint</span>
                    </span>
                  </button>
                )}
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

      {view === "list" && cpOpen && cpKind === "discount" && discount && cpView && (
        <section className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="cp-panel-title">
          <CheckpointBody
            discount={discount}
            cv={cpView}
            backLabel="All areas"
            onBack={closeCheckpoint}
            headingRef={cpHeadingRef}
          />
        </section>
      )}

      {view === "list" && cpOpen && cpKind === "bounty" && bounty && (
        <section className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="bounty-panel-title">
          <BountyBody bounty={bounty} backLabel="All areas" onBack={closeCheckpoint} headingRef={cpHeadingRef} />
        </section>
      )}

      {/* Dev only (never with a source): the builds to compare against, and the
          tuning panel. The panel stays usable while a place is open, so progress
          can be changed while looking at it (the steps rising at 6). */}
      {!hasSource && (
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
              onTier={(t) => sceneRef.current?.setQualityTier(t)}
              posterOn={poster !== null}
              onWatchNext={watchNext}
              onPoster={(on) => {
                if (on) sceneRef.current?.setPoster(true);
                else tryLive();
              }}
            />
          )}
        </footer>
      )}

      {view !== "list" && (
        <div className={s.loading} data-done={phase === "ready" || undefined} role="status" aria-live="polite">
          <span className={s.loadingLine} aria-hidden="true" />
          <span>{phase === "ready" ? "" : "Loading"}</span>
        </div>
      )}
    </main>
  );
}

/** The welcome's two lines (2026-10-19, Lovro's words): over the opening, and at the top of the phone's list. */
function WelcomeWords({ name }: { name: string | null }) {
  return (
    <>
      <h2 id="welcome-title" className={s.welcomeTitle}>
        {name ? `Welcome, ${name}` : "Welcome"}
      </h2>
      <p className={s.welcomeLine}>This is your map through the course.</p>
    </>
  );
}

/** Phones (the list view): the student's place and its next lesson. */
function NextBlock({ study, onWatch }: { study: Study; onWatch: (el: HTMLElement) => void }) {
  const c = useContent();
  const k = study.place;
  // Final pass E: the finished card's wording.
  if (k >= N) {
    return (
      <>
        <h2 className={s.nextArea}>Every place done.</h2>
        <FinishedCount study={study} className={s.listProg} />
        <p className={s.rewatchList}>Pick any place to rewatch.</p>
      </>
    );
  }
  const a = c.areas[k];
  const i = study.placeNext;
  const length = lessonLength(c, k, i);
  return (
    <>
      <p className={s.nextEyebrow}>Next</p>
      <h2 className={s.nextArea}>{a.name}</h2>
      {/* Final pass: the card's count line, so the phone carries what the card does. */}
      <p className={`${s.prog} ${s.listProg}`}>
        <Ticks k={k} n={a.lessons} done={study.done[k]} next={i} />
        <PlaceCount k={k} done={study.done[k]} />
      </p>
      <p className={s.nextLesson}>
        <span className={s.num}>{i + 1}</span>
        <span className={s.t}>{lessonTitle(a, i)}</span>
        {length !== null && (
          <span className={s.dur} data-action={isAction(a, i) || undefined}>
            {length}
          </span>
        )}
      </p>
      {notRecorded(a, i) ? (
        <p className={s.unrecorded}>Not recorded yet</p>
      ) : (
        <button
          type="button"
          className={s.primary}
          aria-label={`Watch lesson ${i + 1}, ${lessonTitle(a, i)}`}
          onClick={(e) => onWatch(e.currentTarget)}
        >
          <Play />
          Watch
        </button>
      )}
    </>
  );
}

/** Final pass C: the phone's window on the world (under 760 px no 3D ever loads). */
const HERO_H = 620;
/** Where the landmark's pin sits in the window: centred, just under the header, so the structure
 *  hangs below it in the open band above the Next block's text (196 zoomed the lookout to fill it). */
const HERO_TY = 130;

/**
 * The phone list view's picture: the student's current place's poster
 * (poster.ts, 60-180 KB, the same files the cheap laptops use) behind the Next
 * block, cropped so its landmark sits in the open band under the header. One
 * image, no WebGL, no per-frame work: the crop is computed once per place and
 * width from the manifest's landmark position (fx, fy), zooming in at most
 * 1.5x past "cover" when the landmark sits near a poster edge.
 */
function PhoneWorld({ place }: { place: number }) {
  const id = `a${Math.min(N, Math.max(1, place + 1))}`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [mark, setMark] = useState<{ id: string; fx: number; fy: number } | null>(null);
  const [crop, setCrop] = useState<{ w: number; h: number; x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${POSTER_DIR}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: PosterManifest | null) => {
        const e = m?.posters?.find((p) => p.id === id);
        const k = e?.markers.find((q) => q.id === id);
        if (live) setMark({ id, fx: k ? k.fx : 0.62, fy: k ? k.fy : 0.45 });
      })
      .catch(() => {
        if (live) setMark({ id, fx: 0.62, fy: 0.45 });
      });
    return () => {
      live = false;
    };
  }, [id]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !mark || mark.id !== id) return;
    const fit = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      if (W < 1 || H < 1) return;
      const tx = W / 2;
      const ty = Math.min(HERO_TY, H * 0.4);
      const cover = Math.max(W / POSTER_W, H / POSTER_H);
      const need = Math.max(
        cover,
        ty / (Math.max(0.05, mark.fy) * POSTER_H),
        (H - ty) / (Math.max(0.05, 1 - mark.fy) * POSTER_H),
        tx / (Math.max(0.05, mark.fx) * POSTER_W),
        (W - tx) / (Math.max(0.05, 1 - mark.fx) * POSTER_W),
      );
      const sc = Math.min(need, cover * 1.5);
      const w = POSTER_W * sc;
      const h = POSTER_H * sc;
      const x = Math.min(0, Math.max(W - w, tx - mark.fx * w));
      const y = Math.min(0, Math.max(H - h, ty - mark.fy * h));
      setCrop({ w: Math.round(w), h: Math.round(h), x: Math.round(x), y: Math.round(y) });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [id, mark]);

  return (
    <div ref={boxRef} className={s.phoneWorld} style={{ height: HERO_H }} aria-hidden="true">
      {crop && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={id}
          src={posterSrc(id)}
          alt=""
          decoding="async"
          draggable={false}
          data-on={loaded === id || undefined}
          onLoad={() => setLoaded(id)}
          style={{ width: crop.w, height: crop.h, transform: `translate3d(${crop.x}px, ${crop.y}px, 0)` }}
        />
      )}
    </div>
  );
}

/** Final pass C: the constellations' names, one per place (SKY_MARKS' shapes, nightsky.ts). */
const SKY_NAMES = SKY_MARKS.map((m) => m.shape.replace(/\b\w/g, (c) => c.toUpperCase()));

/** The line under the telescope: which constellations the student has put in the sky. */
function SkyCaption({ study }: { study: Study }) {
  const { areas } = useContent();
  const names = areas.map((a, k) => (study.done[k] >= a.lessons ? SKY_NAMES[k] : null)).filter((x): x is string => !!x);
  return (
    <>
      <span className={s.lensEyebrow}>
        Your sky · {names.length} of {N} places
      </span>
      <span className={s.lensLine}>{names.length ? names.join(", ") : "Each lesson here lights a star."}</span>
    </>
  );
}

/** One tick per lesson of place k: watched ones filled, the next one outlined. */
function Ticks({ k, n, done, next }: { k: number; n: number; done: number; next: number }) {
  const c = useContent();
  return (
    <span className={s.ticks} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-t={lessonDone(c, k, i, done) ? "d" : i === next ? "n" : undefined} />
      ))}
    </span>
  );
}

/**
 * Final pass: the place's count, one wording for the card, the chip and the
 * phone (at progress 0 the chip said "0 of 8" beside a card saying "8 lessons
 * · 65 min"). Nothing watched: the place's size. Otherwise how far and what
 * is left; `short` (the chip) drops "· 4 to go", which pushed it into the
 * timeline's count at 1366. With a source that does not know the minutes, the
 * size is the lesson count alone.
 */
function PlaceCount({ k, done, short = false }: { k: number; done: number; short?: boolean }) {
  const c = useContent();
  const n = c.areas[k].lessons;
  if (done === 0) {
    const m = placeMinutes(c, k);
    const min = m === null ? 0 : Math.round(m / 5) * 5;
    return (
      <span>
        {n} lessons{min > 0 ? ` · ${min} min` : ""}
      </span>
    );
  }
  return (
    <span>
      <b>{done}</b> of {n}
      {done < n && !short ? ` · ${n - done} to go` : ""}
    </span>
  );
}

/** The arrival card (B's s1, A's Watch): where, how far, the next lesson, one button. */
function CardBody({ k, study, onWatch }: { k: number; study: Study; onWatch: (el: HTMLElement) => void }) {
  const c = useContent();
  const a = c.areas[k];
  const done = study.done[k];
  const i = study.placeNext;
  const action = isAction(a, i);
  const length = lessonLength(c, k, i);
  return (
    <>
      <p className={s.eyebrow}>
        <span className={s.here} aria-hidden="true" />
        <span className={s.accent}>{pad2(k + 1)}</span>
        {a.landmark}
      </p>
      <h2 className={s.cardTitle}>{a.name}</h2>
      <p className={s.prog}>
        <Ticks k={k} n={a.lessons} done={done} next={i} />
        <PlaceCount k={k} done={done} />
      </p>
      <p className={s.nextline}>
        <span className={s.k}>Next</span>
        <span className={s.num}>{i + 1}</span>
        <span className={s.t}>{lessonTitle(a, i)}</span>
        {length !== null && (
          <span className={s.dur} data-action={action || undefined}>
            {length}
          </span>
        )}
      </p>
      {/* Only when every lesson left can't be finished here (map-model.ts): no Watch. */}
      {notRecorded(a, i) ? (
        <p className={s.unrecorded}>Not recorded yet</p>
      ) : (
        <button
          type="button"
          className={s.primary}
          aria-label={`Watch lesson ${i + 1}, ${lessonTitle(a, i)}`}
          onClick={(e) => onWatch(e.currentTarget)}
        >
          <Play />
          Watch
        </button>
      )}
    </>
  );
}

/**
 * Final pass E: every place done. The arrival card at the arch says the
 * course is finished, with the lesson count from progress; nothing is left to
 * watch, so it has no button, only a plain line on how to rewatch.
 */
function FinishedBody({ study }: { study: Study }) {
  const { areas } = useContent();
  return (
    <>
      <p className={s.eyebrow}>
        <span className={s.here} aria-hidden="true" />
        <span className={s.accent}>{pad2(N)}</span>
        {areas[N - 1].landmark}
        <span className={s.eyebrowEnd}>Done</span>
      </p>
      <h2 className={s.cardTitle}>Every place done.</h2>
      <FinishedCount study={study} />
      <p className={s.rewatch}>Pick any place to rewatch.</p>
    </>
  );
}

/** The course's count, one bar segment per place sized by its lessons, for the finished card and the phone. */
function FinishedCount({ study, className }: { study: Study; className?: string }) {
  const { areas, total } = useContent();
  return (
    <p className={className ? `${s.prog} ${className}` : s.prog}>
      <span className={`${s.courseSegs} ${s.finishedSegs}`} aria-hidden="true">
        {areas.map((a, k) => (
          <span key={a.id} className={s.courseSeg} data-state={study.state[k]} style={{ flexGrow: a.lessons }}>
            <i style={{ transform: `scaleX(${study.done[k] / a.lessons})` }} />
          </span>
        ))}
      </span>
      <span>
        <b>{study.doneTotal}</b> of {total} lessons
      </span>
    </p>
  );
}

/**
 * The last place the done card names after place k ("A and B done.", "A to C
 * done."): the run of places done from k on, short of the student's place.
 * Since the second Loom the student's place can be past a place that is not
 * done, one whose lessons left are not recorded yet (map-model.ts): the run
 * stops there, so Creative Strategy at 0 of 18 is never called done.
 */
function doneRun(study: Study, k: number): number {
  let last = k;
  while (last + 1 < Math.min(N, study.place) && study.state[last + 1] === "done") last++;
  return last;
}

/** The done card: one line, and the way on. */
function DoneBody({
  k,
  next: nextK,
  last,
  finished,
  onStart,
}: {
  k: number;
  next: number;
  last: number;
  /** Final pass E: the course, when this update finished its last place (the finished card's lines, no button). */
  finished: Study | null;
  onStart: () => void;
}) {
  const { areas } = useContent();
  const a = areas[k];
  if (finished) {
    return (
      <>
        <p className={s.eyebrow}>
          <span className={s.here} aria-hidden="true" />
          <span className={s.accent}>{pad2(k + 1)}</span>
          {a.landmark}
          <span className={s.eyebrowEnd}>Done</span>
        </p>
        <h2 className={s.cardTitle}>Every place done.</h2>
        <FinishedCount study={finished} />
        <p className={s.rewatch}>Pick any place to rewatch.</p>
      </>
    );
  }
  // The first place not done (-1: none left), and the last place this update finished.
  const next = nextK >= 0 ? areas[nextK] : null;
  const title =
    last <= k ? `${a.name} done.` : last === k + 1 ? `${a.name} and ${areas[last].name} done.` : `${a.name} to ${areas[last].name} done.`;
  return (
    <>
      <p className={s.eyebrow}>
        <span className={s.here} aria-hidden="true" />
        <span className={s.accent}>{pad2(k + 1)}</span>
        {a.landmark}
        <span className={s.eyebrowEnd}>Done</span>
      </p>
      <h2 className={s.cardTitle}>{title}</h2>
      <button type="button" className={s.primary} onClick={onStart}>
        {next ? `Start ${next.name}` : `Open ${a.name}`}
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
  showWatched,
  onShowWatched,
  onBack,
  onOpenLesson,
  onPrefetch,
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
  showWatched: boolean;
  onShowWatched: () => void;
  onBack: () => void;
  onOpenLesson: (i: number) => void;
  /** The pointer entered lesson row i, or the keyboard reached it. */
  onPrefetch: (i: number) => void;
  onBackToArea: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  lessonHeadingRef: RefObject<HTMLHeadingElement | null>;
  rowRefs: RefObject<Array<HTMLButtonElement | null>>;
}) {
  const c = useContent();
  const a = c.areas[idx];
  const done = study.done[idx];
  const nextIdx = idx === study.place ? study.placeNext : -1;
  const setRow = (i: number) => (el: HTMLButtonElement | null) => {
    rowRefs.current[i] = el;
  };

  if (lesson !== null) {
    const length = lessonLength(c, idx, lesson);
    return (
      <div className={s.view} data-dir={dir} key={`lesson-${lesson}`}>
        <div className={s.panelTop}>
          <button type="button" className={s.back} onClick={onBackToArea}>
            <Arrow back />
            {a.name}
          </button>
          <kbd className={s.esc}>Esc</kbd>
        </div>
        <p className={s.eyebrow}>
          <span className={s.accent}>{lesson + 1}</span>
          <span className={s.sep}>/</span>
          {a.lessons}
          {length !== null && <span className={s.eyebrowEnd}>{length}</span>}
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

  // The run of watched lessons from the top, which folds into one row. On the
  // dev page that is every watched lesson; a real student can also have
  // watched one further down, and that one keeps its own row.
  let lead = 0;
  while (lead < a.lessons && lessonDone(c, idx, lead, done)) lead++;
  const fold = lead >= 2 && !showWatched;
  // The lessons left here with no video yet: said once, under the count line.
  let missing = 0;
  for (let i = 0; i < a.lessons; i++) if (!lessonDone(c, idx, i, done) && notRecorded(a, i)) missing++;
  const rows: React.ReactNode[] = [];
  if (fold) {
    rows.push(
      <li key="fold">
        <button type="button" className={s.row} data-state="fold" onClick={onShowWatched}>
          <span className={s.mark} data-m="d" aria-hidden="true" />
          <span className={s.rowN} aria-hidden="true" />
          <span className={s.rowT}>{lead >= a.lessons ? `All ${a.lessons} watched` : `Lessons 1 to ${lead} watched`}</span>
          <span className={s.rowEnd}>Show</span>
        </button>
      </li>,
    );
  }
  for (let i = fold ? lead : 0; i < a.lessons; i++) {
    const title = lessonTitle(a, i);
    const action = isAction(a, i);
    const length = lessonLength(c, idx, i);
    const state = lessonDone(c, idx, i, done) ? "done" : i === nextIdx ? "next" : action ? "action" : "todo";
    // Loom 2: a lesson with no video yet can't be finished here, and still
    // opens. The fix round (.impeccable.md: never mark the negative on every
    // row): the count is said once, under the count line, and such a row is
    // marked by look alone, its title quiet and no length. Only a row the
    // student has passed in their own place (row 11 under a next row 12) says
    // "Not recorded yet" under its title, and the next row does when only such
    // lessons are left.
    const unrecorded = state !== "done" && notRecorded(a, i);
    const says = unrecorded && i <= nextIdx;
    // A lesson row the pointer enters or the keyboard reaches is the likeliest next click.
    const soon = { onPointerEnter: () => onPrefetch(i), onFocus: () => onPrefetch(i) };
    if (state === "next" && !unrecorded) {
      rows.push(
        <li key={i} className={s.nextRow} {...soon}>
          <span className={s.mark} data-m="n" aria-hidden="true" />
          <span className={s.rowN} aria-hidden="true">
            {i + 1}
          </span>
          <span className={s.rowT}>
            {title}
            {length !== null && (
              <span className={s.rowSub} data-action={action || undefined}>
                {length}
              </span>
            )}
          </span>
          <button
            ref={setRow(i)}
            type="button"
            className={`${s.primary} ${s.primarySm}`}
            aria-label={`Watch lesson ${i + 1}, ${title}`}
            onClick={() => onOpenLesson(i)}
          >
            <Play />
            Watch
          </button>
        </li>,
      );
      continue;
    }
    rows.push(
      <li key={i} {...soon}>
        <button
          ref={setRow(i)}
          type="button"
          className={state === "next" ? `${s.row} ${s.nextRow}` : s.row}
          data-state={state}
          data-unrecorded={(unrecorded && state !== "next") || undefined}
          aria-label={`Lesson ${i + 1}, ${title}${state === "done" ? ", watched" : unrecorded ? ", not recorded yet" : action ? ", action item" : ""}`}
          onClick={() => onOpenLesson(i)}
        >
          {/* A next row here has no video (the one with Watch is above): no ▶, which means ready to watch. */}
          <span className={s.mark} data-m={state === "done" ? "d" : action ? "a" : undefined} aria-hidden="true" />
          <span className={s.rowN} aria-hidden="true">
            {i + 1}
          </span>
          <span className={s.rowT}>
            {title}
            {says && <span className={s.rowSub}>Not recorded yet</span>}
          </span>
          {!unrecorded && length !== null && (
            <span className={s.rowEnd} data-action={action || undefined}>
              {length}
            </span>
          )}
        </button>
      </li>,
    );
  }

  return (
    <div className={s.view} data-dir={dir} key="area">
      <div className={s.panelTop}>
        <button type="button" className={s.back} onClick={onBack}>
          <Arrow back />
          {backLabel}
        </button>
        <kbd className={s.esc}>Esc</kbd>
      </div>
      <p className={s.eyebrow}>
        {idx === study.place && <span className={s.here} aria-hidden="true" />}
        <span className={s.accent}>{pad2(idx + 1)}</span>
        {a.landmark}
      </p>
      <h2 ref={headingRef} id="v4-panel-title" className={s.panelTitle} tabIndex={-1}>
        {a.name}
      </h2>
      {a.description && <p className={s.desc}>{a.description}</p>}
      <p className={s.prog}>
        <Ticks k={idx} n={a.lessons} done={done} next={nextIdx} />
        {/* Final pass D: the card's wording (a place not started read "0 of 25 · 25 to go"). */}
        <PlaceCount k={idx} done={done} />
      </p>
      {/* The fix round: its own line, as the count line has no room beside 25 ticks for "11 of 25 · 14 to go" and this. */}
      {missing > 0 && <p className={s.progNote}>{missing === 1 ? "1 lesson" : `${missing} lessons`} not recorded yet</p>}
      <ol className={s.rows}>{rows}</ol>
      {/* The feature row (the Ad Bounty's lesson) is no longer here: it is the one lesson of its own checkpoint (BountyBody, plan item 18). */}
    </div>
  );
}

/** What a screen reader hears for the checkpoint's marker and tag: "30% off, 11 days left". */
function cpAria(cv: CheckpointView): string {
  return `Discount checkpoint, ${cv.label.lead}, ${cv.chip.tail}`;
}

/**
 * The Ad Bounty's one lesson (plan item 18): the source's (the catalog's
 * feature row with the bounty key, source.ts), or on the dev page without a
 * source the fixture's feature row (study.ts), with no video and no page.
 */
function bountyOf(source: WorldSource | undefined, areas: readonly StudyArea[]): WorldBounty | null {
  if (source) return source.bounty ?? null;
  const k = areas.findIndex((a) => a.feature?.key === "bounty_access");
  const f = k >= 0 ? areas[k].feature : undefined;
  return f ? { k, id: "", title: f.title, watch: true, hasVideo: false, done: false } : null;
}

/** What a screen reader hears for the Ad Bounty's marker, tag and phone row: "Ad Bounty checkpoint, 1 lesson". */
function bountyAria(b: WorldBounty): string {
  return `${BOUNTY_NAME} checkpoint, ${b.done ? "watched" : "1 lesson"}`;
}

/** The Ad Bounty program's sign-up page, a public page (Lovro, 2026-10-19): the panel's Apply opens it. */
const BOUNTY_APPLY_URL = "https://creators.ecombounty.com";

/**
 * The Ad Bounty checkpoint's panel (map review 2026-10-15, plan item 18): what
 * the program is in one plain line, in the course's own words for it (a
 * brand tests your ad with its own money and you get a percent of the ad
 * spend for as long as it keeps running), and its one lesson. With a video
 * the lesson gets Watch. A watch lesson without one says it is not recorded
 * yet, once, here where Watch would be. Either way the row opens the
 * lesson's own page (content.onFeature, the address of the old feature row).
 * On the dev page without a source the row is a plain line, as the feature
 * row was. Always open: nothing here is locked or counted.
 *
 * Under the lesson, Apply to Ad Bounties (Lovro's preview review, 2026-10-19:
 * "a big button ... like with the 30% off one"): the 30%'s Apply as it looks
 * when it can be pressed, shown in every state, a link that opens the
 * program's sign-up page in a new tab.
 */
function BountyBody({
  bounty,
  backLabel,
  onBack,
  headingRef,
}: {
  bounty: WorldBounty;
  backLabel: string;
  onBack: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const c = useContent();
  const after = c.areas[BOUNTY.after]?.name ?? "";
  const open = c.onFeature ? () => c.onFeature?.(bounty.k) : null;
  const ready = bounty.watch && bounty.hasVideo && !bounty.done;
  const unrecorded = bounty.watch && !bounty.hasVideo && !bounty.done;
  const state = bounty.done ? "done" : ready ? "ready" : unrecorded ? "unrecorded" : "open";
  let row: ReactNode;
  if (ready && open) {
    row = (
      <li className={s.nextRow}>
        <span className={s.mark} data-m="n" aria-hidden="true" />
        <span className={s.rowN} aria-hidden="true" />
        <span className={s.rowT}>{bounty.title}</span>
        <button type="button" className={`${s.primary} ${s.primarySm}`} aria-label={`Watch ${bounty.title}`} onClick={open}>
          <Play />
          Watch
        </button>
      </li>
    );
  } else {
    const inner = (
      <>
        <span className={s.mark} data-m={bounty.done ? "d" : undefined} aria-hidden="true" />
        <span className={s.rowN} aria-hidden="true" />
        <span className={s.rowT}>
          {bounty.title}
          {unrecorded && <span className={s.rowSub}>Not recorded yet</span>}
        </span>
        <span className={s.rowEnd} aria-hidden="true">
          {open && <Arrow />}
        </span>
      </>
    );
    row = (
      <li>
        {open ? (
          <button
            type="button"
            className={s.row}
            data-state={bounty.done ? "done" : "todo"}
            aria-label={`${bounty.title}${bounty.done ? ", watched" : unrecorded ? ", not recorded yet" : ""}`}
            onClick={open}
          >
            {inner}
          </button>
        ) : (
          <div className={s.row} data-state={bounty.done ? "done" : "todo"}>
            {inner}
          </div>
        )}
      </li>
    );
  }
  return (
    <div className={s.view} data-bounty={state} key="bounty">
      <div className={s.panelTop}>
        <button type="button" className={s.back} onClick={onBack}>
          <Arrow back />
          {backLabel}
        </button>
        <kbd className={s.esc}>Esc</kbd>
      </div>
      <p className={s.eyebrow}>
        <NoticeGlyph className={s.cpEyebrowGlyph} />
        <span className={s.accent}>Checkpoint</span>
        {after && <span className={s.cpAfter}>after {after}</span>}
        {bounty.done && <span className={s.eyebrowEnd}>Watched</span>}
      </p>
      <h2 ref={headingRef} id="bounty-panel-title" className={s.panelTitle} tabIndex={-1}>
        {BOUNTY_NAME}
      </h2>
      <p className={s.desc}>Make ads for real brands and earn a share of the ad spend while they run.</p>
      <ol className={s.rows}>{row}</ol>
      <a className={`${s.primary} ${s.btApply}`} href={BOUNTY_APPLY_URL} target="_blank" rel="noopener noreferrer">
        Apply to Ad Bounties
        <span className={s.srOnly}> (opens in a new tab)</span>
        <Arrow />
      </a>
    </div>
  );
}

/**
 * The discount checkpoint's panel (2026-10-14): the offer, where the student
 * stands on it (src/lib/world/discount.ts discountState), and Apply. No video
 * plays here (Lovro's review, 2026-10-15), so a locked student sees the
 * videos watched and to go, and Apply greyed out until every one is watched.
 * It is aria-disabled, not disabled, so the keyboard and a screen reader
 * still reach it and hear why: its title, "Watch all 61 videos to apply" on the real course, is
 * both the hover's tip and its description. apply() takes no click, Enter or
 * Space before the state is ready. The copy reuses the old dashboard's
 * (DiscountClaimCelebration, StatsWidget) where it still holds: "30% off your
 * next month", "within 48 hours", "your Whop subscription". The code is never
 * shown (the team attaches it on Whop).
 *
 * Since Lovro's second Loom (2026-10-16) it opens for every student and state.
 * Where the offer is closed for the student (the deadline passed, a first
 * payment before 1 October) it says so in one plain line, and the eyebrow
 * says "Closed"; with no first payment on record it asks them to tell the
 * team, and the eyebrow says "Ask the team". Apply shows only while it can
 * still be earned (locked) or is on (ready), never as a dead button.
 *
 * The rule is one line since 2026-10-20 (Lovro: "a lot of confusion for the
 * 30% off"): "Finish every video through Video Ads II within 2 weeks of
 * joining to apply." (checkpointView.ts discountRule), the same words for
 * every student, said while locked and with no first payment on record, and
 * after "This closed on ..." or "Your 2 weeks have passed." where it is closed.
 * T-080's shared deadline (a first payment from 1 October until the launch:
 * the end of 23 October in Croatia, st.window "shared") is unchanged and
 * reaches those students only as the date in "Apply by". An
 * application made on the old dashboard (st.madeBeforeLaunch) gets its own
 * words: "within 48 hours" and "on your next renewal" may no longer hold.
 * Every deadline shows its date and hour in the student's own time zone
 * (checkpointView.ts deadlineAt).
 */
function CheckpointBody({
  discount,
  cv,
  backLabel,
  onBack,
  headingRef,
}: {
  discount: WorldDiscount;
  cv: CheckpointView;
  backLabel: string;
  onBack: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const c = useContent();
  const st = discount.state;
  const after = c.areas[CHECKPOINT.after]?.name ?? "";
  const rule = discountRule(after);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = async () => {
    // Locked, Apply is on the panel but off: a click, Enter or Space asks nothing of the host.
    if (sending || st.kind !== "ready") return;
    setSending(true);
    setError(null);
    let said: string | null;
    try {
      said = await discount.apply();
    } catch {
      said = "That didn't go through. Try again in a moment.";
    }
    if (!alive.current) return;
    setSending(false);
    setError(said);
  };

  // Locked, the line under the title has the days left; ready, "Ready"; any
  // other state, the chip's word (checkpointView.ts): "In review", "Closed"...
  const status = st.kind === "locked" ? null : st.kind === "ready" ? "Ready" : cv.chip.tail;

  // The one Apply, locked and ready. Locked it is greyed out with its reason
  // and a padlock; ready it opens the questions (useWorldDiscount.ts).
  const why = st.kind === "locked" ? `Watch all ${st.lessonsTotal} videos to apply` : null;
  const applyButton = (
    <button
      type="button"
      className={`${s.primary} ${s.cpApply}`}
      onClick={apply}
      disabled={sending}
      aria-disabled={why ? true : undefined}
      title={why ?? undefined}
      aria-busy={sending || undefined}
    >
      {sending ? "Sending…" : `Apply for ${DISCOUNT_PERCENT}% off`}
      {!sending && (why ? <Lock /> : <Arrow />)}
    </button>
  );

  let body: React.ReactNode = null;
  if (st.kind === "locked") {
    const done = st.lessonsTotal - st.lessonsLeft;
    body = (
      <>
        <p className={s.cpWhen}>
          <span>
            Apply by <b>{cv.deadline}</b>
          </span>
          {cv.left && <span className={s.cpLeft}>{cv.left}</span>}
        </p>
        <p className={s.desc}>{rule.open}</p>
        <div className={s.cpBar} aria-hidden="true">
          <i style={{ transform: `scaleX(${st.lessonsTotal > 0 ? done / st.lessonsTotal : 0})` }} />
        </div>
        <p className={s.prog}>
          <span>
            <b>{done}</b> of {st.lessonsTotal} videos
          </span>
          <span className={s.cpToGo}>{st.lessonsLeft} to go</span>
        </p>
        {applyButton}
      </>
    );
  } else if (st.kind === "ready") {
    body = (
      <>
        <p className={s.cpWhen}>
          <span>
            Apply by <b>{cv.deadline}</b>
          </span>
          {cv.left && <span className={s.cpLeft}>{cv.left}</span>}
        </p>
        <p className={s.desc}>
          Every video through {after} is watched. Apply now and the team confirms within 48 hours.
        </p>
        {applyButton}
        {error && (
          <p className={s.cpError} role="alert">
            {error}
          </p>
        )}
      </>
    );
  } else if (st.kind === "pending") {
    // An application from the old dashboard: one line, with its date in it (so no "Sent" line above).
    body = st.madeBeforeLaunch ? (
      <p className={s.desc}>
        You applied on {shortDate(st.at)}, before the new course opened. The team still has to decide it. Ask in Discord if you haven&apos;t heard back.
      </p>
    ) : (
      <>
        <p className={s.cpWhen}>
          <span>
            Sent <b>{shortDate(st.at)}</b>
          </span>
        </p>
        <p className={s.desc}>
          Your application is in. The team checks it and confirms within 48 hours, then puts the {DISCOUNT_PERCENT}% on your Whop subscription.
        </p>
      </>
    );
  } else if (st.kind === "approved") {
    body = st.madeBeforeLaunch ? (
      <p className={s.desc}>
        Your {DISCOUNT_PERCENT}% was approved before the new course opened. If it hasn&apos;t shown up on a payment yet, ask in Discord.
      </p>
    ) : (
      <p className={s.desc}>
        Approved. The team is putting it on your Whop subscription, and you&apos;ll see it on your next renewal. Nothing else to do.
      </p>
    );
  } else if (st.kind === "applied") {
    body = st.madeBeforeLaunch ? (
      <p className={s.desc}>You got your {DISCOUNT_PERCENT}% before the new course opened. It&apos;s one per student.</p>
    ) : (
      <p className={s.desc}>It&apos;s on your Whop subscription. You&apos;ll see {DISCOUNT_PERCENT}% off on your next renewal.</p>
    );
  } else if (st.kind === "rejected") {
    body = (
      <>
        <p className={s.desc}>The team didn&apos;t approve this one.</p>
        {st.rejectionReason && <p className={s.cpReason}>{st.rejectionReason}</p>}
        <p className={s.desc}>If you think that&apos;s wrong, ask in Discord and the team will sort it out.</p>
      </>
    );
  } else if (st.kind === "expired") {
    body = <p className={s.desc}>{`This closed on ${cv.deadline}. ${rule.closed}`}</p>;
  } else if (st.kind === "not-eligible") {
    body = (
      <p className={s.desc}>
        {st.reason === "before-launch"
          ? rule.beforeLaunch
          : st.reason === "no-payment"
            ? `${rule.open} We can't see your first payment yet. Tell the team and they'll sort it out.`
            : "This offer isn't open yet."}
      </p>
    );
  }

  return (
    <div className={s.view} data-cp-state={st.kind} data-cp={cv.tag} key="cp">
      <div className={s.panelTop}>
        <button type="button" className={s.back} onClick={onBack}>
          <Arrow back />
          {backLabel}
        </button>
        <kbd className={s.esc}>Esc</kbd>
      </div>
      <p className={s.eyebrow}>
        <TagGlyph className={s.cpEyebrowGlyph} />
        <span className={s.accent}>Checkpoint</span>
        {after && <span className={s.cpAfter}>after {after}</span>}
        {status && <span className={s.eyebrowEnd}>{status}</span>}
      </p>
      <h2 ref={headingRef} id="cp-panel-title" className={s.panelTitle} tabIndex={-1}>
        {DISCOUNT_PERCENT}% off your next month
      </h2>
      {body}
    </div>
  );
}

/** A price tag on its side, the point to the left with its hole: the discount's one shape. */
function TagGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <path
        d="M1.2 5.5 4.9 1.3c.2-.2.5-.3.7-.3h8.3c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H5.6c-.3 0-.5-.1-.7-.3L1.2 5.5Z"
        className={s.tagBody}
      />
      <circle cx="5.6" cy="5.5" r="1.15" className={s.tagHole} />
    </svg>
  );
}

/**
 * A notice pinned up, two lines on it: the Ad Bounty's one shape (plan item
 * 18), the board's bounty notices in the world. Drawn in the price tag's box
 * and classes, so it takes the tag's colours wherever the tag does.
 */
function NoticeGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <rect x="4" y="1.2" width="8" height="9.4" rx="1" className={s.tagBody} />
      <circle cx="8" cy="2.9" r="1.05" className={s.tagHole} />
      <rect x="5.7" y="5.3" width="4.6" height="1.1" rx="0.4" className={s.tagHole} />
      <rect x="5.7" y="7.6" width="3.2" height="1.1" rx="0.4" className={s.tagHole} />
    </svg>
  );
}

/** A small right-pointing triangle: ready to watch (.impeccable.md state shapes). */
function Play() {
  return (
    <svg className={s.playIcon} width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <path d="M1 1.2v9.6c0 .5.5.8.9.5l7.4-4.8a.6.6 0 0 0 0-1L1.9.7C1.5.4 1 .7 1 1.2Z" fill="currentColor" />
    </svg>
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

/**
 * The brand, alone at the header's left (Lovro's review, 2026-10-15:
 * "everything is going to be Ecom University"). The logo is the Ecom
 * University lockup with "| Ad Creative", Lovro's pick, in Karlo's white
 * file exactly as it came from his brand pack (public/brand/). It replaces
 * the name and the half-sun Mark, since a logo carries its own mark.
 * Another file: put it in public/brand/ and change BRAND_LOGO (its path, its
 * own width and height, which hold its proportions before it loads so
 * nothing moves, and what it says). BRAND_LOGO null shows the name in the
 * map's type beside the Mark instead.
 */
const BRAND_LOGO: { src: string; width: number; height: number; alt: string } | null = {
  src: "/brand/ecomu-ad-creative-white.svg",
  width: 3142,
  height: 233,
  alt: "Ecom University, Ad Creative",
};
const BRAND_NAME = "Ecom University";

function BrandMark() {
  if (BRAND_LOGO !== null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={s.brandLogo}
        src={BRAND_LOGO.src}
        width={BRAND_LOGO.width}
        height={BRAND_LOGO.height}
        alt={BRAND_LOGO.alt}
        draggable={false}
      />
    );
  }
  return (
    <span className={s.brand}>
      <Mark />
      {BRAND_NAME}
    </span>
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
