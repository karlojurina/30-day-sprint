"use client";

import { use } from "react";
import { LessonScreen } from "@/components/world/LessonScreen";

/**
 * Mirrors src/app/world/[areaId]/[lessonId]/page.tsx on the dev harness.
 * `devComplete` adds the "Mark watched (dev)" button: no fixture lesson has a
 * video, so nothing here can be finished by watching.
 */
export default function WorldAppLessonPage({
  params,
}: {
  params: Promise<{ areaId: string; lessonId: string }>;
}) {
  const { areaId, lessonId } = use(params);
  return <LessonScreen areaId={areaId} lessonId={lessonId} devComplete />;
}
