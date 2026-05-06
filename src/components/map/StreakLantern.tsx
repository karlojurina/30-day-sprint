"use client";

interface StreakLanternProps {
  /** Current streak in days. 0 means broken / never started. */
  current: number;
  /** Longest streak — used in the tooltip. */
  longest: number;
}

/**
 * Streak indicator as a lit lantern instead of the 🔥 emoji + count.
 *
 * On-metaphor for the explorer's-chart aesthetic: a lantern is what
 * a cartographer carries on a long journey. The flame breathes
 * gently when the streak is alive, intensifies at milestone tiers
 * (7 / 14 / 30 days), and dims to a cold filament when the streak
 * is broken.
 *
 * Accessibility: the day count is rendered as a small mono numeral
 * inside the lantern body so screen readers + sighted users still
 * see the actual number. aria-label spells it out.
 */
export function StreakLantern({ current, longest }: StreakLanternProps) {
  const isLit = current > 0;
  const tier = current >= 30 ? 3 : current >= 14 ? 2 : current >= 7 ? 1 : 0;

  // Flame color brightens at higher tiers
  const flameCore =
    tier >= 3
      ? "#FFE9B0"
      : tier >= 2
        ? "#F5D58A"
        : tier >= 1
          ? "#F0C97A"
          : "#E6C07A";
  const flameGlow =
    tier >= 3
      ? "rgba(255,233,176,0.6)"
      : tier >= 2
        ? "rgba(245,213,138,0.5)"
        : tier >= 1
          ? "rgba(240,201,122,0.4)"
          : "rgba(230,192,122,0.3)";

  // Outer pill glow ramps with tier so longer streaks visually carry weight
  const pillShadow = isLit
    ? tier >= 2
      ? "0 0 22px rgba(230,192,122,0.45)"
      : tier >= 1
        ? "0 0 16px rgba(230,192,122,0.3)"
        : "0 0 10px rgba(230,192,122,0.2)"
    : "none";

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
        gap: 8,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid rgba(230,192,122,0.28)",
        background: isLit ? "rgba(230,192,122,0.14)" : "rgba(16,32,66,0.6)",
        boxShadow: pillShadow,
        transition: "box-shadow 300ms cubic-bezier(0.22,1,0.36,1), background 300ms cubic-bezier(0.22,1,0.36,1)",
      }}
      title={
        isLit
          ? `${current}-day streak · longest ${longest} · keep showing up`
          : longest > 0
            ? `Streak's gone cold. Longest was ${longest}. Light it again today.`
            : "Complete a lesson today to start a streak."
      }
      aria-label={ariaLabel}
    >
      <svg
        width="18"
        height="22"
        viewBox="0 0 22 28"
        fill="none"
        aria-hidden="true"
      >
        {/* Lantern frame: top hook */}
        <path
          d="M11 1 V 4"
          stroke="rgba(230,192,122,0.7)"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <path
          d="M8.5 4 H 13.5"
          stroke="rgba(230,192,122,0.7)"
          strokeWidth="1.1"
          strokeLinecap="round"
        />

        {/* Cap */}
        <rect
          x="6.5"
          y="5"
          width="9"
          height="2"
          rx="0.6"
          fill="rgba(230,192,122,0.55)"
        />

        {/* Glass body — gradient dimmed when unlit */}
        <defs>
          <radialGradient id="lantern-glow" cx="50%" cy="55%" r="55%">
            <stop offset="0%" stopColor={isLit ? flameGlow : "rgba(230,192,122,0.06)"} />
            <stop offset="100%" stopColor="rgba(6,12,26,0)" />
          </radialGradient>
        </defs>
        <rect
          x="5"
          y="7"
          width="12"
          height="14"
          rx="1.5"
          fill="url(#lantern-glow)"
          stroke="rgba(230,192,122,0.55)"
          strokeWidth="0.9"
        />

        {/* Flame — only when lit. Gentle breathing animation comes from
            CSS (see globals.css `pulse-ring` family). For tier 3 we
            paint a slightly larger flame to convey "hot streak" without
            doing anything garish. */}
        {isLit && (
          <g style={{ transformOrigin: "11px 16px" }}>
            <ellipse
              cx="11"
              cy={tier >= 2 ? 14.5 : 15}
              rx={tier >= 2 ? 2.4 : 2}
              ry={tier >= 2 ? 4 : 3.2}
              fill={flameCore}
              opacity="0.95"
            >
              <animate
                attributeName="ry"
                values={`${tier >= 2 ? 4 : 3.2};${tier >= 2 ? 4.4 : 3.6};${tier >= 2 ? 4 : 3.2}`}
                dur="2.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.92;1;0.92"
                dur="2.4s"
                repeatCount="indefinite"
              />
            </ellipse>
            <circle cx="11" cy="16.5" r="1.1" fill="rgba(255,255,255,0.8)" />
          </g>
        )}

        {/* Base */}
        <rect
          x="6.5"
          y="21"
          width="9"
          height="2"
          rx="0.6"
          fill="rgba(230,192,122,0.55)"
        />
        <path
          d="M11 23 V 26"
          stroke="rgba(230,192,122,0.5)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>

      <span
        className="font-mono tabular-nums font-bold"
        style={{
          color: isLit ? "var(--color-gold-light)" : "rgba(230,220,200,0.42)",
          fontSize: 14,
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
