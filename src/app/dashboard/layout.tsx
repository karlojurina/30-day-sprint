import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";

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
            close button. Only escape hatches: Renew (Whop checkout)
            or Sign out. Covers /dashboard + /dashboard/playbook. */}
        <MembershipBlockOverlay />
      </StudentProvider>
    </StudentGuard>
  );
}
