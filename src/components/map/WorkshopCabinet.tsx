"use client";

import { useState } from "react";
import type { Region } from "@/types/database";
import type { RegionProgress } from "@/contexts/StudentContext";
import { NOTE_ARTIFACTS } from "@/lib/artifacts";

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const INK = "#E6DCC8";

/**
 * The Workshop Cabinet — a grid of artifacts the student collects.
 * Two tiers:
 *   - Region artifacts (top section): unlock when the region completes
 *   - Note-driven artifacts (bottom section): unlock by journaling
 * Locked items appear faded; unlocked ones glow in parchment gold.
 * Pure SVG — swappable for real illustrations later if we commission them.
 */
export function WorkshopCabinet({
  regions,
  regionProgress,
  noteArtifactIds,
}: {
  regions: Region[];
  regionProgress: Record<string, RegionProgress>;
  noteArtifactIds?: Set<string>;
}) {
  const unlockedCount = regions.filter((r) => regionProgress[r.id]?.isComplete).length;
  const totalItems = ARTIFACTS_BY_REGION.flatMap((g) => g.items).length;
  const unlockedItems = ARTIFACTS_BY_REGION.filter((g) =>
    regions
      .filter((r) => regionProgress[r.id]?.isComplete)
      .some((r) => r.id === g.regionId)
  ).flatMap((g) => g.items).length;
  const noteIds = noteArtifactIds ?? new Set<string>();
  const noteUnlocked = NOTE_ARTIFACTS.filter((a) => noteIds.has(a.id)).length;
  const totalAll = totalItems + NOTE_ARTIFACTS.length;
  const unlockedAll = unlockedItems + noteUnlocked;

  return (
    <div
      className="mt-8"
      style={{
        borderTop: "1px solid rgba(230,192,122,0.2)",
        paddingTop: 24,
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <p
            className="font-mono uppercase mb-1"
            style={{
              color: GOLD,
              letterSpacing: "0.18em",
              fontSize: 10,
            }}
          >
            Your Workshop
          </p>
          <h2
            className="italic"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              color: INK,
              fontWeight: 500,
              fontSize: 24,
              lineHeight: 1.1,
            }}
          >
            The Cabinet
          </h2>
        </div>
        <p
          className="font-mono"
          style={{
            color: "rgba(230,220,200,0.6)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          {unlockedAll} / {totalAll} collected ·{" "}
          {unlockedCount} of {regions.length} regions charted
        </p>
      </div>

      <p
        className="italic mb-6"
        style={{
          fontFamily: "Cormorant Garamond, serif",
          fontStyle: "italic",
          color: "rgba(230,220,200,0.62)",
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: 540,
        }}
      >
        Every region you chart adds something to the shelf. Small things at
        first — a notebook, a lantern. Later, a sextant. By the end, a medal
        from the market.
      </p>

      {/* Region blocks */}
      <div className="space-y-8">
        {ARTIFACTS_BY_REGION.map((group) => {
          const region = regions.find((r) => r.id === group.regionId);
          const unlocked = region
            ? regionProgress[region.id]?.isComplete
            : false;
          return (
            <CabinetShelf
              key={group.regionId}
              group={group}
              region={region}
              unlocked={Boolean(unlocked)}
            />
          );
        })}
      </div>

      {/* Note-driven artifacts — earned by journaling, not by completing
          regions. Renders below the region shelves with its own header. */}
      <div className="mt-10">
        <div className="flex items-baseline gap-3 mb-3">
          <span
            className="font-mono"
            style={{
              color: GOLD,
              letterSpacing: "0.14em",
              fontSize: 10,
              textTransform: "uppercase",
            }}
          >
            Earned by journaling
          </span>
          <span
            style={{
              color: INK,
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            The Scribe&rsquo;s Set
          </span>
          <span
            className="font-mono ml-auto"
            style={{
              color: noteUnlocked > 0 ? GOLD_HI : "rgba(230,220,200,0.32)",
              fontSize: 10,
              letterSpacing: "0.16em",
            }}
          >
            {noteUnlocked} / {NOTE_ARTIFACTS.length}
          </span>
        </div>
        <div
          style={{
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(230,192,122,0.25), transparent)",
            marginBottom: 16,
          }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {NOTE_ARTIFACTS.map((artifact) => (
            <NoteArtifactCard
              key={artifact.id}
              artifact={artifact}
              unlocked={noteIds.has(artifact.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoteArtifactCard({
  artifact,
  unlocked,
}: {
  artifact: (typeof NOTE_ARTIFACTS)[number];
  unlocked: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      className="relative rounded-lg p-3 outline-none cursor-default"
      style={{
        background: unlocked
          ? "radial-gradient(ellipse at top, rgba(230,192,122,0.16) 0%, rgba(6,12,26,0.55) 100%)"
          : "rgba(6,12,26,0.45)",
        border: unlocked
          ? "1px solid var(--color-gold)"
          : "1px dashed rgba(230,192,122,0.18)",
        boxShadow: unlocked
          ? "0 0 18px rgba(230,192,122,0.18) inset"
          : undefined,
        opacity: unlocked ? 1 : 0.7,
        transition: "all 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className="mx-auto mb-2 w-12 h-12 rounded-full flex items-center justify-center"
        style={{
          background: unlocked
            ? "rgba(230,192,122,0.24)"
            : "rgba(230,192,122,0.06)",
          border: unlocked
            ? "1.5px solid var(--color-gold)"
            : "1.5px solid rgba(230,192,122,0.18)",
        }}
      >
        <svg
          width={26}
          height={26}
          viewBox="0 0 24 24"
          fill="none"
          stroke={unlocked ? GOLD_HI : "rgba(230,220,200,0.34)"}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={artifact.iconPath} />
        </svg>
      </div>
      <p
        className="text-center font-mono"
        style={{
          color: unlocked ? GOLD : "rgba(230,220,200,0.45)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {artifact.name}
      </p>
      {hovered && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          style={{
            bottom: "calc(100% + 8px)",
            width: 220,
            padding: "10px 12px",
            background: "rgba(6,12,26,0.96)",
            border: "1px solid rgba(230,192,122,0.32)",
            borderRadius: 8,
            boxShadow: "0 12px 24px rgba(0,0,0,0.5)",
          }}
        >
          <p
            className="italic mb-1"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              color: INK,
              fontSize: 13,
              lineHeight: 1.35,
            }}
          >
            {unlocked ? artifact.lore : artifact.unlockHint}
          </p>
          <p
            className="font-mono"
            style={{
              color: unlocked ? GOLD : "rgba(230,220,200,0.4)",
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            {unlocked ? "Earned" : "How to earn"}
          </p>
        </div>
      )}
    </div>
  );
}

function CabinetShelf({
  group,
  region,
  unlocked,
}: {
  group: (typeof ARTIFACTS_BY_REGION)[number];
  region: Region | undefined;
  unlocked: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-3">
        <span
          className="font-mono"
          style={{
            color: unlocked ? GOLD : "rgba(230,220,200,0.32)",
            letterSpacing: "0.14em",
            fontSize: 10,
            textTransform: "uppercase",
          }}
        >
          Region {region?.order_num ?? "?"}
        </span>
        <span
          style={{
            color: unlocked ? INK : "rgba(230,220,200,0.32)",
            fontFamily: "Cormorant Garamond, serif",
            fontStyle: "italic",
            fontSize: 18,
            fontWeight: 500,
          }}
        >
          {region?.name ?? "—"}
        </span>
        {unlocked ? (
          <span
            className="font-mono ml-auto"
            style={{
              color: GOLD_HI,
              fontSize: 10,
              letterSpacing: "0.16em",
            }}
          >
            CHARTED
          </span>
        ) : (
          <span
            className="font-mono ml-auto"
            style={{
              color: "rgba(230,220,200,0.32)",
              fontSize: 10,
              letterSpacing: "0.16em",
            }}
          >
            PENDING
          </span>
        )}
      </div>

      {/* Shelf plank */}
      <div
        style={{
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(230,192,122,0.25), transparent)",
          marginBottom: 16,
        }}
      />

      {/* Items grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {group.items.map((item) => (
          <CabinetItem key={item.id} item={item} unlocked={unlocked} />
        ))}
      </div>
    </div>
  );
}

function CabinetItem({
  item,
  unlocked,
}: {
  item: Artifact;
  unlocked: boolean;
}) {
  return (
    <div
      className="p-3 rounded-lg flex items-center gap-3 transition-opacity"
      style={{
        background: unlocked
          ? "rgba(230,192,122,0.06)"
          : "rgba(6,12,26,0.45)",
        border: unlocked
          ? "1px solid rgba(230,192,122,0.28)"
          : "1px dashed rgba(230,220,200,0.12)",
        opacity: unlocked ? 1 : 0.65,
      }}
    >
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 36, height: 36 }}
      >
        <svg viewBox="-18 -18 36 36" width="36" height="36">
          <ArtifactIcon kind={item.kind} unlocked={unlocked} />
        </svg>
      </div>
      <div className="min-w-0">
        <p
          className="italic"
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 15,
            fontWeight: 500,
            color: unlocked ? INK : "rgba(230,220,200,0.42)",
            lineHeight: 1.15,
            marginBottom: 2,
          }}
        >
          {item.name}
        </p>
        <p
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.06em",
            color: unlocked
              ? "rgba(230,220,200,0.58)"
              : "rgba(230,220,200,0.32)",
          }}
        >
          {item.hint}
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Artifact catalog — 4 themed sets, 3 items each. Cartographic vibe.
// ────────────────────────────────────────────────────────────────

type ArtifactKind =
  | "compass"
  | "notebook"
  | "lantern"
  | "quill"
  | "camera"
  | "reel"
  | "sextant"
  | "map"
  | "anchor"
  | "coin"
  | "medal"
  | "key";

interface Artifact {
  id: string;
  name: string;
  hint: string;
  kind: ArtifactKind;
}

const ARTIFACTS_BY_REGION: {
  regionId: string;
  items: Artifact[];
}[] = [
  {
    regionId: "r1",
    items: [
      {
        id: "r1-1",
        name: "The Compass",
        hint: "you picked a direction",
        kind: "compass",
      },
      {
        id: "r1-2",
        name: "The Notebook",
        hint: "first entry, still blank",
        kind: "notebook",
      },
      {
        id: "r1-3",
        name: "The Lantern",
        hint: "for reading after sunset",
        kind: "lantern",
      },
    ],
  },
  {
    regionId: "r2",
    items: [
      {
        id: "r2-1",
        name: "The Quill",
        hint: "your first scripts",
        kind: "quill",
      },
      {
        id: "r2-2",
        name: "The Camera",
        hint: "you shipped an ad",
        kind: "camera",
      },
      {
        id: "r2-3",
        name: "The Film Reel",
        hint: "the edit that landed",
        kind: "reel",
      },
    ],
  },
  {
    regionId: "r3",
    items: [
      {
        id: "r3-1",
        name: "The Sextant",
        hint: "you can measure angles now",
        kind: "sextant",
      },
      {
        id: "r3-2",
        name: "The Strategy Map",
        hint: "you see the whole brief",
        kind: "map",
      },
      {
        id: "r3-3",
        name: "The Anchor",
        hint: "a portfolio worth pointing at",
        kind: "anchor",
      },
    ],
  },
  {
    regionId: "r4",
    items: [
      {
        id: "r4-1",
        name: "The First Coin",
        hint: "your first paid bounty",
        kind: "coin",
      },
      {
        id: "r4-2",
        name: "The Medal",
        hint: "they chose your submission",
        kind: "medal",
      },
      {
        id: "r4-3",
        name: "The Key",
        hint: "to month two and beyond",
        kind: "key",
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// SVG icons — each 36x36 centered, stroke-based. Cartographic, not gamer.
// ────────────────────────────────────────────────────────────────

function ArtifactIcon({
  kind,
  unlocked,
}: {
  kind: ArtifactKind;
  unlocked: boolean;
}) {
  const stroke = unlocked ? GOLD : "rgba(230,220,200,0.3)";
  const accent = unlocked ? GOLD_HI : "rgba(230,220,200,0.25)";
  const sw = 1.4;

  switch (kind) {
    case "compass":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <circle cx="0" cy="0" r="13" />
          <circle cx="0" cy="0" r="9" />
          <polygon points="0,-10 2,0 0,10 -2,0" fill={accent} stroke="none" />
          <circle cx="0" cy="0" r="1.5" fill={stroke} />
        </g>
      );
    case "notebook":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <rect x="-9" y="-12" width="18" height="24" rx="1.5" />
          <line x1="-9" y1="-7" x2="9" y2="-7" />
          <line x1="-9" y1="-2" x2="9" y2="-2" />
          <line x1="-9" y1="3" x2="9" y2="3" />
          <line x1="-9" y1="8" x2="9" y2="8" />
          <rect x="-9" y="-12" width="3" height="24" fill={accent} stroke="none" />
        </g>
      );
    case "lantern":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <path d="M -4 -12 L 4 -12" />
          <path d="M 0 -12 L 0 -9" />
          <rect x="-7" y="-9" width="14" height="14" rx="1" />
          <path d="M -7 5 L 7 5 L 5 10 L -5 10 Z" />
          <circle cx="0" cy="-2" r="3" fill={accent} stroke="none" opacity={unlocked ? 0.85 : 0.3} />
        </g>
      );
    case "quill":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <path d="M -10 12 L 10 -10" />
          <path d="M 5 -12 Q 12 -8 10 -2 Q 6 0 4 -4 Q 2 -10 5 -12 Z" fill={accent} stroke="none" />
          <path d="M -10 12 L -6 8" />
        </g>
      );
    case "camera":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <rect x="-13" y="-8" width="26" height="16" rx="1.5" />
          <circle cx="0" cy="0" r="5" />
          <circle cx="0" cy="0" r="2.5" fill={accent} stroke="none" />
          <rect x="-10" y="-11" width="6" height="3" />
        </g>
      );
    case "reel":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <circle cx="0" cy="0" r="13" />
          <circle cx="0" cy="0" r="2" fill={stroke} />
          <circle cx="-7" cy="0" r="1.5" fill={accent} stroke="none" />
          <circle cx="7" cy="0" r="1.5" fill={accent} stroke="none" />
          <circle cx="0" cy="-7" r="1.5" fill={accent} stroke="none" />
          <circle cx="0" cy="7" r="1.5" fill={accent} stroke="none" />
        </g>
      );
    case "sextant":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <path d="M -13 10 L 13 10 L 0 -13 Z" />
          <path d="M -11 8 A 12 12 0 0 1 11 8" />
          <line x1="0" y1="-13" x2="0" y2="5" />
          <circle cx="0" cy="10" r="1.5" fill={stroke} />
        </g>
      );
    case "map":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <path d="M -12 -8 L -4 -10 L 4 -6 L 12 -8 L 12 10 L 4 12 L -4 8 L -12 10 Z" />
          <line x1="-4" y1="-10" x2="-4" y2="8" />
          <line x1="4" y1="-6" x2="4" y2="12" />
          <circle cx="7" cy="3" r="1.5" fill={accent} stroke="none" />
        </g>
      );
    case "anchor":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <circle cx="0" cy="-10" r="2.5" />
          <line x1="0" y1="-7" x2="0" y2="10" />
          <line x1="-5" y1="-3" x2="5" y2="-3" />
          <path d="M -10 5 Q -10 11 0 12 Q 10 11 10 5" />
        </g>
      );
    case "coin":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <circle cx="0" cy="0" r="12" fill={accent} opacity={unlocked ? 0.15 : 0.05} />
          <circle cx="0" cy="0" r="12" />
          <circle cx="0" cy="0" r="8" />
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Cormorant Garamond, serif"
            fontSize="10"
            fontWeight="700"
            fill={stroke}
            fontStyle="italic"
            stroke="none"
          >
            E
          </text>
        </g>
      );
    case "medal":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <path d="M -6 -13 L 0 -5 L 6 -13" />
          <circle cx="0" cy="3" r="9" />
          <circle cx="0" cy="3" r="5" fill={accent} stroke="none" opacity={unlocked ? 0.35 : 0.15} />
          <path d="M -3 3 L -1 5 L 4 -1" />
        </g>
      );
    case "key":
      return (
        <g stroke={stroke} strokeWidth={sw} fill="none">
          <circle cx="-6" cy="0" r="5" />
          <line x1="-1" y1="0" x2="12" y2="0" />
          <line x1="8" y1="0" x2="8" y2="4" />
          <line x1="11" y1="0" x2="11" y2="5" />
        </g>
      );
    default:
      return null;
  }
}
