import { Suspense } from "react";
import { ThirtyPage } from "./ThirtyPage";

/**
 * /admin/discounts: the 30% page (admin rebuild PRD, work item 3; admin
 * rebuild 2, D4: Applied, Approved, Rejected, Code Applied, and the coupon of
 * D5). The page itself is src/components/admin/thirty/ThirtyView.tsx, a client component
 * that reads GET /api/admin/thirty with the team member's token; this
 * server wrapper exists to give the tab its title, which the client layout
 * above it cannot. ThirtyPage.tsx hands it the member's role (Approve
 * anyway is a founder's or an admin's, the owner's review of 2026-10-21).
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
      <ThirtyPage />
    </Suspense>
  );
}
