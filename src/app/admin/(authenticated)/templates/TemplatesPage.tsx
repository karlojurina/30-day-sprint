"use client";

import { TemplatesView } from "@/components/admin/templates/TemplatesView";
import { useAuth } from "@/contexts/AuthContext";
import { templatesTransport } from "@/lib/admin/templates-transport";

/**
 * The Templates page's loader: the signed-in member's role and the real
 * calls (src/lib/admin/templates-transport.ts). Every role reads the page;
 * founders and admins edit it, and every write's route checks that again.
 */
export function TemplatesPage() {
  const { teamMember } = useAuth();
  if (!teamMember) return null;
  return <TemplatesView transport={templatesTransport} role={teamMember.role} />;
}
