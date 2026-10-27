import { Suspense } from "react";
import { ThirtyPage } from "./ThirtyPage";

/**
 * /admin/discounts: the 30% page (admin rebuild PRD, work item 3; admin
 * rebuild 2, D4 and the coupon of D5). Since the 30% applies itself (T-137)
 * it is one list of the requests the app couldn't finish, reached from the
 * Dashboard and a student's page, with no entry in the bar. The page itself
 * is src/components/admin/thirty/ThirtyView.tsx, a client component
 * that reads GET /api/admin/thirty with the team member's token; this
 * server wrapper exists to give the tab its title, which the client layout
 * above it cannot. ThirtyPage.tsx hands it the member's role (Approve
 * anyway, and Reject where a code may exist, are a founder's or an admin's).
 *
 * ThirtyView reads ?student= from the address (an old ?tab= opens the whole
 * list), so it waits inside Suspense and the rest of the page stays
 * prerendered, as the login page does with its error line.
 */

export const metadata = {
  title: "30% off · Ecom University",
};

export default function DiscountsPage() {
  return (
    <Suspense fallback={null}>
      <ThirtyPage />
    </Suspense>
  );
}
