import { notFound } from "next/navigation";
import { Bricolage_Grotesque } from "next/font/google";
import { WorldV5 } from "@/components/world-v5/WorldV5";

/**
 * Development-only: the V4 grey world (the whole route, no art) on fixture
 * data, with a tuning panel for pacing, locking and progress.
 *
 * No StudentProvider and no fetch to /api/*. Mounting StudentProvider is a
 * write (it POSTs /api/student/refresh-watch-sync on mount, focus and
 * visibilitychange), and screenshot loops open this page many times.
 *
 * Fonts are scoped to this page: Bricolage Grotesque here, JetBrains Mono from
 * the root layout's variable. globals.css and layout.tsx are not touched.
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-v2-display",
  axes: ["opsz"],
});

export const metadata = {
  title: "EcomTalent — World v4",
  robots: { index: false, follow: false },
};

export default function WorldV5Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className={display.variable}>
      <WorldV5 />
    </div>
  );
}
