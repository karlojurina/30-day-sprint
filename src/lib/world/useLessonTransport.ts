"use client";

import { createContext, useContext, useLayoutEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { realLessonTransport } from "@/lib/world/lesson-transport";
import { withEmbedCache, type CachedLessonTransport } from "@/lib/world/embed-cache";

/**
 * The page's one lesson transport, behind the embed cache (embed-cache.ts).
 *
 * The map asks for a lesson's address before the click and the lesson page's
 * player asks again on mount. They must hold the SAME cache, or the map warms
 * one the player never reads. So both take it from here: the map's host
 * (WorldMap.tsx) and the lesson page (LessonScreen.tsx).
 *
 * /world provides nothing and gets the real calls, cached once for the life of
 * the page. The development harness provides its stand-in server's transport,
 * cached the same way (FixtureStudentProvider.tsx).
 *
 * WHO MAY HOLD THE ADDRESSES. Every caller tells the cache who is signed in
 * and whether their membership is active, from AuthContext's `student` (its
 * `id` and `membership_status`, the same field MembershipBlockOverlay reads):
 * another student, a sign-out or a membership that is not "active" empties
 * it. It is told in a layout effect, which runs before any effect that asks
 * for an address (the player asks from a passive effect, the map from events
 * and from its own effects). The development harness has no signed-in
 * student: its pretend one stands in through LessonAccessContext.
 *
 * The cache is made when this module loads, on the server too, where nothing
 * ever asks it anything: every ask is made from an effect or an event.
 */
const realCached: CachedLessonTransport = withEmbedCache(realLessonTransport);

export const LessonTransportContext = createContext<CachedLessonTransport | null>(null);

export interface LessonAccess {
  /** The signed-in student's id, or null when nobody is. */
  studentId: string | null;
  /** Their membership_status is "active". */
  active: boolean;
}

/** The development harness's pretend student. /world provides nothing and reads AuthContext. */
export const LessonAccessContext = createContext<LessonAccess | null>(null);

/** Who is signed in and whether their membership is active. */
export function useLessonAccess(): LessonAccess {
  const { student } = useAuth();
  const stand = useContext(LessonAccessContext);
  if (stand) return stand;
  return { studentId: student?.id ?? null, active: student?.membership_status === "active" };
}

export function useLessonTransport(): CachedLessonTransport {
  const transport = useContext(LessonTransportContext) ?? realCached;
  const { studentId, active } = useLessonAccess();
  useLayoutEffect(() => {
    transport.setAccess(studentId, active);
  }, [transport, studentId, active]);
  return transport;
}
