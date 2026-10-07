"use client";

import Link from "next/link";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { Panel } from "@/components/world/AreaScreen";
import { mapIsSilent, useMapModel } from "@/components/world/useMapModel";
import u from "@/components/world/world-ui.module.css";

/**
 * What a place's address renders.
 *
 * Nothing, for a place that exists: the map opens its own panel, because the
 * stage reads the same address and tells it which place is open. This route
 * only has something to say when the address names a place the catalog does
 * not have.
 */
export function PlaceRoute({ areaId }: { areaId: string }) {
  const stage = useWorldStage();
  const { areas } = useWorldCatalog();
  const { status } = useMapModel();

  // While the course is loading, or did not arrive, the host's card says so.
  if (mapIsSilent(status)) return null;
  if (areas.some((a) => a.id === areaId)) return null;

  return (
    <Panel note>
      <p className={u.message}>That place isn&apos;t on the map.</p>
      <Link href={stage.href()} scroll={false} className={u.link}>
        <span aria-hidden="true">←</span>
        Back to the world
      </Link>
    </Panel>
  );
}
