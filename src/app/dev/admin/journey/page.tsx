import { DevJourney } from "../DevPeople";
import { readPeopleParams, type SearchParams } from "../people-params";

/**
 * /dev/admin/journey: the Student journey
 * (src/components/admin/journey/JourneyView.tsx) over the real builder with
 * made-up reads, and no login (admin rebuild 2, D8).
 *
 *   ?state=full | empty | loading | error | partial   (default full;
 *          partial: the progress, the areas and the course cannot be read)
 *   ?at=later        read on 12 November: weeks 3 and 4 and Month 2+ fill up
 *   ?drawer=<id>     a student's drawer open from the start (p-maya ...)
 */
export default async function DevJourneyPage({ searchParams }: { searchParams: SearchParams }) {
  const o = await readPeopleParams(searchParams);
  return <DevJourney state={o.state} later={o.later} drawer={o.drawer} role={o.role} />;
}
