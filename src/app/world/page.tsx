"use client";

import dynamic from "next/dynamic";

/**
 * ssr:false is required, not preferred. WebGLRenderer touches `window` and
 * `document` in its constructor, so any server render of this tree throws.
 */
const WorldCanvas = dynamic(
  () => import("@/components/world/WorldCanvas").then((m) => m.WorldCanvas),
  { ssr: false },
);

export default function WorldPage() {
  return <WorldCanvas />;
}
