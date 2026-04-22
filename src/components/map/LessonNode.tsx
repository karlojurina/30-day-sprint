"use client";

import type { Lesson } from "@/types/database";

interface LessonNodeProps {
  lesson: Lesson;
  x: number;
  y: number;
  isDone: boolean;
  isCurrent: boolean;
  isUnlocked: boolean;
  regionLocked: boolean;
  /** true for ~1s after the student marks this lesson complete — plays a pulse */
  justCompleted?: boolean;
  onClick: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  peerCount?: number;
}

const TEAL = "#4DCEC4";
const NAVY_ACCENT = "#4DA0D8";
const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const CRIMSON = "#C44A54";
const NAVY_DARK = "rgba(6,12,26,0.88)";

// 16-point gate star (unlocked discount gate)
function gatePoints(r: number): string {
  return Array.from({ length: 16 })
    .map((_, i) => {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.68;
      return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
    })
    .join(" ");
}

// 8-point boss star
function bossPoints(r: number): string {
  return Array.from({ length: 8 })
    .map((_, i) => {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.6;
      return `${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`;
    })
    .join(" ");
}

/**
 * A single lesson pin on the expedition map — handles all 6 states:
 * locked / available / current / completed / gate / boss.
 *
 * When the lesson is the student's CURRENT position (and unlocked and not
 * yet done), the node displays the EcomTalent logo clipped to its own shape,
 * replacing the default inner mark. A pulsing ring still draws attention.
 */
export function LessonNode({
  lesson,
  x,
  y,
  isDone,
  isCurrent,
  isUnlocked,
  regionLocked,
  justCompleted = false,
  onClick,
  onHoverStart,
  onHoverEnd,
  peerCount = 0,
}: LessonNodeProps) {
  const isWatch = lesson.type === "watch";
  const isGate = lesson.is_gate;
  const isBoss = lesson.is_boss;

  let fill = "rgba(20,36,68,0.92)";
  let stroke = "rgba(230,220,200,0.6)";
  let markColor: string = isWatch ? TEAL : NAVY_ACCENT;

  if (isDone) {
    fill = GOLD;
    stroke = GOLD_HI;
    markColor = "#0A1428";
  }
  if (isBoss) {
    fill = "rgba(60,16,24,0.88)";
    stroke = CRIMSON;
    markColor = CRIMSON;
  }
  if (isGate && !isDone) {
    stroke = GOLD_HI;
    fill = "rgba(230,192,122,0.22)";
    markColor = GOLD_HI;
  }
  if (regionLocked || !isUnlocked) {
    fill = "rgba(20,36,68,0.55)";
    stroke = "rgba(230,220,200,0.25)";
    markColor = "rgba(230,220,200,0.3)";
  }

  // Node radius — gate is supersized, boss big, current slightly bigger
  let r: number;
  if (isBoss) r = 28;
  else if (isGate) r = 44;
  else if (isCurrent) r = 22;
  else r = 18;

  // If current-and-unlocked, tint the fill dark so the logo (which has its
  // own dark content) has contrast behind it. Gate overrides to darker too.
  const showLogo = isCurrent && isUnlocked && !isDone;
  const shapeFill = showLogo ? NAVY_DARK : fill;

  // Per-shape clipPath id so the logo respects the node's outline
  const clipId = `node-clip-${lesson.id}`;

  const a11yLabel = regionLocked
    ? `${lesson.title} — locked`
    : isDone
      ? `${lesson.title} — completed`
      : `${lesson.title}${isGate ? " — discount gate" : isBoss ? " — final reflection" : ""}`;

  return (
    <g
      data-node
      transform={`translate(${x}, ${y})`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={onClick}
      role="button"
      tabIndex={regionLocked ? -1 : 0}
      aria-label={a11yLabel}
      onKeyDown={(e) => {
        if (regionLocked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: regionLocked ? "not-allowed" : "pointer" }}
    >
      <defs>
        <clipPath id={clipId}>
          {isGate && !isDone ? (
            <polygon points={gatePoints(r)} />
          ) : isWatch ? (
            <circle r={r} />
          ) : isBoss ? (
            <polygon points={bossPoints(r)} />
          ) : (
            <g transform="rotate(45)">
              <rect
                x={-r * 0.8}
                y={-r * 0.8}
                width={r * 1.6}
                height={r * 1.6}
                rx="3"
              />
            </g>
          )}
        </clipPath>
      </defs>

      {/* Gate — multi-layer glow + pulsing rings */}
      {isGate && !isDone && !regionLocked && (
        <>
          <circle r={r + 46} fill={GOLD_HI} opacity="0.1">
            <animate
              attributeName="opacity"
              values="0.08;0.2;0.08"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </circle>
          <circle r={r + 22} fill="none" stroke={GOLD_HI} strokeWidth="1.8" opacity="0.55">
            <animate
              attributeName="r"
              values={`${r + 12};${r + 32};${r + 12}`}
              dur="2.8s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.7;0;0.7"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </circle>
          <circle r={r + 14} fill="none" stroke={GOLD_HI} strokeWidth="1.4" opacity="0.4">
            <animate
              attributeName="r"
              values={`${r + 8};${r + 24};${r + 8}`}
              dur="2.8s"
              begin="1.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.6;0;0.6"
              dur="2.8s"
              begin="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            r={r + 8}
            fill="rgba(230,192,122,0.18)"
            stroke="rgba(230,192,122,0.6)"
            strokeWidth="1.4"
          />
        </>
      )}

      {/* Current-lesson pulsing ring (non-gate) */}
      {isCurrent && !isGate && (
        <circle r={r + 14} fill="none" stroke={GOLD_HI} strokeWidth="1.5" opacity="0.5">
          <animate
            attributeName="r"
            values={`${r + 6};${r + 22};${r + 6}`}
            dur="3s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.6;0;0.6"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Completion pulse — expanding gold ring, fires once on completion */}
      {justCompleted && (
        <circle
          r={r}
          fill="none"
          stroke={GOLD_HI}
          strokeWidth="2.5"
          className="lesson-complete-pulse"
          style={{ transformOrigin: "0 0", transformBox: "fill-box" }}
        />
      )}

      {/* Shadow */}
      <ellipse cx="0" cy={r + 4} rx={r * 0.85} ry={r * 0.2} fill="rgba(0,0,0,0.45)" />

      {/* Body */}
      {isGate && !isDone ? (
        <polygon points={gatePoints(r)} fill={shapeFill} stroke={stroke} strokeWidth="2" />
      ) : isWatch ? (
        <circle r={r} fill={shapeFill} stroke={stroke} strokeWidth="1.8" />
      ) : isBoss ? (
        <polygon points={bossPoints(r)} fill={shapeFill} stroke={stroke} strokeWidth="1.8" />
      ) : (
        <g transform="rotate(45)">
          <rect
            x={-r * 0.8}
            y={-r * 0.8}
            width={r * 1.6}
            height={r * 1.6}
            rx="3"
            fill={shapeFill}
            stroke={stroke}
            strokeWidth="1.8"
          />
        </g>
      )}

      {/* Inner content — logo for current node, regular mark otherwise */}
      {showLogo ? (
        <image
          href="/ecomtalent-logo.png"
          x={-r * 0.9}
          y={-r * 0.9}
          width={r * 1.8}
          height={r * 1.8}
          preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${clipId})`}
          aria-label="You are here"
        >
          <title>You are here — EcomTalent</title>
        </image>
      ) : isGate && !isDone ? (
        <g fill="none" stroke={markColor} strokeWidth="2.2" strokeLinecap="round">
          <circle cx="-5" cy="-5" r="3" />
          <circle cx="5" cy="5" r="3" />
          <line x1="-8" y1="8" x2="8" y2="-8" />
        </g>
      ) : isDone ? (
        <path
          d="M -6 0 L -2 4 L 7 -5"
          stroke={markColor}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : isBoss ? (
        <path
          d="M -8 -5 L -5 4 L 0 -7 L 5 4 L 8 -5 M -8 6 L 8 6"
          stroke={markColor}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      ) : isWatch ? (
        <path d="M -3 -5 L 5 0 L -3 5 Z" fill={markColor} />
      ) : (
        <g stroke={markColor} strokeWidth="2" strokeLinecap="round">
          <line x1="-4" y1="0" x2="4" y2="0" />
          <line x1="0" y1="-4" x2="0" y2="4" />
        </g>
      )}

      {/* Peer counter */}
      {peerCount > 0 && !regionLocked && (
        <g transform={`translate(${r + 2}, ${r - 4})`} opacity="0.6">
          <circle cx="4" cy="0" r="2.5" fill={TEAL} />
          <text
            x="10"
            y="3.5"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
            fontSize="10"
            fill="rgba(230,220,200,0.85)"
          >
            {peerCount}
          </text>
        </g>
      )}

      {/* Gate banner — placed far above the node (−90px) with a thin dashed
          connector so it can't overlap the neighboring lesson on a tight path. */}
      {isGate && !isDone && (
        <g transform={`translate(0, ${-r - 90})`}>
          {/* Connector dashes back to the node */}
          <line
            x1="0"
            y1="20"
            x2="0"
            y2={64}
            stroke={GOLD}
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.55"
          />
          <rect
            x="-100"
            y="-16"
            width="200"
            height="32"
            rx="5"
            fill="#0A1428"
            stroke={GOLD}
            strokeWidth="1.6"
          />
          <rect
            x="-96"
            y="-12"
            width="192"
            height="24"
            rx="3"
            fill="none"
            stroke="rgba(230,192,122,0.45)"
            strokeWidth="0.7"
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
            fontSize="12"
            fontWeight="700"
            fill={GOLD_HI}
            letterSpacing="4"
          >
            30% DISCOUNT
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * Hover preview card — rendered in MapCanvas as a TOP LAYER after all nodes,
 * so it's never occluded by a sibling node that renders later in the SVG.
 */
export function HoverPreviewCard({
  lesson,
  x,
  y,
  r,
}: {
  lesson: Lesson;
  x: number;
  y: number;
  r: number;
}) {
  const isWatch = lesson.type === "watch";

  return (
    <g transform={`translate(${x}, ${y + r + 18})`} style={{ pointerEvents: "none" }}>
      <rect
        x="-130"
        y="0"
        width="260"
        height={isWatch ? 110 : 82}
        rx="8"
        fill="#0A1428"
        stroke="rgba(230,192,122,0.55)"
        strokeWidth="1.2"
      />
      {isWatch && (
        <g>
          <rect
            x="-120"
            y="10"
            width="240"
            height="54"
            rx="4"
            fill="rgba(77,206,196,0.1)"
            stroke="rgba(77,206,196,0.4)"
            strokeWidth="0.8"
          />
          <circle
            cx="0"
            cy="37"
            r="14"
            fill="rgba(230,192,122,0.2)"
            stroke={GOLD}
            strokeWidth="1.2"
          />
          <path d="M -4 31 L 8 37 L -4 43 Z" fill={GOLD} />
          {lesson.duration_label && (
            <>
              <rect x="78" y="52" width="38" height="10" rx="2" fill="rgba(10,20,40,0.9)" />
              <text
                x="97"
                y="59"
                textAnchor="middle"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                fontSize="8"
                fill={GOLD}
              >
                {lesson.duration_label}
              </text>
            </>
          )}
        </g>
      )}
      <text
        x="0"
        y={isWatch ? 82 : 22}
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="9"
        fill="rgba(230,192,122,0.9)"
        letterSpacing="2.5"
      >
        {`${lesson.type.toUpperCase()}${lesson.duration_label ? "  ·  " + lesson.duration_label : ""}`}
      </text>
      <text
        x="0"
        y={isWatch ? 100 : 48}
        textAnchor="middle"
        fontFamily="Cormorant Garamond, serif"
        fontStyle="italic"
        fontSize="15"
        fill="#E6DCC8"
      >
        {lesson.title.length > 36 ? lesson.title.slice(0, 34) + "…" : lesson.title}
      </text>
      {!isWatch && lesson.description && (
        <text
          x="0"
          y={68}
          textAnchor="middle"
          fontFamily="Cormorant Garamond, serif"
          fontStyle="italic"
          fontSize="11"
          fill="rgba(230,220,200,0.6)"
        >
          {lesson.description.length > 48
            ? lesson.description.slice(0, 46) + "…"
            : lesson.description}
        </text>
      )}
    </g>
  );
}
