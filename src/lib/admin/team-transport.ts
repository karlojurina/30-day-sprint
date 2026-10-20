"use client";

import { callRoute } from "@/lib/admin/call-route";
import type { TeamRow, TeamTransport } from "@/lib/admin/team-data";

/** The Team page's real calls (admin rebuild 2, WI-9), each a founder-only route. */
export const teamTransport: TeamTransport = {
  async list() {
    const r = await callRoute<{ teamMembers?: TeamRow[] }>("GET", "/api/admin/team-members");
    return r.ok ? { ...r, data: r.data?.teamMembers ?? [] } : r;
  },
  async invite(fields) {
    const r = await callRoute<{ teamMember: TeamRow }>("POST", "/api/admin/team-members", {
      email: fields.email.trim(),
      full_name: fields.full_name.trim(),
      role: fields.role,
    });
    return r.ok ? { ...r, data: r.data.teamMember } : r;
  },
  async changeRole(id, role) {
    const r = await callRoute<{ teamMember: TeamRow }>("PATCH", `/api/admin/team-members/${encodeURIComponent(id)}`, { role });
    return r.ok ? { ...r, data: r.data.teamMember } : r;
  },
  async remove(id) {
    const r = await callRoute<{ warning?: string }>("DELETE", `/api/admin/team-members/${encodeURIComponent(id)}`);
    return r.ok ? { ...r, data: { warning: typeof r.data?.warning === "string" ? r.data.warning : null } } : r;
  },
};
