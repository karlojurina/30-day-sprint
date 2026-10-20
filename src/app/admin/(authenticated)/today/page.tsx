import { TodayView } from "@/components/admin/today/TodayView";

/**
 * /admin/today: Today, the students who need a message (admin rebuild PRD,
 * work item 4). Signing in lands here (call C2). The page itself is
 * src/components/admin/today/TodayView.tsx, a client component that reads
 * GET /api/admin/today with the team member's token; this server wrapper
 * exists to give the tab its title, which the client layout above it
 * cannot.
 */

export const metadata = {
  title: "Today · Ecom University",
};

export default function TodayPage() {
  return <TodayView />;
}
