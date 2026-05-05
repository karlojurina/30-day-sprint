"use client";

import { useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

/**
 * Fixed-position panel showing the last Whop watch-sync result.
 *
 * Collapsed by default as a small "sync" pill in the bottom-right. Click
 * to expand. Inside: last sync time, what Whop returned (fetched),
 * what matched our seed (matched), any unmatched Whop lesson IDs, and
 * the last error. A "Run sync now" button bypasses the 30 s throttle
 * so you can force a fresh call and watch the numbers change.
 *
 * Everything here is read-only metadata — the actual failure modes
 * surface through the numbers:
 *   fetched = 0            → Whop isn't reporting anything for this user
 *   matched < fetched      → Whop IDs exist but our seed doesn't map them
 *   lastError populated    → hard API error (token, network, 500)
 */
export function SyncDebugPanel() {
  const { syncDiagnostics: s, forceSync } = useStudent();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    ok: boolean;
    message?: string;
    matchedLessonIds?: string[];
    fetchedWhopIds?: string[];
    at: number;
  } | null>(null);

  const runNow = async () => {
    setRunning(true);
    const result = await forceSync();
    setRunResult({ ...result, at: Date.now() });
    setRunning(false);
  };

  // Color the pill by severity of the last sync state
  const pillState =
    s.lastError != null
      ? "error"
      : s.fetchedCount != null && s.fetchedCount === 0
        ? "empty"
        : s.fetchedCount != null &&
            s.matchedCount != null &&
            s.matchedCount < s.fetchedCount
          ? "partial"
          : "ok";
  const pillColor = {
    ok: "#4DCEC4",
    partial: "#E6C07A",
    empty: "#4DCEC4", // normal state for student tokens — webhooks handle it
    error: "#C44A54",
  }[pillState];

  // For students whose tokens can't poll Whop, fetched=0 is expected
  // (completions flow in via webhook). Label that case as "webhook" so
  // it doesn't read like a failure.
  const pillLabel = {
    ok: s.matchedCount != null ? `Sync · ${s.matchedCount} matched` : "Sync",
    partial: `Sync · ${s.matchedCount}/${s.fetchedCount} matched`,
    empty: "Sync · webhook-only",
    error: "Sync · error",
  }[pillState];

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 70,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      }}
    >
      {open ? (
        <div
          style={{
            width: 340,
            background: "rgba(6,12,26,0.96)",
            border: "1px solid rgba(230,192,122,0.3)",
            borderRadius: 10,
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            color: "#E6DCC8",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid rgba(230,192,122,0.15)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: pillColor,
              }}
            >
              Whop sync · {pillState}
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(230,220,200,0.6)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "12px 14px", fontSize: 12 }}>
            <Row label="Last sync" value={formatRelative(s.lastSyncAt)} />
            <Row
              label="Fetched from Whop"
              value={s.fetchedCount == null ? "—" : String(s.fetchedCount)}
            />
            <Row
              label="Matched to lessons"
              value={s.matchedCount == null ? "—" : String(s.matchedCount)}
            />
            {s.unmatchedWhopIds.length > 0 && (
              <Row
                label="Unmatched"
                value={`${s.unmatchedWhopIds.length} ids`}
                hint={s.unmatchedWhopIds.slice(0, 6).join("\n") +
                  (s.unmatchedWhopIds.length > 6
                    ? `\n…+${s.unmatchedWhopIds.length - 6} more`
                    : "")}
              />
            )}
            {s.lastError && (
              <Row
                label="Last error"
                value="see hint"
                hint={`${s.lastError}${
                  s.lastErrorAt ? `\n@ ${formatRelative(s.lastErrorAt)}` : ""
                }`}
                valueColor="#E89099"
              />
            )}

            <div
              style={{
                height: 1,
                background: "rgba(230,192,122,0.12)",
                margin: "10px 0",
              }}
            />

            <Row
              label="Course ID"
              value={s.whopCourseIdMasked ?? "NOT SET"}
              valueColor={s.whopCourseIdMasked ? undefined : "#E89099"}
            />
            <Row
              label="Your Whop user"
              value={maskId(s.whopUserId) ?? "—"}
            />
          </div>

          {/* Last run output: which local lessons matched + full Whop list.
              Only shown after a force sync (not auto-populated on mount,
              because the data isn't persisted). Lets you scan for whether
              a specific lesson is currently in the matched set. */}
          {runResult?.ok && runResult.matchedLessonIds && (
            <details
              style={{
                padding: "8px 14px",
                borderTop: "1px solid rgba(230,192,122,0.15)",
                fontSize: 11,
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: "#4DCEC4",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontSize: 10,
                  padding: "2px 0",
                }}
              >
                Matched lessons ({runResult.matchedLessonIds.length})
              </summary>
              <div
                style={{
                  marginTop: 6,
                  padding: 8,
                  background: "rgba(6,12,26,0.5)",
                  borderRadius: 4,
                  maxHeight: 180,
                  overflow: "auto",
                  fontFamily: "inherit",
                  fontSize: 11,
                  color: "rgba(230,220,200,0.85)",
                  lineHeight: 1.5,
                }}
              >
                {runResult.matchedLessonIds.join(", ")}
              </div>
              <p
                style={{
                  marginTop: 6,
                  fontSize: 10,
                  color: "rgba(230,220,200,0.5)",
                }}
              >
                Look for the lesson you watched. If it&apos;s missing,
                Whop didn&apos;t register the watch as completed.
              </p>
            </details>
          )}
          {runResult?.ok && runResult.fetchedWhopIds && (
            <details
              style={{
                padding: "8px 14px",
                borderTop: "1px solid rgba(230,192,122,0.15)",
                fontSize: 11,
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  color: "rgba(230,220,200,0.6)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontSize: 10,
                  padding: "2px 0",
                }}
              >
                All fetched Whop IDs ({runResult.fetchedWhopIds.length})
              </summary>
              <pre
                style={{
                  marginTop: 6,
                  padding: 8,
                  background: "rgba(6,12,26,0.5)",
                  borderRadius: 4,
                  maxHeight: 180,
                  overflow: "auto",
                  fontFamily: "inherit",
                  fontSize: 10,
                  color: "rgba(230,220,200,0.7)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {runResult.fetchedWhopIds.join("\n")}
              </pre>
            </details>
          )}

          {/* Run button */}
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid rgba(230,192,122,0.15)",
              background: "rgba(6,12,26,0.4)",
            }}
          >
            <button
              onClick={runNow}
              disabled={running}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 6,
                background: running ? "rgba(230,192,122,0.3)" : "#E6C07A",
                color: "#060C1A",
                border: "none",
                cursor: running ? "default" : "pointer",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {running ? "Running…" : "Run sync now"}
            </button>
            {runResult && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: runResult.ok ? "#4DCEC4" : "#E89099",
                  lineHeight: 1.4,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {runResult.ok
                  ? `Done · ${formatRelative(new Date(runResult.at).toISOString())}`
                  : `Failed: ${runResult.message ?? "unknown"}`}
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(6,12,26,0.92)",
            border: `1px solid ${pillColor}`,
            color: pillColor,
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 600,
            fontFamily: "inherit",
            boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
          }}
          aria-label="Open sync debug panel"
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: pillColor,
              marginRight: 8,
              verticalAlign: -1,
              boxShadow: `0 0 6px ${pillColor}`,
            }}
          />
          {pillLabel}
        </button>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "3px 0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            color: "rgba(230,220,200,0.55)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: valueColor ?? "#E6DCC8",
            fontSize: 12,
            fontWeight: 500,
            textAlign: "right",
            maxWidth: "60%",
            wordBreak: "break-word",
          }}
        >
          {value}
        </span>
      </div>
      {hint && (
        <pre
          style={{
            margin: 0,
            fontSize: 10,
            color: "rgba(230,220,200,0.5)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontFamily: "inherit",
            lineHeight: 1.4,
            paddingLeft: 12,
            marginTop: 2,
          }}
        >
          {hint}
        </pre>
      )}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return `${Math.floor(diffMs / 86400_000)}d ago`;
}

function maskId(id: string | null): string | null {
  if (!id) return null;
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
