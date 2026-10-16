/**
 * The map component's one input, for when it shows a real student.
 *
 * WorldV6 with no `source` is the dev page: the fixture in study.ts, the TUNE
 * panel, a placeholder lesson view. WorldV6 with a `source` shows what it is
 * given, changes no progress of its own, and asks its host to change the
 * address when the student opens a place or a lesson. The host is
 * src/components/world/WorldMap.tsx (world_v6_wiring_prd.md §8).
 *
 * The shapes are the fixture's own (StudyArea, Study), so nothing inside the
 * component has two ways of reading the student. Geometry (id, landmark word,
 * mesh, rail depth) always comes from STUDY_AREAS, which reads layout.PLACES;
 * the content (name, lesson count, titles, action items, the feature row)
 * comes from the catalog through buildMapModel().
 */
import type { MapModel } from "@/lib/world/map-model";
import type { DiscountState } from "@/lib/world/discount";
import { STUDY_AREAS, type AreaState, type LockMode, type Study, type StudyArea } from "./study";

export interface WorldSource {
  /** Content per place, in route order. Always eight. */
  areas: readonly StudyArea[];
  study: Study;
  /** Counting lessons in the whole course. */
  total: number;
  lock: LockMode;
  /** Minutes lesson i of place k runs; null when the catalog has no duration (then no minutes are shown). */
  minutes(k: number, i: number): number | null;
  /** Is lesson i of place k done? (A real student can watch out of order.) */
  isDone(k: number, i: number): boolean;
  /** The place the route says is open (0..7), or null. */
  openK: number | null;
  /** A lesson page is open over the map: draw nothing, take no keys, hold progress. */
  paused: boolean;
  /** The student opened place k inside the map. */
  onOpenArea(k: number): void;
  /** The student closed the open place inside the map. */
  onCloseArea(): void;
  /** Open the lesson page for lesson i of place k. */
  onWatch(k: number, i: number): void;
  /** Open the page of place k's feature row. */
  onFeature(k: number): void;
  /**
   * Lesson i of place k may be opened soon: ask for its page and its video's address now.
   * Called when a place's panel opens (its first lesson not done), when the
   * card shows the student's next lesson, and when the pointer or the
   * keyboard reaches a lesson row of the panel. The host decides whether the
   * lesson has a video and asks no more than once (embed-cache.ts).
   */
  onPrefetch?(k: number, i: number): void;
  /**
   * The early-finish discount (2026-10-14): what the discount checkpoint
   * between the Trail Hut and the Boathouse, its timeline tag, the header's
   * chip and its panel show. Absent: none of them shows and the cache in
   * the world stands closed.
   */
  discount?: WorldDiscount;
  /**
   * The Ad Bounty's lesson (map review 2026-10-15, plan item 18): a place's
   * feature row, which the map shows as the one lesson of its own checkpoint
   * on the notice-board isle after Creative Strategy, not as a row of that
   * place's panel. onFeature(bounty.k) opens its page. Absent: no bounty
   * checkpoint shows.
   */
  bounty?: WorldBounty;
  /**
   * The address names the Ad Bounty's lesson page (it is open over the map).
   * Opened by its address (a refresh, a link from outside the map) it has no
   * checkpoint panel under it, so the checkpoint opens once the page closes:
   * the page's back link and Esc come home to the panel, as they do when the
   * page was opened from it.
   */
  bountyOpen?: boolean;
}

/** The Ad Bounty's lesson, as the catalog has it (sourceData). */
export interface WorldBounty {
  /** The place whose feature row it is (Creative Strategy, 6, on the real course). */
  k: number;
  /** Its lesson id ("" on the dev page's fixture, which opens no page). */
  id: string;
  title: string;
  /** A watch lesson (the generated dev course has a setup step there). */
  watch: boolean;
  /** A watch lesson with a video behind it: the panel shows Watch. */
  hasVideo: boolean;
  done: boolean;
}

/** The student's discount, as the host worked it out (src/lib/world/discount.ts). */
export interface WorldDiscount {
  state: DiscountState;
  /** The clock the state was worked out at (ms), for "11 days left". */
  now: number;
  /** The next video the offer asks for, as place k and lesson i (locked only), or null. */
  next: { k: number; i: number } | null;
  /** Apply for it: null once the application is in, else the words to show the student. */
  apply(): Promise<string | null>;
}

/** Everything of a WorldSource that comes from the model: the host adds the route and the callbacks. */
export interface SourceData {
  areas: StudyArea[];
  study: Study;
  total: number;
  /** Lesson ids per place, in the order of `areas[k].sample`. */
  lessonIds: string[][];
  /** The feature row's lesson id per place, or null. */
  featureIds: (string | null)[];
  minutes: (number | null)[][];
  done: boolean[][];
  /** The Ad Bounty's lesson: the first place whose feature row has the bounty key, or null. */
  bounty: WorldBounty | null;
}

type ReadyModel = Extract<MapModel, { ok: true }>;

/** The catalog's feature key of the Ad Bounty's lesson (lessons.feature_key). */
export const BOUNTY_KEY = "bounty_access";

/** The Ad Bounty checkpoint's name: its marker, tag, phone row and panel, and its lesson's page (LessonScreen). */
export const BOUNTY_NAME = "Ad Bounty";

export function sourceData(model: ReadyModel, lock: LockMode): SourceData {
  const n = STUDY_AREAS.length;
  const areas: StudyArea[] = [];
  const lessonIds: string[][] = [];
  const featureIds: (string | null)[] = [];
  const minutes: (number | null)[][] = [];
  const done: boolean[][] = [];
  const doneCount: number[] = [];
  let bounty: WorldBounty | null = null;

  for (let k = 0; k < n; k++) {
    const m = model.areas[k];
    const actions: number[] = [];
    const unrecorded: number[] = [];
    m.lessons.forEach((l, i) => {
      if (l.action) actions.push(i);
      if (!l.finishable) unrecorded.push(i);
    });
    // The Ad Bounty's row when the place has one (plan item 18: its own checkpoint's lesson), else the first.
    const feature = m.features.find((f) => f.key === BOUNTY_KEY) ?? m.features[0];
    if (m.features.length > 1 && process.env.NODE_ENV !== "production") {
      console.warn(`[world-v6] ${m.id} has ${m.features.length} rows outside the count; only one is shown`, m.features.map((f) => f.id));
    }
    if (!bounty && feature?.key === BOUNTY_KEY) {
      bounty = { k, id: feature.id, title: feature.title, watch: feature.watch, hasVideo: feature.hasVideo, done: feature.done };
    }
    areas.push({
      ...STUDY_AREAS[k],
      name: m.name,
      lessons: m.lessons.length,
      description: "",
      sample: m.lessons.map((l) => l.title),
      actions,
      unrecorded,
      feature: feature ? { key: "bounty_access", title: feature.title } : undefined,
    });
    lessonIds.push(m.lessons.map((l) => l.id));
    featureIds.push(feature ? feature.id : null);
    minutes.push(m.lessons.map((l) => l.minutes));
    done.push(m.lessons.map((l) => l.done));
    doneCount.push(m.done);
  }

  const place = model.place;
  const current = Math.min(place, n - 1);
  // The places finished in a row from the start, for the scene's whole-place
  // look (setProgress). The student's place can be past a place not finished:
  // one whose lessons left are not recorded yet (map-model.ts).
  let finished = 0;
  while (finished < n && doneCount[finished] >= areas[finished].lessons) finished++;
  const state: AreaState[] = [];
  const locked: boolean[] = [];
  const unreachable: boolean[] = [];
  for (let k = 0; k < n; k++) {
    state.push(doneCount[k] >= areas[k].lessons ? "done" : k === place ? "current" : "todo");
    locked.push(lock !== "open" && k > current);
    unreachable.push(lock === "locked" && k > current);
  }

  const study: Study = {
    current,
    finished,
    progress: finished >= n ? n : finished + Math.min(0.999, doneCount[finished] / Math.max(1, areas[finished].lessons)),
    done: doneCount,
    nextLesson: Math.max(0, model.placeNext),
    place,
    placeNext: model.placeNext,
    doneTotal: model.doneTotal,
    state,
    locked,
    unreachable,
  };

  return { areas, study, total: model.total, lessonIds, featureIds, minutes, done, bounty };
}
