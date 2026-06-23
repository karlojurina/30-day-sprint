"use client";

import { TeamGuard } from "@/components/auth/TeamGuard";
import { useAuth } from "@/contexts/AuthContext";
// v75.51: AdminScopeProvider + ScopeToggle removed. Every admin
// surface is now LAUNCH COHORT only. Pre-launch customers stay out
// of the operational view via the hardcoded first_paid_at filters.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * v75.7 — nav restructure.
 *
 * Top-level items collapsed from 11 to 7 by grouping related routes
 * under "Students" and "Settings" dropdowns:
 *   - Students ▾ → All students, Student journey, Discounts (v75.43: Not activated removed)
 *   - Settings ▾ → General, Discord test, Team (founder-only)
 *
 * Layout shifts from flex (brand left, nav left, profile right) to a
 * 3-column grid so the nav cluster sits dead-center between brand
 * and profile regardless of how wide either edge is.
 *
 * Role gates (csmHidden, founderOnly) still work — they propagate
 * down to children so a CSM never sees the Settings group at all
 * (every child is hidden for them).
 */

type NavLeaf = {
  type: "leaf";
  href: string;
  label: string;
  icon?: React.ReactNode;
  founderOnly?: boolean;
  csmHidden?: boolean;
};

type NavGroup = {
  type: "group";
  label: string;
  icon: React.ReactNode;
  children: NavLeaf[];
  founderOnly?: boolean;
  csmHidden?: boolean;
};

type NavEntry = NavLeaf | NavGroup;

const navEntries: NavEntry[] = [
  {
    type: "leaf",
    href: "/admin",
    label: "Dashboard",
    icon: (
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    ),
  },
  {
    type: "leaf",
    href: "/admin/tasks",
    label: "Tasks",
    icon: (
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    ),
  },
  {
    type: "group",
    label: "Students",
    icon: (
      <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    ),
    children: [
      { type: "leaf", href: "/admin/students", label: "All students" },
      { type: "leaf", href: "/admin/journey", label: "Student journey" },
      // v75.43: "Not activated" removed from sidebar per Karlo.
      // The page itself stays at /admin/not-activated for direct
      // URL access — only the nav link is hidden. Reachable from
      // the journey kanban's first column if needed.
      { type: "leaf", href: "/admin/discounts", label: "Discounts" },
    ],
  },
  {
    type: "group",
    label: "Feedback",
    csmHidden: true,
    icon: (
      <path d="M8 10h8M8 14h5m-9 6 3.5-3H18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" />
    ),
    children: [
      { type: "leaf", href: "/admin/feedback/lessons", label: "Lessons" },
      { type: "leaf", href: "/admin/feedback/survey", label: "Survey" },
    ],
  },
  {
    type: "leaf",
    href: "/admin/insights/progress",
    label: "Insights",
    icon: <path d="M3 3v18h18M7 14l3-3 3 3 5-5" />,
  },
  {
    type: "leaf",
    href: "/admin/templates",
    label: "Templates",
    icon: (
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-2 6H8m6 4H8" />
    ),
  },
  {
    type: "group",
    label: "Settings",
    icon: (
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    ),
    csmHidden: true,
    children: [
      { type: "leaf", href: "/admin/settings", label: "General" },
      { type: "leaf", href: "/admin/discord", label: "Discord test" },
      {
        type: "leaf",
        href: "/admin/team",
        label: "Team",
        founderOnly: true,
      },
    ],
  },
];

function AdminTopNav() {
  const pathname = usePathname();
  const { teamMember, signOut } = useAuth();
  const role = teamMember?.role;

  function entryVisible(e: { founderOnly?: boolean; csmHidden?: boolean }) {
    if (e.founderOnly && role !== "founder") return false;
    if (e.csmHidden && role === "csm") return false;
    return true;
  }

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background:
          "linear-gradient(180deg, var(--color-bg-elevated) 0%, var(--color-bg-card) 100%)",
        borderBottom: "1px solid var(--color-border)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.04)",
        backdropFilter: "saturate(140%) blur(10px)",
        WebkitBackdropFilter: "saturate(140%) blur(10px)",
      }}
    >
      {/* 3-column grid — brand sticks to the left edge, profile sticks
          to the right edge, nav cluster sits dead-center. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          height: 60,
          paddingInline: 24,
          gap: 18,
        }}
      >
        {/* Brand */}
        <Link
          href="/admin"
          className="flex items-center"
          style={{
            gap: 10,
            textDecoration: "none",
            justifySelf: "start",
          }}
        >
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

        {/* Nav cluster — centered. v75.8 — was overflowX: auto, which
            creates a clipping context. The Students ▾ / Settings ▾
            dropdowns are absolutely positioned children of nav-item
            buttons; with overflow set on the nav, the dropdown got
            clipped at the nav boundary and never appeared visibly.
            Now that there are only 7 top-level items they fit
            comfortably without horizontal scroll. */}
        <nav
          className="flex items-stretch"
          style={{
            gap: 0,
            height: 60,
            justifySelf: "center",
          }}
        >
          {navEntries.map((entry) => {
            if (!entryVisible(entry)) return null;
            if (entry.type === "leaf") {
              return (
                <NavLeafItem
                  key={entry.href}
                  entry={entry}
                  pathname={pathname}
                />
              );
            }
            const visibleChildren = entry.children.filter(entryVisible);
            if (visibleChildren.length === 0) return null;
            return (
              <NavGroupItem
                key={entry.label}
                entry={{ ...entry, children: visibleChildren }}
                pathname={pathname}
              />
            );
          })}
        </nav>

        {/* Right column: scope toggle + profile */}
        <div
          className="flex items-center"
          style={{
            gap: 16,
            justifySelf: "end",
          }}
        >
          {/* v75.51: ScopeToggle removed. Cohort is the only view. */}
          <div
            className="flex items-center"
            style={{
              gap: 12,
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
      </div>
      <style>{`
        .admin-nav-item:hover { color: var(--color-text-primary); }
        .admin-nav-item:hover .admin-nav-underline { background: var(--color-border-strong); }
        .admin-nav-item-active .admin-nav-underline { background: var(--color-accent-dark) !important; }
        .admin-nav-dropdown-item:hover { background: var(--color-fill-secondary); }
      `}</style>
    </header>
  );
}

function NavLeafItem({
  entry,
  pathname,
}: {
  entry: NavLeaf;
  pathname: string;
}) {
  const isActive =
    entry.href === "/admin"
      ? pathname === "/admin"
      : pathname.startsWith(entry.href);
  return (
    <Link
      href={entry.href}
      className={`admin-nav-item flex items-center shrink-0 relative${isActive ? " admin-nav-item-active" : ""}`}
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
      {entry.icon && (
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
          {entry.icon}
        </svg>
      )}
      <span>{entry.label}</span>
      <span
        aria-hidden="true"
        className="admin-nav-underline"
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 0,
          height: 2,
          background: "transparent",
          borderRadius: 2,
          transition: "background 150ms ease",
        }}
      />
    </Link>
  );
}

function NavGroupItem({
  entry,
  pathname,
}: {
  entry: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAnyChildActive = entry.children.some((c) =>
    pathname.startsWith(c.href),
  );

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        buttonRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      )
        return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close the menu when the user navigates.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div style={{ position: "relative", display: "flex" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`admin-nav-item flex items-center shrink-0 relative${isAnyChildActive ? " admin-nav-item-active" : ""}`}
        style={{
          gap: 7,
          paddingInline: 12,
          fontSize: 13,
          fontWeight: isAnyChildActive ? 600 : 500,
          letterSpacing: "-0.008em",
          color: isAnyChildActive
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          height: "100%",
          textDecoration: "none",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
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
          {entry.icon}
        </svg>
        <span>{entry.label}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span
          aria-hidden="true"
          className="admin-nav-underline"
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 0,
            height: 2,
            background: "transparent",
            borderRadius: 2,
            transition: "background 150ms ease",
          }}
        />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% - 1px)",
            left: 0,
            minWidth: 200,
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: 4,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            zIndex: 40,
            boxShadow:
              "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)",
          }}
        >
          {entry.children.map((c) => {
            const isActive = pathname.startsWith(c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                role="menuitem"
                className="admin-nav-dropdown-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 32,
                  paddingInline: 10,
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
                  letterSpacing: "-0.005em",
                  textDecoration: "none",
                  background: isActive
                    ? "var(--color-fill-secondary)"
                    : "transparent",
                  transition: "background 120ms ease, color 120ms ease",
                }}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * v75.8 - solid dark avatar with light initials. The previous
 * gradient (accent-dark → bg-card 120%) faded into the page
 * background and read as washed-out gray. Now: deep ink with a
 * tight diagonal sheen so it feels solid + a touch dimensional,
 * not flat. Initials are picked from first + last name parts.
 */
function Avatar({ name }: { name: string }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "·"
      : parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  // Tiny deterministic hue spin off the name so different team
  // members get visually distinguishable avatars when they sit
  // next to each other (Karlo's KJ vs Astrid's AC etc.) without
  // needing a real picture.
  const hue =
    Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
  return (
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        background: `linear-gradient(140deg, hsl(${hue} 22% 22%) 0%, hsl(${hue} 22% 12%) 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.96)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        flexShrink: 0,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.10)",
      }}
    >
      {initials}
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
