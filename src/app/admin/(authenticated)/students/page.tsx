import { StudentsView } from "@/components/admin/students/StudentsView";

/**
 * /admin/students: All students (admin rebuild 2, D9). The page itself is
 * src/components/admin/students/StudentsView.tsx, which reads the database
 * with the team member's session through src/lib/admin/students-list.ts;
 * this server wrapper gives the tab its title.
 */

export const metadata = {
  title: "All students · Ecom University",
};

export default function StudentsPage() {
  return <StudentsView />;
}
