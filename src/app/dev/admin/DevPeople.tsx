"use client";

import { useEffect, useState } from "react";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { TasksView } from "@/components/admin/tasks/TasksView";
import { InsightsView } from "@/components/admin/tasks/InsightsView";
import { StudentsView } from "@/components/admin/students/StudentsView";
import { StudentDetailView } from "@/components/admin/students/StudentDetailView";
import { JourneyView } from "@/components/admin/journey/JourneyView";
import type { TaskTab } from "@/lib/admin/tasks-view";
import {
  fixtureInsightsTransport,
  fixturePeopleTransport,
  fixtureTasksTransport,
  type PeopleCall,
  type PeopleState,
} from "./fixtures-people";

/**
 * The dev pages of admin rebuild 2's lane WI-5 and WI-6: each real view,
 * under the real top bar, with the stand-ins of fixtures-people.ts and no
 * login. The server pages beside them read the address and hand these the
 * options. The calls a page made are on window.__peopleCalls, for
 * world-tests.
 */

type Role = "founder" | "csm" | "admin";
const MEMBER: Record<Role, { full_name: string; role: Role }> = {
  founder: { full_name: "Jamie Rowe", role: "founder" },
  csm: { full_name: "Robin Hale", role: "csm" },
  admin: { full_name: "Alex Moreno", role: "admin" },
};

function useCalls(calls: PeopleCall[]) {
  useEffect(() => {
    window.__peopleCalls = calls;
  }, [calls]);
}

function Bar({ role, pathname }: { role: Role; pathname: string }) {
  return <AdminTopNav member={MEMBER[role]} pathname={pathname} onSignOut={() => {}} />;
}

export function DevTasks(o: { state: PeopleState; reset: boolean; reloadFails: boolean; tab: TaskTab; role: Role }) {
  const [t] = useState(() => fixtureTasksTransport({ state: o.state, reset: o.reset, reloadFails: o.reloadFails }));
  useCalls(t.calls);
  return (
    <>
      <Bar role={o.role} pathname="/admin/tasks" />
      <TasksView transport={t} role={o.role} initialTab={o.tab} />
    </>
  );
}

export function DevInsights(o: { state: PeopleState; reset: boolean; role: Role }) {
  const [t] = useState(() => fixtureInsightsTransport({ state: o.state, reset: o.reset }));
  useCalls(t.calls);
  return (
    <>
      <Bar role={o.role} pathname="/admin/tasks/insights" />
      <InsightsView transport={t} />
    </>
  );
}

export function DevStudents(o: { state: PeopleState; reloadFails: boolean; role: Role }) {
  const [t] = useState(() => fixturePeopleTransport({ state: o.state, reloadFails: o.reloadFails }));
  useCalls(t.calls);
  return (
    <>
      <Bar role={o.role} pathname="/admin/students" />
      <StudentsView transport={t} />
    </>
  );
}

export function DevStudent(o: { id: string; state: PeopleState; role: Role }) {
  const [t] = useState(() => fixturePeopleTransport({ state: o.state }));
  useCalls(t.calls);
  return (
    <>
      <Bar role={o.role} pathname="/admin/students" />
      <StudentDetailView studentId={o.id} transport={t} />
    </>
  );
}

export function DevJourney(o: { state: PeopleState; later: boolean; drawer: string | null; role: Role }) {
  const [t] = useState(() => fixturePeopleTransport({ state: o.state, later: o.later }));
  useCalls(t.calls);
  return (
    <>
      <Bar role={o.role} pathname="/admin/journey" />
      <JourneyView transport={t} initialStudent={o.drawer} />
    </>
  );
}
