"use client";

import { useStudent } from "@/contexts/StudentContext";
import { CornerLink } from "./WorldCorner";

/**
 * The Playbook, from the map (cutover PRD, Work Item 8): a link to
 * /dashboard/playbook labelled "Playbook" in the corner's pill, for a student
 * who has it, and nothing for anyone else. "Has it" is StudentContext's
 * playbookUnlocked, the same verdict the Playbook page lets them in on
 * (isPlaybookUnlocked in src/lib/progress.ts). The old map's links to it
 * (StatsWidget, MapMockup) go with the old map in WI-12.
 *
 * WorldMap.tsx passes it to WorldCorner as `playbook`; the corner's slot has
 * no line and no width while this renders nothing (corner.module.css .slot).
 */
export function PlaybookLink() {
  const { playbookUnlocked } = useStudent();
  if (!playbookUnlocked) return null;
  return <CornerLink href="/dashboard/playbook">Playbook</CornerLink>;
}
