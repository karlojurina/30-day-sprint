"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const INK = "#E6DCC8";

type LegendKey = "legend-seen";

function storageKey(studentId: string | undefined): LegendKey | string {
  return studentId ? `expedition.legend.seen.${studentId}` : "expedition.legend.seen";
}

/**
 * Cartographic map key — shows the node-shape vocabulary on a student's
 * first visit, dismissible, remembered in localStorage. Also reachable
 * anytime via a persistent compass button in the corner.
 *
 * Two modes:
 *   - Auto-open on first visit for a student (reads localStorage)
 *   - Manual open via the trigger button
 */
export function MapLegend() {
  const { student } = useAuth();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Only check localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    const key = storageKey(student?.id);
    const seen = window.localStorage.getItem(key);
    if (!seen) {
      // Delay so the auto-zoom animation plays first (900ms in MapCanvas)
      const id = window.setTimeout(() => setOpen(true), 1600);
      return () => window.clearTimeout(id);
    }
  }, [student?.id]);

  const handleDismiss = () => {
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey(student?.id), "1");
    }
  };

  return (
    <>
      {/* Persistent trigger — a small "?" button in the bottom-left corner */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        style={{
          background: "rgba(10,20,40,0.82)",
          border: "1px solid rgba(230,192,122,0.38)",
          color: GOLD,
          fontFamily: "Cormorant Garamond, serif",
          fontStyle: "italic",
          fontSize: 18,
          fontWeight: 600,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(16,32,66,1)";
          e.currentTarget.style.borderColor = "rgba(230,192,122,0.7)";
          e.currentTarget.style.color = GOLD_HI;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(10,20,40,0.82)";
          e.currentTarget.style.borderColor = "rgba(230,192,122,0.38)";
          e.currentTarget.style.color = GOLD;
        }}
        title="Map key"
        aria-label="Open map key"
      >
        ?
      </button>

      {/* The legend panel — only mounted after hydration */}
      {mounted && open && (
        <div
          className="fade-in-slow fixed bottom-6 left-6 z-30"
          style={{
            width: 320,
            padding: "18px 20px",
            background: "linear-gradient(180deg, rgba(16,32,66,0.96) 0%, rgba(10,20,40,0.96) 100%)",
            border: "1px solid rgba(230,192,122,0.4)",
            borderRadius: 12,
            boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <p
              className="font-mono uppercase"
              style={{
                color: GOLD,
                letterSpacing: "0.18em",
                fontSize: 10,
              }}
            >
              Map key
            </p>
            <button
              onClick={handleDismiss}
              className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
              style={{ color: "rgba(230,220,200,0.55)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = INK)}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(230,220,200,0.55)")}
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <h3
            className="italic mb-4"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              color: INK,
              fontWeight: 500,
              fontSize: 22,
              lineHeight: 1.1,
            }}
          >
            Read your chart.
          </h3>

          <div className="space-y-3 mb-4">
            <LegendRow icon="circle" label="Watch a lesson" note="auto-marks when you finish it on Whop" />
            <LegendRow icon="diamond" label="Take an action" note="check it off when you&rsquo;re done" />
            <LegendRow icon="star16" label="Milestone gate" note="unlocks the 30% discount" />
            <LegendRow icon="star8" label="Final reflection" note="day 30 — the boss" />
          </div>

          <div
            className="pt-3"
            style={{ borderTop: "1px solid rgba(230,192,122,0.16)" }}
          >
            <p
              className="italic"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                fontStyle: "italic",
                color: "rgba(230,220,200,0.68)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Drag the chart to pan. Scroll to zoom. Locked regions will lift as
              you chart the prior ones.
            </p>
          </div>

          <button
            onClick={handleDismiss}
            className="w-full mt-4 py-2.5 rounded-md font-semibold transition-colors"
            style={{
              background: GOLD,
              color: "#060C1A",
              fontSize: 13,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = GOLD_HI)}
            onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
          >
            Got it
          </button>
        </div>
      )}
    </>
  );
}

function LegendRow({
  icon,
  label,
  note,
}: {
  icon: "circle" | "diamond" | "star16" | "star8";
  label: string;
  note: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg viewBox="-18 -18 36 36" width="28" height="28">
          {icon === "circle" && (
            <circle r="12" fill="rgba(20,36,68,0.92)" stroke="#E6DCC8" strokeWidth="1.5" />
          )}
          {icon === "diamond" && (
            <g transform="rotate(45)">
              <rect
                x={-10}
                y={-10}
                width={20}
                height={20}
                rx="2.5"
                fill="rgba(20,36,68,0.92)"
                stroke="#E6DCC8"
                strokeWidth="1.5"
              />
            </g>
          )}
          {icon === "star16" && (
            <polygon
              points={Array.from({ length: 16 })
                .map((_, i) => {
                  const a = (i * Math.PI) / 8 - Math.PI / 2;
                  const r = 14;
                  const rad = i % 2 === 0 ? r : r * 0.68;
                  return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
                })
                .join(" ")}
              fill="rgba(230,192,122,0.22)"
              stroke={GOLD_HI}
              strokeWidth="1.6"
            />
          )}
          {icon === "star8" && (
            <polygon
              points={Array.from({ length: 8 })
                .map((_, i) => {
                  const a = (i * Math.PI) / 4 - Math.PI / 2;
                  const r = 14;
                  const rad = i % 2 === 0 ? r : r * 0.6;
                  return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
                })
                .join(" ")}
              fill="rgba(60,16,24,0.88)"
              stroke="#C44A54"
              strokeWidth="1.5"
            />
          )}
        </svg>
      </div>
      <div className="min-w-0">
        <p
          className="italic"
          style={{
            fontFamily: "Cormorant Garamond, serif",
            color: INK,
            fontSize: 15,
            fontWeight: 500,
            lineHeight: 1.1,
          }}
        >
          {label}
        </p>
        <p
          className="font-mono"
          style={{
            color: "rgba(230,220,200,0.55)",
            fontSize: 10.5,
            letterSpacing: "0.06em",
            marginTop: 2,
          }}
        >
          {note}
        </p>
      </div>
    </div>
  );
}
