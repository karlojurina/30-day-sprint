"use client";

import { TeamView } from "@/components/admin/team/TeamView";
import { useAuth } from "@/contexts/AuthContext";
import { teamTransport } from "@/lib/admin/team-transport";

/**
 * The Team page's loader: who is signed in, and the real calls
 * (src/lib/admin/team-transport.ts). A role other than founder sees one
 * line and nothing is read; the routes refuse it too.
 */
export function TeamPage() {
  const { teamMember } = useAuth();
  if (!teamMember) return null;
  return <TeamView transport={teamTransport} me={{ id: teamMember.id, role: teamMember.role }} />;
}
