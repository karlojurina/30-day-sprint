"use client";

/**
 * v42 (v2) — sheet that opens when a Map 2 hub card is clicked.
 *
 * Layout mirrors the existing LessonSheet — full-screen overlay
 * + scrim, right-rail card with body content. Header carries the
 * node title/subtitle. Body renders doc_content (markdown bodies
 * land later; today the placeholder TODO(karlo) strings just
 * render as preformatted text). Optional video_url embeds above
 * the doc if set.
 *
 * Step 4 ships the read-only sheet. Step 5 wires the
 * mark-complete + crowned celebration onto the milestone node's
 * sheet via the `milestoneSlot` prop.
 */

import { motion, AnimatePresence } from "framer-motion";
import type { PlaybookNode } from "@/types/database";

interface Props {
  node: PlaybookNode | null;
  onClose: () => void;
  /** Step 5 — slot the milestone's mark-complete button + landed
   *  confirmation goes through this. Step 4 leaves it empty. */
  milestoneSlot?: React.ReactNode;
}

export function PlaybookNodeSheet({ node, onClose, milestoneSlot }: Props) {
  const open = Boolean(node);

  return (
    <AnimatePresence>
      {open && node && (
        <>
          <motion.button
            type="button"
            onClick={onClose}
            aria-label="Close sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[60] cursor-default"
            style={{
              background: "rgba(6,12,26,0.7)",
              backdropFilter: "blur(6px)",
              border: "none",
              padding: 0,
            }}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="pb-node-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 z-[65] h-full overflow-y-auto"
            style={{
              width: "min(640px, 100vw)",
              background: "var(--color-bg-card)",
              borderLeft: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <div className="p-5 sm:p-8 pb-12 sm:pb-12">
              {/* Close */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  position: "absolute",
                  top: 18,
                  right: 18,
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.78)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>

              {/* Header */}
              <p
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: node.is_milestone
                    ? "var(--color-gold-light)"
                    : "rgba(255,255,255,0.45)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                {node.is_milestone ? "Milestone" : "Always-on"}
              </p>
              <h2
                id="pb-node-title"
                style={{
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.1,
                  color: "rgba(255,255,255,0.96)",
                  marginBottom: 10,
                }}
              >
                {node.title}
              </h2>
              {node.subtitle && (
                <p
                  style={{
                    fontSize: 15,
                    color: "rgba(255,255,255,0.66)",
                    lineHeight: 1.5,
                    letterSpacing: "-0.005em",
                    marginBottom: 24,
                  }}
                >
                  {node.subtitle}
                </p>
              )}

              {/* Optional video — embedded above the body. Karlo
                  may or may not shoot one per node; doc-first per
                  brief 05-content-delivery.md §7. */}
              {node.video_url && (
                <div
                  style={{
                    position: "relative",
                    paddingBottom: "56.25%",
                    marginBottom: 24,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "rgba(0,0,0,0.4)",
                  }}
                >
                  <iframe
                    src={node.video_url}
                    title={node.title}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      border: "none",
                    }}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              {/* Body — plain text rendering of doc_content for now.
                  preserves newlines without pulling in a markdown
                  library. Real markdown rendering arrives when
                  Karlo's content actually needs the formatting. */}
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.65,
                  color: "rgba(255,255,255,0.82)",
                  whiteSpace: "pre-wrap",
                  letterSpacing: "-0.005em",
                  marginBottom: 32,
                }}
              >
                {node.doc_content}
              </div>

              {/* Milestone CTA slot — Step 5 fills this. */}
              {node.is_milestone && milestoneSlot}

              {/* Footer */}
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: node.is_milestone ? 24 : 0,
                  padding: "10px 16px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  color: "rgba(255,255,255,0.78)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                }}
              >
                ← Back to the Playbook
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
