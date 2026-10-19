import type { Metadata } from "next";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";
import { comingSoonMetadata } from "@/lib/student-app-gate";

/** T-078: while closed, the tab and a link preview read the new name. */
export function generateMetadata(): Metadata {
  return comingSoonMetadata();
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <StudentProvider>
        {children}
        {/* v71 - Hard gate for non-active subscriptions. Renders
            ABOVE all dashboard content (z-index 200) and has no
            close button. Only escape hatches: Renew (Whop checkout;
            for past_due, Whop's page to update the payment) or Sign
            out. Covers /dashboard + /dashboard/playbook. */}
        <MembershipBlockOverlay />
      </StudentProvider>
    </StudentGuard>
  );
}
