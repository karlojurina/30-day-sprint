"use client";

import { use } from "react";
import { LessonScreen } from "@/components/world/LessonScreen";

export default function LessonPage({
  params,
}: {
  params: Promise<{ areaId: string; lessonId: string }>;
}) {
  const { areaId, lessonId } = use(params);
  return <LessonScreen areaId={areaId} lessonId={lessonId} />;
}
