import { LessonFeedbackGate } from "@/components/admin/feedback/LessonFeedbackGate";

/**
 * /admin/feedback/lessons: what students say about each video lesson since
 * the course switch, by area then lesson (admin rebuild 2, D10 and WI-7).
 * /admin/lessons redirects here.
 *
 * The page is src/components/admin/feedback/LessonFeedbackView.tsx, a client
 * component that reads GET /api/admin/lesson-feedback with the team member's
 * token (LessonFeedbackGate.tsx keeps it from the csm role). This server
 * wrapper exists to give the tab its title, which the client layout above it
 * cannot. /dev/admin/feedback/lessons draws the same view with made-up data.
 */

export const metadata = {
  title: "Lesson feedback · Ecom University",
};

export default function LessonFeedbackPage() {
  return <LessonFeedbackGate />;
}
