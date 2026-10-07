"use client";

/**
 * The layer a world route draws over the map: a full-screen scrim with one
 * card in it. The lesson page and the two "not here" messages use it.
 *
 * It scrolls by itself, and the scroll stops at its own edges
 * (overscroll-behavior): the page scroll underneath is the map's camera.
 *
 * Styling is structural only. The design system (W9) and the art-direction
 * conversation set the actual look; nothing here encodes a palette decision
 * that talk has not made yet.
 */
export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 6,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "clamp(16px, 5vh, 64px) 16px",
        overflowY: "auto",
        overscrollBehavior: "contain",
        background:
          "linear-gradient(to bottom, rgba(29,24,38,.55), rgba(29,24,38,.86))",
      }}
    >
      <div
        style={{
          width: "min(100%, 620px)",
          background: "rgba(20,15,18,.80)",
          border: "1px solid rgba(246,239,230,.14)",
          borderRadius: 14,
          padding: "22px 22px 20px",
          backdropFilter: "blur(10px)",
          color: "#F6EFE6",
          boxShadow: "0 30px 80px rgba(0,0,0,.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
