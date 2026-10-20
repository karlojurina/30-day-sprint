"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { StudentContext, type StudentContextType } from "@/contexts/StudentContext";
import type { CatalogLessonLike, CatalogRegionLike } from "@/lib/world/catalog";
import type { StudentLessonWatch } from "@/types/database";
import {
  COURSE,
  COURSE_VIDEO_LESSON_IDS,
  COURSE_WITH_SAMPLE_TEXT,
  coursePresetIds,
  withCourseTexts,
} from "./courseCatalog";
import { withEmbedCache } from "@/lib/world/embed-cache";
import { LessonAccessContext, LessonTransportContext, type LessonAccess } from "@/lib/world/useLessonTransport";
import {
  createFixtureServer,
  VIDEO_LESSON_IDS,
  type DevVideos,
  type FixtureCall,
  type FixtureWatchRow,
} from "./fixtureTransport";
import { useFixtureActionItems } from "./fixtureActionItems";
import { FixtureDiscount, discountPresetIds } from "./fixtureDiscount";
import { FixtureHud, hudStreak } from "./fixtureHud";
import { CelebrationStandInContext } from "@/components/world/WorldCelebrations";
import { AnyLessonFinishesContext } from "@/components/world/useMapModel";
import { StudentNameStandInContext } from "@/components/world/WorldMap";

/**
 * The pretend student behind /dev/world-app (world_v6_wiring_prd.md, Work Item 4).
 *
 * It provides the app's own StudentContext, so WorldStage, WorldMap, PlaceRoute,
 * LessonScreen and LessonPlayer run exactly as they do under /world. It makes
 * no network request of any kind: the catalog is generated here in the shape
 * of the staging seed (migration 2026_v94_catalog_next_staging.sql), and
 * "watched" is a Set held in React state.
 *
 * THREE LESSONS CAN HAVE A REAL VIDEO (tella_player_prd.md, Work Item 4). When
 * the layout hands down two Tella video ids (`devVideos`, read from
 * .env.local on the server), a2l01 and a2l02 play them and a2l03 points at an
 * id no video has. The player's three calls are answered by the stand-in
 * server in fixtureTransport.ts, so this app is still asked for nothing; the
 * only request that leaves the page is the frame loading from Tella. Without
 * the ids no lesson has a video, as before.
 *
 * Only the fields the world tree reads are supplied: useWorldCatalog reads
 * lessons, regions, completedLessonIds, watchProgress, loading and loadError;
 * WorldMap and LessonScreen read completedLessonIds and watchedLessonIds
 * (useWorldDiscount the second too); LessonScreen and
 * LessonPlayer call markWatched; LessonPlayer reads watchProgress and
 * patchWatchProgress (kept here the way StudentProvider keeps them, so a
 * lesson left halfway resumes). LessonScreen's action item block reads
 * completions and calls saveDiscordLink and toggleLessonAction, kept in memory
 * by fixtureActionItems.ts. Anything else on StudentContextType is absent,
 * which is what the cast below admits to.
 *
 * The query string is read once, when the layout mounts. The stage's links
 * carry no query, so the preset has to survive every navigation inside the
 * harness; a full page load starts over.
 *
 *   ?p=p0       nothing done (the default)
 *   ?p=mid      areas 1 to 3 done, lessons 1 to 18 of area 4
 *   ?p=last     areas 1 to 3 done, lessons 1 to 21 of area 4
 *   ?p=ooo      area 1 done; lessons 1, 2, 3 and 7 of area 2
 *   ?p=all      every lesson that counts toward progress
 *
 *   ?catalog=loading   loading stays true
 *   ?catalog=error     loadError set, no rows
 *   ?catalog=empty     no rows, no error
 *   ?catalog=shape     only the first four areas and their lessons
 *   ?catalog=course    the real course (course_catalog_prd.md, Work Item 3)
 *
 *   ?latency=<ms>      the stand-in server gives a lesson's address that many
 *                      ms after it is asked (0 to 5000, default 0), as the
 *                      real route would. Any mode.
 *
 *   ?discount=<preset> the early-finish discount's states, in memory
 *                      (fixtureDiscount.tsx: locked, ready, pending, approved,
 *                      applied, applied-after-renewal, rejected, expired,
 *                      before-launch, september, october, october-expired,
 *                      october-old-course, october-old-course-pending,
 *                      october-old-course-approved, no-payment);
 *                      ready, the four with an application and
 *                      applied-after-renewal add the videos the offer asks
 *                      for to the ?p= preset. Without it the
 *                      pretend student paid 3 days ago, as locked (2026-10-16),
 *                      so the 30% shows on the plain page too.
 *
 *   ?hud=<preset>      the map's top-left corner: the streak (on this context,
 *                      as StudentProvider carries it) and the achievements and
 *                      Sign out (fixtureHud.tsx: cold, some, long, all,
 *                      fresh). Without it: no streak, no achievements.
 *
 *   ?playbook=1        the pretend student has the Playbook (playbookUnlocked,
 *                      as StudentProvider works it out): the corner shows
 *                      the link (PlaybookLink.tsx). Without it: not.
 *
 *   ?celebrate=1       the map's celebrations may fire (WorldCelebrations.tsx):
 *                      the pretend student stands in for the signed-in one
 *                      their triggers need, under the id "fixture-student".
 *                      Without it they never fire on their own, so a ?hud=
 *                      streak does not put one over every other test.
 *
 *   ?questions=<preset> the discount application's questions
 *                      (fixtureDiscount.tsx: none, fail; default the six).
 *
 * The pretend student is called Maya Brooks (a made-up name), so the welcome
 * at the map's start reads "Welcome, Maya" (WorldMap.tsx,
 * StudentNameStandInContext).
 *
 * THE REAL COURSE. ?catalog=course swaps the generated catalog for the rows of
 * courseCatalog.ts: the 8 areas and 141 lessons of
 * supabase/catalog/course_catalog.json, with a length and a video on the
 * lessons course-lengths.fixture.json lists. The three video lessons are not
 * part of it: with the two ids, every lesson that has a video plays test
 * video 1 (fixtureTransport.ts). Its presets are p0, mid (areas 1 to 3 done,
 * lessons 1 to 9 of area 4), partial (the first 6 lessons of every area), loom
 * (Lovro's test in the map review Loom: 3 of area 3, 7 of area 4) and all; any
 * other name is p0.
 * world-tests/v6-course.mjs walks it. Its watch lessons with no video can't
 * be finished on the map, as in the app (map-model.ts); on the placeholder
 * course "Mark watched (dev)" finishes any lesson, so there the map passes
 * none over (AnyLessonFinishesContext).
 *
 * THE LESSONS' TEXT, course mode only (courseCatalog.ts, THE LESSONS' TEXT).
 * With ?text=sample the made-up sample text is on a5l22 and a5l08, and
 * nothing else is. Without it, the texts of the private file the layout read
 * from DEV_COURSE_TEXT_FILE (`courseTexts`), when there is one. With neither,
 * no lesson has a text, as before. Every other mode ignores both.
 *
 * For the browser run: window.__fixture.complete(id) marks a lesson watched,
 * window.__fixture.completed() lists what is watched, window.__fixture.watch
 * holds the stand-in server's watch rows by lesson id,
 * window.__fixture.calls every call the player made to it, and
 * window.__fixture.setStreak(n) sets the streak, as a refresh after a
 * finished lesson would.
 */

const AREAS = [
  { name: "Introduction", lessons: 8 },
  { name: "Fundamentals", lessons: 10 },
  { name: "Video Ads I", lessons: 22 },
  { name: "Video Ads II", lessons: 22 },
  { name: "Static Ads", lessons: 25 },
  { name: "AI Ads & Content", lessons: 22 },
  { name: "Creative Strategy", lessons: 22 },
  { name: "Job Board", lessons: 14 },
] as const;

/** The nine action items of the staging seed. */
const ACTION_IDS: ReadonlySet<string> = new Set([
  "a3l07", "a3l14", "a3l21",
  "a4l07", "a4l14", "a4l21",
  "a5l08", "a5l16", "a5l24",
]);
/** The discount gate. */
const GATE_ID = "a5l25";
/** The Ad Bounty row: a setup step outside the lesson count. */
const FEATURE_ID = "a7l22";
/** v6-app.mjs looks for the start of this sentence on the feature row's page. */
const FEATURE_TEXT = "Fixture setup step: Ad Bounty access is requested here.";
const LOAD_ERROR = "Fixture: the course request failed (?catalog=error).";

/** Lesson n (1-based) of area k (1-based): "a4l19". */
function lessonId(k: number, n: number): string {
  return `a${k}l${String(n).padStart(2, "0")}`;
}

/** v6-app.mjs looks for "Fixture milestone brief for <id>" on an action item's page. */
function actionBrief(id: string): string {
  return `Fixture milestone brief for ${id}: ship the work this lesson asks for.`;
}

interface Rows {
  regions: CatalogRegionLike[];
  lessons: CatalogLessonLike[];
}

/** The first `areaCount` areas of the staging seed and their lessons. */
function buildRows(areaCount: number): Rows {
  const regions: CatalogRegionLike[] = [];
  const lessons: CatalogLessonLike[] = [];
  // sort_order is global and contiguous in the seed, so it runs on across areas.
  let sortOrder = 0;
  for (let k = 1; k <= AREAS.length; k++) {
    const area = AREAS[k - 1];
    const regionId = `a${k}`;
    if (k <= areaCount) regions.push({ id: regionId, order_num: k, name: area.name });
    for (let n = 1; n <= area.lessons; n++) {
      sortOrder += 1;
      if (k > areaCount) continue;
      const id = lessonId(k, n);
      const action = ACTION_IDS.has(id);
      const row: CatalogLessonLike = {
        id,
        region_id: regionId,
        type: "watch",
        title: `${area.name} · lesson ${n}`,
        description: null,
        sort_order: sortOrder,
        requires_action: action,
        action_brief: action ? actionBrief(id) : null,
        is_optional: false,
        is_gate: id === GATE_ID,
        counts_toward_progress: true,
        feature_key: null,
        // No video here. The three lessons that can have one get it in withVideos().
        has_video: false,
        // Area 1 only, so the map shows minutes there and hides them everywhere else.
        duration_seconds: k === 1 ? 300 + 61 * n : null,
      };
      lessons.push(
        id === FEATURE_ID
          ? {
              ...row,
              type: "setup",
              title: "Ad Bounty · get access",
              description: FEATURE_TEXT,
              counts_toward_progress: false,
              feature_key: "bounty_access",
            }
          : row,
      );
    }
  }
  return { regions, lessons };
}

const FULL = buildRows(AREAS.length);
const FIRST_FOUR = buildRows(4);
const NONE: Rows = { regions: [], lessons: [] };

/** The same rows, with a video of `seconds` on the three video lessons. */
function withVideos(rows: Rows, seconds: number): Rows {
  return {
    regions: rows.regions,
    lessons: rows.lessons.map((l) =>
      VIDEO_LESSON_IDS.includes(l.id) ? { ...l, has_video: true, duration_seconds: seconds } : l,
    ),
  };
}

/** Lessons `from`..`to` (1-based, inclusive) of area k. */
function span(k: number, from: number, to: number): string[] {
  const ids: string[] = [];
  for (let n = from; n <= to; n++) ids.push(lessonId(k, n));
  return ids;
}

/** Every lesson of areas 1..k. */
function areasThrough(k: number): string[] {
  const ids: string[] = [];
  for (let a = 1; a <= k; a++) ids.push(...span(a, 1, AREAS[a - 1].lessons));
  return ids;
}

function presetIds(name: string | null): string[] {
  switch (name) {
    case "mid":
      return [...areasThrough(3), ...span(4, 1, 18)];
    case "last":
      return [...areasThrough(3), ...span(4, 1, 21)];
    case "ooo":
      return [...areasThrough(1), lessonId(2, 1), lessonId(2, 2), lessonId(2, 3), lessonId(2, 7)];
    case "all":
      return FULL.lessons.filter((l) => l.counts_toward_progress).map((l) => l.id);
    default:
      return [];
  }
}

type CatalogMode = "ready" | "loading" | "error" | "empty" | "shape" | "course";

function catalogMode(name: string | null): CatalogMode {
  return name === "loading" || name === "error" || name === "empty" || name === "shape" || name === "course"
    ? name
    : "ready";
}

/** The catalog mode of a query string. null before the page has read it. */
function modeOf(search: string | null): CatalogMode | null {
  return search === null ? null : catalogMode(new URLSearchParams(search).get("catalog"));
}

/** ?text=sample: the course's sample text in place of any other. */
function sampleTextOf(search: string | null): boolean {
  return search !== null && new URLSearchParams(search).get("text") === "sample";
}

/**
 * The pretend student, as the lesson cache sees it (useLessonTransport.ts):
 * one student, always active. It stands in for AuthContext's signed-in one,
 * which this page does not have.
 */
const PRETEND_ACCESS: LessonAccess = { studentId: "fixture-student", active: true };

/** ?latency=<ms>: how long the stand-in server takes to give a lesson's address. 0 to 5000, default 0. */
function latencyOf(search: string | null): number {
  const ms = search === null ? 0 : Number(new URLSearchParams(search).get("latency") ?? 0);
  return Number.isFinite(ms) ? Math.min(5000, Math.max(0, Math.round(ms))) : 0;
}

interface FixtureHook {
  complete(id: string): void;
  completed(): string[];
  watch: Record<string, FixtureWatchRow>;
  calls: FixtureCall[];
  setStreak(n: number): void;
}

/** ?<name>=1 in the query string. */
function flagOf(search: string | null, name: string): boolean {
  return search !== null && new URLSearchParams(search).get(name) === "1";
}

/** ?celebrate=1: the pretend student behind the map's celebrations. */
const PRETEND_CELEBRANT = { studentId: "fixture-student" };
/** The pretend student's name, as a students row holds it. Made up. */
const PRETEND_NAME = "Maya Brooks";
type FixtureWindow = Window & { __fixture?: FixtureHook };

/** The query string never changes under the provider: it is read once and kept. */
const subscribeNever = () => () => {};
const noServerQuery = () => null;

export function FixtureStudentProvider({
  children,
  devVideos = null,
  courseTexts = null,
}: {
  children: ReactNode;
  /** The two test videos from .env.local, or null when they are not set. */
  devVideos?: DevVideos | null;
  /**
   * Lesson id to text, from the private file DEV_COURSE_TEXT_FILE names, as
   * the layout matched it against the course's titles. null when the
   * variable is not set or the file could not be read.
   */
  courseTexts?: Readonly<Record<string, string>> | null;
}) {
  // The query string as it was when this provider mounted. null on the server
  // and while hydrating (the server render has no query), so the first paint
  // is the loading state, as it is under StudentProvider.
  const [boot] = useState<{ search: string | null }>(() => ({ search: null }));
  const search = useSyncExternalStore(
    subscribeNever,
    () => (boot.search ??= window.location.search),
    noServerQuery,
  );
  const mode = useMemo(() => modeOf(search), [search]);
  /** Set by window.__fixture.setStreak, over the ?hud= preset's. */
  const [streakNow, setStreakNow] = useState<number | null>(null);
  const streak = useMemo(() => {
    const base = hudStreak(search);
    return streakNow === null ? base : { current: streakNow, longest: Math.max(base.longest, streakNow) };
  }, [search, streakNow]);
  const playbookUnlocked = flagOf(search, "playbook");
  const celebrate = flagOf(search, "celebrate");
  const sampleText = sampleTextOf(search);
  // The course with the private file's texts, made once: the layout hands
  // down a new object on every server render, and the map must not be handed
  // a new list of lessons for that.
  const [courseWithFileTexts] = useState(() => (courseTexts ? withCourseTexts(courseTexts) : COURSE));
  const preset = useMemo(() => {
    if (search === null) return [];
    const name = new URLSearchParams(search).get("p");
    // The real course has its own presets: the others count placeholder lessons.
    const ids = modeOf(search) === "course" ? coursePresetIds(name) : presetIds(name);
    // ?discount=ready and after: every video the offer asks for is watched too (fixtureDiscount.tsx).
    return [...ids, ...discountPresetIds(search, modeOf(search) === "course" ? COURSE.lessons : FULL.lessons)];
  }, [search]);
  /** Lessons marked watched since the page loaded, on top of the preset. */
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set());
  // Action items: the Discord link and the two halves, in memory (fixtureActionItems.ts).
  const actionItems = useFixtureActionItems();
  // The preset and the catalog arrive in the same render, so the map first
  // mounts with the preset in place and a page load never plays the done moment.
  const completedLessonIds = useMemo(() => {
    const ids = new Set(preset);
    for (const id of watched) ids.add(id);
    for (const id of actionItems.doneIds) ids.add(id);
    return ids;
  }, [preset, watched, actionItems.doneIds]);
  // The lessons whose watch half is in, as StudentProvider has them
  // (`completed_at` set): every done lesson, and an action item whose video is
  // watched while its hand-in is still open, which the map and the lesson page
  // pass when they find the next lesson (map-model.ts isPassed).
  const watchedLessonIds = useMemo(
    () => new Set([...completedLessonIds, ...actionItems.watchedIds]),
    [completedLessonIds, actionItems.watchedIds],
  );

  const markWatched = useCallback((id: string) => {
    setWatched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // What the player has been told about its own watching, kept the way
  // StudentProvider keeps it (patchWatchProgress in StudentContext.tsx): the
  // furthest point and the played seconds only ever grow, and the 95% stamp is
  // never taken back. Empty until a lesson with a video is played.
  const [watchProgress, setWatchProgress] = useState<ReadonlyMap<string, StudentLessonWatch>>(
    () => new Map(),
  );
  const patchWatchProgress = useCallback(
    (lessonId: string, patch: Partial<StudentLessonWatch>) => {
      setWatchProgress((prev) => {
        const out = new Map(prev);
        const base: StudentLessonWatch = out.get(lessonId) ?? {
          lesson_id: lessonId,
          max_position_seconds: 0,
          last_position_seconds: 0,
          watched_seconds: 0,
          reported_duration_seconds: null,
          threshold_met_at: null,
          last_heartbeat_at: new Date().toISOString(),
        };
        out.set(lessonId, {
          ...base,
          ...patch,
          max_position_seconds: Math.max(base.max_position_seconds, patch.max_position_seconds ?? 0),
          watched_seconds: Math.max(base.watched_seconds, patch.watched_seconds ?? 0),
          threshold_met_at: base.threshold_met_at ?? patch.threshold_met_at ?? null,
        });
        return out;
      });
    },
    [],
  );

  // The stand-in server: made once, so its rows live as long as the page does.
  // The ids come down from the server once and do not change under it. The
  // mode is not known yet when it is made (the query string is read after
  // hydration), so it asks for the course's video lessons on each call.
  const [server] = useState(() =>
    createFixtureServer({
      videos: devVideos,
      markWatched,
      courseVideoLessons: () => (modeOf(boot.search) === "course" ? COURSE_VIDEO_LESSON_IDS : null),
      latencyMs: () => latencyOf(boot.search),
    }),
  );
  // What the map's host and the lesson page both read: the stand-in server
  // behind the page's one embed cache, made once like the server.
  // `server.calls` still logs every request that reaches the server.
  const [transport] = useState(() => withEmbedCache(server.transport));

  useEffect(() => {
    const w = window as FixtureWindow;
    w.__fixture = {
      complete: markWatched,
      completed: () => [...completedLessonIds].sort(),
      watch: server.watch,
      calls: server.calls,
      setStreak: (n: number) => setStreakNow(n),
    };
    return () => {
      delete w.__fixture;
    };
  }, [completedLessonIds, markWatched, server]);

  // The catalog rows, made once per mode: a heartbeat changes watchProgress
  // and must not hand the map a new list of lessons.
  const videoSeconds = devVideos?.seconds ?? null;
  const rows = useMemo(() => {
    // The real course brings its own lengths and videos: the three video lessons are not part of it.
    if (mode === "course") return sampleText ? COURSE_WITH_SAMPLE_TEXT : courseWithFileTexts;
    const base = mode === "ready" ? FULL : mode === "shape" ? FIRST_FOUR : NONE;
    return videoSeconds === null ? base : withVideos(base, videoSeconds);
  }, [mode, sampleText, courseWithFileTexts, videoSeconds]);

  const value = useMemo(
    () =>
      ({
        lessons: rows.lessons,
        regions: rows.regions,
        completedLessonIds,
        watchedLessonIds,
        watchProgress,
        loading: mode === null || mode === "loading",
        loadError: mode === "error" ? LOAD_ERROR : null,
        patchWatchProgress,
        // markWatched (on an action item it records the watch half only),
        // completions, saveDiscordLink and toggleLessonAction.
        ...actionItems.contextFor(rows.lessons, completedLessonIds, markWatched),
        catalogSuffix: "_next",
        // The corner's streak (?hud=, fixtureHud.tsx).
        streak,
        // The corner's Playbook link (?playbook=1).
        playbookUnlocked,
      }) as unknown as StudentContextType,
    [rows, mode, completedLessonIds, watchedLessonIds, watchProgress, patchWatchProgress, markWatched, actionItems, streak, playbookUnlocked],
  );

  return (
    <StudentContext.Provider value={value}>
      <LessonAccessContext.Provider value={PRETEND_ACCESS}>
        <LessonTransportContext.Provider value={transport}>
          <CelebrationStandInContext.Provider value={celebrate ? PRETEND_CELEBRANT : null}>
            <AnyLessonFinishesContext.Provider value={mode !== "course"}>
              <StudentNameStandInContext.Provider value={PRETEND_NAME}>
                <FixtureDiscount search={search}>
                  <FixtureHud search={search}>{children}</FixtureHud>
                </FixtureDiscount>
              </StudentNameStandInContext.Provider>
            </AnyLessonFinishesContext.Provider>
          </CelebrationStandInContext.Provider>
        </LessonTransportContext.Provider>
      </LessonAccessContext.Provider>
    </StudentContext.Provider>
  );
}
