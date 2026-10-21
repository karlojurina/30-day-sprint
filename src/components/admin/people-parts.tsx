"use client";

import { Pill, T } from "@/components/admin/ui";
import { TAP, pressPill } from "@/components/admin/list-parts";
import { ACTIVITY_TEXT, ACTIVITY_TONE } from "@/lib/useJourneyPaceCounts";
import type { ActivityLabel } from "@/lib/curriculum-reset";

/**
 * Pieces the Tasks page, its insights, All students, the student page and
 * the Student journey share (admin rebuild 2, lane WI-5 and WI-6), in the
 * dark look of admin-tokens.module.css, beside list-parts.tsx (the 30%
 * page's): the same 44px pills and taps, the same 12px floor for words.
 *
 *   TabStrip      tabs as pills with their counts, wrapping on a phone
 *   Warning       a lasting problem with the whole page, above it
 *   SearchField   the search box: 44px tall, 16px words so a phone does not zoom
 *   Meter         a share as a bar and its number, or "Couldn't load"
 *   ActivityPill  how recently a counted lesson was finished, in words
 *   FactsLine     facts in one line, a dot between them
 */

export function TabStrip<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ value: K; label: string; count?: number }>;
  value: K;
  onChange: (v: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            style={{ ...pressPill(active), padding: "0 12px" }}
          >
            {t.label}
            {t.count !== undefined && (
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: color }}
    />
  );
}

/** A lasting problem with the whole page. A status, not an alert: it stays while the page is open. */
export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
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
      <Dot color="var(--color-warning)" />
      <p style={{ ...T.body, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  onEnter?: () => void;
}) {
  return (
    <input
      type="search"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
      style={{
        width: "100%",
        minWidth: 0,
        height: TAP,
        padding: "0 14px",
        // 16px: a phone's browser zooms the page into a smaller field.
        fontSize: 16,
        borderRadius: "var(--radius-control)",
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-bg-card)",
        color: "var(--color-text-primary)",
        outline: "none",
      }}
    />
  );
}

/** A share as a thin bar and its number; "Couldn't load" when it is unknown, never 0%. */
export function Meter({ value, label }: { value: number | null; label?: string }) {
  if (value == null) {
    return <span style={{ ...T.bodyDim, fontSize: 12, whiteSpace: "nowrap" }}>Couldn&apos;t load</span>;
  }
  return (
    <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
      <div
        role="meter"
        aria-label={label ?? "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        style={{ flex: 1, minWidth: 40, height: 4, borderRadius: 2, background: "var(--color-fill-secondary)", overflow: "hidden" }}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: "var(--color-accent-dark)" }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums", minWidth: 34, textAlign: "right" }}>
        {value}%
      </span>
    </div>
  );
}

export function ActivityPill({ label }: { label: ActivityLabel }) {
  return <Pill tone={ACTIVITY_TONE[label]}>{ACTIVITY_TEXT[label]}</Pill>;
}

/** Facts in one line, a dot between them; it wraps on a phone. */
export function FactsLine({ parts, style }: { parts: Array<string | null | false | undefined>; style?: React.CSSProperties }) {
  const shown = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return (
    <p style={{ ...T.bodyDim, lineHeight: 1.6, ...style }}>
      {shown.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

/** The words of a membership status in a sentence: "Payment failed" for past_due. */
export const STATUS_WORDS: Record<string, string> = {
  active: "Active",
  past_due: "Payment failed",
  canceled: "Canceled",
  expired: "Expired",
};
