"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { CutoverView, type CutoverStatus } from "@/components/admin/cutover/CutoverView";

/**
 * /dev/admin/cutover: the course switch's status page
 * (src/components/admin/cutover/CutoverView.tsx) with made-up answers and no
 * login, in the dark look (admin rebuild 2, the render review's fix round).
 *
 *   ?state=after     the switch ran and the build agrees (default)
 *          before    the old course is live
 *          problems  two problems found
 *          error     the status could not be read
 *          loading   the first check has not answered
 *
 * Made-up values only: no real deployment, commit or Whop id. The answer
 * comes a moment after the page is drawn, as the real page's fetch does: the
 * times are written in the browser's own locale, which the server's render
 * would not match.
 */

const DEV_MEMBER = { full_name: "Jamie Rowe", role: "founder" } as const;
/** The moment the dev page says it checked: Tue 20 Oct, 10:30 in Croatia. */
const CHECKED = new Date("2026-10-20T08:30:00.000Z");

const AFTER: CutoverStatus = {
  ok: true,
  phase: "after",
  problems: [],
  build: {
    studentHome: "/world",
    worldLive: true,
    catalogIsV2: true,
    catalogTable: "lessons",
    tableSuffix: "",
    whopCourseIdSet: true,
    whopCourseIdTail: "Q7x2",
    deploymentId: "dpl_devExample01",
    commit: "0a1b2c3",
  },
  db: {
    resetAt: "2026-10-19T14:33:00.000Z",
    regionIds: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"],
    lessons: 141,
    countingLessons: 140,
    lessonsWithWhopId: 141,
  },
};

const BEFORE: CutoverStatus = {
  ...AFTER,
  phase: "before",
  build: { ...AFTER.build, studentHome: "/dashboard", worldLive: false, catalogIsV2: false, tableSuffix: "" },
  db: { ...AFTER.db, resetAt: null, regionIds: ["r1", "r2", "r3", "r4"], lessons: 64, countingLessons: 64, lessonsWithWhopId: 0 },
};

const PROBLEMS: CutoverStatus = {
  ...AFTER,
  ok: false,
  problems: [
    "The build reads the catalog from lessons_next: CATALOG_TABLE_SUFFIX is still set.",
    "12 lessons have no Whop lesson id, so watching them on Whop lights nothing on the map.",
  ],
  build: { ...AFTER.build, catalogTable: "lessons_next", tableSuffix: "_next" },
  db: { ...AFTER.db, lessonsWithWhopId: 129 },
};

function DevCutover() {
  const state = useSearchParams().get("state") ?? "after";
  const [checks, setChecks] = useState(0);
  /** The made-up answer has come (never, for ?state=loading). */
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (state === "loading") return;
    const t = setTimeout(() => setAnswered(true), 300);
    return () => clearTimeout(t);
  }, [state]);
  const status = state === "before" ? BEFORE : state === "problems" ? PROBLEMS : state === "after" ? AFTER : null;
  return (
    <>
      <AdminTopNav member={DEV_MEMBER} pathname="/admin/cutover" onSignOut={() => {}} />
      <CutoverView
        status={answered && state !== "error" ? status : null}
        error={answered && state === "error" ? "The status could not be read (HTTP 500)." : null}
        loading={!answered}
        checkedAt={answered ? CHECKED : null}
        onCheck={() => setChecks((n) => n + 1)}
      />
      <span hidden data-checks={checks} />
    </>
  );
}

export default function DevCutoverPage() {
  return (
    <Suspense fallback={null}>
      <DevCutover />
    </Suspense>
  );
}
