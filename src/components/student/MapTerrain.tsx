"use client";

interface MapTerrainProps {
  width: number;
  height: number;
}

/**
 * Background SVG layer with topographic contour lines.
 * Renders subtle warm-tinted terrain patterns at low opacity.
 */
export function MapTerrain({ width, height }: MapTerrainProps) {
  if (width === 0 || height === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-0"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width={width}
      height={height}
    >
      <defs>
        {/* Contour line pattern — primary */}
        <pattern
          id="terrain-contour-1"
          width="120"
          height="120"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 60 Q30 40 60 60 Q90 80 120 60"
            fill="none"
            stroke="rgba(245, 242, 237, 0.06)"
            strokeWidth="0.8"
          />
          <path
            d="M0 90 Q40 70 80 90 Q100 100 120 85"
            fill="none"
            stroke="rgba(245, 242, 237, 0.04)"
            strokeWidth="0.6"
          />
          <path
            d="M0 30 Q20 20 50 30 Q80 40 120 25"
            fill="none"
            stroke="rgba(245, 242, 237, 0.05)"
            strokeWidth="0.6"
          />
        </pattern>

        {/* Secondary contour — rotated for variation */}
        <pattern
          id="terrain-contour-2"
          width="160"
          height="160"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(15)"
        >
          <path
            d="M0 80 Q40 60 80 80 Q120 100 160 75"
            fill="none"
            stroke="rgba(245, 242, 237, 0.04)"
            strokeWidth="0.6"
          />
          <path
            d="M0 40 Q50 25 100 45 Q130 55 160 35"
            fill="none"
            stroke="rgba(245, 242, 237, 0.03)"
            strokeWidth="0.5"
          />
          <circle
            cx="80"
            cy="120"
            r="20"
            fill="none"
            stroke="rgba(245, 242, 237, 0.03)"
            strokeWidth="0.5"
          />
        </pattern>

        {/* Dot grid for extra depth */}
        <pattern
          id="terrain-dots"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="20" cy="20" r="0.5" fill="rgba(245, 242, 237, 0.05)" />
        </pattern>
      </defs>

      {/* Apply patterns across the full area */}
      <rect width={width} height={height} fill="url(#terrain-contour-1)" />
      <rect width={width} height={height} fill="url(#terrain-contour-2)" />
      <rect width={width} height={height} fill="url(#terrain-dots)" />
    </svg>
  );
}
