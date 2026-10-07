import { notFound } from "next/navigation";
import { CameraHarness } from "./CameraHarness";

/**
 * Development-only: the V4 scene alone, with no interface, for the camera's
 * render checks (world-tests/v5-camera-shots.mjs). /dev/world-v5 is the real
 * page. ?bare=1 installs no modules (terrain and grey stand-ins only).
 */
export const metadata = {
  title: "EcomTalent — World v4 camera",
  robots: { index: false, follow: false },
};

export default function WorldV5CameraPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CameraHarness />;
}
