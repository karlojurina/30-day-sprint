/**
 * Checkpoint theme map — drives the visual identity of each of the 7
 * checkpoints on the student path. Each checkpoint has a distinct SHAPE
 * (SVG path) and ICON, a Karlo voice line for the celebration moment, and
 * a color family.
 *
 * Shapes are drawn as SVG paths inside a 120×120 viewBox. Icons render
 * as inline SVGs inside the shape.
 */

export type CheckpointThemeKey =
  | "onboarding"
  | "foundations"
  | "first_ads"
  | "skill_stack"
  | "strategy"
  | "job_board"
  | "ad_bounties";

export interface CheckpointTheme {
  /** SVG path describing the outer shape, drawn into a 120×120 viewBox */
  shapePath: string;
  /** Icon rendered inside the shape — SVG path string for a 24×24 viewBox */
  iconPath: string;
  /** Whether the icon should be stroked (outline) vs filled */
  iconStyle: "stroke" | "fill";
  /** Karlo voice line shown at the celebration moment for this checkpoint */
  karloLine: string;
  /** Rotation applied to the shape for additional variety (degrees) */
  shapeRotation: number;
  /** CSS variable name for the accent color family */
  colorFamily: "warm" | "hot" | "cool";
}

// Shape paths — all drawn into a 120x120 viewBox, centered at (60, 60).
// Each is roughly the same visual "weight" so the path feels cohesive.
const SHAPES = {
  // Circle with 6 small decorative dots at the cardinals (onboarding — setting bearings)
  badge:
    "M60,10 a50,50 0 1,0 0.01,0 z",
  // Hexagon (foundations — builder feel)
  hexagon:
    "M60,8 L108,36 L108,84 L60,112 L12,84 L12,36 Z",
  // Sharp diamond (first_ads — target/sharp)
  diamond:
    "M60,6 L112,60 L60,114 L8,60 Z",
  // Rounded square (skill_stack — modular)
  roundedSquare:
    "M20,10 L100,10 Q110,10 110,20 L110,100 Q110,110 100,110 L20,110 Q10,110 10,100 L10,20 Q10,10 20,10 Z",
  // Shield (strategy — thinking/protection)
  shield:
    "M60,8 L108,22 L108,64 Q108,100 60,114 Q12,100 12,64 L12,22 Z",
  // Pentagon pointing up (job_board — entry/door)
  pentagon:
    "M60,8 L112,48 L92,112 L28,112 L8,48 Z",
  // Octagon (ad_bounties — prize/trophy)
  octagon:
    "M38,10 L82,10 L112,40 L112,80 L82,110 L38,110 L8,80 L8,40 Z",
} as const;

// Icon paths — drawn in a 24x24 viewBox, will be rendered inside the shape
const ICONS = {
  compass:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2z",
  layers:
    "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  target:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  wrench:
    "M14.7 6.3a5 5 0 0 0-7.4 6.6L3 17.2 6.8 21l4.3-4.3a5 5 0 0 0 6.6-7.4l-2.5 2.5-2.1-2.1 2.5-2.5z",
  brain:
    "M9 3a4 4 0 0 0-4 4v2a4 4 0 0 0-2 3.5 4 4 0 0 0 2 3.5v2a4 4 0 0 0 4 4h1V3H9zm6 0h-1v18h1a4 4 0 0 0 4-4v-2a4 4 0 0 0 2-3.5 4 4 0 0 0-2-3.5V7a4 4 0 0 0-4-4z",
  briefcase:
    "M3 7h18v13H3V7zm6-4h6v4H9V3zm-6 9h18",
  trophy:
    "M6 4h12v2a6 6 0 0 1-12 0V4zM4 4h2v3a5 5 0 0 1-3-4.6V2h1zm16 0h-2v3a5 5 0 0 0 3-4.6V2h-1zM10 14h4v4h-4v-4zm-3 4h10v2H7v-2z",
} as const;

export const CHECKPOINT_THEMES: Record<CheckpointThemeKey, CheckpointTheme> = {
  onboarding: {
    shapePath: SHAPES.badge,
    iconPath: ICONS.compass,
    iconStyle: "stroke",
    karloLine: "You're set up. Now the real work starts.",
    shapeRotation: 0,
    colorFamily: "warm",
  },
  foundations: {
    shapePath: SHAPES.hexagon,
    iconPath: ICONS.layers,
    iconStyle: "stroke",
    karloLine: "Foundations locked. You know the theory — now go build.",
    shapeRotation: 0,
    colorFamily: "warm",
  },
  first_ads: {
    shapePath: SHAPES.diamond,
    iconPath: ICONS.target,
    iconStyle: "fill",
    karloLine: "Two ads shipped. You just earned the discount.",
    shapeRotation: 0,
    colorFamily: "hot",
  },
  skill_stack: {
    shapePath: SHAPES.roundedSquare,
    iconPath: ICONS.wrench,
    iconStyle: "stroke",
    karloLine: "Full toolkit. You can make any ad type now.",
    shapeRotation: 8,
    colorFamily: "warm",
  },
  strategy: {
    shapePath: SHAPES.shield,
    iconPath: ICONS.brain,
    iconStyle: "stroke",
    karloLine:
      "You're thinking like a creative director. Bigger brain unlocked.",
    shapeRotation: 0,
    colorFamily: "cool",
  },
  job_board: {
    shapePath: SHAPES.pentagon,
    iconPath: ICONS.briefcase,
    iconStyle: "stroke",
    karloLine: "Applications out. Now we wait — and keep shipping.",
    shapeRotation: 0,
    colorFamily: "warm",
  },
  ad_bounties: {
    shapePath: SHAPES.octagon,
    iconPath: ICONS.trophy,
    iconStyle: "fill",
    karloLine: "Real briefs, real spend, real work. You're a creative now.",
    shapeRotation: 0,
    colorFamily: "hot",
  },
};

export function getCheckpointTheme(key: string): CheckpointTheme {
  return (
    CHECKPOINT_THEMES[key as CheckpointThemeKey] ?? CHECKPOINT_THEMES.onboarding
  );
}

export function colorVarsForFamily(family: CheckpointTheme["colorFamily"]) {
  if (family === "cool") {
    return {
      accent: "var(--color-milestone)",
      glow: "var(--color-milestone-glow)",
    };
  }
  // warm and hot both use the sunset-orange palette; hot uses a slightly
  // brighter/stronger glow
  return {
    accent: "var(--color-accent)",
    glow:
      family === "hot"
        ? "rgba(255, 107, 53, 0.5)"
        : "var(--color-accent-glow)",
  };
}
