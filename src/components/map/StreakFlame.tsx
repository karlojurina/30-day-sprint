"use client";

interface StreakFlameProps {
  current: number;
  longest: number;
}

/**
 * Streak indicator — Duolingo-style fire flame + day count.
 *
 * Three states:
 *   - 0 days: gray flame outline (cold)
 *   - 1–6 days: orange flame
 *   - 7+ days: bright orange/yellow flame with subtle pulse
 *
 * Designed to be immediately readable without explanation. The flame
 * is pure SVG (no emoji) so the rendering is consistent across
 * platforms and we can animate it.
 */
export function StreakFlame({ current, longest }: StreakFlameProps) {
  const isLit = current > 0;
  const isHot = current >= 7;

  const ariaLabel = isLit
    ? `${current}-day streak, longest ${longest}`
    : longest > 0
      ? `Streak broken — longest was ${longest}`
      : "No streak yet";

  return (
    <div
      style={{
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        borderRadius: 8,
        border: isLit
          ? "1px solid rgba(255,140,60,0.45)"
          : "1px solid rgba(230,220,200,0.18)",
        background: isLit ? "rgba(255,140,60,0.10)" : "rgba(16,32,66,0.6)",
        transition: "background 250ms cubic-bezier(0.22,1,0.36,1)",
      }}
      title={
        isLit
          ? `${current}-day streak · longest ${longest}`
          : longest > 0
            ? `Streak's gone cold. Longest was ${longest}.`
            : "Complete a lesson today to start a streak."
      }
      aria-label={ariaLabel}
    >
      <FlameSvg lit={isLit} hot={isHot} />
      <span
        className="font-mono tabular-nums font-bold"
        style={{
          color: isLit
            ? isHot
              ? "#FFB868"
              : "#FF8C3C"
            : "rgba(230,220,200,0.42)",
          fontSize: 15,
          minWidth: 16,
          textAlign: "right",
          lineHeight: 1,
        }}
      >
        {current}
      </span>
    </div>
  );
}

function FlameSvg({ lit, hot }: { lit: boolean; hot: boolean }) {
  return (
    <svg width="20" height="22" viewBox="0 0 24 28" aria-hidden="true">
      {/* Outer flame body */}
      <path
        d="M12 2 C 9 7, 5 10, 5 16 a 7 7 0 0 0 14 0 C 19 12, 16 10, 14 6 C 13 9, 11 9, 12 2 Z"
        fill={
          !lit
            ? "rgba(230,220,200,0.22)"
            : hot
              ? "url(#flame-grad-hot)"
              : "url(#flame-grad)"
        }
        stroke={lit ? "rgba(255,180,60,0.6)" : "rgba(230,220,200,0.4)"}
        strokeWidth={lit ? 0.8 : 1}
      >
        {lit && (
          <animate
            attributeName="opacity"
            values="0.95;1;0.95"
            dur="2.2s"
            repeatCount="indefinite"
          />
        )}
      </path>
      {/* Inner flame core */}
      {lit && (
        <path
          d="M12 9 C 10 12, 8 14, 8 17 a 4 4 0 0 0 8 0 C 16 14, 14 12, 12 9 Z"
          fill={hot ? "#FFE9B0" : "#FFD18A"}
          opacity="0.95"
        >
          <animate
            attributeName="opacity"
            values="0.85;1;0.85"
            dur="1.8s"
            repeatCount="indefinite"
          />
        </path>
      )}
      <defs>
        <linearGradient id="flame-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF6A1A" />
          <stop offset="100%" stopColor="#FFB868" />
        </linearGradient>
        <linearGradient id="flame-grad-hot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF4500" />
          <stop offset="60%" stopColor="#FF8C3C" />
          <stop offset="100%" stopColor="#FFE9B0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
