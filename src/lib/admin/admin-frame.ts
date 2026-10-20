import type { TeamMember } from "@/types/database";

/**
 * The admin's frame as data (admin rebuild 2, D1): where the team lands,
 * what the top bar lists for each role, and which pages wear the brand
 * kit's dark look. No React here, so client-tests/admin-frame.test.mjs
 * checks it as it is; src/components/admin/AdminTopNav.tsx draws it and
 * src/app/admin/(authenticated)/layout.tsx applies the look.
 *
 * The role flags hide links only. Every page and route checks the role
 * itself.
 */

export type Role = TeamMember["role"];

/** Where signing in, setting a password and the bar's lockup go: the Dashboard. */
export const ADMIN_HOME = "/admin";

export type NavLeaf = {
  type: "leaf";
  href: string;
  label: string;
  /** Active on this address only, not on the addresses under it. */
  exact?: boolean;
  founderOnly?: boolean;
  csmHidden?: boolean;
};

export type NavGroup = {
  type: "group";
  label: string;
  children: NavLeaf[];
};

export type NavEntry = NavLeaf | NavGroup;

/**
 * Dashboard · 30% off · Tasks · Students (All students, Student journey) ·
 * Feedback (Lesson feedback, Survey) · Templates · Insights · Team. No
 * "More": Today, Brand Owners, Stats, Settings and Discord test were removed
 * (D2), and everything left has a place of its own.
 */
export const ADMIN_NAV: NavEntry[] = [
  { type: "leaf", href: ADMIN_HOME, label: "Dashboard", exact: true },
  { type: "leaf", href: "/admin/discounts", label: "30% off" },
  { type: "leaf", href: "/admin/tasks", label: "Tasks" },
  {
    type: "group",
    label: "Students",
    children: [
      { type: "leaf", href: "/admin/students", label: "All students" },
      { type: "leaf", href: "/admin/journey", label: "Student journey" },
    ],
  },
  {
    // The flags these two pages had in More: hidden from the csm role.
    type: "group",
    label: "Feedback",
    children: [
      { type: "leaf", href: "/admin/feedback/lessons", label: "Lesson feedback", csmHidden: true },
      { type: "leaf", href: "/admin/feedback/survey", label: "Survey", csmHidden: true },
    ],
  },
  { type: "leaf", href: "/admin/templates", label: "Templates" },
  { type: "leaf", href: "/admin/insights/progress", label: "Insights" },
  { type: "leaf", href: "/admin/team", label: "Team", founderOnly: true, csmHidden: true },
];

function leafVisible(leaf: NavLeaf, role: Role | undefined): boolean {
  if (leaf.founderOnly && role !== "founder") return false;
  if (leaf.csmHidden && role === "csm") return false;
  return true;
}

/** The entries a role sees, in order. A group with no visible page is left out. */
export function entriesFor(role: Role | undefined): NavEntry[] {
  const out: NavEntry[] = [];
  for (const entry of ADMIN_NAV) {
    if (entry.type === "leaf") {
      if (leafVisible(entry, role)) out.push(entry);
      continue;
    }
    const children = entry.children.filter((c) => leafVisible(c, role));
    if (children.length > 0) out.push({ ...entry, children });
  }
  return out;
}

export function isActive(leaf: NavLeaf, pathname: string): boolean {
  if (leaf.exact) return pathname === leaf.href;
  return pathname === leaf.href || pathname.startsWith(`${leaf.href}/`);
}

/**
 * Does `pathname` wear the dark look? Each entry of `pages` covers its page
 * and the pages under it, except the Dashboard: every admin address starts
 * with "/admin/", so "/admin" covers itself only.
 */
export function isRebuiltPage(pathname: string, pages: readonly string[]): boolean {
  return pages.some((p) =>
    p === ADMIN_HOME ? pathname === p : pathname === p || pathname.startsWith(`${p}/`),
  );
}
