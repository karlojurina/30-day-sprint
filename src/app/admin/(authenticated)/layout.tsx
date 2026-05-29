"use client";

import { TeamGuard } from "@/components/auth/TeamGuard";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Items flagged `founderOnly: true` only render in the nav for
 *  the founder role. The page + API enforce the role server-side
 *  anyway, but hiding the link removes the dead end for non-founders. */
const navItems: {
  href: string;
  label: string;
  icon: React.ReactNode;
  founderOnly?: boolean;
}[] = [
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
    href: "/admin/lessons",
    label: "Lessons",
    icon: (
      // Star icon — matches the rating UI students see.
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
    ),
  },
  {
    href: "/admin/journey",
    label: "Student journey",
    icon: (
      // Path / footsteps glyph — students moving along a journey
      <path d="M3 12h3l3-9 6 18 3-9h3" />
    ),
  },
  {
    href: "/admin/not-activated",
    label: "Not Activated",
    icon: (
      // Hourglass / unactivated student — waiting on first login
      <path d="M6 2h12v6l-4 4 4 4v6H6v-6l4-4-4-4z" />
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
  {
    href: "/admin/team",
    label: "Team",
    founderOnly: true,
    icon: (
      // Two-person icon - distinct from Students (which is people +
      // detail) and matches the team-management surface.
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    ),
  },
];

/**
 * v75.1 - polished top nav. Tab-style active state with an accent
 * underline (replaces the box highlight which read as "pill"),
 * subtle hover state on every item, soft elevated header background
 * with a hairline divider + 1px highlight, profile avatar with
 * initials. Pace numbers next to the Journey item are gone -
 * Karlo wanted them out of the global nav (they live on the page
 * itself).
 */
function AdminTopNav() {
  const pathname = usePathname();
  const { teamMember, signOut } = useAuth();

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background:
          "linear-gradient(180deg, var(--color-bg-elevated) 0%, var(--color-bg-card) 100%)",
        borderBottom: "1px solid var(--color-border)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.10)",
        backdropFilter: "saturate(140%) blur(10px)",
        WebkitBackdropFilter: "saturate(140%) blur(10px)",
      }}
    >
      <div
        className="flex items-center"
        style={{
          height: 60,
          paddingInline: 24,
          gap: 28,
        }}
      >
        {/* Brand */}
        <Link
          href="/admin"
          className="flex items-center shrink-0"
          style={{
            gap: 10,
            textDecoration: "none",
          }}
        >
          {/* Brand mark - 4-pointed star, sage tint. */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 2 L13.8 10.2 L22 12 L13.8 13.8 L12 22 L10.2 13.8 L2 12 L10.2 10.2 Z"
              fill="var(--color-accent-dark)"
              opacity="0.85"
            />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.014em",
                lineHeight: 1.1,
              }}
            >
              EcomTalent
            </span>
            <span
              style={{
                fontSize: 9,
                color: "var(--color-text-tertiary)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              Team
            </span>
          </div>
        </Link>

        {/* Nav - tab-style active underline. */}
        <nav
          className="flex items-stretch"
          style={{
            gap: 0,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            height: 60,
          }}
        >
          {navItems.map((item) => {
            if (item.founderOnly && teamMember?.role !== "founder") {
              return null;
            }
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="admin-nav-item flex items-center shrink-0 relative"
                style={{
                  gap: 7,
                  paddingInline: 12,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: "-0.008em",
                  color: isActive
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
                  textDecoration: "none",
                  transition: "color 120ms ease",
                  height: "100%",
                }}
              >
                <svg
                  width="14"
                  height="14"
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
                <span>{item.label}</span>
                {/* Active underline indicator */}
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 12,
                    right: 12,
                    bottom: 0,
                    height: 2,
                    background: isActive
                      ? "var(--color-accent-dark)"
                      : "transparent",
                    borderRadius: 2,
                    transition: "background 150ms ease",
                  }}
                />
              </Link>
            );
          })}
        </nav>

        {/* Profile + sign out */}
        <div
          className="flex items-center shrink-0"
          style={{
            gap: 12,
            paddingLeft: 18,
            borderLeft: "1px solid var(--color-border)",
            height: 36,
          }}
        >
          <Avatar name={teamMember?.full_name ?? ""} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              maxWidth: 160,
            }}
          >
            <span
              className="truncate"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.005em",
                lineHeight: 1.2,
              }}
            >
              {teamMember?.full_name ?? "—"}
            </span>
            <button
              onClick={signOut}
              style={{
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textAlign: "left",
                letterSpacing: "-0.003em",
                lineHeight: 1.2,
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .admin-nav-item:hover {
          color: var(--color-text-primary);
        }
      `}</style>
    </header>
  );
}

/** Round avatar with the team member's initials. Falls back to a
 *  single dot if no name yet (rare; just first-render). */
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        background:
          "linear-gradient(135deg, var(--color-accent-dark) 0%, var(--color-bg-card) 120%)",
        border: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-primary)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "-0.005em",
        flexShrink: 0,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
      }}
    >
      {initials || "·"}
    </div>
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
        className="admin-shell flex flex-col min-h-screen"
        style={{ background: "var(--color-bg-primary)" }}
      >
        <AdminTopNav />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </TeamGuard>
  );
}
