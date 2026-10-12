import { notFound } from "next/navigation";
import { Bricolage_Grotesque } from "next/font/google";
import { WorldStage } from "@/components/world/WorldStage";
import { isTellaVideoId } from "@/lib/world/tella";
import { FixtureStudentProvider } from "./FixtureStudentProvider";
import type { DevVideos } from "./fixtureTransport";

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
 *
 * THE TEST VIDEOS (tella_player_prd.md, Work Item 4; world-tests/tella-watch.mjs).
 * Two Tella video ids and their length are read from the environment here,
 * on the server, on every request, and handed to the provider as a prop:
 * DEV_TELLA_VIDEO_ID, DEV_TELLA_VIDEO_ID_2 and DEV_TELLA_VIDEO_SECONDS
 * (default 67). They live in .env.local and nowhere else. They are not
 * NEXT_PUBLIC_, so they are in no bundle, and this page does not exist
 * outside development. With either id missing or malformed the harness is
 * what it was: no lesson has a video. `data-dev-videos` says how many ids
 * arrived and never which, and `data-dev-video-seconds` the length the three
 * video lessons were given; the proof script reads both.
 */

/** Used when DEV_TELLA_VIDEO_SECONDS is not set: both test videos are 67 s long. */
const DEFAULT_VIDEO_SECONDS = 67;

function readDevVideos(): DevVideos | null {
  const a = process.env.DEV_TELLA_VIDEO_ID;
  const b = process.env.DEV_TELLA_VIDEO_ID_2;
  if (!isTellaVideoId(a) || !isTellaVideoId(b)) return null;
  const seconds = Number(process.env.DEV_TELLA_VIDEO_SECONDS);
  return { a, b, seconds: isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_VIDEO_SECONDS };
}

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
  const devVideos = readDevVideos();
  return (
    <div
      className={display.variable}
      data-dev-videos={devVideos ? 2 : undefined}
      data-dev-video-seconds={devVideos?.seconds}
    >
      <FixtureStudentProvider devVideos={devVideos}>
        <WorldStage base="/dev/world-app">{children}</WorldStage>
      </FixtureStudentProvider>
    </div>
  );
}
