"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { TeamMember } from "@/types/database";
import {
  ADMIN_HOME,
  entriesFor,
  isActive,
  type NavEntry,
  type NavGroup,
  type NavLeaf,
} from "@/lib/admin/admin-frame";
import { Button } from "./ui";
import tokens from "./admin-tokens.module.css";

/**
 * The admin's top bar (admin rebuild 2, D1), in the dark look of
 * admin-tokens.module.css: the white Ecom University lockup (to the
 * Dashboard), then Dashboard, 30% off, Tasks, Students (two pages), Feedback
 * (two pages), Templates, Insights and Team, and the profile on the right.
 * The entries and their role flags are ADMIN_NAV in
 * src/lib/admin/admin-frame.ts.
 *
 * From 1100px wide the entries sit in the bar and the two groups open as
 * dropdowns. Under 1100px one Menu button opens every entry, and the
 * profile, as a full-width list under the bar. Nothing in the bar scrolls
 * sideways: at 1100px a founder's 8 entries fit beside a name of about
 * 120px with the lockup at full size (216px); a longer name, up to the
 * profile's 180px, shrinks the lockup first (to 128px at 1100px, measured
 * 2026-10-20), and on a narrow phone too the lockup shrinks before anything
 * overflows. The nav itself still gets no overflow rule, because that would
 * clip the dropdowns.
 *
 * The member, the address and sign-out come in as props, so the dev page
 * (src/app/dev/admin/frame) can draw the bar for any role with no login.
 */

const BAR_HEIGHT = 60;

export function AdminTopNav({
  member,
  pathname,
  onSignOut,
}: {
  member: Pick<TeamMember, "full_name" | "role"> | null;
  pathname: string;
  onSignOut: () => void | Promise<void>;
}) {
  const entries = entriesFor(member?.role);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // Open at an address: a new address closes it with no effect to run.
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  const menuOpen = menuOpenAt === pathname;

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (headerRef.current?.contains(e.target as Node)) return;
      setMenuOpenAt(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setMenuOpenAt(null);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      ref={headerRef}
      className={`${tokens.tokens} sticky top-0 z-30`}
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div
        className="flex items-center px-4 min-[1100px]:px-6"
        style={{ height: BAR_HEIGHT, gap: 16 }}
      >
        <Link
          href={ADMIN_HOME}
          className="flex items-center"
          style={{ minWidth: 0, height: "100%", textDecoration: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/ecomu-ad-creative-white.svg"
            width={3142}
            height={233}
            alt="Ecom University"
            draggable={false}
            style={{
              display: "block",
              width: "auto",
              height: "auto",
              maxHeight: 16,
              maxWidth: "100%",
            }}
          />
        </Link>

        <nav
          aria-label="Admin"
          className="hidden min-[1100px]:flex items-stretch"
          style={{ height: BAR_HEIGHT, marginLeft: 16 }}
        >
          {entries.map((entry) =>
            entry.type === "leaf" ? (
              <BarLink key={entry.href} leaf={entry} pathname={pathname} />
            ) : (
              <BarGroup key={entry.label} group={entry} pathname={pathname} />
            ),
          )}
        </nav>

        <div style={{ flex: 1 }} />

        {member && (
          <div
            className="hidden min-[1100px]:flex items-center"
            style={{ gap: 12, flexShrink: 0 }}
          >
            <Initials name={member.full_name} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                maxWidth: 180,
                minWidth: 0,
              }}
            >
              <span
                className="truncate"
                style={{
                  maxWidth: "100%",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.25,
                }}
              >
                {member.full_name}
              </span>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="admin-nav-signout"
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1.3,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        )}

        <button
          ref={menuButtonRef}
          type="button"
          className="flex min-[1100px]:hidden items-center"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpenAt(menuOpen ? null : pathname)}
          style={{
            flexShrink: 0,
            gap: 8,
            height: 44,
            padding: "0 16px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-pill)",
            cursor: "pointer",
          }}
        >
          Menu
          <Chevron open={menuOpen} />
        </button>
      </div>

      {menuOpen && (
        <MenuPanel
          id={menuId}
          entries={entries}
          pathname={pathname}
          member={member}
          onSignOut={onSignOut}
          onClose={() => setMenuOpenAt(null)}
        />
      )}

      <style>{`
        .admin-nav-item {
          color: var(--color-text-secondary);
          transition: color var(--duration-quick) var(--ease-default);
        }
        .admin-nav-item:hover,
        .admin-nav-item[data-active] {
          color: var(--color-text-primary);
        }
        .admin-nav-item .admin-nav-underline {
          background: transparent;
          transition: background var(--duration-quick) var(--ease-default);
        }
        .admin-nav-item:hover .admin-nav-underline {
          background: var(--color-border-strong);
        }
        .admin-nav-item[data-active] .admin-nav-underline {
          background: var(--color-accent-dark);
        }
        .admin-nav-option {
          transition: background var(--duration-quick) var(--ease-default);
        }
        .admin-nav-option:hover {
          background: var(--color-fill-secondary);
        }
        .admin-nav-signout {
          color: var(--color-text-secondary);
        }
        .admin-nav-signout:hover {
          color: var(--color-text-primary);
          text-decoration: underline;
        }
      `}</style>
    </header>
  );
}

function BarLink({ leaf, pathname }: { leaf: NavLeaf; pathname: string }) {
  const active = isActive(leaf, pathname);
  return (
    <Link
      href={leaf.href}
      className="admin-nav-item flex items-center shrink-0 relative"
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      style={{
        paddingInline: 12,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {leaf.label}
      <Underline />
    </Link>
  );
}

function BarGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const active = group.children.some((c) => isActive(c, pathname));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpenAt(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenAt(null);
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative", display: "flex" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpenAt(open ? null : pathname)}
        className="admin-nav-item flex items-center shrink-0 relative"
        data-active={active || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          gap: 6,
          paddingInline: 12,
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {group.label}
        <Chevron open={open} />
        <Underline />
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={group.label}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            minWidth: 220,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-control)",
            // It floats over the page, so it is the one thing here with a shadow.
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            zIndex: 40,
          }}
        >
          {group.children.map((c) => {
            const current = isActive(c, pathname);
            return (
              <Link
                key={c.href}
                href={c.href}
                role="menuitem"
                aria-current={current ? "page" : undefined}
                onClick={() => setOpenAt(null)}
                className="admin-nav-option"
                style={{
                  display: "flex",
                  alignItems: "center",
                  minHeight: 44,
                  paddingInline: 12,
                  borderRadius: "var(--radius-chip)",
                  fontSize: 13,
                  fontWeight: current ? 600 : 500,
                  color: "var(--color-text-primary)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  // Only the current page sets a background, so the hover
                  // rule can paint the others.
                  ...(current ? { background: "var(--color-fill-secondary)" } : {}),
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

function MenuPanel({
  id,
  entries,
  pathname,
  member,
  onSignOut,
  onClose,
}: {
  id: string;
  entries: NavEntry[];
  pathname: string;
  member: Pick<TeamMember, "full_name" | "role"> | null;
  onSignOut: () => void | Promise<void>;
  onClose: () => void;
}) {
  // A group sits between two hairlines, so the entry after it reads as top
  // level again. Two groups in a row (Students, then Feedback) share the
  // line between them, and the profile row takes a hairline of its own only
  // when no group above it already drew one.
  const lastIsGroup = entries[entries.length - 1]?.type === "group";
  return (
    <div
      id={id}
      className="min-[1100px]:hidden"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        maxHeight: `calc(100dvh - ${BAR_HEIGHT}px)`,
        overflowY: "auto",
        overscrollBehavior: "contain",
        background: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--color-border)",
        boxShadow: "0 16px 32px rgba(0, 0, 0, 0.45)",
        paddingBottom: 8,
      }}
    >
      <nav aria-label="Admin">
        <ul style={{ listStyle: "none", margin: 0, padding: "8px 0 0" }}>
          {entries.map((entry, i) =>
            entry.type === "leaf" ? (
              <li key={entry.href}>
                <MenuRow leaf={entry} pathname={pathname} onClose={onClose} />
              </li>
            ) : (
              <li
                key={entry.label}
                style={{
                  borderTop:
                    entries[i - 1]?.type === "group" ? "none" : "1px solid var(--color-border)",
                  borderBottom: "1px solid var(--color-border)",
                  padding: "4px 0",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    padding: "12px 16px 4px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {entry.label}
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {entry.children.map((c) => (
                    <li key={c.href}>
                      <MenuRow leaf={c} pathname={pathname} onClose={onClose} />
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      </nav>

      {member && (
        <div
          className="flex items-center"
          style={{
            gap: 12,
            padding: "12px 16px 4px",
            borderTop: lastIsGroup ? "none" : "1px solid var(--color-border)",
          }}
        >
          <Initials name={member.full_name} />
          <span
            className="truncate"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {member.full_name}
          </span>
          <Button variant="raised" size="md" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

function MenuRow({
  leaf,
  pathname,
  onClose,
}: {
  leaf: NavLeaf;
  pathname: string;
  onClose: () => void;
}) {
  const current = isActive(leaf, pathname);
  return (
    <Link
      href={leaf.href}
      aria-current={current ? "page" : undefined}
      onClick={onClose}
      className="admin-nav-option"
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 48,
        paddingInline: 16,
        fontSize: 15,
        fontWeight: current ? 600 : 500,
        color: "var(--color-text-primary)",
        textDecoration: "none",
        // The selected state in the one accent, as a bar on the left edge.
        boxShadow: current ? "inset 3px 0 0 var(--color-accent-dark)" : "none",
      }}
    >
      {leaf.label}
    </Link>
  );
}

function Underline() {
  return (
    <span
      aria-hidden="true"
      className="admin-nav-underline"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 0,
        height: 2,
        borderRadius: 2,
      }}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform var(--duration-quick) var(--ease-default)",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** First and last initials on a flat raised circle. */
function Initials({ name }: { name: string }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "·"
      : parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (
    <div
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: "var(--radius-pill)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-fill-secondary)",
        color: "var(--color-text-primary)",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {initials}
    </div>
  );
}
