"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { StudentContext, type StudentContextType } from "@/contexts/StudentContext";
import type { CatalogLessonLike, CatalogRegionLike } from "@/lib/world/catalog";
import type { StudentLessonWatch } from "@/types/database";
import {
  createFixtureServer,
  FixtureTransportContext,
  VIDEO_LESSON_IDS,
  type DevVideos,
  type FixtureCall,
  type FixtureWatchRow,
} from "./fixtureTransport";

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
 * WorldMap and LessonScreen read completedLessonIds; LessonScreen and
 * LessonPlayer call markWatched; LessonPlayer reads watchProgress and
 * patchWatchProgress (kept here the way StudentProvider keeps them, so a
 * lesson left halfway resumes). Anything else on StudentContextType is absent,
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
 *
 * For the browser run: window.__fixture.complete(id) marks a lesson watched,
 * window.__fixture.completed() lists what is watched, window.__fixture.watch
 * holds the stand-in server's watch rows by lesson id, and
 * window.__fixture.calls every call the player made to it.
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

type CatalogMode = "ready" | "loading" | "error" | "empty" | "shape";

function catalogMode(name: string | null): CatalogMode {
  return name === "loading" || name === "error" || name === "empty" || name === "shape" ? name : "ready";
}

interface FixtureHook {
  complete(id: string): void;
  completed(): string[];
  watch: Record<string, FixtureWatchRow>;
  calls: FixtureCall[];
}
type FixtureWindow = Window & { __fixture?: FixtureHook };

/** The query string never changes under the provider: it is read once and kept. */
const subscribeNever = () => () => {};
const noServerQuery = () => null;

export function FixtureStudentProvider({
  children,
  devVideos = null,
}: {
  children: ReactNode;
  /** The two test videos from .env.local, or null when they are not set. */
  devVideos?: DevVideos | null;
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
  const mode = useMemo(
    () => (search === null ? null : catalogMode(new URLSearchParams(search).get("catalog"))),
    [search],
  );
  const preset = useMemo(
    () => (search === null ? [] : presetIds(new URLSearchParams(search).get("p"))),
    [search],
  );
  /** Lessons marked watched since the page loaded, on top of the preset. */
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set());
  // The preset and the catalog arrive in the same render, so the map first
  // mounts with the preset in place and a page load never plays the done moment.
  const completedLessonIds = useMemo(() => {
    const ids = new Set(preset);
    for (const id of watched) ids.add(id);
    return ids;
  }, [preset, watched]);

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
  // The ids come down from the server once and do not change under it.
  const [server] = useState(() => createFixtureServer({ videos: devVideos, markWatched }));

  useEffect(() => {
    const w = window as FixtureWindow;
    w.__fixture = {
      complete: markWatched,
      completed: () => [...completedLessonIds].sort(),
      watch: server.watch,
      calls: server.calls,
    };
    return () => {
      delete w.__fixture;
    };
  }, [completedLessonIds, markWatched, server]);

  // The catalog rows, made once per mode: a heartbeat changes watchProgress
  // and must not hand the map a new list of lessons.
  const videoSeconds = devVideos?.seconds ?? null;
  const rows = useMemo(() => {
    const base = mode === "ready" ? FULL : mode === "shape" ? FIRST_FOUR : NONE;
    return videoSeconds === null ? base : withVideos(base, videoSeconds);
  }, [mode, videoSeconds]);

  const value = useMemo(
    () =>
      ({
        lessons: rows.lessons,
        regions: rows.regions,
        completedLessonIds,
        watchProgress,
        loading: mode === null || mode === "loading",
        loadError: mode === "error" ? LOAD_ERROR : null,
        patchWatchProgress,
        markWatched,
        catalogSuffix: "_next",
      }) as unknown as StudentContextType,
    [rows, mode, completedLessonIds, watchProgress, patchWatchProgress, markWatched],
  );

  return (
    <StudentContext.Provider value={value}>
      <FixtureTransportContext.Provider value={server.transport}>{children}</FixtureTransportContext.Provider>
    </StudentContext.Provider>
  );
}
