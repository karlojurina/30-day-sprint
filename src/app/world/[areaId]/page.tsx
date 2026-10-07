"use client";

import { use } from "react";
import { PlaceRoute } from "@/components/world/PlaceRoute";

export default function AreaPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = use(params);
  return <PlaceRoute areaId={areaId} />;
}
