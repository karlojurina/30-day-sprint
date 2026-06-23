import { redirect } from "next/navigation";

/**
 * Legacy route. Lesson ratings moved to /admin/feedback/lessons when the
 * Feedback nav group was added. Kept as a redirect so old bookmarks and
 * any external links don't 404.
 */
export default function LegacyLessonsRedirect() {
  redirect("/admin/feedback/lessons");
}
