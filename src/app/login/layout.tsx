import type { Metadata } from "next";
import { ComingSoon } from "@/components/auth/ComingSoon";
import { comingSoonMetadata, studentAppClosed } from "@/lib/student-app-gate";

/** T-078: while closed, the tab and a link preview read the new name. */
export function generateMetadata(): Metadata {
  return comingSoonMetadata();
}

/**
 * While the student app is closed (STUDENT_APP_CLOSED, T-078) the login is
 * the coming-soon page: the "Sign in with Whop" button never renders.
 *
 * Decided here, on the server, so the browser needs no copy of the value.
 * The page is built with the value its deploy carries, and Vercel applies a
 * changed value only on the next deploy, so this page and the routes that
 * read the same value at request time always agree. With the value unset the
 * login page renders exactly as before.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (studentAppClosed()) return <ComingSoon />;
  return children;
}
