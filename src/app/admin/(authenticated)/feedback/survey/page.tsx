import { SurveyPage } from "./SurveyPage";

/**
 * /admin/feedback/survey: the 30% application's survey answers (admin
 * rebuild 2, WI-9). The page is src/components/admin/survey/SurveyView.tsx,
 * handed the real read by SurveyPage.tsx; this server wrapper gives the tab
 * its title, which the client layout above it cannot.
 */

export const metadata = {
  title: "Survey · Ecom University",
};

export default function FeedbackSurveyPage() {
  return <SurveyPage />;
}
