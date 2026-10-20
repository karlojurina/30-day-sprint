import { TemplatesPage } from "./TemplatesPage";

/**
 * /admin/templates: the message templates and the Message settings panel
 * (admin rebuild 2, WI-8). The page is src/components/admin/templates/
 * TemplatesView.tsx, handed the real calls by TemplatesPage.tsx; this server
 * wrapper gives the tab its title, which the client layout above it cannot.
 */

export const metadata = {
  title: "Templates · Ecom University",
};

export default function AdminTemplatesPage() {
  return <TemplatesPage />;
}
