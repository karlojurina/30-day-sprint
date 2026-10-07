import { notFound } from "next/navigation";
import { Bricolage_Grotesque } from "next/font/google";
import { WorldStage } from "@/components/world/WorldStage";
import { FixtureStudentProvider } from "./FixtureStudentProvider";

/**
 * Development-only: the three /world routes with a pretend student, so a real
 * browser can walk every path a student can take with no login
 * (world_v6_wiring_prd.md, Work Item 4; driven by world-tests/v6-app.mjs).
 *
 * Same stage, same host, same map, same place route and same lesson page as
 * src/app/world/. Only the three wrappers above the stage differ: the auth
 * guard, StudentProvider and the access gate are replaced by
 * FixtureStudentProvider, which serves a generated catalog in the staging
 * seed's shape and makes no network request. Mounting StudentProvider here
 * would be a write (it POSTs /api/student/refresh-watch-sync on mount, focus
 * and visibilitychange), and the browser run opens these pages many times.
 *
 * The font wrapper is the dev map page's (src/app/dev/world-v6/page.tsx).
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-v2-display",
  axes: ["opsz"],
});

export const metadata = {
  title: "EcomTalent World (dev harness)",
  robots: { index: false, follow: false },
};

export default function WorldAppLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className={display.variable}>
      <FixtureStudentProvider>
        <WorldStage base="/dev/world-app">{children}</WorldStage>
      </FixtureStudentProvider>
    </div>
  );
}
