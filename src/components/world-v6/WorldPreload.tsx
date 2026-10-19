"use client";

import { useEffect } from "react";
import { NARROW_QUERY } from "@/components/world-v6/WorldV6";

/**
 * Starts downloading the 3D map's code when the world's layout mounts (speed,
 * 2026-10-20). WorldV6 asked for three.js and scene.ts only when it mounted,
 * which on /world is after /api/auth/me and /api/student/data have answered,
 * and the scene asked for its 17 modules only once the terrain was built.
 * This asks for the scene now, and for the modules as soon as the scene's
 * code is in (scene.ts preloadModules, which skips them where the posters
 * will show). WorldV6's own import then gets the same module from the bundler.
 *
 * Nothing is drawn and nothing waits on it: a failure here is WorldV6's to
 * report when it imports. A phone width, where the map is the list,
 * downloads nothing, as before. `when` false asks for nothing (/world before
 * it opens to everyone: WorldAccessGate decides who may load it first).
 */
export function WorldPreload({ when = true }: { when?: boolean }) {
  useEffect(() => {
    if (!when || window.matchMedia(NARROW_QUERY).matches) return;
    import("@/lib/world-v6/scene")
      .then((m) => m.preloadModules(window.location.search))
      .catch(() => {});
  }, [when]);
  return null;
}
