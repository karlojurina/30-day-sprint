"use client";

import { use } from "react";
import { PlaceRoute } from "@/components/world/PlaceRoute";

/** Mirrors src/app/world/[areaId]/page.tsx on the dev harness. */
export default function WorldAppAreaPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = use(params);
  return <PlaceRoute areaId={areaId} />;
}
