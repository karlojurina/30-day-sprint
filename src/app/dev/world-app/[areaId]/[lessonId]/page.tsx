"use client";

import { use } from "react";
import { LessonScreen } from "@/components/world/LessonScreen";
import { useFixtureTransport } from "../../fixtureTransport";

/**
 * Mirrors src/app/world/[areaId]/[lessonId]/page.tsx on the dev harness.
 * `devComplete` adds the "Mark watched (dev)" button: only the three lessons
 * that are given a test video can be finished by watching, and only when the
 * harness has the video ids. `transport` is the stand-in server
 * (fixtureTransport.ts), so the player asks this app for nothing.
 */
export default function WorldAppLessonPage({
  params,
}: {
  params: Promise<{ areaId: string; lessonId: string }>;
}) {
  const { areaId, lessonId } = use(params);
  const transport = useFixtureTransport();
  return <LessonScreen areaId={areaId} lessonId={lessonId} devComplete transport={transport} />;
}
