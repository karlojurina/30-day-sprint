
/**
 * The boundary between the world and the curriculum.
 *
 * WHY THIS FILE EXISTS. `/world` renders eight places and the lessons inside
 * them. None of that should have to change when the real course arrives — the
 * names, the counts, which lesson is the gate, where the Ad Bounty pond sits.
 * Everything under `components/world/` asks this module and nothing else, so
 * PRD 2 changes data and this file's callers stay untouched.
 *
 * THE SHAPE-STRUCTURAL TYPES ARE DELIBERATE. The rows arrive as `Lesson[]`
 * from StudentContext, but they are v1 rows before cutover and v2 rows after
 * (and on the staging preview). The two shapes differ: v2 has no `day`, no
 * `duration_label`, no `is_boss`, and its `sort_order` is global rather than
 * per-day. So every function here reads only the fields BOTH shapes carry, and
 * `day` is never touched. That is what lets the world run against either
 * catalog without a translation layer.
 *
 * ACTION ITEMS COME FROM `requires_action`, never from the title. The old map
 * detected them with `/^Action Item:/i` against the lesson title
 * (MapMockup.tsx:504). There are ~9 action items in the entire new course and
 * a regex over prose is not how a milestone should be identified.
 */

/** The fields both catalog shapes carry. Never `day`. */
export interface CatalogLessonLike {
  id: string;
  region_id: string;
  type: string;
  title: string;
  sort_order: number;
  requires_action: boolean;
  is_optional: boolean;
  is_gate: boolean;
  counts_toward_progress: boolean;
  feature_key: string | null;
  bunny_video_id: string | null;
  duration_seconds: number | null;
}

export interface CatalogRegionLike {
  id: string;
  order_num: number;
  name: string;
  landmark_label?: string | null;
  rail_at?: number | null;
}

export interface Area {
  id: string;
  order: number;
  name: string;
  /** Art-direction output. Null until that conversation happens. */
  landmarkLabel: string | null;
  /** Scroll depth of this area's stop on the rail, 0..1. Art-direction output. */
  railAt: number | null;
}

export interface AreaProgress {
  /** Lessons that count toward progress. Excludes the Ad Bounty pond. */
  total: number;
  done: number;
  /** 0..1. Zero when the area has no counting lessons, never NaN. */
  ratio: number;
  isComplete: boolean;
  /** Lessons opened but not finished — what draws the "in progress" state. */
  inProgress: number;
}

export interface WorldCatalog {
  areas: Area[];
  lessonsByArea: Map<string, CatalogLessonLike[]>;
  areaOf(lessonId: string): Area | null;
  areaProgress(areaId: string): AreaProgress;
  /** Furthest area with any completion; the first area when there are none. */
  currentAreaId: string | null;
  /**
   * PRD 1 answers "yes" for every area. Free roam versus sequential is an open
   * decision, and this is the single place it will be made.
   */
  isAreaReachable(areaId: string): boolean;
  videoIdFor(lessonId: string): string | null;
  hasVideo(lessonId: string): boolean;
  /** First lesson, in global order, that is not yet complete. */
  nextLesson: CatalogLessonLike | null;
  /** The discount gate, if the catalog has one. */
  gateLesson: CatalogLessonLike | null;
  lessonById(lessonId: string): CatalogLessonLike | null;
  /**
   * True when the catalog came back empty. The world must show a retry rather
   * than an empty continent: /api/student/data swallows its fetch error
   * (StudentContext:607 only console.errors), so an empty array is
   * indistinguishable from a failed request without this.
   */
  isEmpty: boolean;
}

export interface BuildCatalogInput {
  lessons: CatalogLessonLike[];
  regions: CatalogRegionLike[];
  completedLessonIds: Set<string>;
  watchProgress: Map<string, unknown>;
}

export function buildWorldCatalog({
  lessons,
  regions,
  completedLessonIds,
  watchProgress,
}: BuildCatalogInput): WorldCatalog {
  const areas: Area[] = [...regions]
    // order_num, never the id text. 'a10' sorts before 'a9' lexically, which
    // is the exact bug v92 fixed in student_current_region.
    .sort((a, b) => a.order_num - b.order_num)
    .map((r) => ({
      id: r.id,
      order: r.order_num,
      name: r.name,
      landmarkLabel: r.landmark_label ?? null,
      railAt: r.rail_at ?? null,
    }));

  const areaById = new Map(areas.map((a) => [a.id, a]));
  const byId = new Map(lessons.map((l) => [l.id, l]));

  const lessonsByArea = new Map<string, CatalogLessonLike[]>();
  for (const area of areas) lessonsByArea.set(area.id, []);
  for (const lesson of lessons) {
    // A lesson whose region is missing from `regions` would otherwise vanish
    // silently. Give it a bucket so a catalog mismatch is visible as a count.
    if (!lessonsByArea.has(lesson.region_id)) {
      lessonsByArea.set(lesson.region_id, []);
    }
    lessonsByArea.get(lesson.region_id)!.push(lesson);
  }
  for (const list of lessonsByArea.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }

  const ordered = [...lessons].sort((a, b) => a.sort_order - b.sort_order);

  function areaProgress(areaId: string): AreaProgress {
    const list = lessonsByArea.get(areaId) ?? [];
    const counting = list.filter((l) => l.counts_toward_progress);
    const done = counting.filter((l) => completedLessonIds.has(l.id)).length;
    const inProgress = counting.filter(
      (l) => !completedLessonIds.has(l.id) && watchProgress.has(l.id),
    ).length;
    return {
      total: counting.length,
      done,
      ratio: counting.length === 0 ? 0 : done / counting.length,
      isComplete: counting.length > 0 && done === counting.length,
      inProgress,
    };
  }

  // Furthest area the student has touched, by area order — not by whichever
  // completion happens to be last in the array.
  let currentAreaId: string | null = areas[0]?.id ?? null;
  let bestOrder = -1;
  for (const lesson of lessons) {
    if (!completedLessonIds.has(lesson.id)) continue;
    const area = areaById.get(lesson.region_id);
    if (area && area.order > bestOrder) {
      bestOrder = area.order;
      currentAreaId = area.id;
    }
  }

  const nextLesson =
    ordered.find((l) => !completedLessonIds.has(l.id) && !l.is_optional) ??
    ordered.find((l) => !completedLessonIds.has(l.id)) ??
    null;

  return {
    areas,
    lessonsByArea,
    areaOf: (lessonId) => {
      const lesson = byId.get(lessonId);
      return lesson ? areaById.get(lesson.region_id) ?? null : null;
    },
    areaProgress,
    currentAreaId,
    isAreaReachable: () => true,
    videoIdFor: (lessonId) => byId.get(lessonId)?.bunny_video_id ?? null,
    hasVideo: (lessonId) => Boolean(byId.get(lessonId)?.bunny_video_id),
    nextLesson,
    gateLesson: lessons.find((l) => l.is_gate) ?? null,
    lessonById: (lessonId) => byId.get(lessonId) ?? null,
    isEmpty: lessons.length === 0 || areas.length === 0,
  };
}
