"use client";

import type { Region } from "@/types/database";
import type { RegionStrip } from "@/lib/map/path-math";
import type { RegionProgress } from "@/contexts/StudentContext";

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";

/**
 * Region cartouche — title panel ABOVE each region strip.
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
        fontFamily="monospace"
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
              y={-6}
              fontFamily="monospace"
              fontSize="11"
              letterSpacing="2"
              fill={state.isComplete ? GOLD_HI : "rgba(230,220,200,0.6)"}
            >
              {state.isComplete ? "CHARTED" : `${state.completed}/${state.total}`}
            </text>
            <text
              textAnchor="end"
              y={12}
              fontFamily="monospace"
              fontSize="9"
              letterSpacing="3"
              fill="rgba(230,220,200,0.4)"
            >
              COMPLETE
            </text>
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

export function CompassRose({ x, y }: { x: number; y: number }) {
  const r = 60;
  return (
    <g transform={`translate(${x}, ${y})`} opacity="0.78">
      <circle r={r} fill="rgba(10,20,40,0.55)" stroke="rgba(230,192,122,0.55)" strokeWidth="1" />
      <circle r={r - 8} fill="none" stroke="rgba(230,192,122,0.3)" strokeWidth="0.6" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <polygon
            points={`0,${-r + 4} -4,0 0,-8 4,0`}
            fill={a % 90 === 0 ? "rgba(230,192,122,0.75)" : "rgba(230,192,122,0.35)"}
            stroke="rgba(230,192,122,0.6)"
            strokeWidth="0.6"
          />
        </g>
      ))}
      {[
        [0, -r + 18, "N"],
        [r - 18, 0, "E"],
        [0, r - 14, "S"],
        [-r + 18, 0, "W"],
      ].map(([xx, yy, t], i) => (
        <text
          key={i}
          x={xx as number}
          y={yy as number}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Cormorant Garamond, serif"
          fontSize="12"
          fontWeight="600"
          fill="rgba(230,220,200,0.88)"
        >
          {t}
        </text>
      ))}
      <circle r="3" fill="rgba(230,192,122,0.9)" />
      <circle r="1" fill="#0A1428" />
    </g>
  );
}

export function ScaleBar({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`} opacity="0.78">
      <text
        fontFamily="monospace"
        fontSize="10"
        fill="rgba(230,220,200,0.75)"
        letterSpacing="2"
        y="-10"
      >
        30 DAYS
      </text>
      {Array.from({ length: 6 }).map((_, i) => (
        <rect
          key={i}
          x={i * 18}
          y="0"
          width="18"
          height="4"
          fill={i % 2 === 0 ? "rgba(230,220,200,0.8)" : "transparent"}
          stroke="rgba(230,220,200,0.7)"
          strokeWidth="0.6"
        />
      ))}
      <text fontFamily="monospace" fontSize="9" fill="rgba(230,220,200,0.55)" y="18">
        0
      </text>
      <text
        fontFamily="monospace"
        fontSize="9"
        fill="rgba(230,220,200,0.55)"
        x="108"
        y="18"
        textAnchor="end"
      >
        30
      </text>
    </g>
  );
}

export function MapLegend({ x, y }: { x: number; y: number }) {
  const items: { kind: "watch" | "action" | "done" | "you"; label: string }[] = [
    { kind: "watch", label: "Lesson (video)" },
    { kind: "action", label: "Action item" },
    { kind: "done", label: "Completed" },
    { kind: "you", label: "You are here" },
  ];
  return (
    <g transform={`translate(${x}, ${y})`} opacity="0.88">
      <rect
        x="0"
        y="0"
        width="440"
        height="130"
        rx="10"
        fill="rgba(10,20,40,0.7)"
        stroke="rgba(230,192,122,0.35)"
        strokeWidth="1"
      />
      <text
        x="18"
        y="24"
        fontFamily="monospace"
        fontSize="10"
        letterSpacing="3"
        fill="rgba(230,192,122,0.85)"
      >
        LEGEND
      </text>
      {items.map((it, i) => (
        <g
          key={it.kind}
          transform={`translate(${24 + (i % 2) * 210}, ${54 + Math.floor(i / 2) * 34})`}
        >
          {it.kind === "watch" && <circle cx="10" cy="0" r="9" fill="#4DCEC4" opacity="0.9" />}
          {it.kind === "action" && (
            <polygon points="1,-8 19,-8 19,8 1,8" fill="none" stroke="#4DA0D8" strokeWidth="1.6" />
          )}
          {it.kind === "done" && <circle cx="10" cy="0" r="9" fill="#E6C07A" />}
          {it.kind === "you" && (
            <polygon points="10,-10 13,-3 20,0 13,3 10,10 7,3 0,0 7,-3" fill="#F0D595" />
          )}
          <text
            x="34"
            y="5"
            fontFamily="Cormorant Garamond, serif"
            fontStyle="italic"
            fontSize="15"
            fill="rgba(230,220,200,0.9)"
          >
            {it.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function CornerOrnament({ x, y, rot = 0 }: { x: number; y: number; rot?: number }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${rot})`} opacity="0.62">
      <path d="M 0 24 L 0 0 L 24 0" stroke="rgba(230,192,122,0.75)" strokeWidth="1.4" fill="none" />
      <path d="M 6 30 L 6 6 L 30 6" stroke="rgba(230,192,122,0.4)" strokeWidth="0.8" fill="none" />
      <circle cx="0" cy="0" r="3.5" fill="none" stroke="rgba(230,192,122,0.75)" strokeWidth="1" />
      <circle cx="0" cy="0" r="1.2" fill="rgba(230,192,122,0.85)" />
    </g>
  );
}
