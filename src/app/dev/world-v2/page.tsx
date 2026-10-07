import { notFound } from "next/navigation";
import { Bricolage_Grotesque } from "next/font/google";
import { WorldV2 } from "@/components/world-v2/WorldV2";

/**
 * Development-only: the v2 world map on fixture data (src/lib/world-v2/study.ts).
 *
 * No StudentProvider and no fetch to /api/*. Mounting StudentProvider is a
 * write (it POSTs /api/student/refresh-watch-sync on mount, focus and
 * visibilitychange), and screenshot loops open this page many times.
 *
 * Fonts are scoped to this page: Bricolage Grotesque here, JetBrains Mono from
 * the root layout's variable. globals.css and layout.tsx style the live
 * dashboard and are not touched.
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-v2-display",
  axes: ["opsz"],
});

export const metadata = {
  title: "EcomTalent — World v2",
  robots: { index: false, follow: false },
};

export default function WorldV2Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className={display.variable}>
      <WorldV2 />
    </div>
  );
}
