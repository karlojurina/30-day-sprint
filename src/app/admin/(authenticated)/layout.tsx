"use client";

import { TeamGuard } from "@/components/auth/TeamGuard";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: (
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    ),
  },
  {
    href: "/admin/tasks",
    label: "Tasks",
    icon: (
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    ),
  },
  {
    href: "/admin/students",
    label: "Students",
    icon: (
      <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    ),
  },
  {
    href: "/admin/discounts",
    label: "Discounts",
    icon: (
      <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    ),
  },
  {
    href: "/admin/insights/progress",
    label: "Insights",
    icon: (
      <path d="M3 3v18h18M7 14l3-3 3 3 5-5" />
    ),
  },
  {
    href: "/admin/templates",
    label: "Templates",
    icon: (
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-2 6H8m6 4H8" />
    ),
  },
  {
    href: "/admin/discord",
    label: "Discord test",
    icon: (
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    ),
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: (
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    ),
  },
];

function AdminSidebar() {
  const pathname = usePathname();
  const { teamMember, signOut } = useAuth();

  return (
    <aside
      className="flex flex-col h-screen sticky top-0"
      style={{
        width: 232,
        background: "var(--color-bg-elevated)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {/* Brand */}
      <div className="px-5 py-5">
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.014em",
          }}
        >
          EcomTalent
        </p>
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginTop: 1,
            letterSpacing: "-0.005em",
          }}
        >
          Team
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 transition-colors"
              style={{
                height: 40,
                borderRadius: 10,
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                letterSpacing: "-0.011em",
                color: isActive
                  ? "var(--color-accent-dark)"
                  : "var(--color-text-secondary)",
                background: isActive
                  ? "rgba(140, 140, 130, 0.14)"
                  : "transparent",
                border: isActive
                  ? "1px solid rgba(140, 140, 130, 0.28)"
                  : "1px solid transparent",
                boxShadow: isActive
                  ? "0 1px 2px rgba(20, 20, 24, 0.04)"
                  : "none",
                marginBottom: 4,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer — team member + sign out */}
      <div
        className="px-5 py-4"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <p
          className="truncate"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--color-text-secondary)",
          }}
        >
          {teamMember?.full_name}
        </p>
        <button
          onClick={signOut}
          className="mt-1 transition-colors"
          style={{
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TeamGuard>
      <div
        className="admin-shell flex min-h-screen"
        style={{ background: "var(--color-bg-primary)" }}
      >
        <AdminSidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </TeamGuard>
  );
}
