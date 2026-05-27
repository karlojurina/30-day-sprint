"use client";

/**
 * v72 — Map 2 hub. 3 always-on cards side-by-side. Click any card →
 * opens that node's PlaybookNodeSheet (full HTML article in an
 * iframe).
 *
 * Per lovro-brief-playbook-articles §01:
 *   • 3 nodes, not 4. The pb_land_first_client milestone is dropped.
 *   • All cards are always-on. No completion state, no milestone
 *     pill, no crowned celebration.
 */

import type { PlaybookNode } from "@/types/database";

interface Props {
  nodes: PlaybookNode[];
  onOpenNode: (id: string) => void;
}

export function PlaybookHub({ nodes, onOpenNode }: Props) {
  return (
    <div
      className="grid gap-4 w-full mx-auto px-5 sm:px-6 lg:px-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      style={{
        maxWidth: 1040,
      }}
    >
      {nodes.map((node) => (
        <PlaybookCard
          key={node.id}
          node={node}
          onClick={() => onOpenNode(node.id)}
        />
      ))}
    </div>
  );
}

function PlaybookCard({
  node,
  onClick,
}: {
  node: PlaybookNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        textAlign: "left",
        padding: "24px 22px 22px",
        borderRadius: 16,
        background: "rgba(15,17,21,0.78)",
        border: "1px solid rgba(255,255,255,0.10)",
        cursor: "pointer",
        transition:
          "transform 200ms cubic-bezier(0.22,1,0.36,1), border-color 200ms",
        color: "rgba(255,255,255,0.96)",
        minHeight: 200,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
      }}
    >
      <div>
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
        <span
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Read
        </span>
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
