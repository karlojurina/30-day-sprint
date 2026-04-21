"use client";

import type { Dispatch, SetStateAction } from "react";

/**
 * Floating zoom/pan controls in the bottom-right of the map.
 * Emits panTarget values that MapCanvas listens for.
 */
export function MapControls({
  setPanTarget,
}: {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}) {
  const btnStyle =
    "w-10 h-10 rounded-md border flex items-center justify-center " +
    "text-[rgba(230,220,200,0.75)] hover:text-[#E6C07A] " +
    "transition-colors cursor-pointer select-none";

  return (
    <div
      className="absolute bottom-6 right-6 z-20 flex flex-col gap-2"
      style={{ pointerEvents: "auto" }}
    >
      <button
        onClick={() => setPanTarget("current")}
        className={btnStyle}
        style={{
          background: "rgba(10,20,40,0.8)",
          borderColor: "rgba(230,192,122,0.32)",
          backdropFilter: "blur(4px)",
        }}
        title="Zoom to current lesson"
        aria-label="Zoom to current lesson"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polygon points="12,2 14,10 22,12 14,14 12,22 10,14 2,12 10,10" />
        </svg>
      </button>
      <button
        onClick={() => setPanTarget("out")}
        className={btnStyle}
        style={{
          background: "rgba(10,20,40,0.8)",
          borderColor: "rgba(230,192,122,0.32)",
          backdropFilter: "blur(4px)",
        }}
        title="Fit whole map"
        aria-label="Fit whole map"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
      </button>
    </div>
  );
}
