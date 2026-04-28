"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useStudent } from "@/contexts/StudentContext";
import {
  MAP_W,
  MAP_H,
  type RegionStripMap,
} from "@/lib/map/path-math";
import { LESSON_TYPE_LABELS } from "@/lib/constants";
import type { Lesson } from "@/types/database";
import { CloudTransition } from "./CloudTransition";

interface MapMockupProps {
  onOpenLesson: (lessonId: string) => void;
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

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const INK = "#E6DCC8";

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

// ──────────────────────────────────────────────────────────────
// Scene data — per-region background image + red-line waypoints.
// Regions without a scene image fall back to zoom-on-main.
// Waypoint coords are in the 3200×1400 map space (image cover-fits into it).
// ──────────────────────────────────────────────────────────────

interface Scene {
  image: string;
  waypoints: { x: number; y: number }[];
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
    waypoints: [
      { x: 825, y: 1328 }, { x: 885, y: 1239 }, { x: 959, y: 1171 },
      { x: 1032, y: 1125 },{ x: 1119, y: 1088 },{ x: 1236, y: 1030 },
      { x: 1329, y: 995 }, { x: 1433, y: 953 }, { x: 1522, y: 919 },
      { x: 1600, y: 892 }, { x: 1686, y: 864 }, { x: 1771, y: 820 },
      { x: 1826, y: 781 }, { x: 1855, y: 750 }, { x: 1857, y: 711 },
      { x: 1832, y: 684 }, { x: 1782, y: 652 }, { x: 1738, y: 627 },
      { x: 1721, y: 603 }, { x: 1729, y: 574 }, { x: 1774, y: 547 },
      { x: 1829, y: 525 }, { x: 1904, y: 501 }, { x: 1940, y: 479 },
      { x: 2021, y: 346 },
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
type EndMarkerKind = "onward" | "discount" | "celebration";
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
  r4: { kind: "celebration", label: "Expedition complete", sublabel: "well charted" },
};

// ──────────────────────────────────────────────────────────────
// Mockup lesson redistribution (client-side only — does NOT mutate DB).
//
// Updated 2026-04-28 to match v6/v7 data model:
//   - R1 (Base Camp, days 1-7): l001-l020 in day/sort_order
//     l018 was moved from day 6 → day 7 in v7 so the day-7 cluster is
//     "Action Item: Organic Ads → UGC → Action Item: UGC Ad"
//   - R2 (Creative Lab, days 8-15): l021-l025 (moved from R1 in v6) +
//     l026-l033, l035-l039, l041, l042, l045, l046 (l034, l040, l043,
//     l044 were deleted in v6 — their function folded into compound
//     "Action Item:" lessons)
//   - R3 (Test Track, days 16-23): l047-l056
//   - R4 (The Market, days 24-30): l057-l063
//
// Lessons whose title starts with "Action Item:" are rendered as diamond
// markers on the path.
// ──────────────────────────────────────────────────────────────

const MOCKUP_REGION_LESSONS: Record<RegionId, string[]> = {
  // R1 in path order (day, then sort_order)
  r1: [
    "l001", "l002", "l003",                  // day 1
    "l004", "l005", "l006",                  // day 2
    "l007", "l008", "l009",                  // day 3
    "l010", "l011", "l012",                  // day 4
    "l013", "l014", "l015",                  // day 5
    "l016", "l017",                          // day 6
    "l018", "l019", "l020",                  // day 7
  ],
  // R2 = the 5 ex-R1 lessons (l021-l025) + remaining R2 minus deleted.
  // R2 ends at l042 — the "Claim discount" transition fires next.
  r2: [
    "l021", "l022", "l023", "l024", "l025",  // moved from R1 in v6
    "l026", "l027", "l028", "l029", "l030", "l031",
    "l032", "l033",
    // l034 deleted (Ship Your Organic Ad → folded into l018)
    "l035", "l036", "l037", "l038", "l039",
    // l040 deleted (Ship Your UGC Ad → folded into l020)
    "l041", "l042",
    // l043 deleted (Ship Your High-Production Ad → folded into l024)
    // l044 deleted (Ship Your VSL → folded into l022)
    // l045 + l046 moved to R3 in v8 (engage feedback + static ad)
  ],
  // R3 = ex-R2 l045/l046 (engage feedback + static ad, with l046 still
  // carrying the discount-gate flag) + the existing strategy lessons.
  r3: [
    "l045", "l046",
    "l047", "l048", "l049", "l050", "l051",
    "l052", "l053", "l054", "l055", "l056",
  ],
  r4: Array.from({ length: 7 }, (_, i) => `l0${String(57 + i).padStart(2, "0")}`),
};

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
export function MapMockup({ onOpenLesson }: MapMockupProps) {
  const {
    regions,
    lessons,
    completedLessonIds,
    currentLesson,
    discountRequest,
    discountAllLessonsDone,
    requestDiscount,
  } = useStudent();

  const outerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const [view, setView] = useState<View>("overview");
  const [outerSize, setOuterSize] = useState({ w: 0, h: 0 });
  const [displayTransform, setDisplayTransform] = useState({
    x: 0,
    y: 0,
    scale: 1,
  });

  // Cloud-transition orchestration
  const [transitionCounter, setTransitionCounter] = useState(0);
  const pendingViewRef = useRef<View | null>(null);
  const [hoveredZone, setHoveredZone] = useState<RegionId | null>(null);

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

  // Default view: always start on the overview. The student opts into a region
  // by clicking its hit zone (which plays the cloud transition).
  useEffect(() => {
    if (outerSize.w === 0) return;
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

  const sidePanelWidth = getSidePanelWidth(outerSize.w);

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
      // Center on Base Camp so a new student lands looking at where they
      // start, not a wide context map.
      const z = REGION_ZONES.r1;
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
      transformRef.current = baseline;
      setDisplayTransform(baseline);
    }

    if (reduced) {
      transformRef.current = target;
      setDisplayTransform(target);
      return;
    }

    tweenRef.current = gsap.to(transformRef.current, {
      x: target.x,
      y: target.y,
      scale: target.scale,
      // Cloud-cover swap: 0.25s and the user never sees it.
      // First paint: slow ease so the camera arrival reads as cinematic.
      duration: isFirst ? 1.8 : 0.25,
      ease: isFirst ? "expo.out" : "power2.out",
      onUpdate: () => {
        setDisplayTransform({ ...transformRef.current });
      },
      onComplete: () => {
        tweenRef.current = null;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, outerSize]);

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
  // view = viewport minus the side panel. The clamp uses this so panning
  // never reveals the panel area or any background.
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
      transformRef.current = next;
      setDisplayTransform(next);
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
    transformRef.current = next;
    setDisplayTransform(next);
  };

  // Build a lookup for fast lesson-by-id access
  const lessonsById = useMemo(() => {
    const m = new Map<string, Lesson>();
    lessons.forEach((l) => m.set(l.id, l));
    return m;
  }, [lessons]);

  // Lessons for each region are redistributed per MOCKUP_REGION_LESSONS
  // (mockup-only client-side override — DB region_id is ignored).
  const lessonsByRegion = useMemo(() => {
    const out: Partial<Record<RegionId, Lesson[]>> = {};
    (Object.keys(MOCKUP_REGION_LESSONS) as RegionId[]).forEach((rid) => {
      out[rid] = MOCKUP_REGION_LESSONS[rid]
        .map((id) => lessonsById.get(id))
        .filter((l): l is Lesson => l != null);
    });
    return out as Record<RegionId, Lesson[]>;
  }, [lessonsById]);

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
  const focusedLessons: Lesson[] =
    focusedRegion ? lessonsByRegion[focusedRegion.id as RegionId] ?? [] : [];

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

  // Trigger a cloud transition then swap the view at peak coverage.
  // Blocked while a drag was in progress (pan shouldn't also click a zone).
  // No pre-zoom — the clouds fully cover the screen at peak, so the camera
  // doesn't need to "dive in" first. Pre-zoom used to land at a different
  // scale than the post-swap target, which read as a weird zoom-out as
  // clouds retreated. Letting the clouds do the work alone is cleaner.
  const transitionTo = (next: View) => {
    if (suppressClickRef.current) return;
    if (pendingViewRef.current !== null) return; // already in flight
    // Sequential lock: clicking a locked region is a no-op. The SVG also
    // visually communicates the locked state so the click never gets fired
    // from a deliberate user — but defensive guard handles programmatic /
    // keyboard activation paths.
    if (next !== "overview" && !unlockedRegions.has(next as RegionId)) return;
    pendingViewRef.current = next;

    // If the user is heading into a region, force-mount the deferred scene
    // stack now. The cloud transition gives us ~1s of cover before the swap
    // reveals the new view — plenty of headroom for a 600 KB WebP.
    if (next !== "overview" && !regionsMounted) {
      setRegionsMounted(true);
    }

    setTransitionCounter((n) => n + 1);
  };

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
      {/* Map inner — scaled + translated by GSAP (mirrored to React state) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: MAP_W,
          height: MAP_H,
          transform: `translate(${displayTransform.x}px, ${displayTransform.y}px) scale(${displayTransform.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {/* Sharp scene images — overview is mounted eagerly; region scenes
            are deferred until idle (or until the user heads into one). Once
            mounted, scene swap is a pure opacity toggle. */}
        {SCENE_IMAGE_STACK.map(({ id, src, eager }) => {
          const shouldMount = eager || regionsMounted || view === id;
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
            lessons={focusedLessons}
            completedLessonIds={completedLessonIds}
            currentLessonId={currentLesson?.id ?? null}
            onOpenLesson={onOpenLesson}
            endMarker={SCENE_END_MARKERS[view as RegionId]}
            onEndMarkerClick={() => {
              const next = SCENE_END_MARKERS[view as RegionId]?.nextView;
              if (next) transitionTo(next);
            }}
            // R2 specifically gets a second "Claim discount" marker
            // stacked above the onward marker. Other regions don't.
            secondaryMarker={
              view === "r2"
                ? {
                    kind: "discount",
                    label: discountRequest
                      ? discountRequest.status === "approved"
                        ? "Discount approved"
                        : discountRequest.status === "rejected"
                          ? "Discount rejected"
                          : "Discount pending"
                      : "Claim discount",
                    sublabel: discountRequest
                      ? discountRequest.status === "approved"
                        ? "30% off — see code"
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
                ? async () => {
                    if (discountRequest) {
                      // Already claimed — show details (status, code if any)
                      const code = discountRequest.promo_code;
                      const status = discountRequest.status;
                      if (status === "approved" && code) {
                        await navigator.clipboard.writeText(code);
                        alert(`Promo code copied: ${code}`);
                      } else if (status === "rejected") {
                        alert(
                          discountRequest.rejection_reason ??
                            "Discount was rejected. Reach out in Discord."
                        );
                      } else {
                        alert("Your discount request is pending review.");
                      }
                      return;
                    }
                    if (!discountAllLessonsDone) {
                      alert(
                        "Finish every lesson in Region 1 and Region 2 first to unlock the discount."
                      );
                      return;
                    }
                    await requestDiscount();
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
            }}
          >
            <defs>
              <radialGradient id="zone-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(230,192,122,0.35)" />
                <stop offset="60%" stopColor="rgba(230,192,122,0.12)" />
                <stop offset="100%" stopColor="rgba(230,192,122,0)" />
              </radialGradient>
              <radialGradient id="zone-glow-hot" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(240,213,149,0.55)" />
                <stop offset="60%" stopColor="rgba(240,213,149,0.2)" />
                <stop offset="100%" stopColor="rgba(240,213,149,0)" />
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
                          fontFamily: "Cormorant Garamond, serif",
                          fontStyle: "italic",
                          fontWeight: 600,
                          fontSize: 26,
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
                      y={24}
                      textAnchor="middle"
                      style={{
                        fontFamily: "Cormorant Garamond, serif",
                        fontStyle: "italic",
                        fontWeight: 500,
                        fontSize: 34,
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
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        fontSize: 13,
                        letterSpacing: "0.22em",
                        fill: isUnlocked ? GOLD : "rgba(230,220,200,0.62)",
                        textTransform: "uppercase",
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 3,
                        strokeLinejoin: "round",
                      }}
                    >
                      {isUnlocked
                        ? isComplete
                          ? `CHARTED · ${total}`
                          : `${completed} / ${total} LESSONS`
                        : "LOCKED"}
                    </text>

                    {/* Hover CTA — only shown for unlocked regions */}
                    {hot && (
                      <text
                        x={0}
                        y={76}
                        textAnchor="middle"
                        style={{
                          fontFamily: "JetBrains Mono, ui-monospace, monospace",
                          fontSize: 11,
                          letterSpacing: "0.28em",
                          fill: GOLD_HI,
                          textTransform: "uppercase",
                          paintOrder: "stroke fill",
                          stroke: "rgba(6,12,26,0.85)",
                          strokeWidth: 3,
                          strokeLinejoin: "round",
                        }}
                      >
                        ENTER REGION →
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Region side panel */}
      {focusedRegion && (
        <RegionSidePanel
          region={focusedRegion}
          lessons={focusedLessons}
          completedLessonIds={completedLessonIds}
          onOpenLesson={onOpenLesson}
          onBack={() => transitionTo("overview")}
          onPrev={prevRegion ? () => transitionTo(prevRegion.id as RegionId) : null}
          onNext={nextRegion ? () => transitionTo(nextRegion.id as RegionId) : null}
          width={sidePanelWidth}
        />
      )}

      {/* Cloud scene-swap transition — fires at peak coverage */}
      <CloudTransition
        trigger={transitionCounter}
        duration={2.0}
        onPeak={() => {
          const next = pendingViewRef.current;
          if (next != null) {
            setView(next);
            pendingViewRef.current = null;
          }
        }}
      />
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
  onBack,
  onPrev,
  onNext,
  width,
}: {
  region: ReturnType<typeof useStudent>["regions"][number];
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  onOpenLesson: (id: string) => void;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  width: number;
}) {
  const numeral = ["I", "II", "III", "IV"][region.order_num - 1];

  const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
  const total = lessons.length;

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width,
        background:
          "linear-gradient(180deg, rgba(6,12,26,0.96) 0%, rgba(10,20,40,0.96) 100%)",
        borderLeft: "1px solid rgba(230,192,122,0.25)",
        display: "flex",
        flexDirection: "column",
        animation: "slide-in-right 0.6s cubic-bezier(0.22,1,0.36,1) both",
        boxShadow: "-30px 0 60px rgba(0,0,0,0.5)",
      }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        className="btn-ghost flex items-center gap-2 px-6 py-4"
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid rgba(230,192,122,0.12)",
          color: "var(--color-ink-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
        </svg>
        Back to map
      </button>

      {/* Region header */}
      <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(230,192,122,0.12)" }}>
        <p
          className="font-mono uppercase mb-1"
          style={{
            color: GOLD,
            letterSpacing: "0.22em",
            fontSize: 11,
          }}
        >
          Region {numeral}
        </p>
        <h2
          className="italic"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: 34,
            color: INK,
            lineHeight: 1,
            marginBottom: 10,
          }}
        >
          {region.name}
        </h2>
        <p
          className="italic"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--color-ink-dim)",
            marginBottom: 16,
            lineHeight: 1.4,
          }}
        >
          {region.tagline}
        </p>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span
              className="font-mono"
              style={{
                color: GOLD_HI,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {completed} / {total} charted
            </span>
            <span
              className="font-mono"
              style={{
                color: "var(--color-ink-dim)",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              {region.days_label}
            </span>
          </div>
          <div
            style={{
              height: 3,
              background: "rgba(230,192,122,0.12)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: total > 0 ? `${(completed / total) * 100}%` : "0%",
                height: "100%",
                background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_HI} 100%)`,
                transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Lesson list — sequential lock model: lesson[k] is the next to do
          where k = number of completed lessons in this region. Anything
          past k is locked. The first found "not done" doubles as the
          current lesson regardless of currentLessonId. */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5"
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="space-y-2">
          {lessons.map((lesson, i) => {
            const isDone = completedLessonIds.has(lesson.id);
            // Sequential model — first not-done is the current lesson.
            // Everything past it is locked until the current one's done.
            const isCurrent = !isDone && i === completed;
            const isLocked = !isDone && !isCurrent;
            return (
              <button
                key={lesson.id}
                onClick={isLocked ? undefined : () => onOpenLesson(lesson.id)}
                disabled={isLocked}
                aria-disabled={isLocked || undefined}
                aria-label={
                  isLocked
                    ? `${lesson.title} — locked, finish previous lessons first`
                    : undefined
                }
                className={`w-full flex items-start gap-3 p-3 rounded-lg text-left ${isCurrent || isLocked ? "" : "btn-card-lift"}`}
                style={{
                  background: isCurrent
                    ? "rgba(230,192,122,0.16)"
                    : "rgba(6,12,26,0.4)",
                  border: `1px solid ${
                    isCurrent
                      ? "rgba(230,192,122,0.55)"
                      : isDone
                        ? "rgba(230,192,122,0.2)"
                        : "rgba(230,192,122,0.08)"
                  }`,
                  opacity: isLocked ? 0.45 : isDone && !isCurrent ? 0.7 : 1,
                  cursor: isLocked ? "not-allowed" : "pointer",
                }}
              >
                {/* Status indicator */}
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center mt-0.5"
                  style={{
                    width: 24,
                    height: 24,
                    background: isDone
                      ? GOLD
                      : isCurrent
                        ? "rgba(230,192,122,0.2)"
                        : "transparent",
                    border: isCurrent
                      ? `1.5px solid ${GOLD_HI}`
                      : !isDone
                        ? "1px solid rgba(230,220,200,0.28)"
                        : "none",
                  }}
                >
                  {isDone ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg-secondary)" strokeWidth="3" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div
                      className="pulse-ring"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: GOLD_HI,
                      }}
                    />
                  ) : isLocked ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11 V 7 a 4 4 0 0 1 8 0 V 11" />
                    </svg>
                  ) : (
                    <span
                      className="font-mono"
                      style={{
                        color: "var(--color-ink-dim)",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </span>
                  )}
                </div>

                {/* Lesson title + meta */}
                <div className="flex-1 min-w-0">
                  <p
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: 15,
                      fontWeight: 500,
                      color: INK,
                      lineHeight: 1.25,
                      marginBottom: 3,
                    }}
                  >
                    {MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-mono uppercase"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.16em",
                        color: isCurrent
                          ? GOLD
                          : "var(--color-ink-dim)",
                      }}
                    >
                      {LESSON_TYPE_LABELS[lesson.type]}
                    </span>
                    {lesson.duration_label && (
                      <>
                        <span style={{ color: "var(--color-ink-faint)", fontSize: 10 }} aria-hidden="true">
                          ·
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 11,
                            color: "var(--color-ink-dim)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {lesson.duration_label}
                        </span>
                      </>
                    )}
                    {lesson.is_gate && (
                      <span
                        className="font-mono uppercase"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          color: GOLD_HI,
                          background: "rgba(230,192,122,0.12)",
                          padding: "2px 6px",
                          borderRadius: 3,
                        }}
                      >
                        Discount
                      </span>
                    )}
                    {lesson.is_boss && (
                      <span
                        className="font-mono uppercase"
                        style={{
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          color: "#F0A0A8",
                          background: "rgba(196,74,84,0.18)",
                          padding: "2px 6px",
                          borderRadius: 3,
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
      </div>

      {/* Prev / Next region footer */}
      <div
        className="flex"
        style={{ borderTop: "1px solid rgba(230,192,122,0.15)" }}
      >
        <button
          onClick={onPrev ?? undefined}
          disabled={!onPrev}
          className={`flex-1 px-5 py-4 text-left ${onPrev ? "btn-tinted" : ""}`}
          style={{
            background: "transparent",
            border: "none",
            borderRight: "1px solid rgba(230,192,122,0.12)",
            color: onPrev ? "var(--color-ink)" : "var(--color-ink-faint)",
            cursor: onPrev ? "pointer" : "default",
          }}
        >
          <p
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "var(--color-ink-dim)",
            }}
          >
            Previous
          </p>
          <p
            className="italic"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            ← {onPrev ? "Go back" : "—"}
          </p>
        </button>
        <button
          onClick={onNext ?? undefined}
          disabled={!onNext}
          className={`flex-1 px-5 py-4 text-right ${onNext ? "btn-tinted" : ""}`}
          style={{
            background: "transparent",
            border: "none",
            color: onNext ? "var(--color-ink)" : "var(--color-ink-faint)",
            cursor: onNext ? "pointer" : "default",
          }}
        >
          <p
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "var(--color-ink-dim)",
            }}
          >
            Next region
          </p>
          <p
            className="italic"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {onNext ? "Onward" : "—"} →
          </p>
        </button>
      </div>
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
  /** Optional second marker drawn ABOVE the primary endMarker. Used on
      R2 to surface the discount-claim CTA separately from the onward
      transition button. */
  secondaryMarker?: SceneEndMarker;
  onSecondaryMarkerClick?: () => void;
}

function ScenePathOverlay({
  scene,
  lessons,
  completedLessonIds,
  currentLessonId,
  onOpenLesson,
  endMarker,
  onEndMarkerClick,
  secondaryMarker,
  onSecondaryMarkerClick,
}: ScenePathOverlayProps) {
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

    // Inset from each end so nothing sits near the scene's image edges
    // (which are often cropped by the viewport's aspect ratio) or crowds
    // the end marker. 10% of total, capped at 200 map-units — enough to
    // keep the first lesson off the bottom on R2/R3 and the last lesson
    // clear of the "Onward" marker on R1.
    const edgeInset = Math.min(200, total * 0.1);
    const usableLen = total - edgeInset * 2;

    return lessons.map((_, i) => {
      const t = N === 1 ? 0.5 : i / (N - 1);
      const target = edgeInset + usableLen * t;
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
      }}
    >
      {/* No path line — just the lesson nodes sitting on the painted trail */}

      {/* Lesson nodes (skipping the last waypoint). Node size scales with
          y: lessons further up the scene (smaller y, "further away") render
          smaller to suggest depth. */}
      {lessonPositions.map((pos, i) => {
        const lesson = lessons[i];
        if (!lesson || !pos) return null;
        const isDone = completedLessonIds.has(lesson.id);
        const isCurrent = lesson.id === currentLessonId;
        const isAction = isActionItem(lesson);
        const displayTitle =
          MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
        const size = perspectiveSize(pos.y);
        return (
          <LessonMarker
            key={lesson.id}
            x={pos.x}
            y={pos.y}
            index={i + 1}
            isDone={isDone}
            isCurrent={isCurrent}
            isAction={isAction}
            title={displayTitle}
            size={size}
            onClick={() => onOpenLesson(lesson.id)}
          />
        );
      })}

      {/* Secondary marker — drawn slightly ABOVE the primary so the two
          read as a stack: claim first, then onward. Used on R2 for the
          discount-claim button alongside the onward transition. */}
      {secondaryMarker && lastWaypoint && (
        <EndMarker
          x={lastWaypoint.x}
          y={lastWaypoint.y - 130}
          marker={secondaryMarker}
          onClick={onSecondaryMarkerClick}
        />
      )}

      {/* End marker on the last waypoint */}
      {endMarker && lastWaypoint && (
        <EndMarker
          x={lastWaypoint.x}
          y={lastWaypoint.y}
          marker={endMarker}
          onClick={onEndMarkerClick}
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
  return 26 * eased; // base 26 px (matches previous LessonMarker size)
}

interface LessonMarkerProps {
  x: number;
  y: number;
  index: number;
  isDone: boolean;
  isCurrent: boolean;
  isAction: boolean;
  title: string;
  /** Base radius for circle / half-width for diamond. Drives perspective. */
  size: number;
  onClick: () => void;
}

function LessonMarker({
  x,
  y,
  index,
  isDone,
  isCurrent,
  isAction,
  title,
  size: baseSize,
  onClick,
}: LessonMarkerProps) {
  const [hot, setHot] = useState(false);
  const fill = isDone
    ? GOLD
    : isCurrent
      ? "rgba(230,192,122,0.25)"
      : "rgba(6,12,26,0.92)";
  const stroke = isCurrent ? GOLD_HI : GOLD;
  // Action items are visually larger than lessons, proportional to base
  const size = isAction ? baseSize * 1.23 : baseSize;

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor: "pointer", pointerEvents: "auto" }}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
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
      {/* Pulsing ring for current */}
      {isCurrent && (
        <circle
          r={size + 6}
          fill="none"
          stroke={GOLD_HI}
          strokeWidth={2}
          opacity={0.6}
        >
          <animate
            attributeName="r"
            values={`${size + 2};${size + 14};${size + 2}`}
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.15;0.7;0.15"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Hover glow */}
      {hot && (
        <circle
          r={size + 4}
          fill="rgba(240,213,149,0.25)"
          style={{ transition: "opacity 0.2s" }}
        />
      )}

      {/* Marker shape — circle for lessons, diamond for action items */}
      {isAction ? (
        <rect
          x={-size * 0.75}
          y={-size * 0.75}
          width={size * 1.5}
          height={size * 1.5}
          transform="rotate(45)"
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
        />
      ) : (
        <circle
          r={size}
          fill={fill}
          stroke={stroke}
          strokeWidth={isCurrent ? 3 : 2}
        />
      )}

      {/* Inner glyph */}
      {isDone ? (
        <path
          d="M -9 0 L -2 7 L 10 -7"
          fill="none"
          stroke="#0A1428"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : isAction ? (
        // Small lightning / action glyph
        <path
          d="M -5 -9 L 3 -2 L -1 -2 L 5 9 L -3 2 L 1 2 Z"
          fill={isCurrent ? GOLD_HI : GOLD}
          stroke="none"
        />
      ) : (
        <text
          y={6}
          textAnchor="middle"
          style={{
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 16,
            fontWeight: 600,
            fill: isCurrent ? GOLD_HI : GOLD,
          }}
        >
          {index}
        </text>
      )}

      {/* Hover label */}
      {hot && (
        <g transform={`translate(0 ${-(size + 18)})`} pointerEvents="none">
          <rect
            x={-120}
            y={-22}
            width={240}
            height={28}
            rx={4}
            fill="rgba(6,12,26,0.92)"
            stroke="rgba(230,192,122,0.3)"
            strokeWidth={1}
          />
          <text
            y={-3}
            textAnchor="middle"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
              fontSize: 16,
              fill: INK,
            }}
          >
            {title.length > 36 ? title.slice(0, 33) + "…" : title}
          </text>
        </g>
      )}
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
}: {
  x: number;
  y: number;
  marker: SceneEndMarker;
  onClick?: () => void;
}) {
  const [hot, setHot] = useState(false);
  const isClickable = !!onClick;
  const accent =
    marker.kind === "discount"
      ? "#4DCEC4"
      : marker.kind === "celebration"
        ? GOLD_HI
        : GOLD;

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{
        cursor: isClickable ? "pointer" : "default",
        pointerEvents: "auto",
      }}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
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
      {/* Pulsing aura */}
      <circle r={42} fill={accent} opacity={0.18}>
        <animate
          attributeName="r"
          values="38;52;38"
          dur="2.6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.1;0.28;0.1"
          dur="2.6s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Outer ring brightens on hover */}
      <circle
        r={36}
        fill="rgba(6,12,26,0.92)"
        stroke={accent}
        strokeWidth={hot ? 3.5 : 2.5}
        style={{ transition: "stroke-width 0.2s" }}
      />

      {/* Inner glyph */}
      {marker.kind === "onward" && (
        <path
          d="M -10 -8 L 8 0 L -10 8 L -6 0 Z"
          fill={accent}
          stroke="none"
        />
      )}
      {marker.kind === "discount" && (
        <g>
          {/* Percent symbol */}
          <circle cx={-7} cy={-7} r={4} fill="none" stroke={accent} strokeWidth={2.5} />
          <circle cx={7} cy={7} r={4} fill="none" stroke={accent} strokeWidth={2.5} />
          <line x1={-12} y1={12} x2={12} y2={-12} stroke={accent} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      )}
      {marker.kind === "celebration" && (
        <g>
          {/* Stylized trophy */}
          <path
            d="M -8 -10 L 8 -10 L 7 4 Q 7 8 0 8 Q -7 8 -7 4 Z"
            fill={accent}
            stroke="none"
          />
          <line x1={-3} y1={8} x2={3} y2={8} stroke={accent} strokeWidth={3} strokeLinecap="round" />
          <line x1={-5} y1={11} x2={5} y2={11} stroke={accent} strokeWidth={3} strokeLinecap="round" />
        </g>
      )}

      {/* Label below marker */}
      <g transform="translate(0 60)" pointerEvents="none">
        <text
          textAnchor="middle"
          y={0}
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 26,
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
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fill: accent,
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
