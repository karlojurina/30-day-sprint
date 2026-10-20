/**
 * The Team page's shapes and rules (admin rebuild 2, WI-9). No React and no
 * browser client: client-tests/team-page.test.mjs checks the rules as they
 * are. The real calls are src/lib/admin/team-transport.ts; the dev page
 * /dev/admin/team hands the same view made-up ones
 * (src/app/dev/admin/team-fixtures.ts).
 *
 * The routes behind it (/api/admin/team-members and /[id]) are founder only
 * and refuse the same things the page holds back: a founder demoting or
 * removing themselves.
 */

import type { Answer } from "./types-erased.ts";

export type TeamRole = "founder" | "admin" | "csm";

export interface TeamRow {
  id: string;
  email: string;
  full_name: string;
  role: TeamRole;
  created_at: string;
}

export const ROLE_OPTIONS: Array<{ value: TeamRole; label: string; description: string }> = [
  { value: "founder", label: "Founder", description: "Everything, including this page." },
  { value: "admin", label: "Admin", description: "Everything except this page." },
  { value: "csm", label: "CSM", description: "Tasks, students and the journey." },
];

/** The invite field's example address: the team's own domain since the rename. */
export const INVITE_PLACEHOLDER = "name@ecomuniversity.com";

export interface InviteFields {
  email: string;
  full_name: string;
  role: TeamRole;
}

export interface TeamTransport {
  /** GET /api/admin/team-members, oldest first. */
  list(): Promise<Answer<TeamRow[]>>;
  /** POST /api/admin/team-members: Supabase emails the invite. */
  invite(fields: InviteFields): Promise<Answer<TeamRow>>;
  /** PATCH /api/admin/team-members/:id with { role }. */
  changeRole(id: string, role: TeamRole): Promise<Answer<TeamRow>>;
  /** DELETE /api/admin/team-members/:id. `warning`: the row went but the login could not be deleted. */
  remove(id: string): Promise<Answer<{ warning: string | null }>>;
}

/** A founder cannot change their own role here (the route refuses it too). */
export function roleLocked(member: Pick<TeamRow, "id" | "role">, meId: string | null): boolean {
  return member.id === meId && member.role === "founder";
}

/** Nobody can remove themselves (the route refuses it too). */
export function canRemove(member: Pick<TeamRow, "id">, meId: string | null): boolean {
  return member.id !== meId;
}

/** What is wrong with an invite before it is sent, or null. */
export function inviteProblem(f: InviteFields): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter a full email address.";
  if (!f.full_name.trim()) return "Enter their full name.";
  return null;
}
