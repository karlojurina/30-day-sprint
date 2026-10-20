import { TasksView } from "@/components/admin/tasks/TasksView";

/**
 * /admin/tasks: the CSM's task queue (admin rebuild 2, D7). The page itself
 * is src/components/admin/tasks/TasksView.tsx, a client component that reads
 * GET /api/admin/tasks with the team member's token; this server wrapper
 * gives the tab its title, which the client layout above it cannot.
 */

export const metadata = {
  title: "Tasks · Ecom University",
};

export default function TasksPage() {
  return <TasksView />;
}
