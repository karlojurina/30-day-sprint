import { DevTasks } from "../DevPeople";
import { readPeopleParams, type SearchParams } from "../people-params";

/**
 * /dev/admin/tasks: the Tasks page (src/components/admin/tasks/TasksView.tsx)
 * with made-up data and no login (admin rebuild 2, D7).
 *
 *   ?state=full | empty | loading | error   (default full)
 *   ?reset=none      the tasks reset has not run: no Archived tab
 *   ?reload=fail     the list loads once, then every read of it fails
 *   ?tab=todo | sent | dismissed | archived
 *   ?role=csm | founder | admin   whose Refresh (default csm)
 */
export default async function DevTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const o = await readPeopleParams(searchParams);
  return <DevTasks state={o.state} reset={o.reset} reloadFails={o.reloadFails} tab={o.tab} role={o.role} />;
}
