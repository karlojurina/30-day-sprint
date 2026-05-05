import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";

export default function DashboardPilotLayout({
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
