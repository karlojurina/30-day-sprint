"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DiscountStandInContext, type DiscountStandIn } from "@/components/world/useWorldDiscount";
import { requiredLessons, type DiscountLesson, type DiscountRequestRow } from "@/lib/world/discount";
import type { CatalogLessonLike } from "@/lib/world/catalog";

/**
 * The pretend student's early-finish discount on /dev/world-app
 * (FixtureStudentProvider.tsx), so every state of the checkpoint can be seen
 * and tested with no server: ?discount=<preset>, best with ?catalog=course.
 *
 *   ?discount=locked         first payment 3 days ago (11 days left), videos
 *                            as the ?p= preset has them
 *   ?discount=ready          first payment 5 days ago, every video the offer
 *                            asks for watched (added to the ?p= preset)
 *   ?discount=pending        as ready, and an application sent 2 hours ago
 *   ?discount=approved       as ready, and the application approved
 *   ?discount=expired        first payment 20 days ago, nothing applied for
 *   ?discount=before-launch  first payment on 2026-09-20, before the new course
 *   no ?discount             no first payment on record: the offer is not shown
 *
 * Apply resolves in memory after 600 ms: the application turns pending, as
 * the route's row would. No request leaves the page. The clock is the page's
 * load time, so the days left do not drift while a test runs.
 *
 * window.__fixtureDiscount: the preset and the requests, for the browser run.
 */

export type DiscountPreset = "locked" | "ready" | "pending" | "approved" | "expired" | "before-launch";
const PRESETS: readonly DiscountPreset[] = ["locked", "ready", "pending", "approved", "expired", "before-launch"];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The pretend Apply's wait, so the button's sending state can be seen. */
const APPLY_MS = 600;

export function discountPresetOf(search: string | null): DiscountPreset | null {
  if (search === null) return null;
  const v = new URLSearchParams(search).get("discount");
  return PRESETS.includes(v as DiscountPreset) ? (v as DiscountPreset) : null;
}

/**
 * The videos a preset needs watched on top of ?p=: for ready, pending and
 * approved, every lesson the offer asks for (discount.ts requiredLessons), so
 * the map's lanterns and counts agree with the panel.
 */
export function discountPresetIds(search: string | null, lessons: readonly CatalogLessonLike[]): string[] {
  const preset = discountPresetOf(search);
  if (preset !== "ready" && preset !== "pending" && preset !== "approved") return [];
  const course: DiscountLesson[] = [...lessons]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      id: l.id,
      type: l.type,
      counts_toward_progress: l.counts_toward_progress !== false,
      is_gate: l.is_gate === true,
      has_video: l.has_video === true,
      duration_seconds: l.duration_seconds ?? null,
    }));
  return requiredLessons(course).map((l) => l.id);
}

type FixtureDiscountWindow = Window & { __fixtureDiscount?: { preset: DiscountPreset | null; requests: () => DiscountRequestRow[] } };

export function FixtureDiscount({ search, children }: { search: string | null; children: ReactNode }) {
  const preset = discountPresetOf(search);
  // The page's load time: the presets count from it.
  const [boot] = useState(() => Date.now());
  const [sent, setSent] = useState<DiscountRequestRow[]>([]);

  const firstPaidAt = useMemo(() => {
    switch (preset) {
      case "locked":
        return new Date(boot - 3 * DAY_MS).toISOString();
      case "ready":
        return new Date(boot - 5 * DAY_MS).toISOString();
      case "pending":
      case "approved":
        return new Date(boot - 6 * DAY_MS).toISOString();
      case "expired":
        return new Date(boot - 20 * DAY_MS).toISOString();
      case "before-launch":
        return "2026-09-20T10:00:00.000Z";
      default:
        return null;
    }
  }, [preset, boot]);

  const requests = useMemo<DiscountRequestRow[]>(() => {
    const at = new Date(boot - 2 * HOUR_MS).toISOString();
    const base: DiscountRequestRow[] =
      preset === "pending"
        ? [{ id: "fixture-request", status: "pending", created_at: at }]
        : preset === "approved"
          ? [{ id: "fixture-request", status: "approved", created_at: at }]
          : [];
    return [...base, ...sent];
  }, [preset, boot, sent]);

  const apply = useCallback(async (): Promise<string | null> => {
    await new Promise((r) => setTimeout(r, APPLY_MS));
    setSent((prev) => (prev.length ? prev : [{ id: "fixture-sent", status: "pending", created_at: new Date().toISOString() }]));
    return null;
  }, []);

  const value = useMemo<DiscountStandIn>(() => ({ firstPaidAt, requests, apply }), [firstPaidAt, requests, apply]);

  useEffect(() => {
    const w = window as FixtureDiscountWindow;
    w.__fixtureDiscount = { preset, requests: () => value.requests.slice() };
    return () => {
      delete w.__fixtureDiscount;
    };
  }, [preset, value]);

  return <DiscountStandInContext.Provider value={value}>{children}</DiscountStandInContext.Provider>;
}
