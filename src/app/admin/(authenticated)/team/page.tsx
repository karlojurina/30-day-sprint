import { TeamPage } from "./TeamPage";

/**
 * /admin/team: who can sign in to the admin, and their roles (admin rebuild
 * 2, WI-9). Founders only. The page is src/components/admin/team/
 * TeamView.tsx, handed the real calls by TeamPage.tsx; this server wrapper
 * gives the tab its title, which the client layout above it cannot.
 */

export const metadata = {
  title: "Team · Ecom University",
};

export default function AdminTeamPage() {
  return <TeamPage />;
}
