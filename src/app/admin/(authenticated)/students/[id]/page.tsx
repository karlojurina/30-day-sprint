import { StudentDetailView } from "@/components/admin/students/StudentDetailView";

/**
 * /admin/students/[id]: one student (admin rebuild 2, D9). The page itself
 * is src/components/admin/students/StudentDetailView.tsx, which reads the
 * database with the team member's session through
 * src/lib/admin/student-detail.ts; this server wrapper gives the tab its
 * title and hands the view the id.
 */

export const metadata = {
  title: "Student · Ecom University",
};

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentDetailView studentId={id} />;
}
