import { DevStudent } from "../../DevPeople";
import { readPeopleParams, type SearchParams } from "../../people-params";

/**
 * /dev/admin/students/<id>: one student
 * (src/components/admin/students/StudentDetailView.tsx) over the real
 * builder with made-up reads, and no login (admin rebuild 2, D9). The ids
 * are fixtures-people.ts's: p-maya (synced since the switch), p-jonah (not
 * synced since the switch), p-priya (never synced), p-sofia (canceling, a
 * Whop note), p-iris (no name, left out of the tasks); any other id is not
 * found.
 *
 *   ?state=full | loading | error | partial   (default full; partial: every
 *          read but the student's own fails)
 */
export default async function DevStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const o = await readPeopleParams(searchParams);
  return <DevStudent id={id} state={o.state} role={o.role} />;
}
