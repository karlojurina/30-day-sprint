"use client";

import { motion } from "framer-motion";
import type { StudentTitle } from "@/types/database";

interface MapCharacterProps {
  x: number;
  y: number;
  title: StudentTitle;
}

/**
 * Avatar that moves along the map at the student's current position.
 * Evolves with rank: gains accessories per title upgrade.
 */
export function MapCharacter({ x, y, title }: MapCharacterProps) {
  // Character appearance based on title
  const config = TITLE_VISUALS[title];

  return (
    <motion.div
      className="absolute pointer-events-none z-[5]"
      animate={{ left: x - 20, top: y - 20 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      style={{ width: 40, height: 40 }}
    >
      {/* Outer glow (higher ranks) */}
      {config.glowColor && (
        <div
          className="absolute inset-[-8px] rounded-full"
          style={{
            background: `radial-gradient(circle, ${config.glowColor} 0%, transparent 70%)`,
            opacity: config.glowOpacity ?? 0.4,
          }}
        />
      )}

      {/* Base avatar circle */}
      <svg
        viewBox="0 0 40 40"
        className="w-full h-full relative z-10"
        fill="none"
      >
        {/* Ring */}
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="var(--color-bg-card)"
          stroke={config.ringColor}
          strokeWidth={config.ringWidth}
        />

        {/* Simple person silhouette */}
        <circle cx="20" cy="15" r="5" fill={config.iconColor} />
        <path
          d="M12 30 C12 24 16 21 20 21 C24 21 28 24 28 30"
          fill={config.iconColor}
        />

        {/* Badge accessory */}
        {config.badge && (
          <g transform="translate(28, 4)">
            <circle cx="0" cy="0" r="7" fill={config.badgeColor ?? config.ringColor} />
            <path
              d={config.badge}
              fill="var(--color-bg-primary)"
              transform="translate(-4, -4) scale(0.65)"
            />
          </g>
        )}

        {/* Crown for Pro */}
        {title === "ecomtalent_pro" && (
          <g transform="translate(11, -2)">
            <path
              d="M0 10 L3 3 L6 7 L9 0 L12 7 L15 3 L18 10 Z"
              fill="#FFD700"
              stroke="#B8860B"
              strokeWidth="0.5"
            />
          </g>
        )}
      </svg>
    </motion.div>
  );
}

interface TitleVisual {
  ringColor: string;
  ringWidth: number;
  iconColor: string;
  glowColor: string | null;
  glowOpacity?: number;
  badge: string | null; // SVG path for badge icon
  badgeColor?: string;
}

const TITLE_VISUALS: Record<StudentTitle, TitleVisual> = {
  recruit: {
    ringColor: "var(--color-border-strong)",
    ringWidth: 1.5,
    iconColor: "var(--color-text-tertiary)",
    glowColor: null,
    badge: null,
  },
  explorer: {
    ringColor: "var(--color-text-secondary)",
    ringWidth: 2,
    iconColor: "var(--color-text-secondary)",
    glowColor: null,
    // Compass badge
    badge: "M6 0 L8 5 L6 12 L4 5 Z M0 6 L5 4 L12 6 L5 8 Z",
    badgeColor: "var(--color-milestone)",
  },
  apprentice: {
    ringColor: "var(--color-accent)",
    ringWidth: 2,
    iconColor: "var(--color-text-primary)",
    glowColor: null,
    // Book/notebook badge
    badge: "M2 1 H10 V11 H2 Z M4 3 H8 M4 5 H8 M4 7 H8",
    badgeColor: "var(--color-accent)",
  },
  ad_creator: {
    ringColor: "var(--color-accent)",
    ringWidth: 2.5,
    iconColor: "var(--color-text-primary)",
    glowColor: "var(--color-accent-glow)",
    glowOpacity: 0.3,
    badge: null,
  },
  strategist: {
    ringColor: "var(--color-accent-light)",
    ringWidth: 2.5,
    iconColor: "var(--color-text-primary)",
    glowColor: "var(--color-accent-glow)",
    glowOpacity: 0.5,
    badge: null,
  },
  bounty_hunter: {
    ringColor: "#FFD700",
    ringWidth: 2.5,
    iconColor: "var(--color-text-primary)",
    glowColor: "rgba(255, 215, 0, 0.25)",
    glowOpacity: 0.5,
    badge: null,
  },
  ecomtalent_pro: {
    ringColor: "#FFD700",
    ringWidth: 3,
    iconColor: "var(--color-text-primary)",
    glowColor: "rgba(255, 215, 0, 0.4)",
    glowOpacity: 0.6,
    badge: null,
  },
};
