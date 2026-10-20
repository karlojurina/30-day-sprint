"use client";

import { AdminTopNav } from "@/components/admin/AdminTopNav";
import tokens from "@/components/admin/admin-tokens.module.css";
import { TeamGuard } from "@/components/auth/TeamGuard";
import { useAuth } from "@/contexts/AuthContext";
import { usePathname } from "next/navigation";
// v75.51: AdminScopeProvider + ScopeToggle removed. Every admin
// surface is now LAUNCH COHORT only. Pre-launch customers stay out
// of the operational view via the hardcoded first_paid_at filters.

/**
 * The frame of every signed-in admin page: the team guard, the top bar
 * (src/components/admin/AdminTopNav.tsx) and the page.
 *
 * .admin-shell stays on the outer element. It gives the pages that keep the
 * light look their colours, and it is what turns off the student side's
 * paper grain. The pages rebuilt in the brand kit's dark look (admin rebuild
 * PRD, call C1) get the token class on <main>, which paints them dark from
 * the bar to the bottom of the window. The bar carries the token class on
 * its own header, so it is dark over every page.
 */
const REBUILT_PAGES = ["/admin/today", "/admin/discounts"];

function isRebuiltPage(pathname: string): boolean {
  return REBUILT_PAGES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { teamMember, signOut } = useAuth();
  const mainClass = isRebuiltPage(pathname)
    ? `flex-1 overflow-auto ${tokens.tokens}`
    : "flex-1 overflow-auto";
  return (
    <TeamGuard>
      <div
        className="admin-shell flex flex-col min-h-screen"
        style={{ background: "var(--color-bg-primary)" }}
      >
        <AdminTopNav
          member={teamMember}
          pathname={pathname}
          onSignOut={async () => {
            // signOut answers the failure's sentence (or null) since the bug
            // hunt's login-5: a failed sign-out keeps the session, so say so.
            const error = await signOut();
            if (error) window.alert(error);
          }}
        />
        <main className={mainClass}>{children}</main>
      </div>
    </TeamGuard>
  );
}
