"use client";

import type { Region } from "@/types/database";
import type { RegionStrip } from "@/lib/map/path-math";
import type { RegionProgress } from "@/contexts/StudentContext";

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";

/**
 * Region cartouche — title panel ABOVE each region strip.
 * The only piece of map chrome we kept — compass rose, scale bar, legend,
 * corner ornaments and the chart frame were all removed so the map IS the page.
 */
export function RegionCartouche({
  region,
  regionStrip: s,
  state,
}: {
  region: Region;
  regionStrip: RegionStrip;
  state: RegionProgress;
}) {
  const xMid = (s.xStart + s.xEnd) / 2;
  const yBase = s.yTop - 70;
  const accent = state.isComplete
    ? GOLD_HI
    : state.isUnlocked
      ? GOLD
      : "rgba(230,192,122,0.45)";
  const inkCol = state.isUnlocked ? "#E6DCC8" : "rgba(230,220,200,0.45)";
  const numerals = ["I", "II", "III", "IV"];
  const numeral = numerals[region.order_num - 1];

  const panelW = Math.min(640, s.xEnd - s.xStart - 120);
  const panelH = 110;

  return (
    <g transform={`translate(${xMid}, ${yBase})`}>
      <rect
        x={-panelW / 2}
        y={-panelH / 2}
        width={panelW}
        height={panelH}
        rx="8"
        fill="rgba(6,12,26,0.72)"
        stroke={accent}
        strokeWidth="1.2"
      />
      <rect
        x={-panelW / 2 + 6}
        y={-panelH / 2 + 6}
        width={panelW - 12}
        height={panelH - 12}
        rx="5"
        fill="none"
        stroke={accent}
        strokeWidth="0.6"
        opacity="0.6"
      />

      {/* Roman numeral badge */}
      <g transform={`translate(${-panelW / 2 + 44}, 0)`}>
        <circle r="26" fill="rgba(10,20,40,0.85)" stroke={accent} strokeWidth="1.4" />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Cormorant Garamond, Georgia, serif"
          fontSize="24"
          fontWeight="600"
          fill={accent}
          letterSpacing="1"
        >
          {numeral}
        </text>
      </g>

      {/* REGION label + days */}
      <text
        x={-panelW / 2 + 88}
        y={-26}
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="11"
        fill={state.isUnlocked ? "rgba(230,220,200,0.75)" : "rgba(230,220,200,0.4)"}
        letterSpacing="5"
      >
        REGION {numeral} · {region.days_label.toUpperCase()}
      </text>

      {/* Name */}
      <text
        x={-panelW / 2 + 88}
        y={8}
        fontFamily="Cormorant Garamond, Georgia, serif"
        fontSize="34"
        fontWeight="500"
        fontStyle="italic"
        fill={inkCol}
      >
        {region.name}
      </text>

      {/* Tagline */}
      <text
        x={-panelW / 2 + 88}
        y={32}
        fontFamily="Cormorant Garamond, Georgia, serif"
        fontSize="14"
        fontStyle="italic"
        fill={state.isUnlocked ? "rgba(230,220,200,0.65)" : "rgba(230,220,200,0.35)"}
      >
        {region.tagline}
      </text>

      {/* Right edge — progress or lock */}
      <g transform={`translate(${panelW / 2 - 28}, 0)`}>
        {state.isUnlocked ? (
          <>
            <text
              textAnchor="end"
              y={state.isComplete ? 4 : -6}
              fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize={state.isComplete ? "13" : "11"}
              letterSpacing={state.isComplete ? "3" : "2"}
              fontWeight={state.isComplete ? "700" : "500"}
              fill={state.isComplete ? GOLD_HI : "rgba(230,220,200,0.6)"}
            >
              {state.isComplete ? "CHARTED" : `${state.completed}/${state.total}`}
            </text>
            {!state.isComplete && (
              <text
                textAnchor="end"
                y={12}
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                fontSize="9"
                letterSpacing="3"
                fill="rgba(230,220,200,0.4)"
              >
                CHARTED
              </text>
            )}
          </>
        ) : (
          <g transform="translate(-8, -10)">
            <rect
              x="-2"
              y="6"
              width="24"
              height="16"
              rx="2"
              fill="none"
              stroke={accent}
              strokeWidth="1.6"
            />
            <path
              d="M 2 6 V 0 a 8 8 0 0 1 16 0 V 6"
              fill="none"
              stroke={accent}
              strokeWidth="1.6"
            />
          </g>
        )}
      </g>
    </g>
  );
}
