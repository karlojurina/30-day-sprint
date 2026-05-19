"use client";

/**
 * v43 — Centered modal for the Map 2 hub. Was originally a right-rail
 * aside (mirrored the LessonSheet's earlier shape) but the centered
 * popup pattern is the one Karlo wants everywhere now, same as the
 * map lesson sheets.
 *
 * Wraps the same content the right-rail version had: optional video,
 * doc body, milestone CTA slot. Sizing matches the LessonSheet group
 * variant (720px on desktop, full-screen on phone).
 */

import { motion, AnimatePresence } from "framer-motion";
import type { PlaybookNode } from "@/types/database";

interface Props {
  node: PlaybookNode | null;
  onClose: () => void;
  /** Milestone-only: the mark-complete CTA + post-landing confirmation
   *  panel is injected here so this component stays presentational. */
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

          <div
            className="fixed inset-0 z-[65] flex items-center justify-center p-0 sm:p-4"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pb-node-title"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col w-full sm:w-[min(720px,92vw)] h-full sm:h-auto max-h-[100dvh] sm:max-h-[92vh] rounded-none sm:rounded-2xl overflow-hidden"
              style={{
                pointerEvents: "auto",
                background:
                  "linear-gradient(180deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 100%)",
                border: "1px solid var(--color-border-hover)",
                boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-start justify-between p-5 sm:p-6 shrink-0"
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <div className="min-w-0 pr-3">
                  <p
                    className="font-mono uppercase"
                    style={{
                      fontSize: 11,
                      color: node.is_milestone
                        ? "var(--color-gold-light)"
                        : "rgba(255,255,255,0.45)",
                      letterSpacing: "0.18em",
                      marginBottom: 8,
                    }}
                  >
                    {node.is_milestone ? "Milestone" : "Always-on"}
                  </p>
                  <h2
                    id="pb-node-title"
                    style={{
                      fontSize: 24,
                      fontWeight: 600,
                      letterSpacing: "-0.022em",
                      lineHeight: 1.15,
                      color: "rgba(255,255,255,0.96)",
                    }}
                  >
                    {node.title}
                  </h2>
                  {node.subtitle && (
                    <p
                      style={{
                        fontSize: 14,
                        color: "rgba(255,255,255,0.66)",
                        lineHeight: 1.5,
                        letterSpacing: "-0.005em",
                        marginTop: 8,
                      }}
                    >
                      {node.subtitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0"
                  style={{
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
              </div>

              {/* Body — scrollable */}
              <div
                className="overflow-y-auto p-5 sm:p-6"
                style={{ flex: 1 }}
              >
                {/* Optional video — embedded above the doc body. */}
                {node.video_url && (
                  <div
                    style={{
                      position: "relative",
                      paddingBottom: "56.25%",
                      marginBottom: 22,
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

                {/* Body — preformatted text. Markdown rendering arrives
                    when Karlo's content actually needs the formatting. */}
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: 1.65,
                    color: "rgba(255,255,255,0.82)",
                    whiteSpace: "pre-wrap",
                    letterSpacing: "-0.005em",
                    marginBottom: 24,
                  }}
                >
                  {node.doc_content}
                </div>

                {/* Milestone CTA slot — wired from the parent page. */}
                {node.is_milestone && milestoneSlot}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
