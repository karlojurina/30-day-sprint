"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { SPEC_EASE_GSAP, SPEC_EASE_GSAP_INOUT } from "@/lib/motion";
import { useStudent } from "@/contexts/StudentContext";
import {
  MAP_W,
  MAP_H,
  type RegionStripMap,
} from "@/lib/map/path-math";
import { LESSON_TYPE_LABELS, LESSON_GROUPS } from "@/lib/constants";
import { useIsPhone } from "@/lib/useMediaQuery";
import type { Lesson } from "@/types/database";

/** Synthetic id prefix for the virtual lesson representing a group on the map. */
const GROUP_ID_PREFIX = "group:";

/** Build a synthetic Lesson for the map node that stands in for a group. */
function makeVirtualGroupLesson(groupId: string, anchor: Lesson): Lesson {
  const g = LESSON_GROUPS[groupId];
  return {
    ...anchor,
    id: GROUP_ID_PREFIX + groupId,
    title: g?.title ?? "Group",
    description: g?.description ?? null,
    duration_label: null,
    requires_action: false,
    action_brief: null,
    is_gate: false,
    is_boss: false,
    whop_lesson_id: null,
    discord_channel: null,
    lesson_group_id: null,
  };
}

/**
 * Collapse grouped sub-lessons into one virtual group lesson per group,
 * preserving the day/sort_order position of the FIRST sub-lesson so the
 * group marker sits where the sub-lessons used to start. The full
 * sub-lesson set is still available via LESSON_GROUPS for the lesson
 * sheet's group view.
 */
function collapseLessonGroups(lessons: Lesson[]): Lesson[] {
  const groupedIds = new Set<string>();
  for (const g of Object.values(LESSON_GROUPS)) {
    for (const id of g.lessonIds) groupedIds.add(id);
  }
  const out: Lesson[] = [];
  const seenGroups = new Set<string>();
  for (const l of lessons) {
    const groupId = (l as Lesson & { lesson_group_id?: string | null })
      .lesson_group_id;
    if (!groupId && !groupedIds.has(l.id)) {
      out.push(l);
      continue;
    }
    // Determine the group id (prefer column, fallback to membership lookup)
    const resolvedGroupId =
      groupId ??
      Object.values(LESSON_GROUPS).find((g) => g.lessonIds.includes(l.id))?.id;
    if (!resolvedGroupId) {
      out.push(l);
      continue;
    }
    if (seenGroups.has(resolvedGroupId)) continue;
    seenGroups.add(resolvedGroupId);
    out.push(makeVirtualGroupLesson(resolvedGroupId, l));
  }
  return out;
}

/**
 * Whether a virtual group lesson should be considered "complete" on the
 * map. True when EVERY sub-lesson is in completedLessonIds (which already
 * counts skipped lessons).
 */
function isGroupComplete(
  groupId: string,
  completedLessonIds: Set<string>
): boolean {
  const g = LESSON_GROUPS[groupId];
  if (!g) return false;
  return g.lessonIds.every((id) => completedLessonIds.has(id));
}

/**
 * If `currentLessonId` is one of a group's sub-lessons, return the
 * virtual group id so the map can highlight the group marker as
 * "current". Otherwise return the original id.
 */
function virtualizeCurrentLessonId(currentLessonId: string | null): string | null {
  if (!currentLessonId) return null;
  for (const g of Object.values(LESSON_GROUPS)) {
    if (g.lessonIds.includes(currentLessonId)) return GROUP_ID_PREFIX + g.id;
  }
  return currentLessonId;
}
import { MapAmbience } from "@/components/map/MapAmbience";
import { BountyAccessClaimCelebration } from "@/components/map/BountyAccessClaimCelebration";
import {
  DiscountClaimCelebration,
  type DiscountCelebrationMode,
} from "@/components/map/DiscountClaimCelebration";
import { CinematicDive } from "./CinematicDive";
import { StatsWidget } from "@/components/map/StatsWidget";
import { RegionTodoWidget } from "@/components/map/RegionTodoWidget";
import { QuizModal } from "@/components/quiz/QuizModal";
import { SwipeCardsQuiz } from "@/components/quiz/SwipeCardsQuiz";
import { getRegionQuiz } from "@/lib/region-quizzes";

interface MapMockupProps {
  onOpenLesson: (lessonId: string) => void;
  /** v50.3 — only honoured on /dashboard-mockup. Lets the dev test
   *  panel override student state without writing to the DB so the
   *  Playbook locked/unlocked visuals can be exercised live. */
  testOverrides?: {
    bountyAccessClaimedAt?: string | null;
  };
}

type RegionId = keyof RegionStripMap;
type View = "overview" | RegionId;

// Side panel width adapts to viewport so the map keeps useful canvas on
// laptop and tablet widths (panel was a fixed 420 before — squeezed the
// scene below ~1280px wide).
function getSidePanelWidth(viewportW: number): number {
  if (viewportW >= 1440) return 420;
  if (viewportW >= 1280) return 380;
  if (viewportW >= 1024) return 340;
  if (viewportW >= 768) return 300;
  return Math.max(260, Math.round(viewportW * 0.42));
}

// Width of the side panel when collapsed — just enough for the
// expand button + the region numeral. Map gains the rest as canvas.
const SIDE_PANEL_COLLAPSED_WIDTH = 56;

// Palette swapped from gold/brass to clean pearl-white per user
// feedback. Same MULTI-STOP material treatment (gradient + bevel +
// specular) — just a polished-silver hue instead of polished-gold.
const GOLD = "#F0F0EA";    // was #E6C07A — used for accent text/strokes
const GOLD_HI = "#FFFFFF"; // was #F0D595 — bright accent
const INK = "#F5F5F2";     // was #E6DCC8 — primary on-dark text

// ───────────────────────────────────────────────────────────────────
// Pearl medallion palette — for lesson waypoints + EndMarkers.
// Reads as polished silver/pearl with proper material depth.
//
//   BRASS_GLINT  — tightest specular hot-spot (pure white)
//   BRASS_HI     — diffuse upper-left highlight
//   BRASS_LIGHT  — lit polished pearl
//   BRASS_MID    — base pearl
//   BRASS_BASE   — antique pearl (incomplete state mid)
//   BRASS_DEEP   — rim shadow
//   BRASS_DARK   — engraving / inset shadow
//
// Variable names retained as BRASS_* so existing references
// don't churn — they're now silver tones, not gold.
// ───────────────────────────────────────────────────────────────────
const BRASS_GLINT = "#FFFFFF";
const BRASS_HI = "#F5F5F0";
const BRASS_LIGHT = "#DDDDD5";
const BRASS_MID = "#B8B8AE";
const BRASS_BASE = "#8E8E84";
const BRASS_DEEP = "#5C5C53";
const BRASS_DARK = "#1F1E1A";

// Legacy aliases — keep so older references compile.
const SILVER = BRASS_LIGHT;
const SILVER_HI = BRASS_HI;
void BRASS_BASE;
void BRASS_DARK;

/**
 * Puzzle-piece region hit zones — irregular closed polygons positioned over
 * the main_image.png panorama. Coordinates are in the 3200×1400 map space.
 *
 * Use `/dashboard-mockup/edit-regions` (the picker tool) to trace accurate
 * polygons and replace these values. Current placeholders are 16-point
 * ellipse approximations — close-ish but not precise.
 */
interface RegionZone {
  /** Closed polygon outline (last point auto-connects to first) */
  polygon: Array<{ x: number; y: number }>;
  /** Label position — usually polygon centroid but can be hand-tuned */
  labelX: number;
  labelY: number;
}

// Traced in /dashboard-mockup/edit-regions on 2026-04-22.
// Pixel-accurate polygons over main_image.png, 3200×1400 coord space.
const REGION_ZONES: Record<RegionId, RegionZone> = {
  r1: {
    polygon: [
      { x: 381, y: 1030 }, { x: 437, y: 1021 }, { x: 475, y: 1011 },
      { x: 505, y: 1009 }, { x: 535, y: 1002 }, { x: 576, y: 996 },
      { x: 622, y: 973 },  { x: 658, y: 951 },  { x: 704, y: 946 },
      { x: 751, y: 941 },  { x: 802, y: 940 },  { x: 847, y: 939 },
      { x: 903, y: 939 },  { x: 955, y: 939 },  { x: 1025, y: 936 },
      { x: 1087, y: 953 }, { x: 1126, y: 961 }, { x: 1165, y: 979 },
      { x: 1206, y: 988 }, { x: 1228, y: 1025 },{ x: 1181, y: 1054 },
      { x: 1171, y: 1067 },{ x: 1187, y: 1084 },{ x: 1177, y: 1109 },
      { x: 1156, y: 1124 },{ x: 1103, y: 1128 },{ x: 1074, y: 1142 },
      { x: 1016, y: 1151 },{ x: 959, y: 1172 }, { x: 909, y: 1192 },
      { x: 884, y: 1214 }, { x: 862, y: 1246 }, { x: 834, y: 1272 },
      { x: 820, y: 1280 }, { x: 780, y: 1291 }, { x: 633, y: 1283 },
      { x: 428, y: 1135 }, { x: 369, y: 1055 }, { x: 380, y: 1035 },
    ],
    labelX: 844, labelY: 1064,
  },
  r2: {
    polygon: [
      { x: 1560, y: 986 }, { x: 1538, y: 990 }, { x: 1528, y: 997 },
      { x: 1519, y: 1007 },{ x: 1515, y: 1032 },{ x: 1553, y: 1058 },
      { x: 1564, y: 1133 },{ x: 1569, y: 1153 },{ x: 1603, y: 1184 },
      { x: 1638, y: 1182 },{ x: 1709, y: 1195 },{ x: 1777, y: 1210 },
      { x: 1866, y: 1223 },{ x: 1975, y: 1222 },{ x: 2075, y: 1196 },
      { x: 2123, y: 1166 },{ x: 2221, y: 1108 },{ x: 2286, y: 1079 },
      { x: 2360, y: 1034 },{ x: 2357, y: 992 }, { x: 2351, y: 972 },
      { x: 2299, y: 958 }, { x: 2200, y: 969 }, { x: 2158, y: 953 },
      { x: 2149, y: 909 }, { x: 2162, y: 883 }, { x: 2166, y: 869 },
      { x: 2148, y: 840 }, { x: 2109, y: 825 }, { x: 2050, y: 825 },
      { x: 1934, y: 853 }, { x: 1720, y: 912 }, { x: 1567, y: 982 },
    ],
    labelX: 1920, labelY: 1027,
  },
  r3: {
    polygon: [
      { x: 2051, y: 811 }, { x: 2117, y: 816 }, { x: 2157, y: 834 },
      { x: 2179, y: 856 }, { x: 2233, y: 857 }, { x: 2291, y: 849 },
      { x: 2304, y: 824 }, { x: 2279, y: 763 }, { x: 2263, y: 730 },
      { x: 2231, y: 702 }, { x: 2196, y: 662 }, { x: 2165, y: 630 },
      { x: 2135, y: 612 }, { x: 2057, y: 589 }, { x: 2045, y: 568 },
      { x: 2035, y: 542 }, { x: 2021, y: 526 }, { x: 1946, y: 515 },
      { x: 1869, y: 524 }, { x: 1796, y: 542 }, { x: 1756, y: 563 },
      { x: 1693, y: 608 }, { x: 1678, y: 638 }, { x: 1752, y: 655 },
      { x: 1801, y: 658 }, { x: 1860, y: 673 }, { x: 1944, y: 694 },
      { x: 2009, y: 753 }, { x: 2018, y: 793 }, { x: 2049, y: 810 },
    ],
    labelX: 2031, labelY: 687,
  },
  r4: {
    polygon: [
      { x: 1831, y: 521 }, { x: 1878, y: 514 }, { x: 1919, y: 510 },
      { x: 1963, y: 510 }, { x: 2017, y: 518 }, { x: 2046, y: 534 },
      { x: 2049, y: 553 }, { x: 2062, y: 571 }, { x: 2079, y: 575 },
      { x: 2147, y: 579 }, { x: 2212, y: 535 }, { x: 2306, y: 493 },
      { x: 2376, y: 395 }, { x: 2398, y: 337 }, { x: 2391, y: 306 },
      { x: 2350, y: 274 }, { x: 2247, y: 229 }, { x: 2148, y: 223 },
      { x: 2028, y: 250 }, { x: 1910, y: 299 }, { x: 1857, y: 343 },
      { x: 1825, y: 395 }, { x: 1808, y: 471 }, { x: 1802, y: 504 },
      { x: 1828, y: 517 },
    ],
    labelX: 2059, labelY: 438,
  },
};

// v50.3 — Playbook aura zone. Lives on the R4 scene (not the overview).
// Same shape contract as REGION_ZONES so it can reuse the glow/feather/fog
// rendering, but it's a standalone constant because it's not part of the
// sequential region unlock — it's a parallel claim that activates on
// bounty_access_claimed_at.
//
// Polygon is a placeholder traced around the volcano summit on the
// R4 painted scene. Refine via /dashboard-mockup/edit-regions if the
// halo doesn't hug the summit cleanly.
const PLAYBOOK_ZONE: RegionZone = {
  polygon: [
    { x: 2760, y:  90 },
    { x: 2880, y: 120 },
    { x: 2970, y: 195 },
    { x: 3010, y: 290 },
    { x: 3015, y: 380 },
    { x: 2965, y: 470 },
    { x: 2870, y: 535 },
    { x: 2760, y: 555 },
    { x: 2640, y: 535 },
    { x: 2555, y: 470 },
    { x: 2510, y: 380 },
    { x: 2515, y: 290 },
    { x: 2555, y: 195 },
    { x: 2640, y: 120 },
  ],
  labelX: 2760, labelY: 321,
};

// ──────────────────────────────────────────────────────────────
// Scene data — per-region background image + red-line waypoints.
// Regions without a scene image fall back to zoom-on-main.
// Waypoint coords are in the 3200×1400 map space (image cover-fits into it).
// ──────────────────────────────────────────────────────────────

interface Scene {
  image: string;
  waypoints: { x: number; y: number }[];
  /**
   * Optional easing exponent for lesson placement.
   *   1.0 → uniform arc-length distribution (default)
   *   > 1 → bias lessons toward the START of the path so later lessons
   *         get more visual breathing room. Useful when the painted
   *         trail has a switchback / hairpin in its later half that
   *         consumes arc length without adding visual space.
   */
  placementEase?: number;
  /**
   * Fraction of total arc length reserved at the end of the path for
   * the end marker. Default 0.16 (suits R2 which stacks "discount" +
   * "Onward"). Override to a smaller value when the scene only has a
   * single end marker and you want lessons to use more of the path.
   */
  edgeInsetEndFrac?: number;
}
// Waypoints traced in the picker (2026-04-23). Last waypoint in each
// scene is reserved as the END MARKER (next-region / discount /
// celebration) — see SCENE_END_MARKERS below.
const SCENES: Partial<Record<RegionId, Scene>> = {
  r1: {
    image: "/regions/first_location.webp",
    waypoints: [
      { x: 433, y: 1102 }, { x: 504, y: 1086 }, { x: 576, y: 1070 },
      { x: 641, y: 1055 }, { x: 702, y: 1041 }, { x: 775, y: 1028 },
      { x: 843, y: 1013 }, { x: 910, y: 994 },  { x: 963, y: 984 },
      { x: 1013, y: 974 },{ x: 1057, y: 968 }, { x: 1097, y: 953 },
      { x: 1153, y: 940 },{ x: 1209, y: 919 }, { x: 1262, y: 905 },
      { x: 1311, y: 898 },{ x: 1363, y: 886 }, { x: 1400, y: 877 },
      { x: 1443, y: 866 },{ x: 1495, y: 844 }, { x: 1557, y: 839 },
      { x: 1618, y: 816 },{ x: 1653, y: 803 }, { x: 1674, y: 794 },
      { x: 1705, y: 785 },{ x: 1734, y: 779 }, { x: 1763, y: 777 },
      { x: 1779, y: 776 },{ x: 1802, y: 772 }, { x: 1836, y: 769 },
      { x: 1905, y: 769 },{ x: 1987, y: 768 }, { x: 2077, y: 764 },
      { x: 2164, y: 757 },{ x: 2246, y: 747 }, { x: 2333, y: 734 },
      { x: 2407, y: 714 },{ x: 2465, y: 699 }, { x: 2527, y: 664 },
      { x: 2580, y: 626 },{ x: 2609, y: 587 }, { x: 2613, y: 555 },
      { x: 2607, y: 530 },{ x: 2573, y: 513 }, { x: 2536, y: 490 },
      { x: 2500, y: 473 },{ x: 2485, y: 452 }, { x: 2489, y: 429 },
      { x: 2518, y: 418 },
    ],
  },
  r2: {
    image: "/regions/second_location.webp",
    waypoints: [
      { x: 791, y: 1354 }, { x: 868, y: 1294 }, { x: 929, y: 1253 },
      { x: 989, y: 1211 }, { x: 1060, y: 1183 },{ x: 1164, y: 1136 },
      { x: 1264, y: 1110 },{ x: 1315, y: 1098 },{ x: 1405, y: 1082 },
      { x: 1442, y: 1078 },{ x: 1484, y: 1075 },{ x: 1533, y: 1067 },
      { x: 1556, y: 1065 },{ x: 1590, y: 1062 },{ x: 1638, y: 1059 },
      { x: 1692, y: 1054 },{ x: 1753, y: 1045 },{ x: 1815, y: 1035 },
      { x: 1868, y: 1026 },{ x: 1918, y: 1013 },{ x: 1972, y: 996 },
      { x: 2008, y: 971 }, { x: 2021, y: 939 }, { x: 2002, y: 920 },
      { x: 1961, y: 906 }, { x: 1931, y: 898 }, { x: 1898, y: 890 },
      { x: 1861, y: 883 }, { x: 1818, y: 877 }, { x: 1791, y: 870 },
      { x: 1760, y: 859 }, { x: 1744, y: 839 }, { x: 1745, y: 814 },
      { x: 1761, y: 800 }, { x: 1824, y: 789 }, { x: 1880, y: 789 },
      { x: 1917, y: 795 }, { x: 2213, y: 790 }, { x: 2275, y: 780 },
      { x: 2312, y: 757 }, { x: 2331, y: 735 }, { x: 2332, y: 705 },
      { x: 2313, y: 677 }, { x: 2310, y: 651 }, { x: 2320, y: 625 },
      { x: 2357, y: 609 }, { x: 2404, y: 593 }, { x: 2436, y: 587 },
    ],
  },
  r3: {
    image: "/regions/third_location.webp",
    waypoints: [
      { x: 360, y: 1345 }, { x: 385, y: 1296 }, { x: 440, y: 1253 },
      { x: 495, y: 1233 }, { x: 544, y: 1196 }, { x: 613, y: 1167 },
      { x: 650, y: 1145 }, { x: 758, y: 1118 }, { x: 814, y: 1097 },
      { x: 874, y: 1083 }, { x: 937, y: 1087 }, { x: 992, y: 1108 },
      { x: 1026, y: 1130 },{ x: 1083, y: 1145 },{ x: 1170, y: 1150 },
      { x: 1259, y: 1163 },{ x: 1370, y: 1151 },{ x: 1426, y: 1149 },
      { x: 1456, y: 1134 },{ x: 1496, y: 1124 },{ x: 1566, y: 1118 },
      { x: 1652, y: 1118 },{ x: 1722, y: 1110 },{ x: 1789, y: 1099 },
      { x: 1844, y: 1084 },{ x: 1901, y: 1065 },{ x: 1944, y: 1045 },
      { x: 1990, y: 1022 },{ x: 2093, y: 976 }, { x: 2148, y: 995 },
      { x: 2214, y: 1011 },{ x: 2274, y: 1020 },{ x: 2329, y: 1030 },
      { x: 2394, y: 1042 },{ x: 2494, y: 1035 },{ x: 2578, y: 1014 },
      { x: 2658, y: 982 }, { x: 2694, y: 950 }, { x: 2703, y: 915 },
      { x: 2728, y: 900 }, { x: 2755, y: 897 }, { x: 2806, y: 892 },
      { x: 2938, y: 880 }, { x: 3043, y: 847 }, { x: 3115, y: 809 },
      { x: 2977, y: 544 }, { x: 2887, y: 532 }, { x: 2789, y: 521 },
      { x: 2666, y: 496 }, { x: 2569, y: 471 }, { x: 2489, y: 447 },
    ],
  },
  r4: {
    image: "/regions/fourth_location.webp",
    // Re-traced 2026-05-15 via /dashboard-mockup/edit-regions on the
    // refreshed fourth_location.webp. 37 path waypoints + the 38th
    // reserved as the "Program complete" end marker (see
    // SCENE_END_MARKERS[r4]).
    //
    // The global edgeInsetEnd (0.16) was tuned for R2's stacked
    // discount + Onward markers. R4 only has the "Program complete"
    // marker, so it can use a much smaller reserve — otherwise the
    // last 5-6 waypoints (everything past the switchback) never get
    // a lesson on them. 0.04 lets lessons extend up through
    // ~waypoint 35.
    edgeInsetEndFrac: 0.04,
    waypoints: [
      { x: 819, y: 1339 }, { x: 838, y: 1291 }, { x: 866, y: 1249 },
      { x: 903, y: 1200 }, { x: 949, y: 1171 }, { x: 999, y: 1141 },
      { x: 1047, y: 1121 },{ x: 1095, y: 1090 },{ x: 1151, y: 1066 },
      { x: 1194, y: 1042 },{ x: 1239, y: 1021 },{ x: 1284, y: 998 },
      { x: 1354, y: 967 }, { x: 1418, y: 948 }, { x: 1469, y: 937 },
      { x: 1522, y: 920 }, { x: 1570, y: 900 }, { x: 1617, y: 882 },
      { x: 1667, y: 855 }, { x: 1723, y: 835 }, { x: 1766, y: 810 },
      { x: 1797, y: 792 }, { x: 1833, y: 768 }, { x: 1859, y: 740 },
      { x: 1862, y: 717 }, { x: 1837, y: 692 }, { x: 1806, y: 672 },
      { x: 1766, y: 645 }, { x: 1736, y: 626 }, { x: 1717, y: 611 },
      { x: 1709, y: 591 }, { x: 1739, y: 564 }, { x: 1774, y: 548 },
      { x: 1822, y: 526 }, { x: 1882, y: 510 }, { x: 1920, y: 492 },
      { x: 1952, y: 474 },
      // v50.2 - Bounty Access end-marker. Karlo-supplied coords for
      // where the gate sits on the painted scene.
      { x: 2021, y: 304 },
    ],
  },
};

// Catmull-Rom → cubic-Bezier smoothed CLOSED path through a vertex list.
// Used for the region glow shapes so their edges curve between polygon
// vertices instead of the hard "boxy" segments you get with <polygon>.
function smoothClosedPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
  }
  const n = pts.length;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const pm1 = pts[(i - 1 + n) % n];
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const p2 = pts[(i + 2) % n];
    const c1x = p0.x + (p1.x - pm1.x) / 6;
    const c1y = p0.y + (p1.y - pm1.y) / 6;
    const c2x = p1.x - (p2.x - p0.x) / 6;
    const c2y = p1.y - (p2.y - p0.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p1.x} ${p1.y}`;
  }
  return d + " Z";
}

// Scene images. Overview loads eagerly (it's the first paint); region
// scenes are deferred until after the overview is in front of the user,
// then mounted in the background so transitions are still instant once
// the user clicks in. Total payload is ~2.5 MB across all 5 (down from
// ~170 MB of source PNGs — see scripts/optimize-scene-images.mjs).
const SCENE_IMAGE_STACK: Array<{ id: View; src: string; eager: boolean }> = [
  { id: "overview", src: "/regions/main_image.webp",      eager: true  },
  { id: "r1",       src: "/regions/first_location.webp",  eager: false },
  { id: "r2",       src: "/regions/second_location.webp", eager: false },
  { id: "r3",       src: "/regions/third_location.webp",  eager: false },
  { id: "r4",       src: "/regions/fourth_location.webp", eager: false },
];

// End-of-region marker that sits on the LAST waypoint of each scene.
// Click → transitionTo nextView. R4 has no next (final region).
type EndMarkerKind =
  | "onward"
  | "discount"
  | "celebration"
  | "playbook"
  | "bounty";
interface SceneEndMarker {
  kind: EndMarkerKind;
  label: string;
  sublabel: string;
  /** If set, clicking the marker triggers the cloud transition to this view */
  nextView?: View;
}
const SCENE_END_MARKERS: Record<RegionId, SceneEndMarker> = {
  r1: { kind: "onward", label: "Onward",  sublabel: "to Creative Lab", nextView: "r2" },
  r2: { kind: "onward",  label: "Onward",          sublabel: "to Test Track",   nextView: "r3" },
  r3: { kind: "onward", label: "Onward",  sublabel: "to The Summit",  nextView: "r4" },
  // v50 — Bounty Access is the finish. Sits at the last waypoint
  // (the arch in R4's painted scene). Click opens l057's sheet,
  // where the Claim button completes the sprint. "Program complete"
  // moved to a pinned label slightly in front (see below).
  r4: { kind: "bounty", label: "Bounty Access", sublabel: "the finish line" },
};

// Action Items: lessons whose title starts with "Action Item:" render as
// diamond markers on the path. Region membership and order now come
// straight from the DB (lessons.region_id + sort by day, sort_order).

// Titles can be overridden for the mockup. Currently empty — l021 is
// the real "VSLs" lesson in r2, no override needed.
const MOCKUP_TITLE_OVERRIDES: Record<string, string> = {};

function isActionItem(lesson: Lesson): boolean {
  const title = MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
  return /^Action Item:/i.test(title);
}

/**
 * Mockup: region-centric expedition. No 63-node path.
 *
 *   Overview — whole painted world, 4 regions labelled with progress
 *              Click a region → zoom in.
 *   Region focus — map zooms to that region, side panel shows its lessons
 *              Click a lesson → open the existing LessonSheet modal.
 *              Prev / Next region buttons navigate between regions.
 *              "Back to map" returns to overview.
 */
export function MapMockup({ onOpenLesson, testOverrides }: MapMockupProps) {
  const {
    regions,
    lessons,
    completedLessonIds,
    currentLesson,
    discountRequest,
    discountAllLessonsDone,
    regionProgress,
    requestDiscount,
    // v42 (v2) — bounty access claim celebration (l057). v50 retired
    // the separate first-bounty-submitted celebration that lived on
    // l058; Bounty Access IS the finish-line moment now.
    bountyAccessJustClaimed,
    dismissBountyClaim,
    bountyAccessClaimedAt,
    // v54 (brief-region-quiz) - per-region quiz state + mutators.
    regionQuiz,
    markRegionQuizPassed,
    incrementRegionQuizAttempts,
  } = useStudent();

  // v50.3 — testOverrides escape hatch. /dashboard-mockup wires this
  // up to a dev test panel so we can flip the Playbook lock/unlock
  // without touching the DB. Falls through to the real student value
  // when no override is set (i.e. on real /dashboard).
  const effectiveBountyAccessClaimedAt =
    testOverrides && "bountyAccessClaimedAt" in testOverrides
      ? testOverrides.bountyAccessClaimedAt ?? null
      : bountyAccessClaimedAt;

  // v54 (brief-region-quiz) - quiz modal state. quizRegionId is the
  // region whose quiz is currently open (null = closed). quizProgress
  // is the counter line surfaced from the format component to the
  // shared modal header. quizPassed flips when the format signals
  // pass; the modal renders WinScreen + we transition to the next
  // region on advance.
  const [quizRegionId, setQuizRegionId] = useState<RegionId | null>(null);
  const [quizProgress, setQuizProgress] = useState<string>("");
  const [quizPassed, setQuizPassed] = useState(false);
  const quizAttemptIncrementedRef = useRef<RegionId | null>(null);

  // Toast for the "you haven't completed all lessons" message when
  // the student tries to advance from a locked Onward marker.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  }

  const router = useRouter();
  const outerRef = useRef<HTMLDivElement>(null);
  // Inner translated div. We write to its style.transform directly on
  // every pan/wheel/tween tick — going through React state would re-render
  // the whole MapMockup tree (2500 lines, painted scene + path overlay +
  // side panel) on every frame and the touch lag becomes brutal.
  const mapInnerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  // Sync the inner div's CSS transform from transformRef.current.
  //
  // If `t` is passed, we MUTATE the existing transformRef object's
  // properties in place (we do NOT replace the object). GSAP tweens
  // capture a reference to whatever transformRef.current pointed at
  // when the tween started — if we ever swapped that reference for a
  // new object mid-tween (the previous version did), GSAP kept
  // animating the orphaned object and the DOM read a stale frozen
  // copy. That's what was breaking the cinematic transitions.
  //
  // Callers: pan, wheel, baseline, panel re-fit (pass `t`); GSAP
  // onUpdate (no arg — just sync DOM from the in-place ref).
  const applyTransform = (t?: { x: number; y: number; scale: number }) => {
    if (t) {
      transformRef.current.x = t.x;
      transformRef.current.y = t.y;
      transformRef.current.scale = t.scale;
    }
    const el = mapInnerRef.current;
    if (!el) return;
    const r = transformRef.current;
    el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${r.scale})`;
  };

  const [view, setView] = useState<View>("overview");
  const [outerSize, setOuterSize] = useState({ w: 0, h: 0 });
  const [discountModalMode, setDiscountModalMode] =
    useState<DiscountCelebrationMode | null>(null);

  // Cloud-transition orchestration
  const [transitionCounter, setTransitionCounter] = useState(0);
  const pendingViewRef = useRef<View | null>(null);
  // Title card state — set when transitionTo runs, persists for the
  // entire transition (so the JSX render stays mounted past peak,
  // when pendingViewRef is cleared in onPeak). Null = no card.
  const [transitionTitle, setTransitionTitle] = useState<{
    numeral: string;
    label: string;
  } | null>(null);
  const [hoveredZone, setHoveredZone] = useState<RegionId | null>(null);
  // v50.4 — Playbook aura hot state lives in MapMockup so the
  // polygon AND the pinned Playbook marker can both flip it on.
  // Without this, moving the cursor from polygon → marker fires
  // onMouseLeave on the polygon and the glow collapses (the marker
  // sits ABOVE the polygon in the SVG, so it intercepts events).
  const [playbookAuraHot, setPlaybookAuraHot] = useState(false);

  // Region scenes are mounted lazily — after the overview is in front of
  // the user. The overview alone is ~330 KB; deferring the four regions
  // means first paint pays for one image instead of all five. The first
  // hover/click into a region also force-mounts that one immediately.
  const [regionsMounted, setRegionsMounted] = useState(false);

  // Measure outer container
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () =>
      setOuterSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Default view: brief overview, then auto-transition into the region
  // where the student is currently working. Returning students with
  // progress past R1 land where they left off, not back on the
  // First-load behavior: ALWAYS land on the overview. No automatic
  // zoom-into-a-region — the previous behavior of gliding into the
  // student's last-active region was overriding their intent on
  // every reload (especially if they were already on an overview-
  // style screen). Manual click is the only thing that transitions
  // into a region now.
  const initialViewSet = useRef(false);
  useEffect(() => {
    if (outerSize.w === 0) return;
    if (initialViewSet.current) return;
    initialViewSet.current = true;
    setView("overview");
  }, [outerSize.w]);

  // Kick off region preload after the browser has had a chance to paint
  // the overview. requestIdleCallback yields for higher-priority work;
  // setTimeout fallback covers Safari, which doesn't ship rIC.
  useEffect(() => {
    if (regionsMounted) return;
    const start = () => setRegionsMounted(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(start, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(start, 600);
    return () => window.clearTimeout(id);
  }, [regionsMounted]);

  const isPhone = useIsPhone();
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  // On phone, the side panel renders as a bottom-sheet overlay - it
  // does NOT take horizontal space in the layout. So we report 0 to
  // anything that uses sidePanelWidth for canvas sizing.
  const sidePanelWidth = isPhone
    ? 0
    : sidePanelCollapsed
      ? SIDE_PANEL_COLLAPSED_WIDTH
      : getSidePanelWidth(outerSize.w);

  // Default zoom factor over cover-fit. Cover guarantees the image fills the
  // viewport (no bars at any aspect ratio); the multiplier zooms in further
  // so a new student lands focused on Base Camp instead of a wide,
  // overwhelming map.
  const OVERVIEW_DEFAULT_ZOOM = 1.7;
  const REGION_DEFAULT_ZOOM = 1.25;

  // Compute target transform for a given view.
  //
  // Cover-fit (Math.max) — image always fills the viewport in both axes,
  // so the user never sees background bars. Default zoom is intentionally
  // ABOVE cover so the focal region (Base Camp on overview, the labelX/Y
  // for region scenes) lands prominently in front of the user. Pan + wheel
  // zoom let them explore further; clampTransform keeps everything inside
  // the image bounds so bars never appear.
  const getTargetTransform = (v: View) => {
    const vw = outerSize.w || 1;
    const vh = outerSize.h || 1;

    const clampToImage = (t: {
      x: number;
      y: number;
      scale: number;
      areaW: number;
    }) => {
      const imgW = MAP_W * t.scale;
      const imgH = MAP_H * t.scale;
      const x = imgW <= t.areaW ? (t.areaW - imgW) / 2 : Math.max(t.areaW - imgW, Math.min(0, t.x));
      const y = imgH <= vh ? (vh - imgH) / 2 : Math.max(vh - imgH, Math.min(0, t.y));
      return { x, y, scale: t.scale };
    };

    if (v === "overview") {
      const cover = Math.max(vw / MAP_W, vh / MAP_H);
      const scale = cover * OVERVIEW_DEFAULT_ZOOM;
      // Center on the student's CURRENT region (the one their next
      // lesson lives in), not always r1. A returning student lands
      // looking at where they actually are. Falls back to r1 only
      // when there's no current lesson (e.g., student finished
      // everything — though that's rare and r1 is a fine default).
      const focusRegion = (currentLesson?.region_id as RegionId) ?? "r1";
      const z = REGION_ZONES[focusRegion] ?? REGION_ZONES.r1;
      return clampToImage({
        x: vw / 2 - z.labelX * scale,
        y: vh / 2 - z.labelY * scale,
        scale,
        areaW: vw,
      });
    }

    // Region view — leaves room on the right for the side panel.
    const usableW = Math.max(1, vw - sidePanelWidth);

    if (SCENES[v]) {
      const cover = Math.max(usableW / MAP_W, vh / MAP_H);
      const scale = cover * REGION_DEFAULT_ZOOM;
      const z = REGION_ZONES[v as RegionId];
      return clampToImage({
        x: usableW / 2 - z.labelX * scale,
        y: vh / 2 - z.labelY * scale,
        scale,
        areaW: usableW,
      });
    }

    // Fallback — region has no scene image yet, zoom into its focal point on
    // the overview panorama.
    const z = REGION_ZONES[v];
    const cover = Math.max(usableW / MAP_W, vh / MAP_H);
    const scale = cover * 1.9;
    return clampToImage({
      x: usableW / 2 - z.labelX * scale,
      y: vh / 2 - z.labelY * scale,
      scale,
      areaW: usableW,
    });
  };

  // First-paint flag — we want a long, cinematic camera arrival the first
  // time the user lands on the map, but a fast tween for subsequent view
  // changes (those run hidden behind cloud cover).
  const isFirstPaintRef = useRef(true);

  // Animate transform on view change
  useEffect(() => {
    if (outerSize.w === 0) return;
    const target = getTargetTransform(view);
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const isFirst = isFirstPaintRef.current;

    // Cinematic open: start at the bare cover-fit baseline (image fills
    // the viewport, no extra zoom) and ease into the focus on Base Camp.
    // Long expo curve so the camera "arrives" rather than snapping.
    if (isFirst) {
      isFirstPaintRef.current = false;
      const cover = Math.max(outerSize.w / MAP_W, outerSize.h / MAP_H);
      const baseline = {
        x: (outerSize.w - MAP_W * cover) / 2,
        y: (outerSize.h - MAP_H * cover) / 2,
        scale: cover,
      };
      applyTransform(baseline);
    }

    if (reduced) {
      applyTransform(target);
      return;
    }

    tweenRef.current = gsap.to(transformRef.current, {
      x: target.x,
      y: target.y,
      scale: target.scale,
      // First paint: slow expo arrival (cinematic).
      // Region transitions: timed against the title-card fade
      // overlay (2.0s total, peak at 0.25s when fully covered).
      // Camera tween at 0.7s so it completes during the dark hold,
      // well before the overlay starts revealing the new scene.
      duration: isFirst ? 1.8 : 0.7,
      ease: isFirst ? SPEC_EASE_GSAP : SPEC_EASE_GSAP_INOUT,
      onUpdate: () => {
        // GSAP mutates transformRef.current's props in place. Just
        // sync the DOM — DON'T pass a copy back into applyTransform
        // or we'd replace the ref GSAP is animating.
        applyTransform();
      },
      onComplete: () => {
        tweenRef.current = null;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, outerSize]);

  // Re-fit on panel collapse/expand — preserves the user's pan
  // position. If the current zoom is enough to cover the new visible
  // area, we just re-clamp (the camera doesn't move, the image
  // "follows" the panel). If the zoom is too low (rare — only happens
  // when panel collapse widens the area beyond what the current scale
  // covers), we bump scale up to the new cover and recenter the
  // re-clamped position. Skips first render so the initial paint
  // sequence (view + outerSize effect above) stays in charge.
  const sidePanelInitRef = useRef(true);
  useEffect(() => {
    if (sidePanelInitRef.current) {
      sidePanelInitRef.current = false;
      return;
    }
    if (outerSize.w === 0) return;
    const t = transformRef.current;
    const areaW = getAreaW();
    const vh = outerSize.h;
    const cover = Math.max(areaW / MAP_W, vh / MAP_H);
    if (t.scale + 0.001 < cover) {
      // Need to bump scale to fill new wider area. Snap (no tween) so
      // the camera tracks the panel motion 1:1.
      const next = {
        ...t,
        scale: cover,
      };
      // Re-clamp the new position so we don't expose background.
      const imgW = MAP_W * next.scale;
      const imgH = MAP_H * next.scale;
      next.x = imgW <= areaW ? (areaW - imgW) / 2 : Math.max(areaW - imgW, Math.min(0, next.x));
      next.y = imgH <= vh ? (vh - imgH) / 2 : Math.max(vh - imgH, Math.min(0, next.y));
      applyTransform(next);
    } else {
      // Scale already covers the new area. Just re-clamp position —
      // user's pan stays. This is the "image follows the panel" feel.
      applyTransform(clampTransform(t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidePanelWidth]);

  // ──────────────────────────────────────────────────────────
  // Pan + zoom — works in BOTH overview and region scenes.
  // - Drag to pan, wheel to zoom (pointer-anchored).
  // - Uses document-level pointermove/up listeners attached on pointerdown
  //   so we DON'T setPointerCapture on the outer div — that would steal
  //   pointerup away from child zone polygons and break their onClick.
  // - Scale clamped to [coverScale, coverScale * 3] so the viewport is
  //   always fully covered (no bars).
  // - Region pan area is the side-panel-adjusted usable width.
  // ──────────────────────────────────────────────────────────
  const suppressClickRef = useRef(false);

  // The width the image needs to cover. Overview = full viewport; region
  // view = viewport minus the side panel (panel is an overlay, so the
  // map's DOM container is still the full viewport but visually the
  // panel covers the right edge).
  const getAreaW = () => {
    if (view === "overview") return outerSize.w;
    return Math.max(1, outerSize.w - sidePanelWidth);
  };

  // Clamp pan so the image always covers the visible area. If the image is
  // somehow smaller than the area (shouldn't happen since min scale is
  // coverScale, but guard anyway), centre it.
  const clampTransform = (t: { x: number; y: number; scale: number }) => {
    const areaW = getAreaW();
    const vh = outerSize.h;
    const imgW = MAP_W * t.scale;
    const imgH = MAP_H * t.scale;
    const x =
      imgW <= areaW
        ? (areaW - imgW) / 2
        : Math.max(areaW - imgW, Math.min(0, t.x));
    const y =
      imgH <= vh
        ? (vh - imgH) / 2
        : Math.max(vh - imgH, Math.min(0, t.y));
    return { x, y, scale: t.scale };
  };

  const onMapPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // v50.4 — don't accept pan during a region transition. The
    // pre-zoom tween's onComplete is what advances the cinematic
    // (setTransitionCounter → CinematicDive → onPeak → clears
    // pendingViewRef). Killing the tween mid-flight left
    // pendingViewRef stuck non-null, which made every subsequent
    // back-to-map click a no-op until the page was reloaded.
    if (pendingViewRef.current !== null) return;
    // Kill any in-flight tween so it doesn't fight the manual pan
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    const startCx = e.clientX;
    const startCy = e.clientY;
    const startTx = transformRef.current.x;
    const startTy = transformRef.current.y;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startCx;
      const dy = ev.clientY - startCy;
      if (!moved && Math.hypot(dx, dy) > 5) moved = true;
      if (!moved) return;
      const next = clampTransform({
        x: startTx + dx,
        y: startTy + dy,
        scale: transformRef.current.scale,
      });
      applyTransform(next);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (moved) {
        // Block the click that would otherwise enter a region.
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const onMapWheel = (e: React.WheelEvent) => {
    if (outerSize.w === 0) return;
    e.preventDefault();
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    // Min zoom = cover (image fills the visible area, no bars). Max zoom =
    // 3× cover, plenty for inspecting individual lesson nodes inside a
    // region. Region view uses the side-panel-adjusted width as the area
    // to cover.
    const areaW = getAreaW();
    const coverScale = Math.max(areaW / MAP_W, outerSize.h / MAP_H);
    const maxScale = coverScale * 3;
    const current = transformRef.current;
    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(
      coverScale,
      Math.min(maxScale, current.scale * zoomFactor)
    );
    if (newScale === current.scale) return;
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const mx = (px - current.x) / current.scale;
    const my = (py - current.y) / current.scale;
    const nextX = px - mx * newScale;
    const nextY = py - my * newScale;
    const next = clampTransform({ x: nextX, y: nextY, scale: newScale });
    applyTransform(next);
  };

  // Lessons for each region come straight from the DB — group by
  // region_id, then sort by (day, sort_order). This means migrations
  // (e.g. v24 moving l064 from R4 to R3, adding l065–l078, removing
  // l051) reflect on the map automatically with no UI edit needed.
  const lessonsByRegion = useMemo(() => {
    const out: Record<RegionId, Lesson[]> = { r1: [], r2: [], r3: [], r4: [] };
    for (const l of lessons) {
      const rid = l.region_id as RegionId;
      if (out[rid]) out[rid].push(l);
    }
    for (const rid of Object.keys(out) as RegionId[]) {
      out[rid].sort(
        (a, b) => a.day - b.day || a.sort_order - b.sort_order,
      );
    }
    return out;
  }, [lessons]);

  // Sequential region unlock: r1 always open; r(n) opens only when every
  // lesson in r(1..n-1) is complete. Returns a Set so SVG render and click
  // handler can both check membership in O(1).
  const unlockedRegions = useMemo<Set<RegionId>>(() => {
    const order: RegionId[] = ["r1", "r2", "r3", "r4"];
    const out = new Set<RegionId>();
    for (let i = 0; i < order.length; i++) {
      const rid = order[i];
      if (i === 0) {
        out.add(rid);
        continue;
      }
      const prevLessons = lessonsByRegion[order[i - 1]] ?? [];
      const prevDone = prevLessons.length > 0 && prevLessons.every((l) => completedLessonIds.has(l.id));
      if (!prevDone) break;
      out.add(rid);
    }
    return out;
  }, [lessonsByRegion, completedLessonIds]);

  const focusedRegion =
    view !== "overview" ? regions.find((r) => r.id === view) : null;
  // Real (sub-)lesson list — used by the side panel + lesson sheet.
  const focusedLessons: Lesson[] =
    focusedRegion ? lessonsByRegion[focusedRegion.id as RegionId] ?? [] : [];
  // Map-only lesson list — group sub-lessons collapsed into a single
  // virtual lesson so the path doesn't get crowded.
  //
  // v50.3 — l057 ("Complete Ad Bounty Onboarding") is intentionally
  // hidden from the R4 path. The green Bounty Access end-marker IS the
  // l057 lesson now: clicking the marker opens l057's sheet (see the
  // onEndMarkerClick handler below). Rendering it as a separate path
  // node confused users into thinking it was a different lesson.
  const focusedMapLessons = useMemo<Lesson[]>(
    () =>
      collapseLessonGroups(focusedLessons).filter(
        (l) => !(focusedRegion?.id === "r4" && l.id === "l057"),
      ),
    [focusedLessons, focusedRegion],
  );
  // Augment completedLessonIds with virtual group ids so the map's
  // LessonMarker can render the group as done when all sub-lessons are.
  const completedLessonIdsForMap = useMemo<Set<string>>(() => {
    const s = new Set(completedLessonIds);
    for (const g of Object.values(LESSON_GROUPS)) {
      if (isGroupComplete(g.id, completedLessonIds)) {
        s.add(GROUP_ID_PREFIX + g.id);
      }
    }
    return s;
  }, [completedLessonIds]);

  const sortedRegions = useMemo(
    () => [...regions].sort((a, b) => a.order_num - b.order_num),
    [regions]
  );

  const focusedIdx =
    focusedRegion == null
      ? -1
      : sortedRegions.findIndex((r) => r.id === focusedRegion.id);
  const prevRegion = focusedIdx > 0 ? sortedRegions[focusedIdx - 1] : null;
  const nextRegion =
    focusedIdx >= 0 && focusedIdx < sortedRegions.length - 1
      ? sortedRegions[focusedIdx + 1]
      : null;

  // Compute a "pre-zoom" target that's a slight push-in toward the
  // destination, used as a brief tween BEFORE the fade triggers. Reads
  // as the camera "leaning in" before the cut. Two cases:
  //   overview → region: zoom in 1.20x on the clicked region's center
  //                      (still in overview view, just camera moving)
  //   region → overview: zoom in 1.10x on current region's view
  //                      (push-in on what we're leaving)
  const getPreZoomTarget = (from: View, to: View) => {
    const vw = outerSize.w || 1;
    const vh = outerSize.h || 1;
    const cover = Math.max(vw / MAP_W, vh / MAP_H);

    const clampToImage = (t: {
      x: number;
      y: number;
      scale: number;
      areaW: number;
    }) => {
      const imgW = MAP_W * t.scale;
      const imgH = MAP_H * t.scale;
      const x = imgW <= t.areaW ? (t.areaW - imgW) / 2 : Math.max(t.areaW - imgW, Math.min(0, t.x));
      const y = imgH <= vh ? (vh - imgH) / 2 : Math.max(vh - imgH, Math.min(0, t.y));
      return { x, y, scale: t.scale };
    };

    if (from === "overview" && to !== "overview") {
      // Zoom in toward the clicked region's anchor point on the
      // overview map. ~1.20x more than overview default.
      const z = REGION_ZONES[to as RegionId];
      const scale = cover * OVERVIEW_DEFAULT_ZOOM * 1.20;
      return clampToImage({
        x: vw / 2 - z.labelX * scale,
        y: vh / 2 - z.labelY * scale,
        scale,
        areaW: vw,
      });
    }

    // Region → overview: small forward push on the current camera
    // position. Same x/y, scale up 1.10x.
    const current = transformRef.current;
    return {
      x: current.x,
      y: current.y,
      scale: current.scale * 1.10,
    };
  };

  // Click → pre-zoom (300ms small push-in) → fade transition →
  // scene swap behind the dark → emerge into destination.
  const transitionTo = (next: View) => {
    if (suppressClickRef.current) return;
    if (pendingViewRef.current !== null) return; // already in flight
    // Sequential lock: clicking a locked region is a no-op. The SVG also
    // visually communicates the locked state so the click never gets fired
    // from a deliberate user — but defensive guard handles programmatic /
    // keyboard activation paths.
    if (next !== "overview" && !unlockedRegions.has(next as RegionId)) return;
    pendingViewRef.current = next;

    // v50.4 — failsafe. If onPeak never fires (e.g. CinematicDive
    // unmounts mid-flight, GSAP timeline aborted by a window blur,
    // ref attachment race), pendingViewRef would stay non-null and
    // every future transitionTo call would silently no-op. Three
    // seconds is comfortably longer than the 2 s dive duration —
    // the normal path clears the ref well before this fires.
    window.setTimeout(() => {
      if (pendingViewRef.current === next) {
        pendingViewRef.current = null;
      }
    }, 3000);

    // Snapshot title for the destination. Stored in state so it
    // stays mounted past peak — pendingViewRef gets cleared in
    // onPeak, but state lives until the next transition overwrites
    // it. For back-to-overview we use a generic "Map" title (no
    // numeral) so the transition has the same visual treatment.
    if (next !== "overview") {
      const region = regions.find((r) => r.id === next);
      if (region) {
        const num = ["I", "II", "III", "IV"][(region.order_num ?? 1) - 1] ?? "";
        setTransitionTitle({ numeral: num, label: region.name });
      } else {
        setTransitionTitle(null);
      }
    } else {
      setTransitionTitle({ numeral: "✦", label: "The Map" });
    }

    // Force-mount deferred scene stack if heading into a region.
    if (next !== "overview" && !regionsMounted) {
      setRegionsMounted(true);
    }

    // Pre-zoom: short camera tween toward the destination BEFORE the
    // fade triggers. Skipped if outerSize isn't ready yet (initial
    // mount edge case).
    if (outerSize.w === 0) {
      setTransitionCounter((n) => n + 1);
      return;
    }

    const preTarget = getPreZoomTarget(view, next);
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    tweenRef.current = gsap.to(transformRef.current, {
      x: preTarget.x,
      y: preTarget.y,
      scale: preTarget.scale,
      duration: 0.32,
      ease: SPEC_EASE_GSAP,
      onUpdate: () => {
        applyTransform();
      },
      onComplete: () => {
        tweenRef.current = null;
        setTransitionCounter((n) => n + 1);
      },
    });
    return;
  };

  // Dev test panel listener — lets the developer trigger any
  // region transition without clicking a region zone.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<View>;
      if (ce.detail) transitionTo(ce.detail);
    };
    window.addEventListener("et:test:transition", handler);
    return () => window.removeEventListener("et:test:transition", handler);
    // transitionTo identity changes each render; use a fresh handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: "#060C1A",
        cursor: view === "overview" ? "grab" : "default",
        touchAction: "none",
      }}
      onPointerDown={onMapPointerDown}
      onWheel={onMapWheel}
    >
      {/* Map inner — scaled + translated. Pan / wheel / GSAP write
          directly to this element's style.transform via mapInnerRef so
          we don't re-render the whole tree on every input tick. The
          initial style.transform is seeded from transformRef; subsequent
          updates are pure DOM mutation. */}
      <div
        ref={mapInnerRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: MAP_W,
          height: MAP_H,
          transform: `translate(${transformRef.current.x}px, ${transformRef.current.y}px) scale(${transformRef.current.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          // Block accidental text highlighting when the user drags
          // around the map. Scoped to the map container — lesson
          // sheets / modals outside this tree stay selectable.
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* Sharp scene images — overview is mounted eagerly; region
            scenes pre-mount on desktop so swaps are an instant opacity
            toggle. On phone we only mount the active scene (each scene
            is a 3200×1400 composited layer, and stacking five of them
            costs serious GPU memory + makes pans crawl on lower-end
            devices). The transition flow already has cloud cover so a
            single-frame mount on entry is invisible. */}
        {SCENE_IMAGE_STACK.map(({ id, src, eager }) => {
          const shouldMount = isPhone
            ? view === id
            : eager || regionsMounted || view === id;
          if (!shouldMount) return null;
          return (
            <img
              key={id}
              src={src}
              alt=""
              decoding="async"
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center",
                opacity: view === id ? 1 : 0,
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
          );
        })}

        {/* Inside a region scene — draw the path + lesson nodes + end marker */}
        {view !== "overview" && SCENES[view] && (
          <ScenePathOverlay
            scene={SCENES[view]!}
            lessons={focusedMapLessons}
            completedLessonIds={completedLessonIdsForMap}
            currentLessonId={virtualizeCurrentLessonId(currentLesson?.id ?? null)}
            onOpenLesson={onOpenLesson}
            endMarker={
              // R4 — dynamic label so the marker reflects claimed state
              // (matches the R2 discount marker pattern). Other regions
              // use the static SCENE_END_MARKERS entry as-is.
              view === "r4"
                ? {
                    kind: "bounty",
                    label: effectiveBountyAccessClaimedAt
                      ? "Bounty Access · claimed"
                      : "Bounty Access",
                    sublabel: effectiveBountyAccessClaimedAt
                      ? "the finish line · done"
                      : "the finish line",
                  }
                : SCENE_END_MARKERS[view as RegionId]
            }
            endMarkerLocked={
              !(regionProgress[view as RegionId]?.isComplete ?? false)
            }
            onEndMarkerClick={() => {
              const progress = regionProgress[view as RegionId];
              const isComplete = progress?.isComplete ?? false;
              if (!isComplete) {
                const remaining =
                  (progress?.total ?? 0) - (progress?.completed ?? 0);
                showToast(
                  remaining === 1
                    ? "You haven't completed the last lesson"
                    : `${remaining} lessons left to unlock Onward`,
                );
                return;
              }
              // v50 — R4's end-marker IS the Bounty Access claim. Open
              // l057's lesson sheet where the Claim button lives.
              if (view === "r4") {
                onOpenLesson("l057");
                return;
              }
              // v54 - quiz gate. Same logic as the side panel
              // Onward button. The painted end-marker is what most
              // students click; without this branch the gate never
              // fires for users who don't open the side panel.
              const currentRid = view as RegionId;
              const quizConfig = getRegionQuiz(currentRid);
              const alreadyPassed =
                regionQuiz[currentRid]?.quiz_passed_at != null;
              if (quizConfig && !alreadyPassed) {
                if (quizAttemptIncrementedRef.current !== currentRid) {
                  quizAttemptIncrementedRef.current = currentRid;
                  void incrementRegionQuizAttempts(currentRid);
                }
                setQuizPassed(false);
                setQuizProgress("");
                setQuizRegionId(currentRid);
                return;
              }
              const next = SCENE_END_MARKERS[view as RegionId]?.nextView;
              if (next) transitionTo(next);
            }}
            // R2 → "Claim discount" marker (auto-positioned 160px back
            // from the last waypoint). Other regions don't use the
            // auto-positioned secondary slot.
            secondaryMarker={
              view === "r2"
                ? {
                    kind: "discount",
                    label: discountRequest
                      ? discountRequest.status === "approved" || discountRequest.status === "applied"
                        ? "Discount approved"
                        : discountRequest.status === "rejected"
                          ? "Discount rejected"
                          : "Discount pending"
                      : "Claim discount",
                    sublabel: discountRequest
                      ? discountRequest.status === "approved" || discountRequest.status === "applied"
                        ? "30% off - applied by team"
                        : discountRequest.status === "rejected"
                          ? "see Discord"
                          : "review in progress"
                      : discountAllLessonsDone
                        ? "reward unlocked"
                        : "finish R1 + R2 first",
                  }
                : undefined
            }
            onSecondaryMarkerClick={
              view === "r2"
                ? () => {
                    // Open the celebration modal in whichever mode applies.
                    if (discountRequest) {
                      setDiscountModalMode("review");
                    } else if (!discountAllLessonsDone) {
                      setDiscountModalMode("blocked");
                    } else {
                      setDiscountModalMode("claim");
                    }
                  }
                : undefined
            }
            // v50.3 — only the Playbook is pinned now. The Program
            // Complete marker was removed (Bounty Access IS the
            // finish line, so a separate celebration on the same
            // scene was redundant). The Playbook's CLICK is its
            // marker; the AURA polygon below provides the
            // hover-glow / locked-fog treatment that matches the
            // overview region zones.
            pinnedMarkers={
              view === "r4"
                ? [
                    {
                      marker: {
                        kind: "playbook",
                        label: "The Playbook",
                        sublabel: effectiveBountyAccessClaimedAt
                          ? "Months 2-3 · open"
                          : "claim Bounty Access first",
                      },
                      // v50.2 - Karlo-supplied coords for the button
                      // position inside the traced volcano-summit
                      // polygon (the polygon stays as the visual
                      // halo, this is just where the marker sits).
                      position: { x: 2760, y: 321 },
                      locked: !effectiveBountyAccessClaimedAt,
                      onClick: () => {
                        if (!effectiveBountyAccessClaimedAt) {
                          showToast(
                            "Claim Bounty Access to unlock the Playbook",
                          );
                          return;
                        }
                        router.push("/dashboard/playbook");
                      },
                      // v50.4 — keep the aura's glow alive while the
                      // cursor sits on the marker (the marker draws
                      // above the polygon, so otherwise the polygon's
                      // mouseleave fires and the halo collapses).
                      onHoverChange: setPlaybookAuraHot,
                    },
                  ]
                : undefined
            }
            // v50.3 — Playbook aura. Rendered on R4 only. Same glow /
            // feather / fog pattern as the overview region zones; locked
            // when bounty access isn't claimed yet. Sits BEHIND the
            // lesson markers + pinned Playbook marker because
            // ScenePathOverlay draws the aura first.
            playbookAura={
              view === "r4"
                ? {
                    polygon: PLAYBOOK_ZONE.polygon,
                    locked: !effectiveBountyAccessClaimedAt,
                    hot: playbookAuraHot,
                    onHotChange: setPlaybookAuraHot,
                    onClick: () => {
                      if (!effectiveBountyAccessClaimedAt) {
                        showToast(
                          "Claim Bounty Access to unlock the Playbook",
                        );
                        return;
                      }
                      router.push("/dashboard/playbook");
                    },
                  }
                : undefined
            }
          />
        )}

        {/* SVG overlay — ellipse hit zones over the map (overview only) */}
        {view === "overview" && (
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
              textRendering: "geometricPrecision",
              shapeRendering: "geometricPrecision",
              // Stop the map text from highlighting when the user
              // drag-scrolls or pans. Lesson-sheet text remains
              // selectable — this style is scoped to the SVG only.
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {/* Ambient layer — birds + clouds drifting over the painted map.
                Sits behind the hit-zones and labels so it doesn't intercept
                clicks. Pure pointer-events:none. */}
            <MapAmbience
              currentLessonPosition={
                currentLesson
                  ? {
                      // Approximate the current lesson's region center for
                      // sparkle placement on the overview. Per-region zoom
                      // already provides the real lesson position.
                      x:
                        currentLesson.region_id === "r1"
                          ? 350
                          : currentLesson.region_id === "r2"
                            ? 1150
                            : currentLesson.region_id === "r3"
                              ? 2050
                              : 2850,
                      y: 700,
                    }
                  : null
              }
            />

            <defs>
              {/* v50.4 — pearl-white auras (was gold). Karlo is
                  pulling all gold accents off the map; the hover
                  state is now a brighter white instead of a warm
                  amber. */}
              <radialGradient id="zone-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.42)" />
                <stop offset="60%" stopColor="rgba(255,255,255,0.16)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              <radialGradient id="zone-glow-hot" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.72)" />
                <stop offset="60%" stopColor="rgba(255,255,255,0.30)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              {/* Fog-of-war gradient — deep navy, sits over locked regions
                  so the painted terrain reads as obscured/unknown. Same
                  shape as the active glow but cool and heavier. */}
              <radialGradient id="zone-fog" cx="50%" cy="50%" r="55%">
                <stop offset="0%" stopColor="rgba(10,20,40,0.92)" />
                <stop offset="55%" stopColor="rgba(10,20,40,0.7)" />
                <stop offset="100%" stopColor="rgba(10,20,40,0.18)" />
              </radialGradient>
              {/* Feather the polygon glow so vertex-bound edges read as a
                  soft halo rather than a clipped fill. stdDeviation is in
                  map-space units (3200×1400 viewBox); the oversized filter
                  region prevents the blur from clipping at the bbox edge. */}
              <filter
                id="zone-feather"
                x="-25%"
                y="-25%"
                width="150%"
                height="150%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation="16" />
              </filter>
              <filter
                id="zone-feather-hot"
                x="-25%"
                y="-25%"
                width="150%"
                height="150%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation="22" />
              </filter>
            </defs>

            {sortedRegions.map((r) => {
              const z = REGION_ZONES[r.id as RegionId];
              const regionLessons = lessonsByRegion[r.id as RegionId] ?? [];
              if (!z) return null;
              const total = regionLessons.length;
              const completed = regionLessons.filter((l) =>
                completedLessonIds.has(l.id)
              ).length;
              const isComplete = total > 0 && completed === total;
              const isUnlocked = unlockedRegions.has(r.id as RegionId);
              const hot = isUnlocked && hoveredZone === r.id;
              const isCurrent =
                isUnlocked &&
                regionLessons.some((l) => l.id === currentLesson?.id);
              const numeral = ["I", "II", "III", "IV"][r.order_num - 1];
              const stroke = isComplete ? GOLD_HI : GOLD;
              const smoothD = smoothClosedPath(z.polygon);

              // Surface the discount on R2 directly inside the region
              // label (instead of a separate floating beacon). One
              // gold line — quiet, always visible, doesn't compete
              // with the painted scene. Hidden once the student has
              // already applied.
              const showDiscountLine =
                r.id === "r2" && !discountRequest;

              // Same pattern for R4 — tease the bounty access claim
              // that lives at l057. Hidden once l057 is completed
              // (proxy for "bounty access claimed" until the v2
              // schema lands the dedicated bounty_access_claimed_at
              // field). Copy mirrors the v2 brief's panel-headline
              // placeholder.
              const showBountyLine =
                r.id === "r4" &&
                !completedLessonIds.has("l057");

              const ariaLabel = isUnlocked
                ? `${r.name} — ${completed}/${total} lessons`
                : `${r.name} — locked, finish previous region first`;

              return (
                <g
                  key={`zone-${r.id}`}
                  style={{ cursor: isUnlocked ? "pointer" : "not-allowed" }}
                  onClick={
                    isUnlocked ? () => transitionTo(r.id as RegionId) : undefined
                  }
                  onMouseEnter={
                    isUnlocked
                      ? () => setHoveredZone(r.id as RegionId)
                      : undefined
                  }
                  onMouseLeave={
                    isUnlocked ? () => setHoveredZone(null) : undefined
                  }
                  onKeyDown={(e) => {
                    if (!isUnlocked) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      transitionTo(r.id as RegionId);
                    }
                  }}
                  tabIndex={isUnlocked ? 0 : -1}
                  role="button"
                  aria-disabled={!isUnlocked || undefined}
                  aria-label={ariaLabel}
                >
                  {/* Invisible hit surface — catches clicks/taps over the
                      whole smoothed shape regardless of gradient
                      transparency. Locked regions still need this so the
                      cursor changes correctly on hover. */}
                  <path
                    d={smoothD}
                    fill="rgba(0,0,0,0.001)"
                    pointerEvents="all"
                  />

                  {isUnlocked ? (
                    <>
                      {/* Subtle breathing glow on the smoothed shape — no
                          outline. Animates between two opacities so the
                          region "pulses" gently. The feGaussianBlur filter
                          feathers the gradient where it clips against
                          polygon vertices, so edges read as a soft halo,
                          not a hard cutout. */}
                      <path
                        d={smoothD}
                        fill={hot ? "url(#zone-glow-hot)" : "url(#zone-glow)"}
                        filter={hot ? "url(#zone-feather-hot)" : "url(#zone-feather)"}
                        pointerEvents="none"
                        style={{
                          transition: "opacity 0.4s cubic-bezier(0.22,1,0.36,1)",
                        }}
                      >
                        {!hot && (
                          <animate
                            attributeName="opacity"
                            values="0.55;1;0.55"
                            dur="4.5s"
                            repeatCount="indefinite"
                          />
                        )}
                      </path>

                      {/* Subtle current-region accent (no harsh outline) */}
                      {isCurrent && (
                        <path
                          d={smoothD}
                          fill="url(#zone-glow-hot)"
                          filter="url(#zone-feather-hot)"
                          opacity={0.5}
                          pointerEvents="none"
                        >
                          <animate
                            attributeName="opacity"
                            values="0.25;0.6;0.25"
                            dur="3.2s"
                            repeatCount="indefinite"
                          />
                        </path>
                      )}
                    </>
                  ) : (
                    /* Locked: persistent fog rolls over the polygon. Same
                       feathered radial pattern as the hover glow, but cool
                       deep-navy instead of warm gold so it reads as
                       obscured terrain — fog of war. */
                    <path
                      d={smoothD}
                      fill="url(#zone-fog)"
                      filter="url(#zone-feather)"
                      pointerEvents="none"
                    >
                      <animate
                        attributeName="opacity"
                        values="0.85;1;0.85"
                        dur="6s"
                        repeatCount="indefinite"
                      />
                    </path>
                  )}

                  {/* Center label — positioned at labelX/labelY in map space */}
                  <g
                    transform={`translate(${z.labelX} ${z.labelY})`}
                    pointerEvents="none"
                  >
                    {/* Numeral plaque (or lock plaque when locked) */}
                    <circle
                      cx={0}
                      cy={-28}
                      r={26}
                      fill="rgba(6,12,26,0.85)"
                      stroke={isUnlocked ? stroke : "rgba(230,220,200,0.4)"}
                      strokeWidth={1.5}
                    />
                    {isUnlocked ? (
                      <text
                        x={0}
                        y={-20}
                        textAnchor="middle"
                        style={{
                          fontFamily:
                            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                          fontWeight: 600,
                          fontSize: 22,
                          letterSpacing: "-0.02em",
                          fill: stroke,
                        }}
                      >
                        {numeral}
                      </text>
                    ) : (
                      /* Padlock icon — drawn as SVG paths so it scales
                         with the rest of the map without bitmap fuzz. */
                      <g transform="translate(0 -28)" stroke="rgba(230,220,200,0.78)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
                        <rect x={-9} y={-2} width={18} height={14} rx={2.5} fill="rgba(6,12,26,0.85)" />
                        <path d="M -6 -2 V -7 a 6 6 0 0 1 12 0 V -2" />
                        <circle cx={0} cy={5} r={1.4} fill="rgba(230,220,200,0.78)" stroke="none" />
                      </g>
                    )}

                    {/* Region name */}
                    <text
                      x={0}
                      y={26}
                      textAnchor="middle"
                      style={{
                        fontFamily:
                          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        fontWeight: 600,
                        fontSize: 30,
                        letterSpacing: "-0.022em",
                        fill: isUnlocked ? INK : "rgba(230,220,200,0.7)",
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 4,
                        strokeLinejoin: "round",
                      }}
                    >
                      {r.name}
                    </text>

                    {/* Progress / locked sublabel */}
                    <text
                      x={0}
                      y={52}
                      textAnchor="middle"
                      style={{
                        fontFamily:
                          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        fontWeight: 500,
                        fontSize: 13,
                        letterSpacing: "-0.005em",
                        fill: isUnlocked ? GOLD : "rgba(230,220,200,0.62)",
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 3,
                        strokeLinejoin: "round",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {isUnlocked
                        ? isComplete
                          ? `Complete · ${total}`
                          : `${completed} / ${total} lessons`
                        : "Locked"}
                    </text>

                    {/* Discount line — only on R2. Pulsing green dot +
                        bold "30% OFF" + quieter "your second month"
                        subline beneath. */}
                    {showDiscountLine && (
                      <g>
                        {/* Green pulse dot — manually placed left of
                            "30% OFF" text. Text width ~92px, dot offset
                            is rough but reads as adjacent. */}
                        <circle
                          cx={-56}
                          cy={77}
                          r={5}
                          fill="#22C55E"
                        >
                          <animate
                            attributeName="opacity"
                            values="0.6;1;0.6"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="r"
                            values="4.5;6;4.5"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                        </circle>
                        {/* Outer glow ring around the dot */}
                        <circle
                          cx={-56}
                          cy={77}
                          r={9}
                          fill="rgba(34, 197, 94, 0.25)"
                        >
                          <animate
                            attributeName="r"
                            values="7;12;7"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="0.18;0.45;0.18"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                        </circle>
                        <text
                          x={6}
                          y={84}
                          textAnchor="middle"
                          style={{
                            fontFamily:
                              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            fontWeight: 700,
                            fontSize: 22,
                            letterSpacing: "-0.022em",
                            fill: GOLD_HI,
                            paintOrder: "stroke fill",
                            stroke: "rgba(6,12,26,0.88)",
                            strokeWidth: 4,
                            strokeLinejoin: "round",
                          }}
                        >
                          30% OFF
                        </text>
                        <text
                          x={0}
                          y={106}
                          textAnchor="middle"
                          style={{
                            fontFamily:
                              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            fontWeight: 500,
                            fontSize: 13,
                            letterSpacing: "-0.005em",
                            fill: "rgba(230,220,200,0.78)",
                            paintOrder: "stroke fill",
                            stroke: "rgba(6,12,26,0.85)",
                            strokeWidth: 3,
                            strokeLinejoin: "round",
                          }}
                        >
                          your second month
                        </text>
                      </g>
                    )}

                    {/* Bounty line — only on R4. Same shape as the
                        discount line but copy mirrors the v2 brief's
                        l057 panel ("Bounty Access opens here").
                        Dot sits ~15px left of the wider text (BOUNTY
                        ACCESS is roughly 60px wider than "30% OFF"). */}
                    {showBountyLine && (
                      <g>
                        <circle
                          cx={-100}
                          cy={77}
                          r={5}
                          fill="#22C55E"
                        >
                          <animate
                            attributeName="opacity"
                            values="0.6;1;0.6"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="r"
                            values="4.5;6;4.5"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                        </circle>
                        <circle
                          cx={-100}
                          cy={77}
                          r={9}
                          fill="rgba(34, 197, 94, 0.25)"
                        >
                          <animate
                            attributeName="r"
                            values="7;12;7"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="0.18;0.45;0.18"
                            dur="1.6s"
                            repeatCount="indefinite"
                          />
                        </circle>
                        <text
                          x={6}
                          y={84}
                          textAnchor="middle"
                          style={{
                            fontFamily:
                              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            fontWeight: 700,
                            fontSize: 22,
                            letterSpacing: "-0.022em",
                            fill: GOLD_HI,
                            paintOrder: "stroke fill",
                            stroke: "rgba(6,12,26,0.88)",
                            strokeWidth: 4,
                            strokeLinejoin: "round",
                          }}
                        >
                          BOUNTY ACCESS
                        </text>
                        <text
                          x={0}
                          y={106}
                          textAnchor="middle"
                          style={{
                            fontFamily:
                              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            fontWeight: 500,
                            fontSize: 13,
                            letterSpacing: "-0.005em",
                            fill: "rgba(230,220,200,0.78)",
                            paintOrder: "stroke fill",
                            stroke: "rgba(6,12,26,0.85)",
                            strokeWidth: 3,
                            strokeLinejoin: "round",
                          }}
                        >
                          claim your spot at the end
                        </text>
                      </g>
                    )}

                    {/* Hover CTA — only shown for unlocked regions */}
                    {hot && (
                      <text
                        x={0}
                        y={showDiscountLine || showBountyLine ? 130 : 76}
                        textAnchor="middle"
                        style={{
                          fontFamily:
                            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                          fontWeight: 500,
                          fontSize: 12,
                          letterSpacing: "-0.005em",
                          fill: GOLD_HI,
                          paintOrder: "stroke fill",
                          stroke: "rgba(6,12,26,0.85)",
                          strokeWidth: 3,
                          strokeLinejoin: "round",
                        }}
                      >
                        Enter region →
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* StatsWidget — visible ONLY on overview. Replaces the old
          TopBar. Hosts welcome, progress, streak, next lesson,
          discount countdown, and signout. */}
      {view === "overview" && (
        <>
          <StatsWidget onOpenLesson={onOpenLesson} />
          {/* Region to-do widget — sits next to StatsWidget on overview.
              Auto-hides on phone (cramped). */}
          {!isPhone && <RegionTodoWidget />}
        </>
      )}

      {/* Back-to-map button — visible ONLY when zoomed into a region.
          Floating pill in the top-left; sized so it reads at a glance. */}
      {view !== "overview" && (
        <button
          type="button"
          onClick={() => transitionTo("overview")}
          aria-label="Back to map"
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            zIndex: 35,
            height: 48,
            padding: "0 22px 0 18px",
            borderRadius: 999,
            background: "rgba(15, 17, 21, 0.65)",
            border: "1px solid rgba(255, 255, 255, 0.20)",
            backdropFilter: "blur(24px) saturate(140%)",
            WebkitBackdropFilter: "blur(24px) saturate(140%)",
            color: "rgba(255, 255, 255, 0.96)",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.011em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow:
              "0 10px 28px rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.06) inset",
            transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(15, 17, 21, 0.80)";
            e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.32)";
            e.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(15, 17, 21, 0.65)";
            e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.20)";
            e.currentTarget.style.transform = "translateX(0)";
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to map
        </button>
      )}

      {/* Fade-through-dark with destination title card overlaid during
          the dark moment. Shows numeral + region name when entering a
          region; plain fade when going back to overview. */}
      <CinematicDive
        trigger={transitionCounter}
        duration={2.0}
        title={transitionTitle}
        onPeak={() => {
          const next = pendingViewRef.current;
          if (next != null) {
            setView(next);
            pendingViewRef.current = null;
          }
        }}
      />

      {/* v54 (brief-region-quiz) - region-end quiz gate. Modal mounts
          when Onward is clicked on a fully-complete region whose
          quiz isn't yet passed. The shared QuizModal wrapper handles
          chrome + win screen; each region's format component
          (currently only SwipeCardsQuiz) plugs inside. */}
      {(() => {
        if (!quizRegionId) return null;
        const quizConfig = getRegionQuiz(quizRegionId);
        if (!quizConfig) return null;
        const focusedRegionName =
          regions.find((r) => r.id === quizRegionId)?.name ?? "Region";
        return (
          <QuizModal
            open={true}
            regionName={focusedRegionName}
            progressLine={quizProgress}
            passed={quizPassed}
            onClose={() => {
              // Close = abort. Per brief, progress doesn't persist
              // across sessions, so we just dump state.
              setQuizRegionId(null);
              setQuizPassed(false);
              setQuizProgress("");
              quizAttemptIncrementedRef.current = null;
            }}
            onAdvance={() => {
              // Win screen continue - mark pass + transition.
              void markRegionQuizPassed(quizRegionId);
              const nextMap: Record<RegionId, RegionId | null> = {
                r1: "r2",
                r2: "r3",
                r3: "r4",
                r4: null,
              };
              const nextRid = nextMap[quizRegionId];
              setQuizRegionId(null);
              setQuizPassed(false);
              setQuizProgress("");
              quizAttemptIncrementedRef.current = null;
              if (nextRid) transitionTo(nextRid);
            }}
          >
            {quizConfig.format === "swipe_cards" && (
              <SwipeCardsQuiz
                cards={quizConfig.cards}
                onProgressChange={setQuizProgress}
                onPass={() => setQuizPassed(true)}
              />
            )}
            {/* Other formats (stack_builder, tier_ranking,
                vault_tumblers) plug in here once Karlo ships
                content for R2-4 - brief explicitly out of scope
                this round. */}
          </QuizModal>
        );
      })()}

      {/* Discount claim celebration — replaces the old alert() flow.
          Mode is set when the secondary R2 marker is clicked. The modal
          renders inline; calling onClaim triggers requestDiscount(). */}
      <DiscountClaimCelebration
        open={discountModalMode != null}
        mode={discountModalMode ?? "claim"}
        discountRequest={discountRequest}
        onClaim={async () => {
          await requestDiscount();
          // After claiming, switch the modal to "review" so the same
          // open modal shows the new pending/approved state.
          setDiscountModalMode("review");
        }}
        onDismiss={() => setDiscountModalMode(null)}
      />

      {/* v42 — Bounty Access claim celebration. Fires from the l057
          lesson sheet's claim button via StudentContext, which raises
          bountyAccessJustClaimed = true and the takeover renders here. */}
      <BountyAccessClaimCelebration
        open={bountyAccessJustClaimed}
        onDismiss={dismissBountyClaim}
      />

      {/* Toast — single transient message dead-center on screen.
          Used for "Onward locked" notifications. Auto-dismisses
          after 3s via the showToast helper. Fixed positioning so
          it ignores the side panel and lands at the viewport's
          true visual center. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 100,
            padding: "16px 28px",
            borderRadius: 999,
            background: "rgba(15, 17, 21, 0.94)",
            border: "1px solid rgba(255, 255, 255, 0.22)",
            backdropFilter: "blur(24px) saturate(140%)",
            WebkitBackdropFilter: "blur(24px) saturate(140%)",
            color: "rgba(255, 255, 255, 0.96)",
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "-0.011em",
            boxShadow: "0 24px 56px rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation:
              "fade-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            maxWidth: "min(90vw, 480px)",
            textAlign: "center",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.65, flexShrink: 0 }}
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11 V7 a5 5 0 0 1 10 0 V11" />
          </svg>
          {toast}
        </div>
      )}

      {/* Region side panel — sits as an absolute overlay over the map.
          When sidePanelWidth changes (collapse / expand), the imperative
          re-fit effect below preserves the user's pan position. */}
      {focusedRegion && (
        <RegionSidePanel
          region={focusedRegion}
          lessons={focusedLessons}
          completedLessonIds={completedLessonIds}
          onOpenLesson={onOpenLesson}
          onPrev={prevRegion ? () => transitionTo(prevRegion.id as RegionId) : null}
          onNext={
            nextRegion
              ? () => {
                  const progress = regionProgress[focusedRegion.id];
                  const isComplete = progress?.isComplete ?? false;
                  if (!isComplete) {
                    const remaining =
                      (progress?.total ?? 0) - (progress?.completed ?? 0);
                    showToast(
                      remaining === 1
                        ? "You haven't completed the last lesson"
                        : `${remaining} lessons left to unlock Onward`,
                    );
                    return;
                  }
                  // v54 - quiz gate. If the region has a quiz config
                  // AND this student hasn't passed it yet, fire the
                  // modal instead of jumping. After they pass, the
                  // modal calls markRegionQuizPassed + transitionTo
                  // on Continue. Regions without a quiz config (R2-4
                  // for now) fall through to the existing behavior.
                  const focusedRid = focusedRegion.id as RegionId;
                  const quiz = getRegionQuiz(focusedRid);
                  const alreadyPassed =
                    regionQuiz[focusedRid]?.quiz_passed_at != null;
                  if (quiz && !alreadyPassed) {
                    if (quizAttemptIncrementedRef.current !== focusedRid) {
                      quizAttemptIncrementedRef.current = focusedRid;
                      void incrementRegionQuizAttempts(focusedRid);
                    }
                    setQuizPassed(false);
                    setQuizProgress("");
                    setQuizRegionId(focusedRid);
                    return;
                  }
                  transitionTo(nextRegion.id as RegionId);
                }
              : null
          }
          nextLocked={
            nextRegion != null &&
            !(regionProgress[focusedRegion.id]?.isComplete ?? false)
          }
          width={sidePanelWidth}
          collapsed={sidePanelCollapsed}
          onToggleCollapsed={() => setSidePanelCollapsed((v) => !v)}
          isPhone={isPhone}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Side panel (shown when a region is focused)
// ──────────────────────────────────────────────────────────────

function RegionSidePanel({
  region,
  lessons,
  completedLessonIds,
  onOpenLesson,
  // v50.4 — onBack removed. The duplicate "Back to map" link inside
  // this panel was deleted; the floating top-left pill on the map
  // covers back-navigation now.
  onPrev,
  onNext,
  nextLocked = false,
  width,
  collapsed,
  onToggleCollapsed,
  isPhone = false,
}: {
  region: ReturnType<typeof useStudent>["regions"][number];
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  onOpenLesson: (id: string) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** When true, the "Onward" footer button still fires onNext (parent
   *  will show a toast), but it renders dimmed with a lock affordance. */
  nextLocked?: boolean;
  width: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** On phone, the panel renders as a bottom-sheet overlay rather than
   *  a right-rail aside. Toggle button becomes a floating tab. */
  isPhone?: boolean;
}) {
  // onPrev is still accepted as a prop (parent passes it for
  // backward compat) but unused in the new footer - "Back to map"
  // in the top nav covers that direction now.
  void onPrev;

  const numeral = ["I", "II", "III", "IV"][region.order_num - 1];

  const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
  const total = lessons.length;
  // Phone collapsed: a floating bottom tab. Tap to expand the sheet.
  if (isPhone && collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        aria-label="Expand region lessons"
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: 16,
          zIndex: 30,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderRadius: 999,
          // Solid bg, no backdrop-filter. Blur over a panning map kills
          // phone GPU. See sibling note in StatsWidget phone pill.
          background: "rgba(15, 17, 21, 0.96)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          color: "rgba(255, 255, 255, 0.94)",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <span style={{ color: "var(--color-gold)" }}>{numeral}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {completed} / {total}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
    );
  }

  // Desktop collapsed: thin strip with just an expand button
  // and the region's roman numeral. Map gets the rest of the canvas.
  if (collapsed) {
    return (
      <aside
        onWheel={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background:
            "linear-gradient(180deg, rgba(6,12,26,0.96) 0%, rgba(10,20,40,0.96) 100%)",
          borderLeft: "1px solid rgba(245,245,240,0.25)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 16,
          gap: 14,
          boxShadow: "-30px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onToggleCollapsed}
          aria-label="Expand region panel"
          title="Expand region panel"
          className="btn-ghost"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid rgba(245,245,240,0.25)",
            background: "transparent",
            color: "var(--color-ink-dim)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div
          style={{
            color: "var(--color-gold)",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            marginTop: 8,
          }}
        >
          {numeral} · {region.name}
        </div>
      </aside>
    );
  }

  const asideStyle: React.CSSProperties = isPhone
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "85vh",
        zIndex: 35,
        background: "rgba(10, 14, 22, 0.97)",
        borderTop: "1px solid rgba(255,255,255,0.10)",
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        display: "flex",
        flexDirection: "column",
        animation: "slide-in-up 0.45s cubic-bezier(0.22,1,0.36,1) both",
        boxShadow: "0 -20px 60px rgba(0,0,0,0.55)",
      }
    : {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width,
        background: "rgba(10, 14, 22, 0.96)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        animation: "slide-in-right 0.5s cubic-bezier(0.22,1,0.36,1) both",
        boxShadow: "-20px 0 40px rgba(0,0,0,0.45)",
      };

  return (
    <aside
      onWheel={(e) => e.stopPropagation()}
      style={asideStyle}
    >
      {/* v50.4 — old "Top nav" row removed. It carried a duplicate
          "Back to map" link (the floating top-left pill already
          handles back-navigation) and a collapse chevron. The
          collapse moved inline with the region label below so we
          reclaim ~50 px of vertical space for the lesson list. */}

      {/* Region header - tighter than before */}
      <div
        style={{
          padding: "18px 18px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
            }}
          >
            Region {numeral}
          </p>
          {/* v50.4 — collapse chevron, moved out of the now-deleted
              top nav and inline with the region label so the panel
              header is one row taller instead of two. */}
          <button
            onClick={onToggleCollapsed}
            aria-label={isPhone ? "Close panel" : "Collapse panel"}
            title={isPhone ? "Close panel" : "Collapse panel"}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Phone: down chevron (close sheet). Desktop: right chevron (collapse rail). */}
              <path d={isPhone ? "M6 9l6 6 6-6" : "M9 18l6-6-6-6"} />
            </svg>
          </button>
        </div>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.022em",
            color: "rgba(255,255,255,0.96)",
            lineHeight: 1.1,
            marginBottom: 14,
          }}
        >
          {region.name}
        </h2>

        {/* Inline progress: bar + count side by side */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 4,
              background: "rgba(255,255,255,0.08)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: total > 0 ? `${(completed / total) * 100}%` : "0%",
                height: "100%",
                background: "rgba(255,255,255,0.85)",
                transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)",
              }}
            />
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.005em",
              flexShrink: 0,
            }}
          >
            {completed} / {total}
          </span>
        </div>
      </div>

      {/* Lesson list - sequential lock model: lesson[k] is the next
          to do where k = number of completed lessons in this region.
          Tighter cards than before; only the current lesson gets a
          strong highlight, done lessons mute, locked lessons ghost. */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          padding: "12px 14px",
          overscrollBehavior: "contain",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {lessons.map((lesson, i) => {
          const isDone = completedLessonIds.has(lesson.id);
          // Sequential model - first not-done is the current lesson.
          // Everything past it is locked until the current one's done.
          const isCurrent = !isDone && i === completed;
          const isLocked = !isDone && !isCurrent;

          // Display title: replace em-dashes coming from DB-driven
          // lesson titles (e.g. "Video Ads Master — Introduction")
          // with hyphens per Karlo's voice rule.
          const rawTitle =
            MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
          const displayTitle = rawTitle.replace(/[–—]/g, "-");
          const displayDuration =
            lesson.duration_label?.replace(/[–—]/g, "-");

          return (
            <button
              key={lesson.id}
              onClick={isLocked ? undefined : () => onOpenLesson(lesson.id)}
              disabled={isLocked}
              aria-disabled={isLocked || undefined}
              aria-label={
                isLocked
                  ? `${displayTitle} - locked, finish previous lessons first`
                  : undefined
              }
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: isCurrent
                  ? "rgba(255,255,255,0.10)"
                  : "transparent",
                border: isCurrent
                  ? "1px solid rgba(255,255,255,0.30)"
                  : "1px solid transparent",
                textAlign: "left",
                cursor: isLocked ? "not-allowed" : "pointer",
                opacity: isLocked ? 0.35 : isDone && !isCurrent ? 0.55 : 1,
                transition: "background 150ms ease, border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (isLocked || isCurrent) return;
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                if (isLocked || isCurrent) return;
                e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Status indicator - 22px circle, simpler than before */}
              <div
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: isDone
                    ? "rgba(255,255,255,0.92)"
                    : isCurrent
                      ? "rgba(255,255,255,0.16)"
                      : "transparent",
                  border: isCurrent
                    ? "1.5px solid rgba(255,255,255,0.85)"
                    : !isDone
                      ? "1px solid rgba(255,255,255,0.18)"
                      : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(15,17,21,0.92)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : isCurrent ? (
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.95)",
                    }}
                  />
                ) : isLocked ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11 V 7 a 4 4 0 0 1 8 0 V 11" />
                  </svg>
                ) : (
                  <span
                    style={{
                      color: "rgba(255,255,255,0.45)",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {i + 1}
                  </span>
                )}
              </div>

              {/* Lesson title + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "-0.011em",
                    color: "rgba(255,255,255,0.92)",
                    lineHeight: 1.25,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayTitle}
                </p>
                <div
                  style={{
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                      color: "rgba(255,255,255,0.50)",
                    }}
                  >
                    {LESSON_TYPE_LABELS[lesson.type]}
                  </span>
                  {displayDuration && (
                    <>
                      <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }} aria-hidden="true">
                        ·
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "rgba(255,255,255,0.50)",
                          letterSpacing: "-0.005em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {displayDuration}
                      </span>
                    </>
                  )}
                  {lesson.is_gate && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: GOLD_HI,
                        background: "rgba(245,245,240,0.10)",
                        border: "1px solid rgba(245,245,240,0.20)",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                    >
                      Discount
                    </span>
                  )}
                  {lesson.id === "l057" && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "#4ADE80",
                        background: "rgba(34, 197, 94, 0.12)",
                        border: "1px solid rgba(34, 197, 94, 0.32)",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                    >
                      Bounty
                    </span>
                  )}
                  {lesson.is_boss && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "#F0A0A8",
                        background: "rgba(196,74,84,0.12)",
                        border: "1px solid rgba(196,74,84,0.32)",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                    >
                      Final
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer - single full-width Onward button when a next
          region exists. "Back to map" in the top nav already covers
          the previous direction, so the dual-button footer was
          mostly boilerplate. */}
      {onNext && (
        <div
          style={{
            padding: 14,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <button
            onClick={onNext}
            disabled={nextLocked}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 10,
              background: nextLocked
                ? "rgba(255,255,255,0.06)"
                : "rgba(255,255,255,0.94)",
              border: nextLocked
                ? "1px solid rgba(255,255,255,0.10)"
                : "none",
              color: nextLocked
                ? "rgba(255,255,255,0.45)"
                : "rgba(15,17,21,0.92)",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              cursor: nextLocked ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {nextLocked ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11 V7 a5 5 0 0 1 10 0 V11" />
                </svg>
                Finish this region first
              </>
            ) : (
              <>
                Onward
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────
// Scene overlay — positions lesson nodes along waypoints (no visible
// path line per user request) plus an end-of-region marker.
// ──────────────────────────────────────────────────────────────

interface ScenePathOverlayProps {
  scene: Scene;
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  currentLessonId: string | null;
  onOpenLesson: (id: string) => void;
  endMarker?: SceneEndMarker;
  onEndMarkerClick?: () => void;
  /** When true, the end marker renders in a "locked" treatment
   *  (dim + lock icon) and the click handler should typically show
   *  a notification instead of transitioning. */
  endMarkerLocked?: boolean;
  /** Optional second marker drawn ABOVE the primary endMarker. Used on
      R2 to surface the discount-claim CTA separately from the onward
      transition button. v50: also used on R4 for the locked-Playbook
      gate that appears past the "Program complete" marker. */
  secondaryMarker?: SceneEndMarker;
  onSecondaryMarkerClick?: () => void;
  /** When true, the secondary marker renders in a "locked" treatment
   *  (lock glyph, dimmed). */
  secondaryMarkerLocked?: boolean;
  /** v50 — extra markers with EXPLICIT positions in MAP coordinate
   *  space (no auto-positioning relative to waypoints). Each can be
   *  locked, can have its own click handler, etc. Used on R4 for the
   *  "Program complete" celebration + the "Playbook" zone marker. */
  pinnedMarkers?: Array<{
    marker: SceneEndMarker;
    position: { x: number; y: number };
    onClick?: () => void;
    locked?: boolean;
    /** v50.4 — bubble hover up. Used by R4's Playbook marker so the
     *  surrounding aura polygon keeps its glow alive while the cursor
     *  sits on the marker itself. */
    onHoverChange?: (hot: boolean) => void;
  }>;
  /** v50.3 — Playbook aura. A region-style hover-glow + locked-fog
   *  halo painted over a polygon on the scene. Drawn behind lesson
   *  nodes so the Playbook marker (which sits on top) reads
   *  cleanly. */
  playbookAura?: {
    polygon: Array<{ x: number; y: number }>;
    locked: boolean;
    onClick: () => void;
    /** v50.4 — controlled-hover. Parent owns the hot state so the
     *  Playbook marker (rendered ABOVE the aura) can also flip it
     *  on. Without this, moving the cursor from polygon → marker
     *  fires onMouseLeave on the polygon and the glow collapses. */
    hot: boolean;
    onHotChange: (hot: boolean) => void;
  };
}

function ScenePathOverlay({
  scene,
  lessons,
  completedLessonIds,
  currentLessonId,
  onOpenLesson,
  endMarker,
  onEndMarkerClick,
  endMarkerLocked = false,
  secondaryMarker,
  onSecondaryMarkerClick,
  secondaryMarkerLocked = false,
  pinnedMarkers,
  playbookAura,
}: ScenePathOverlayProps) {
  // Lifted hover state — child markers report up so the hover label
  // can render once at the END of the SVG, on top of every other
  // node. SVG paint order = source order, so anything that draws
  // last wins z-index.
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // v50.4 — Playbook aura hover state is now controlled by the
  // parent (see playbookAura.hot). Lifted so the marker rendered on
  // top of the polygon can keep the glow alive instead of letting
  // mouseleave-on-polygon collapse it.
  // Lesson positions are distributed by ARC LENGTH along the waypoint
  // polyline (excluding the last waypoint, reserved for the end marker).
  // Index-based distribution caused overlaps where the user clicked many
  // points near turns; arc-length spacing guarantees even visual spacing
  // regardless of waypoint density.
  const lessonPositions = useMemo(() => {
    const usable = scene.waypoints.slice(0, -1);
    const N = lessons.length;
    if (N === 0 || usable.length === 0) return [];
    if (usable.length === 1) return Array(N).fill(usable[0]);

    // Cumulative distance along the polyline
    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < usable.length; i++) {
      total += Math.hypot(
        usable[i].x - usable[i - 1].x,
        usable[i].y - usable[i - 1].y
      );
      cum.push(total);
    }
    if (total === 0) return usable.slice(0, N);

    // Asymmetric insets: the END needs more room because the discount
    // marker (R2) and the Onward marker live there. The START only
    // needs to clear the scene's image edge. With the breakdowns
    // collapsed to a single group node, R2 has plenty of total
    // horizontal room — bias the lessons toward the start so the
    // discount + Onward have space to breathe.
    const edgeInsetStart = Math.min(120, total * 0.06);
    const endFrac = scene.edgeInsetEndFrac ?? 0.16;
    const edgeInsetEnd = Math.min(280, total * endFrac);
    const usableLen = total - edgeInsetStart - edgeInsetEnd;
    const ease = scene.placementEase ?? 1;

    return lessons.map((_, i) => {
      const tLinear = N === 1 ? 0.5 : i / (N - 1);
      // ease > 1 biases lessons toward the start (more space at the end);
      // ease < 1 biases toward the end. ease === 1 is uniform arc-length.
      const t = ease === 1 ? tLinear : Math.pow(tLinear, ease);
      const target = edgeInsetStart + usableLen * t;
      // Find the segment containing `target` via linear scan
      let seg = 0;
      while (seg < cum.length - 1 && cum[seg + 1] < target) seg++;
      const segStart = cum[seg];
      const segEnd = cum[seg + 1] ?? total;
      const segT = segEnd === segStart ? 0 : (target - segStart) / (segEnd - segStart);
      const p0 = usable[seg];
      const p1 = usable[seg + 1] ?? p0;
      return {
        x: p0.x + (p1.x - p0.x) * segT,
        y: p0.y + (p1.y - p0.y) * segT,
      };
    });
  }, [scene, lessons]);

  const lastWaypoint = scene.waypoints[scene.waypoints.length - 1];

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        textRendering: "geometricPrecision",
        shapeRendering: "geometricPrecision",
      }}
    >
      {/* No path line — just the lesson nodes sitting on the painted trail */}

      {/* v50.3 — Playbook aura. Same defs + render pattern as the
          overview region zones (zone-glow, zone-fog, zone-feather), but
          self-contained so this SVG doesn't depend on the overview's
          <defs>. Drawn FIRST so lesson nodes + the Playbook marker
          pinned on top still receive the clicks. The invisible hit
          path catches taps anywhere inside the polygon and routes
          to onClick. */}
      {playbookAura && (
        <g>
          <defs>
            {/* v50.4 — pearl-white glow (no gold accent). Higher base
                opacity than the regions because the volcano summit is
                a brighter scene than the overview, so the same alpha
                read as invisible against bright sky. */}
            <radialGradient id="playbook-aura-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.62)" />
              <stop offset="55%" stopColor="rgba(255,255,255,0.28)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
            <radialGradient id="playbook-aura-glow-hot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.86)" />
              <stop offset="55%" stopColor="rgba(255,255,255,0.42)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
            <radialGradient id="playbook-aura-fog" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="rgba(10,20,40,0.92)" />
              <stop offset="55%" stopColor="rgba(10,20,40,0.68)" />
              <stop offset="100%" stopColor="rgba(10,20,40,0.18)" />
            </radialGradient>
            <filter
              id="playbook-aura-feather"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="18" />
            </filter>
            <filter
              id="playbook-aura-feather-hot"
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="24" />
            </filter>
          </defs>

          {(() => {
            const d = smoothClosedPath(playbookAura.polygon);
            const hot = !playbookAura.locked && playbookAura.hot;
            return (
              <g
                style={{
                  cursor: "pointer",
                  pointerEvents: "auto",
                }}
                onClick={playbookAura.onClick}
                onMouseEnter={() => playbookAura.onHotChange(true)}
                onMouseLeave={() => playbookAura.onHotChange(false)}
                role="button"
                aria-label={
                  playbookAura.locked
                    ? "The Playbook — locked, claim Bounty Access first"
                    : "The Playbook — open"
                }
              >
                {/* Hit surface — invisible but catches clicks/taps over
                    the whole polygon. */}
                <path
                  d={d}
                  fill="rgba(0,0,0,0.001)"
                  pointerEvents="all"
                />

                {playbookAura.locked ? (
                  <path
                    d={d}
                    fill="url(#playbook-aura-fog)"
                    filter="url(#playbook-aura-feather)"
                    pointerEvents="none"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.85;1;0.85"
                      dur="6s"
                      repeatCount="indefinite"
                    />
                  </path>
                ) : (
                  <path
                    d={d}
                    fill={hot ? "url(#playbook-aura-glow-hot)" : "url(#playbook-aura-glow)"}
                    filter={hot ? "url(#playbook-aura-feather-hot)" : "url(#playbook-aura-feather)"}
                    pointerEvents="none"
                    style={{
                      transition: "opacity 0.4s cubic-bezier(0.22,1,0.36,1)",
                    }}
                  >
                    {/* v50.4 — louder pulse than the regions
                        (0.40 → 1.0 vs 0.55 → 1.0) so the halo reads
                        against bright sky. Pulse stops while hot so
                        the user gets a clear "I'm pointing at this"
                        moment. */}
                    {!hot && (
                      <animate
                        attributeName="opacity"
                        values="0.40;1;0.40"
                        dur="3.6s"
                        repeatCount="indefinite"
                      />
                    )}
                  </path>
                )}
              </g>
            );
          })()}
        </g>
      )}

      {/* Lesson nodes (skipping the last waypoint). Node size scales with
          y: lessons further up the scene (smaller y, "further away") render
          smaller to suggest depth. */}
      {lessonPositions.map((pos, i) => {
        const lesson = lessons[i];
        if (!lesson || !pos) return null;
        const isDone = completedLessonIds.has(lesson.id);
        const isCurrent = lesson.id === currentLessonId;
        const isAction = isActionItem(lesson);
        const isGroup = lesson.id.startsWith(GROUP_ID_PREFIX);
        const displayTitle =
          MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
        const size = perspectiveSize(pos.y);
        // v50 — l057's headline "BOUNTY ACCESS" claim pill was moved
        // off the lesson node and onto R4's end-marker (the green
        // star at the arch). No lesson currently uses the per-node
        // claim treatment; left as a hook in case we resurrect it.
        const claim: "discount" | "bounty" | null = null;
        return (
          <LessonMarker
            key={lesson.id}
            x={pos.x}
            y={pos.y}
            index={i + 1}
            isDone={isDone}
            isCurrent={isCurrent}
            isAction={isAction}
            isGroup={isGroup}
            claim={claim}
            title={displayTitle}
            size={size}
            isHovered={hoveredIdx === i}
            onHoverChange={(hovered) =>
              setHoveredIdx(hovered ? i : (prev) => (prev === i ? null : prev))
            }
            onClick={() => onOpenLesson(lesson.id)}
          />
        );
      })}

      {/* Secondary marker — sits BEFORE the primary along the path
          direction so the flow reads sequentially:
              last lesson → discount → onward
          Computed by walking back from the last waypoint along the
          segment from second-to-last → last by SECONDARY_BACK_OFFSET
          map units. Falls back to a vertical offset if there's only
          one waypoint. */}
      {secondaryMarker && lastWaypoint && (() => {
        const SECONDARY_BACK_OFFSET = 160;
        const N = scene.waypoints.length;
        let sx = lastWaypoint.x;
        let sy = lastWaypoint.y - 130;
        if (N >= 2) {
          const prev = scene.waypoints[N - 2];
          const dx = lastWaypoint.x - prev.x;
          const dy = lastWaypoint.y - prev.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) {
            sx = lastWaypoint.x - (dx / len) * SECONDARY_BACK_OFFSET;
            sy = lastWaypoint.y - (dy / len) * SECONDARY_BACK_OFFSET;
          }
        }
        return (
          <EndMarker
            x={sx}
            y={sy}
            marker={secondaryMarker}
            onClick={onSecondaryMarkerClick}
            locked={secondaryMarkerLocked}
          />
        );
      })()}

      {/* End marker on the last waypoint */}
      {endMarker && lastWaypoint && (
        <EndMarker
          x={lastWaypoint.x}
          y={lastWaypoint.y}
          marker={endMarker}
          onClick={onEndMarkerClick}
          locked={endMarkerLocked}
        />
      )}

      {/* v50 — pinned markers at explicit map coords (no waypoint
          relationship). Painted last among non-hover-label markers so
          they sit on top of the path + lesson nodes. */}
      {pinnedMarkers?.map((pm, i) => (
        <EndMarker
          key={i}
          x={pm.position.x}
          y={pm.position.y}
          marker={pm.marker}
          onClick={pm.onClick}
          locked={pm.locked ?? false}
          onHoverChange={pm.onHoverChange}
        />
      ))}

      {/* Hover label — rendered LAST in the SVG so it sits above every
          other marker (lesson, group, secondary, end). Source order =
          paint order in SVG. */}
      {hoveredIdx != null &&
        lessonPositions[hoveredIdx] &&
        lessons[hoveredIdx] && (
          <HoverLabel
            x={lessonPositions[hoveredIdx].x}
            y={
              lessonPositions[hoveredIdx].y -
              perspectiveSize(lessonPositions[hoveredIdx].y) -
              18
            }
            title={
              MOCKUP_TITLE_OVERRIDES[lessons[hoveredIdx].id] ??
              lessons[hoveredIdx].title
            }
          />
        )}
    </svg>
  );
}

// Perspective scaling — nodes higher in the scene (smaller y) render
// smaller. Not strictly linear; the lower half is fairly flat so
// foreground nodes don't get huge.
function perspectiveSize(y: number): number {
  const t = Math.max(0, Math.min(1, y / MAP_H));
  // 0.65 at top → 1.0 at bottom, with a slight curve favoring the bottom half
  const eased = 0.65 + 0.35 * Math.pow(t, 0.9);
  // Bumped 26 → 32 so the markers carry visible weight in the
  // painted scenes — the previous size read as small stickers
  // on top of the landscape rather than waypoints inside it.
  return 32 * eased;
}

interface LessonMarkerProps {
  x: number;
  y: number;
  index: number;
  isDone: boolean;
  isCurrent: boolean;
  isAction: boolean;
  /** True for the virtual group marker (collapsed sub-lessons). Renders
   * with a stacked badge so it visually reads as "more inside". */
  isGroup?: boolean;
  /** "discount" → l049 — gold star + 30% DISCOUNT banner.
   *  "bounty"   → l057 — green star + BOUNTY ACCESS banner.
   *  Both render at ~3x normal size with glow + halo rings. */
  claim?: "discount" | "bounty" | null;
  title: string;
  /** Base radius for circle / half-width for diamond. Drives perspective. */
  size: number;
  isHovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onClick: () => void;
}

function LessonMarker({
  x,
  y,
  index,
  isDone,
  isCurrent,
  isAction,
  isGroup = false,
  claim = null,
  title,
  size: baseSize,
  isHovered,
  onHoverChange,
  onClick,
}: LessonMarkerProps) {
  const hot = isHovered;
  void title;

  // Claim nodes (l049 discount + l057 bounty) take a totally separate
  // rendering path — gold/green 16-point star, glow rings, banner.
  // They render at ~3x the size of a regular lesson so they read as
  // the headline moments of their region.
  if (claim) {
    return (
      <ClaimMarker
        x={x}
        y={y}
        baseSize={baseSize}
        isDone={isDone}
        isHovered={hot}
        variant={claim}
        onHoverChange={onHoverChange}
        onClick={onClick}
      />
    );
  }

  // Action items larger than lessons; group node larger still.
  const size = isAction
    ? baseSize * 1.23
    : isGroup
      ? baseSize * 1.18
      : baseSize;

  // Minimalist clean-white palette:
  //   Done    → solid white fill, dark check
  //   Current → white outline + white pulse + dim navy fill
  //   Locked  → soft white outline + dim navy fill (no warm tint)
  const isLocked = !isDone && !isCurrent;
  const fill = isDone
    ? "rgba(255, 255, 255, 0.96)"
    : isCurrent
      ? "rgba(15, 17, 21, 0.78)"
      : "rgba(15, 17, 21, 0.62)";
  const stroke = isDone
    ? "rgba(255, 255, 255, 0.96)"
    : isCurrent
      ? "rgba(255, 255, 255, 0.92)"
      : "rgba(255, 255, 255, 0.42)";
  const glyphColor = isDone
    ? "rgba(15, 17, 21, 0.92)"
    : isCurrent
      ? "rgba(255, 255, 255, 0.96)"
      : "rgba(255, 255, 255, 0.55)";

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor: "pointer", pointerEvents: "auto" }}
      onClick={onClick}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={title}
    >
      {/* Pulsing rim — only on the current waypoint. White, not gold. */}
      {isCurrent && (
        <circle
          r={size + 6}
          fill="none"
          stroke="rgba(255, 255, 255, 0.65)"
          strokeWidth={1.2}
          opacity={0.55}
        >
          <animate
            attributeName="r"
            values={`${size + 3};${size + 14};${size + 3}`}
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.10;0.55;0.10"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Hover wash — soft white glow, no warm tint */}
      {hot && (
        <circle
          r={size + 4}
          fill="rgba(255, 255, 255, 0.10)"
          style={{ transition: "opacity 0.2s" }}
        />
      )}

      {/* Soft contact shadow — grounds the marker without warm tint */}
      {isAction ? (
        <rect
          x={-size * 0.75 + 1}
          y={-size * 0.75 + 2}
          width={size * 1.5}
          height={size * 1.5}
          transform="rotate(45)"
          fill="rgba(0, 0, 0, 0.32)"
          stroke="none"
          opacity={0.6}
        />
      ) : (
        <ellipse
          cx={0.5}
          cy={size * 0.86}
          rx={size * 0.82}
          ry={size * 0.18}
          fill="rgba(0, 0, 0, 0.34)"
          stroke="none"
        />
      )}

      {/* Marker shape — flat fill + hairline stroke. No gradient,
          no bevel, no specular. Clean and minimal. */}
      {isAction ? (
        <rect
          x={-size * 0.75}
          y={-size * 0.75}
          width={size * 1.5}
          height={size * 1.5}
          transform="rotate(45)"
          fill={fill}
          stroke={stroke}
          strokeWidth={isCurrent ? 1.8 : isLocked ? 1.2 : 1.5}
        />
      ) : (
        <circle
          r={size}
          fill={fill}
          stroke={stroke}
          strokeWidth={isCurrent ? 1.8 : isLocked ? 1.2 : 1.5}
        />
      )}

      {/* Inner glyph — flat colors, no shadow tricks. */}
      {isDone ? (
        <path
          d="M -9 0 L -2 7 L 10 -7"
          fill="none"
          stroke={glyphColor}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : isGroup ? (
        <g
          stroke={glyphColor}
          strokeWidth={2}
          strokeLinecap="round"
        >
          <line x1={-7} y1={-6} x2={7} y2={-6} />
          <line x1={-7} y1={0} x2={7} y2={0} />
          <line x1={-7} y1={6} x2={7} y2={6} />
        </g>
      ) : isAction ? (
        <path
          d="M -5 -9 L 3 -2 L -1 -2 L 5 9 L -3 2 L 1 2 Z"
          fill={glyphColor}
          stroke="none"
        />
      ) : (
        <text
          y={6}
          textAnchor="middle"
          style={{
            fontFamily:
              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.018em",
            fontVariantNumeric: "tabular-nums",
            fill: glyphColor,
          }}
        >
          {index}
        </text>
      )}
    </g>
  );
}

/* ─────────────── ClaimMarker ───────────────
 *
 * The big gold/green 16-point star used for the two headline claim
 * moments on Map 1 — l049 (30% discount) and l057 (Bounty Access).
 *
 * Renders at ~3x the size of a regular lesson, with multi-layer
 * glow rings, a star body, an inner icon, and a banner above the
 * star spelling out what the claim is. The two variants share
 * everything except color + banner text.
 */

const GATE_GOLD = "#E6C07A";
const GATE_GOLD_HI = "#F0D595";
const BOUNTY_GREEN = "#22C55E";
const BOUNTY_GREEN_HI = "#4ADE80";

function gateStarPoints(r: number): string {
  return Array.from({ length: 16 })
    .map((_, i) => {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.68;
      return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
    })
    .join(" ");
}

function ClaimMarker({
  x,
  y,
  baseSize,
  isDone,
  isHovered,
  variant,
  onHoverChange,
  onClick,
}: {
  x: number;
  y: number;
  baseSize: number;
  isDone: boolean;
  isHovered: boolean;
  variant: "discount" | "bounty";
  onHoverChange: (hovered: boolean) => void;
  onClick: () => void;
}) {
  // Claim nodes outscale regular lessons by ~1.6x. (Previously 3x —
  // that swallowed half the visible scene.) The glow halo around them
  // doubles the visible footprint, so 1.6x on the body lands at a
  // reasonable focal-point size.
  const r = baseSize * 1.6;

  const palette =
    variant === "discount"
      ? {
          star: GATE_GOLD_HI,
          starFill: "rgba(230,192,122,0.22)",
          starFillDone: GATE_GOLD,
          glow: GATE_GOLD_HI,
          glowFill: "rgba(230,192,122,0.18)",
          glowStroke: "rgba(230,192,122,0.6)",
          banner: "30% DISCOUNT",
          bannerStroke: GATE_GOLD,
          bannerInner: "rgba(230,192,122,0.45)",
          bannerText: GATE_GOLD_HI,
        }
      : {
          star: BOUNTY_GREEN_HI,
          starFill: "rgba(34,197,94,0.18)",
          starFillDone: BOUNTY_GREEN,
          glow: BOUNTY_GREEN_HI,
          glowFill: "rgba(34,197,94,0.18)",
          glowStroke: "rgba(34,197,94,0.6)",
          banner: "BOUNTY ACCESS",
          bannerStroke: BOUNTY_GREEN,
          bannerInner: "rgba(34,197,94,0.45)",
          bannerText: BOUNTY_GREEN_HI,
        };

  const starFill = isDone ? palette.starFillDone : palette.starFill;

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor: "pointer", pointerEvents: "auto" }}
      onClick={onClick}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      tabIndex={0}
      role="button"
      aria-label={
        variant === "discount" ? "30% discount claim" : "Bounty access claim"
      }
    >
      {/* Multi-layer glow — only when active (not yet claimed). */}
      {!isDone && (
        <>
          <circle r={r + 46} fill={palette.glow} opacity={0.1}>
            <animate
              attributeName="opacity"
              values="0.08;0.2;0.08"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            r={r + 22}
            fill="none"
            stroke={palette.glow}
            strokeWidth={1.8}
            opacity={0.55}
          >
            <animate
              attributeName="r"
              values={`${r + 12};${r + 32};${r + 12}`}
              dur="2.8s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.7;0;0.7"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            r={r + 14}
            fill="none"
            stroke={palette.glow}
            strokeWidth={1.4}
            opacity={0.4}
          >
            <animate
              attributeName="r"
              values={`${r + 8};${r + 24};${r + 8}`}
              dur="2.8s"
              begin="1.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.6;0;0.6"
              dur="2.8s"
              begin="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            r={r + 8}
            fill={palette.glowFill}
            stroke={palette.glowStroke}
            strokeWidth={1.4}
          />
        </>
      )}

      {/* Hover wash */}
      {isHovered && !isDone && (
        <circle r={r + 12} fill="rgba(255,255,255,0.08)" />
      )}

      {/* Star body */}
      <polygon
        points={gateStarPoints(r)}
        fill={starFill}
        stroke={palette.star}
        strokeWidth={2.2}
      />

      {/* Inner icon — claim-specific glyph, scaled with r. */}
      {!isDone &&
        (variant === "discount" ? (
          // Percent sign
          <g
            fill="none"
            stroke={palette.star}
            strokeWidth={3}
            strokeLinecap="round"
            transform={`scale(${r / 18})`}
          >
            <circle cx={-5} cy={-5} r={3} />
            <circle cx={5} cy={5} r={3} />
            <line x1={-8} y1={8} x2={8} y2={-8} />
          </g>
        ) : (
          // Three-dot coin cluster
          <g fill={palette.star} transform={`scale(${r / 18})`}>
            <circle cx={0} cy={-6} r={3.2} />
            <circle cx={-5} cy={3} r={3.2} />
            <circle cx={5} cy={3} r={3.2} />
          </g>
        ))}
      {isDone && (
        // Centered check — bounding box (-r*0.28, -r*0.18) to
        // (r*0.28, r*0.18) so midpoint sits at (0, 0). Smaller +
        // tighter stroke than before; the previous version
        // overpowered the star body.
        <path
          d={`M ${-r * 0.28} ${-r * 0.02} L ${-r * 0.05} ${r * 0.18} L ${r * 0.28} ${-r * 0.18}`}
          fill="none"
          stroke="rgba(15,17,21,0.92)"
          strokeWidth={r * 0.085}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Banner above the star */}
      <g transform={`translate(0, ${-r - 60})`}>
        <line
          x1={0}
          y1={20}
          x2={0}
          y2={50}
          stroke={palette.bannerStroke}
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.55}
        />
        <rect
          x={-110}
          y={-16}
          width={220}
          height={32}
          rx={5}
          fill="#0A1428"
          stroke={palette.bannerStroke}
          strokeWidth={1.6}
        />
        <rect
          x={-106}
          y={-12}
          width={212}
          height={24}
          rx={3}
          fill="none"
          stroke={palette.bannerInner}
          strokeWidth={0.7}
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontSize={13}
          fontWeight={700}
          fill={palette.bannerText}
          letterSpacing={4}
        >
          {palette.banner}
        </text>
      </g>
    </g>
  );
}

// Hover label — rendered as a sibling of LessonMarker (after them all)
// so SVG paint order keeps it on top regardless of which marker is hot.
function HoverLabel({
  x,
  y,
  title,
}: {
  x: number;
  y: number;
  title: string;
}) {
  const display = title.length > 36 ? title.slice(0, 33) + "…" : title;
  return (
    <g
      transform={`translate(${x} ${y})`}
      pointerEvents="none"
      style={{ textRendering: "geometricPrecision" }}
    >
      <rect
        x={-128}
        y={-22}
        width={256}
        height={28}
        rx={6}
        fill="rgba(15,17,21,0.96)"
        stroke="rgba(255,247,235,0.18)"
        strokeWidth={1}
      />
      <text
        y={-3}
        textAnchor="middle"
        style={{
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          fill: "rgba(255,247,235,0.92)",
        }}
      >
        {display}
      </text>
    </g>
  );
}

// ──────────────────────────────────────────────────────────
// End-of-region marker — sits on the last waypoint of a scene's path.
// Three visual variants:
//   onward      — gold "Onward →" plaque (advances to next region)
//   discount    — teal/gold percent badge (R2: claim discount)
//   celebration — gold trophy/wreath (R4: expedition complete)
// ──────────────────────────────────────────────────────────

function EndMarker({
  x,
  y,
  marker,
  onClick,
  locked = false,
  onHoverChange,
}: {
  x: number;
  y: number;
  marker: SceneEndMarker;
  onClick?: () => void;
  /** When true, the marker renders dim with a lock glyph and the
   *  pulsing aura is suppressed. Click still fires onClick (parent
   *  decides whether to show a notification instead of navigating). */
  locked?: boolean;
  /** v50.4 — bubble hover state up so parents like the Playbook
   *  aura can keep their glow alive while the cursor is on the
   *  marker (otherwise the polygon's mouseleave fires when the
   *  cursor crosses onto the marker). */
  onHoverChange?: (hot: boolean) => void;
}) {
  const [hot, setHot] = useState(false);
  const isClickable = !!onClick;
  // Minimalist clean white EndMarkers, matching simplified LessonMarker.
  // Discount + celebration get a thin extra outer ring as their only
  // "milestone" tell. Onward is the same disc without the ring.
  const isMilestone = marker.kind !== "onward";

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{
        cursor: isClickable ? "pointer" : "default",
        pointerEvents: "auto",
        opacity: locked ? 0.5 : 1,
        transition: "opacity 200ms cubic-bezier(0.25,0.1,0.25,1)",
      }}
      onClick={onClick}
      onMouseEnter={() => {
        setHot(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setHot(false);
        onHoverChange?.(false);
      }}
      onKeyDown={(e) => {
        if (!isClickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      tabIndex={isClickable ? 0 : -1}
      role={isClickable ? "button" : undefined}
      aria-label={`${marker.label} — ${marker.sublabel}`}
    >
      {/* Pulsing aura — gold halo on discount marker (matches the
          new claim treatment), soft white on the others. */}
      <circle
        r={44}
        fill={marker.kind === "discount" ? GATE_GOLD_HI : "rgba(255, 255, 255, 0.18)"}
        opacity={locked ? 0 : isMilestone ? 0.24 : 0.18}
      >
        <animate
          attributeName="r"
          values="40;54;40"
          dur="2.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values={
            locked
              ? "0;0;0"
              : isMilestone
                ? "0.18;0.40;0.18"
                : "0.10;0.24;0.10"
          }
          dur="2.6s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Soft contact shadow — suppressed for the discount marker
          because the gold star body extends past the ellipse and
          the dark band reads as a smudge under the gem. White-disc
          markers keep the shadow for grounding. */}
      {marker.kind !== "discount" && (
        <ellipse
          cx={1.5}
          cy={32}
          rx={32}
          ry={6}
          fill="rgba(0, 0, 0, 0.40)"
          stroke="none"
        />
      )}

      {/* Outer milestone ring — only on discount + celebration */}
      {isMilestone && (
        <circle
          r={44}
          fill="none"
          stroke={
            marker.kind === "discount"
              ? GATE_GOLD_HI
              : "rgba(255, 255, 255, 0.55)"
          }
          strokeWidth={1.2}
          opacity={0.7}
        />
      )}

      {/* Body — 16-point gold star on the discount marker. The new
          (v50) bounty end-marker uses a 16-point GREEN star — same
          shape language but green to read as "bounty" the way gold
          reads as "discount". Other kinds keep the white disc. */}
      {marker.kind === "discount" ? (
        <polygon
          points={gateStarPoints(36)}
          fill="rgba(230,192,122,0.22)"
          stroke={GATE_GOLD_HI}
          strokeWidth={hot ? 2.6 : 2.2}
          style={{ transition: "stroke-width 0.2s" }}
        />
      ) : marker.kind === "bounty" ? (
        <polygon
          points={gateStarPoints(36)}
          fill="rgba(34, 197, 94, 0.22)"
          stroke="#4ADE80"
          strokeWidth={hot ? 2.6 : 2.2}
          style={{ transition: "stroke-width 0.2s" }}
        />
      ) : (
        <circle
          r={36}
          fill="rgba(255, 255, 255, 0.96)"
          stroke="rgba(255, 255, 255, 0.96)"
          strokeWidth={hot ? 2 : 1.4}
          style={{ transition: "stroke-width 0.2s" }}
        />
      )}

      {/* Inner glyph — flat dark navy on white. When locked, replace
          the arrow with a padlock icon to communicate the gate. */}
      {marker.kind === "onward" && !locked && (
        <path
          d="M -10 -8 L 8 0 L -10 8 L -6 0 Z"
          fill="rgba(15, 17, 21, 0.92)"
          stroke="none"
        />
      )}
      {marker.kind === "onward" && locked && (
        <g stroke="rgba(15, 17, 21, 0.92)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect x={-7} y={-2} width={14} height={12} rx={2} fill="rgba(15, 17, 21, 0.92)" />
          <path d="M -5 -2 V -7 a 5 5 0 0 1 10 0 V -2" />
        </g>
      )}
      {marker.kind === "discount" && (
        <g>
          <circle cx={-7} cy={-7} r={4} fill="none" stroke={GATE_GOLD_HI} strokeWidth={2.6} />
          <circle cx={7} cy={7} r={4} fill="none" stroke={GATE_GOLD_HI} strokeWidth={2.6} />
          <line x1={-12} y1={12} x2={12} y2={-12} stroke={GATE_GOLD_HI} strokeWidth={2.6} strokeLinecap="round" />
        </g>
      )}
      {marker.kind === "celebration" && (
        <g>
          <path
            d="M -8 -10 L 8 -10 L 7 4 Q 7 8 0 8 Q -7 8 -7 4 Z"
            fill="rgba(15, 17, 21, 0.92)"
            stroke="none"
          />
          <line x1={-3} y1={8} x2={3} y2={8} stroke="rgba(15, 17, 21, 0.92)" strokeWidth={3} strokeLinecap="round" />
          <line x1={-5} y1={11} x2={5} y2={11} stroke="rgba(15, 17, 21, 0.92)" strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
      {/* v50 — Bounty Access end-marker. Three-dot coin cluster
          inside the green star (matches the Bounty Apprentice chip
          visual language). */}
      {marker.kind === "bounty" && (
        <g fill="#15803D">
          <circle cx={0} cy={-7} r={3.6} />
          <circle cx={-6.2} cy={3.5} r={3.6} />
          <circle cx={6.2} cy={3.5} r={3.6} />
        </g>
      )}

      {/* v50 — Playbook marker. Unlocked: open-book icon. Locked:
          padlock (matches the onward-locked variant so the language
          is consistent across the map). */}
      {marker.kind === "playbook" && !locked && (
        <g stroke="rgba(15, 17, 21, 0.92)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M -10 -7 L -10 9 L 0 6 L 10 9 L 10 -7 L 0 -4 Z" fill="rgba(15, 17, 21, 0.92)" />
          <line x1={0} y1={-4} x2={0} y2={6} stroke="rgba(255, 255, 255, 0.6)" strokeWidth={1.2} />
        </g>
      )}
      {marker.kind === "playbook" && locked && (
        <g stroke="rgba(15, 17, 21, 0.92)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect x={-7} y={-2} width={14} height={12} rx={2} fill="rgba(15, 17, 21, 0.92)" />
          <path d="M -5 -2 V -7 a 5 5 0 0 1 10 0 V -2" />
        </g>
      )}

      {/* Label below marker */}
      <g transform="translate(0 60)" pointerEvents="none">
        <text
          textAnchor="middle"
          y={0}
          style={{
            fontFamily:
              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 600,
            fontSize: 22,
            letterSpacing: "-0.022em",
            fill: INK,
            paintOrder: "stroke fill",
            stroke: "rgba(6,12,26,0.85)",
            strokeWidth: 4,
            strokeLinejoin: "round",
          }}
        >
          {marker.label}
        </text>
        <text
          textAnchor="middle"
          y={22}
          style={{
            fontFamily:
              'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 500,
            fontSize: 12,
            letterSpacing: "-0.005em",
            fill: isMilestone ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.78)",
            paintOrder: "stroke fill",
            stroke: "rgba(6,12,26,0.85)",
            strokeWidth: 3,
            strokeLinejoin: "round",
          }}
        >
          {marker.sublabel}
        </text>
      </g>
    </g>
  );
}
