import { Suspense } from "react";
import { ThirtyView } from "@/components/admin/thirty/ThirtyView";

/**
 * /admin/discounts: the 30% page (admin rebuild PRD, work item 3; admin
 * rebuild 2, D4: Applied, Approved, Rejected, Code Applied, and the coupon of
 * D5). The page itself is src/components/admin/thirty/ThirtyView.tsx, a client component
 * that reads GET /api/admin/thirty with the team member's token; this
 * server wrapper exists to give the tab its title, which the client layout
 * above it cannot.
 *
 * ThirtyView reads ?student= and ?tab= from the address, so it waits inside
 * Suspense and the rest of the page stays prerendered, as the login page
 * does with its error line.
 */

export const metadata = {
  title: "30% off · Ecom University",
};

export default function DiscountsPage() {
  return (
    <Suspense fallback={null}>
      <ThirtyView />
    </Suspense>
  );
}
