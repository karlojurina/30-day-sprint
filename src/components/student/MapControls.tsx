"use client";

import { useControls } from "react-zoom-pan-pinch";

export function MapControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="fixed bottom-6 right-6 z-20 flex flex-col gap-2">
      <button
        onClick={() => zoomIn(0.3)}
        className="
          w-10 h-10 rounded-xl
          bg-[var(--color-bg-card)]/90 backdrop-blur-sm
          border border-[var(--color-border-strong)]
          flex items-center justify-center
          text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
          hover:bg-[var(--color-bg-elevated)] transition-colors
        "
        aria-label="Zoom in"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <button
        onClick={() => zoomOut(0.3)}
        className="
          w-10 h-10 rounded-xl
          bg-[var(--color-bg-card)]/90 backdrop-blur-sm
          border border-[var(--color-border-strong)]
          flex items-center justify-center
          text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
          hover:bg-[var(--color-bg-elevated)] transition-colors
        "
        aria-label="Zoom out"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
        </svg>
      </button>

      <button
        onClick={() => resetTransform()}
        className="
          w-10 h-10 rounded-xl
          bg-[var(--color-bg-card)]/90 backdrop-blur-sm
          border border-[var(--color-border-strong)]
          flex items-center justify-center
          text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
          hover:bg-[var(--color-bg-elevated)] transition-colors
        "
        aria-label="Reset view"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
    </div>
  );
}
