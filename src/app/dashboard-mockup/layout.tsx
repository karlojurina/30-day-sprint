import type { Metadata } from "next";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { comingSoonMetadata } from "@/lib/student-app-gate";

/** T-078: while closed, the tab and a link preview read the new name. */
export function generateMetadata(): Metadata {
  return comingSoonMetadata();
}

export default function DashboardMockupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <StudentProvider>{children}</StudentProvider>
    </StudentGuard>
  );
}
