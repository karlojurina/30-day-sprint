"use client";

import { use } from "react";
import { AreaScreen } from "@/components/world/AreaScreen";

export default function AreaPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = use(params);
  return <AreaScreen areaId={areaId} />;
}
