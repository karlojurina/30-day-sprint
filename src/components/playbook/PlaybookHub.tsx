"use client";

/**
 * v42 (v2) — Map 2 hub. 4 horizontal cards side-by-side. Click any
 * card → opens that node's PlaybookNodeSheet. The 4th node
 * (pb_land_first_client) is the single milestone; we surface a
 * subtle visual differentiator (gold accent border + crown mark)
 * so it reads as the special one without inventing a separate
 * layout.
 *
 * Step 4 ships the layout + sheet behavior. Step 5 wires the
 * mark-complete + crowned celebration on the milestone card.
 *
 * Per the brief (04-map2-playbook.md):
 *   • No SVG terrain map — keep it simple.
 *   • No completion state for the 3 always-on cards.
 *   • Hub stays open even after the milestone fires.
 *   • v1 placeholder layout; Karlo delivers the full visual set in P2.
 */

import type { PlaybookNode } from "@/types/database";

interface Props {
  nodes: PlaybookNode[];
  firstClientLandedAt: string | null;
  onOpenNode: (id: string) => void;
}

export function PlaybookHub({ nodes, firstClientLandedAt, onOpenNode }: Props) {
  return (
    <div
      className="grid gap-4 w-full mx-auto px-5 sm:px-6 lg:px-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      style={{
        maxWidth: 1280,
      }}
    >
      {nodes.map((node) => (
        <PlaybookCard
          key={node.id}
          node={node}
          milestoneLandedAt={
            node.is_milestone ? firstClientLandedAt : null
          }
          onClick={() => onOpenNode(node.id)}
        />
      ))}
    </div>
  );
}

function PlaybookCard({
  node,
  milestoneLandedAt,
  onClick,
}: {
  node: PlaybookNode;
  milestoneLandedAt: string | null;
  onClick: () => void;
}) {
  const isMilestone = node.is_milestone;
  const isLanded = isMilestone && Boolean(milestoneLandedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        textAlign: "left",
        padding: "24px 22px 22px",
        borderRadius: 16,
        background:
          isMilestone
            ? "linear-gradient(180deg, rgba(230,192,122,0.10) 0%, rgba(15,17,21,0.85) 100%)"
            : "rgba(15,17,21,0.78)",
        border: isMilestone
          ? "1px solid rgba(230,192,122,0.55)"
          : "1px solid rgba(255,255,255,0.10)",
        cursor: "pointer",
        transition: "transform 200ms cubic-bezier(0.22,1,0.36,1), border-color 200ms",
        color: "rgba(255,255,255,0.96)",
        minHeight: 200,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.borderColor = isMilestone
          ? "rgba(230,192,122,0.85)"
          : "rgba(255,255,255,0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = isMilestone
          ? "rgba(230,192,122,0.55)"
          : "rgba(255,255,255,0.10)";
      }}
    >
      {isMilestone && (
        <span
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-gold-light)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            background: "rgba(230,192,122,0.15)",
            border: "1px solid rgba(230,192,122,0.5)",
            borderRadius: 999,
            padding: "2px 8px",
          }}
        >
          Milestone
        </span>
      )}

      <div>
        {/* Position numeral / mark */}
        <p
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: isMilestone ? "var(--color-gold-light)" : "rgba(255,255,255,0.4)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {String(node.position).padStart(2, "0")} ·{" "}
          {isMilestone ? "the work click moment" : "always-on"}
        </p>
        <h3
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.022em",
            lineHeight: 1.15,
            marginBottom: 8,
          }}
        >
          {node.title}
        </h3>
        {node.subtitle && (
          <p
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.66)",
              lineHeight: 1.45,
              letterSpacing: "-0.005em",
            }}
          >
            {node.subtitle}
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {isLanded ? (
          <span
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--color-gold-light)",
              letterSpacing: "0.06em",
            }}
          >
            Landed ·{" "}
            {new Date(milestoneLandedAt!).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : (
          <span
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            Open
          </span>
        )}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.55 }}
        >
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
