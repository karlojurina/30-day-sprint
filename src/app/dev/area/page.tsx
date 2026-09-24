"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/world/AreaScreen";
import { AreaLessonList } from "@/components/world/AreaLessonList";
import type { CatalogLessonLike } from "@/lib/world/catalog";

/**
 * Development-only: the area screen at both ends of the real size spread.
 *
 * The locked catalog runs 8 lessons (Introduction) to 25 (Static Ads). That
 * 3.1x spread gets exercised on day one, and whether either end reads as
 * crammed or as empty is not answerable by reading the code. Render both and
 * look.
 *
 * ?size=8 | ?size=25 — default 25, the harder one.
 */
export default function DevAreaPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  // useSearchParams suspends, so it needs a boundary.
  return (
    <Suspense fallback={null}>
      <DevArea />
    </Suspense>
  );
}

function make(n: number, prefix: string): CatalogLessonLike[] {
  const titles = [
    "Why static ads still outperform",
    "Reading a winning ad in 30 seconds",
    "The hook is the whole ad",
    "Building your swipe file properly",
    "Figma setup for ad creative",
    "Type that survives a 400px feed",
    "Colour without a brand guide",
    "The three layouts that always work",
    "Writing the line before the layout",
    "Product shots on a phone",
    "Backgrounds that do not fight the product",
    "Before and after, honestly",
    "Social proof that is not a fake review",
    "Claims you cannot make",
    "The offer block",
    "Testing five statics at once",
    "Reading the numbers after 48 hours",
    "Iterating the winner, not the loser",
    "When to kill a concept",
    "Batching a week of statics",
    "Handing files to a brand",
    "Pricing static work",
    "The revision conversation",
    "Building the portfolio piece",
    "Your first paid static",
  ];
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}l${String(i + 1).padStart(2, "0")}`,
    region_id: prefix,
    type: "watch",
    title: titles[i % titles.length],
    description: null,
    sort_order: i + 1,
    requires_action: i === 7 || i === 15 || i === 23,
    action_brief: "Ship one.",
    is_optional: false,
    is_gate: i === n - 1,
    counts_toward_progress: true,
    feature_key: null,
    bunny_video_id: i % 3 === 0 ? "fake-guid" : null,
    duration_seconds: 300 + ((i * 137) % 900),
  }));
}

function DevArea() {
  // useSearchParams, not window.location. Reading window during render makes
  // the server and client disagree (a hydration mismatch, which also means the
  // screenshot captures a re-rendered tree); setState in an effect avoids that
  // but trips react-hooks/set-state-in-effect. This does neither.
  const size = useSearchParams().get("size") === "8" ? 8 : 25;
  const lessons = make(size, "a5");
  const done = new Set(lessons.slice(0, Math.floor(size * 0.4)).map((l) => l.id));
  const partial = lessons[Math.floor(size * 0.4)]?.id;

  return (
    <div style={{ minHeight: "100vh", background: "#1d1826" }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, font: "700 24px/1.15 ui-sans-serif, system-ui, sans-serif", letterSpacing: "-0.02em" }}>
            {size === 8 ? "Introduction" : "Static Ads"}
          </h1>
          <span style={{ opacity: 0.6, font: "400 13px ui-sans-serif, system-ui, sans-serif" }}>
            {done.size} of {size} done
          </span>
        </div>
        <div style={{ height: 3, borderRadius: 2, background: "rgba(246,239,230,.12)", margin: "16px 0 4px" }}>
          <div style={{ height: "100%", width: `${(done.size / size) * 100}%`, borderRadius: 2, background: "rgba(232,168,106,.85)" }} />
        </div>
        <AreaLessonList
          areaId="a5"
          lessons={lessons}
          stateFor={(id) => ({
            done: done.has(id),
            position: id === partial ? 260 : 0,
            reportedDuration: null,
            hasVideo: Boolean(lessons.find((l) => l.id === id)?.bunny_video_id),
          })}
        />
      </Panel>
    </div>
  );
}
