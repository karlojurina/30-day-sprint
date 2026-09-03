"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "@/components/admin/ui";

/**
 * Date-range control for /admin/stats.
 *
 * Replaces two raw <input type="date"> fields, which rendered as
 * "01.11.2025." in a Croatian locale, sat unstyled next to the selects,
 * and gave no way to see a month while choosing a window.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ALL DATE MATH IS UTC, AND CALENDAR DATES NEVER BECOME Date OBJECTS
 * ON THE WAY OUT.
 *
 * This component emits "YYYY-MM-DD" strings only. Internally every
 * boundary is Date.UTC(...) — `new Date(y, m, d)` is local-time and must
 * never appear here. That is what keeps the window correct for a user in
 * UTC+2 between 00:00 and 02:00 local, where `new Date()` in the browser
 * reports yesterday. The server re-validates and rejects rather than
 * clamping (resolveCustomRange in src/lib/whop-stats.ts), so this is
 * belt-and-braces rather than the only guard.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Interaction model matches the admin nav dropdown already in
 * layout.tsx: outside-click and Escape close, and navigating closes.
 * Preset rows are 44px so they meet the tap-target floor.
 */

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const utcToday = () => {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
};

export type Preset = { value: string; label: string };

type Props = {
  /** Currently active preset key, or "custom". */
  range: string;
  presets: Preset[];
  customFrom: string;
  customTo: string;
  /** Resolved window currently on screen, for the button label. */
  resolvedFrom?: string;
  resolvedTo?: string;
  historyStart: string;
  onPreset: (value: string) => void;
  onCustom: (from: string, to: string) => void;
};

function monthMatrix(year: number, month: number): (number | null)[][] {
  const first = Date.UTC(year, month, 1);
  // Monday-first, matching the weekly buckets used everywhere else here.
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, r) =>
    cells.slice(r * 7, r * 7 + 7),
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function DateRangePicker({
  range,
  presets,
  customFrom,
  customTo,
  resolvedFrom,
  resolvedTo,
  historyStart,
  onPreset,
  onCustom,
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(() => {
    const base = customTo ? parse(customTo) : utcToday();
    const d = new Date(base);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  // Draft selection — nothing is committed until Apply, so a half-made
  // range never triggers a fetch.
  const [draft, setDraft] = useState<{ from: string; to: string }>({
    from: customFrom,
    to: customTo,
  });

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = useMemo(() => {
    const fmt = (d: string) =>
      new Date(parse(d)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    if (range === "custom" && customFrom && customTo) {
      return `${fmt(customFrom)} – ${fmt(customTo)}`;
    }
    const p = presets.find((x) => x.value === range);
    if (p && resolvedFrom && resolvedTo) {
      return `${p.label} · ${fmt(resolvedFrom)} – ${fmt(resolvedTo)}`;
    }
    return p?.label ?? "Pick a range";
  }, [range, customFrom, customTo, presets, resolvedFrom, resolvedTo]);

  const minMs = parse(historyStart);
  const maxMs = utcToday();

  const pick = (day: number) => {
    const ms = Date.UTC(anchor.y, anchor.m, day);
    if (ms < minMs || ms > maxMs) return;
    const d = iso(ms);
    // First click, or a click before the current start, begins a new range.
    if (!draft.from || draft.to || ms < parse(draft.from)) {
      setDraft({ from: d, to: "" });
    } else {
      setDraft({ from: draft.from, to: d });
    }
  };

  const inDraft = (ms: number) => {
    if (!draft.from) return false;
    const a = parse(draft.from);
    const b = draft.to ? parse(draft.to) : a;
    return ms >= Math.min(a, b) && ms <= Math.max(a, b);
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: 44, // tap-target floor
    paddingInline: 12,
    borderRadius: "var(--radius-chip)",
    fontSize: 13,
    letterSpacing: "var(--track-subhead)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    transition: "background var(--duration-quick) var(--ease-default)",
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 34,
          paddingInline: 12,
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-control)",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "var(--track-subhead)",
          color: "var(--color-text-primary)",
          cursor: "pointer",
          transition: "border-color var(--duration-quick) var(--ease-default)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"
             style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--duration-quick) var(--ease-default)" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Choose a date range"
          className="surface-elevated"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 60,
            display: "flex",
            background: "var(--color-bg-card)",
            borderRadius: "var(--radius-card)",
            overflow: "hidden",
          }}
        >
          {/* Presets. Most windows are a preset; the calendar is the
              escape hatch, not the primary path. */}
          <div
            style={{
              width: 168,
              padding: 8,
              borderRight: "1px solid var(--color-border)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {presets.map((p) => {
              const active = range === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() => {
                    onPreset(p.value);
                    setOpen(false);
                  }}
                  className="admin-nav-dropdown-item"
                  style={{
                    ...rowStyle,
                    fontWeight: active ? 600 : 500,
                    color: active
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                    background: active ? "var(--color-fill-secondary)" : "transparent",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Calendar */}
          <div style={{ padding: 12, width: 268 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <button
                onClick={() =>
                  setAnchor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
                }
                aria-label="Previous month"
                style={{
                  width: 28, height: 28, display: "grid", placeItems: "center",
                  background: "transparent", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-chip)", cursor: "pointer",
                  color: "var(--color-text-secondary)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "var(--track-headline)",
                  color: "var(--color-text-primary)",
                }}
              >
                {MONTHS[anchor.m]} {anchor.y}
              </span>
              <button
                onClick={() =>
                  setAnchor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))
                }
                aria-label="Next month"
                style={{
                  width: 28, height: 28, display: "grid", placeItems: "center",
                  background: "transparent", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-chip)", cursor: "pointer",
                  color: "var(--color-text-secondary)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div
                  key={i}
                  style={{
                    ...T.eyebrow,
                    fontSize: 10,
                    textAlign: "center",
                    paddingBottom: 4,
                  }}
                >
                  {d}
                </div>
              ))}
              {monthMatrix(anchor.y, anchor.m).flat().map((day, i) => {
                if (day == null) return <div key={i} />;
                const ms = Date.UTC(anchor.y, anchor.m, day);
                const disabled = ms < minMs || ms > maxMs;
                const selected =
                  draft.from === iso(ms) || (draft.to && draft.to === iso(ms));
                const within = !selected && inDraft(ms);
                return (
                  <button
                    key={i}
                    onClick={() => pick(day)}
                    disabled={disabled}
                    aria-pressed={!!selected}
                    style={{
                      height: 32,
                      border: "none",
                      borderRadius: "var(--radius-chip)",
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      cursor: disabled ? "default" : "pointer",
                      background: selected
                        ? "var(--color-accent-dark)"
                        : within
                          ? "var(--color-fill-secondary)"
                          : "transparent",
                      color: selected
                        ? "#FFFFFF"
                        : disabled
                          ? "var(--color-text-quaternary)"
                          : "var(--color-text-primary)",
                      transition: "background var(--duration-quick) var(--ease-default)",
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div
              className="flex items-center justify-between"
              style={{ marginTop: 12, gap: 8 }}
            >
              <span style={{ ...T.meta }}>
                {draft.from && draft.to
                  ? `${draft.from} → ${draft.to}`
                  : draft.from
                    ? "pick an end date"
                    : "pick a start date"}
              </span>
              <button
                onClick={() => {
                  if (!draft.from || !draft.to) return;
                  onCustom(draft.from, draft.to);
                  setOpen(false);
                }}
                disabled={!draft.from || !draft.to}
                style={{
                  height: 30,
                  paddingInline: 14,
                  borderRadius: "var(--radius-control)",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "var(--track-subhead)",
                  cursor: draft.from && draft.to ? "pointer" : "default",
                  background:
                    draft.from && draft.to
                      ? "var(--color-accent-dark)"
                      : "var(--color-fill-secondary)",
                  color:
                    draft.from && draft.to ? "#FFFFFF" : "var(--color-text-tertiary)",
                  transition: "background var(--duration-quick) var(--ease-default)",
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
