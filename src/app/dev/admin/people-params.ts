import { parsePeopleState, type PeopleState } from "./fixtures-people";
import type { TaskTab } from "@/lib/admin/tasks-view";

/**
 * The address of the dev pages of lane WI-5 and WI-6, read on the server
 * (fixtures-people.ts says what each value does).
 */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function readPeopleParams(searchParams: SearchParams) {
  const p = await searchParams;
  const tabs: Record<string, TaskTab> = { todo: "open", sent: "completed", dismissed: "dismissed", archived: "archived" };
  const roleValue = one(p.role);
  const role: "founder" | "admin" | "csm" = roleValue === "founder" || roleValue === "admin" ? roleValue : "csm";
  return {
    state: parsePeopleState(one(p.state)) as PeopleState,
    reset: one(p.reset) !== "none",
    reloadFails: one(p.reload) === "fail",
    later: one(p.at) === "later",
    drawer: one(p.drawer),
    tab: tabs[one(p.tab) ?? ""] ?? "open",
    role,
  };
}
