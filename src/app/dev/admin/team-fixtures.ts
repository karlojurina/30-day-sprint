/**
 * Made-up data for /dev/admin/team (admin rebuild 2, WI-9). Development
 * only: the dev layout calls notFound() anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every name and email
 * below is invented, on example.com.
 *
 *   ?state=full | empty | loading | error   (default full)
 */

import type { Answer } from "@/lib/admin/admin-transport";
import type { InviteFields, TeamRole, TeamRow, TeamTransport } from "@/lib/admin/team-data";

export type TeamFixtureState = "full" | "empty" | "loading" | "error";

const STATES: TeamFixtureState[] = ["full", "empty", "loading", "error"];

export function parseTeamState(value: string | null): TeamFixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

/** The founder the dev page signs in as. */
export const DEV_FOUNDER_ID = "tm-robin";

function members(): TeamRow[] {
  return [
    { id: DEV_FOUNDER_ID, email: "robin.hale@example.com", full_name: "Robin Hale", role: "founder", created_at: "2026-05-01T09:00:00.000Z" },
    { id: "tm-jamie", email: "jamie.rowe@example.com", full_name: "Jamie Rowe", role: "admin", created_at: "2026-05-20T09:00:00.000Z" },
    { id: "tm-sam", email: "sam.lee@example.com", full_name: "Sam Lee", role: "csm", created_at: "2026-06-12T09:00:00.000Z" },
    {
      id: "tm-max",
      email: "maximilian.featherstonehaugh-smythe@example.com",
      full_name: "Maximilian Featherstonehaugh-Smythe",
      role: "csm",
      created_at: "2026-10-01T09:00:00.000Z",
    },
  ];
}

/** The Team page's calls, answered from the made-up list a moment later. */
export function fixtureTeamTransport(state: TeamFixtureState): TeamTransport & { calls: Array<{ name: string; args: unknown[] }> } {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  let list = state === "empty" ? [] : members();
  let n = 0;
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 250));
  return {
    calls,
    list() {
      calls.push({ name: "list", args: [] });
      if (state === "loading") return new Promise<Answer<TeamRow[]>>(() => {});
      if (state === "error") return later<TeamRow[]>({ ok: false, status: 500, error: "permission denied for table team_members" });
      return later({ ok: true, status: 200, data: list.map((m) => ({ ...m })) });
    },
    invite(f: InviteFields) {
      calls.push({ name: "invite", args: [f] });
      const email = f.email.trim().toLowerCase();
      if (list.some((m) => m.email === email)) return later<TeamRow>({ ok: false, status: 409, error: `${email} is already a team member` });
      const row: TeamRow = { id: `tm-new-${++n}`, email, full_name: f.full_name.trim(), role: f.role, created_at: "2026-10-20T08:30:00.000Z" };
      list = [...list, row];
      return later({ ok: true, status: 200, data: row });
    },
    changeRole(id: string, role: TeamRole) {
      calls.push({ name: "changeRole", args: [id, role] });
      const m = list.find((x) => x.id === id);
      if (!m) return later<TeamRow>({ ok: false, status: 500, error: "Failed to update team member" });
      if (id === DEV_FOUNDER_ID && role !== "founder") return later<TeamRow>({ ok: false, status: 400, error: "Cannot demote your own founder role" });
      m.role = role;
      return later({ ok: true, status: 200, data: { ...m } });
    },
    remove(id: string) {
      calls.push({ name: "remove", args: [id] });
      if (id === DEV_FOUNDER_ID) return later<{ warning: string | null }>({ ok: false, status: 400, error: "Cannot remove yourself" });
      list = list.filter((x) => x.id !== id);
      return later({ ok: true, status: 200, data: { warning: null } });
    },
  };
}
