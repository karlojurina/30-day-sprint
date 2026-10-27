"use client";

import { ThirtyView } from "@/components/admin/thirty/ThirtyView";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The 30% page with the signed-in team member's role (the owner's review,
 * 2026-10-21): Approve anyway is a founder's or an admin's, on every pending
 * row a check refuses, and since the 30% applies itself (T-137) so is Reject
 * on a request whose code may exist. POST /api/discounts/approve and
 * /api/discounts/reject refuse a csm there too, so this only decides what
 * the page offers.
 */
export function ThirtyPage() {
  const { teamMember } = useAuth();
  const canApproveAnyway = teamMember?.role === "founder" || teamMember?.role === "admin";
  return <ThirtyView canApproveAnyway={canApproveAnyway} />;
}
