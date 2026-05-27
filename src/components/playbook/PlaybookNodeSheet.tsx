"use client";

/**
 * v72 — Playbook node sheet. Renders a standalone HTML article
 * (public/playbook/<article_slug>/index.html) inside an iframe.
 *
 * Per lovro-brief-playbook-articles §02: iframe is the recommended
 * render path. Each article is a complete HTML document with inline
 * CSS + JS (Article 1 has an interactive calculator + lightbox +
 * carousel). The iframe sandboxes all of it - no CSS bleed into
 * platform chrome, the inline JS just works, mobile @media queries
 * handle phone sizing.
 *
 * The articles are long full-page documents (Article 1 is ~8K
 * words), so the sheet is a near-fullscreen takeover rather than the
 * old 720px centered modal. The article scrolls internally inside
 * the iframe (one scrollbar). A thin top bar carries the node title
 * + a close button (the brief's header + back-to-playbook footer
 * collapse into this single bar since the article has its own
 * in-body header).
 */

import { motion, AnimatePresence } from "framer-motion";
import type { PlaybookNode } from "@/types/database";

interface Props {
  node: PlaybookNode | null;
  onClose: () => void;
}

// v72.1 - hardcoded node-id → article-slug fallback. The article
// rendering shouldn't break just because the v72 migration (which
// populates playbook_nodes.article_slug) hasn't run on a given
// environment yet. If the DB column is set we use it; otherwise we
// resolve the slug from the stable node id.
const SLUG_BY_NODE_ID: Record<string, string> = {
  pb_submit_bounties: "01-submit-ad-bounties",
  pb_build_portfolio: "02-build-your-portfolio",
  pb_apply_job_board: "03-apply-to-brands",
};

function resolveArticleSlug(node: PlaybookNode): string | null {
  return node.article_slug ?? SLUG_BY_NODE_ID[node.id] ?? null;
}

export function PlaybookNodeSheet({ node, onClose }: Props) {
  const open = Boolean(node);
  const articleSlug = node ? resolveArticleSlug(node) : null;

  return (
    <AnimatePresence>
      {open && node && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={node.title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[120] flex flex-col"
          style={{ background: "#0a0a0a" }}
        >
          {/* Thin top bar - node title (context) + close. The article
              inside the iframe has its own full header, so this bar
              stays minimal to avoid a double-header. */}
          <div
            className="flex items-center justify-between px-4 py-3 sm:px-6 shrink-0"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(10,10,10,0.92)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onClose}
                aria-label="Back to the playbook"
                className="shrink-0"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.78)",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Playbook
              </button>
              <span
                className="truncate hidden sm:block"
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.55)",
                  letterSpacing: "-0.005em",
                }}
              >
                {node.title}
              </span>
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

          {/* Body - the HTML article. Fills the rest of the screen;
              scrolls internally. Slug comes from the DB column when
              set, else the node-id fallback map. */}
          {articleSlug ? (
            <iframe
              key={articleSlug}
              src={`/playbook/${articleSlug}/index.html`}
              title={node.title}
              style={{
                flex: 1,
                width: "100%",
                border: "none",
                background: "#0a0a0a",
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center"
              style={{ flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 14 }}
            >
              This article isn&rsquo;t available yet.
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
