import { notFound } from "next/navigation";
import { DevAdminMain } from "./DevAdminMain";

/**
 * Development only: the admin's rebuilt components with made-up data and no
 * login, so a browser (and world-tests) can look at every state of them
 * (admin rebuild PRD, section 9). Made-up people only: this repository is
 * public.
 *
 * The same frame as src/app/admin/(authenticated)/layout.tsx, without the
 * team guard: .admin-shell on the outer element (the admin's scope, and what
 * turns off the student side's paper grain), the token class of
 * admin-tokens.module.css on <main> inside it (never on the same element).
 * DevAdminMain decides which pages get the token class.
 */

export const metadata = {
  title: "Admin preview · Ecom University",
  robots: { index: false, follow: false },
};

export default function DevAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div
      className="admin-shell flex flex-col min-h-screen"
      style={{ background: "var(--color-bg-primary)" }}
    >
      <DevAdminMain>{children}</DevAdminMain>
    </div>
  );
}
