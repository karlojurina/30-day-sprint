import { DevStudents } from "../DevPeople";
import { readPeopleParams, type SearchParams } from "../people-params";

/**
 * /dev/admin/students: All students (src/components/admin/students/StudentsView.tsx)
 * over the real builder with made-up reads, and no login (admin rebuild 2, D9).
 *
 *   ?state=full | empty | loading | error | partial   (default full;
 *          partial: the progress and the course cannot be read)
 *   ?reload=fail   the list loads once, then every read of it fails
 */
export default async function DevStudentsPage({ searchParams }: { searchParams: SearchParams }) {
  const o = await readPeopleParams(searchParams);
  return <DevStudents state={o.state} reloadFails={o.reloadFails} role={o.role} />;
}
