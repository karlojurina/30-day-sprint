import { JourneyView } from "@/components/admin/journey/JourneyView";

/**
 * /admin/journey: the Student journey (admin rebuild 2, D8). The page itself
 * is src/components/admin/journey/JourneyView.tsx, which reads the database
 * with the team member's session through src/lib/admin/journey-board.ts;
 * this server wrapper gives the tab its title.
 */

export const metadata = {
  title: "Student journey · Ecom University",
};

export default function JourneyPage() {
  return <JourneyView />;
}
