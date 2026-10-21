"use client";

import Link from "next/link";
import { T } from "@/components/admin/ui";
import { hasDetails, plainReadError, plainReadErrors } from "@/lib/admin/read-failure";

/**
 * Pieces of admin rebuild 2's review fix round, in the dark look of
 * admin-tokens.module.css. In their own file (the round's lane), so the
 * shared list-parts.tsx and ui.tsx only import them.
 *
 *   ErrorDetails   the database's own words behind a small, closed "Details"
 *   ReadFailure    a failed read in plain words (read-failure.ts), then
 *                  ErrorDetails with the raw text when it says more
 *   ProblemNotice  a read that failed above a list that still shows: the
 *                  page's sentence, why in plain words, and Details
 *   FailureList    several failed reads: each plain sentence once, then one
 *                  Details naming every read with its raw text
 *   TextLink       a link to another page as Airy Blue words in a header
 *                  ("Outreach insights", "Queue"), 44px tall
 *
 * The summary is 44px tall (the kit's touch target) in 12px words, with the
 * browser's triangle, so it reads as something to press.
 */

/** The browser's own disclosure triangle (a list item), 44px tall with its padding, as the student page's other folds. */
const SUMMARY: React.CSSProperties = {
  display: "list-item",
  padding: "12px 0",
  lineHeight: "20px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const RAW: React.CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  borderRadius: "var(--radius-chip)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--color-text-secondary)",
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
};

/** The raw text of one or more failed reads, closed until pressed. */
export function ErrorDetails({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <details data-error-details="">
      <summary style={SUMMARY}>Details</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((l) => (
          <p key={l} style={RAW}>
            {l}
          </p>
        ))}
      </div>
    </details>
  );
}

/** One failed read: what it means, and the database's words behind Details when they say more. */
export function ReadFailure({
  raw,
  lead,
  style,
}: {
  raw: string | null | undefined;
  /** What could not be done, said first: "Couldn't load the Whop sync." */
  lead?: string;
  style?: React.CSSProperties;
}) {
  const plain = plainReadError(raw);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, ...style }}>
      <p style={{ ...T.body, lineHeight: 1.5 }}>
        {lead ? `${lead} ` : ""}
        <span style={lead ? { color: "var(--color-text-secondary)" } : undefined}>{plain}</span>
      </p>
      {hasDetails(raw) && <ErrorDetails lines={[String(raw).trim()]} />}
    </div>
  );
}

/**
 * A read that failed, above a list that still shows (a list read again that
 * failed, a column that could not load): the page's sentence, why in plain
 * words, and the raw text behind Details. A status, not an alert: it stays
 * while the page is open. The dark look of people-parts.tsx's Warning.
 */
export function ProblemNotice({ text, raw }: { text: string; raw?: string | null }) {
  return (
    <div
      role="status"
      data-problem=""
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        marginBottom: 12,
        padding: "10px 14px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: "var(--color-warning)" }} />
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <p style={{ ...T.body, lineHeight: 1.5 }}>
          {text}
          {raw ? <span style={{ color: "var(--color-text-secondary)" }}> {plainReadError(raw)}</span> : null}
        </p>
        {hasDetails(raw) && <ErrorDetails lines={[String(raw).trim()]} />}
      </div>
    </div>
  );
}

/** Several failed reads: each plain sentence once, and one Details with every read and its raw text. */
export function FailureList({ failures }: { failures: Array<{ read: string; error: string }> }) {
  const plain = plainReadErrors(failures.map((f) => f.error));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {plain.map((p) => (
        <p key={p} style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          {p}
        </p>
      ))}
      <ErrorDetails lines={failures.map((f) => `${f.read}: ${f.error}`)} />
    </div>
  );
}

/** A link that reads as words in Airy Blue, 44px tall: the header's way to another page (the Dashboard's "Open Insights"). */
export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 4px",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--color-accent-dark)",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
