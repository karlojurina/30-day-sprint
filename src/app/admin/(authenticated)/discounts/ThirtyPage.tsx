"use client";

import { ThirtyView } from "@/components/admin/thirty/ThirtyView";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The 30% page with the signed-in team member's role (the owner's review,
 * 2026-10-21): Approve anyway is a founder's or an admin's, on every Applied
 * row a check refuses. POST /api/discounts/approve refuses a csm's override
 * too, so this only decides what the page offers.
 */
export function ThirtyPage() {
  const { teamMember } = useAuth();
  const canApproveAnyway = teamMember?.role === "founder" || teamMember?.role === "admin";
  return <ThirtyView canApproveAnyway={canApproveAnyway} />;
}
