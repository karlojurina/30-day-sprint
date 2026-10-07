"use client";

import Link from "next/link";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";
import { useWorldStage } from "@/components/world/WorldStage";
import { Panel } from "@/components/world/AreaScreen";
import { mapIsSilent, useMapModel } from "@/components/world/useMapModel";

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
    <Panel>
      <p style={{ margin: 0, opacity: 0.8 }}>That place isn&apos;t on the map.</p>
      <Link href={stage.href()} scroll={false} style={linkStyle}>
        Back to the world
      </Link>
    </Panel>
  );
}

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  color: "rgba(246,239,230,.75)",
  font: "500 13px ui-sans-serif, system-ui, sans-serif",
  textDecoration: "none",
};
