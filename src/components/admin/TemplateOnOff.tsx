"use client";

/**
 * The on/off line of one template on /admin/templates. Where the switch works
 * it says whether the template is on, and founders and admins get Turn on /
 * Turn off; Turn on waits, with the reason beside it, while the view gives
 * one. Where the switch would not stop the template's tasks, it shows the
 * view's one line and no button. src/lib/template-on-off.ts decides which.
 */

import type { OnOffView } from "@/lib/template-on-off";

export function TemplateOnOff({
  view,
  canEdit,
  busy,
  onToggle,
}: {
  view: OnOffView;
  canEdit: boolean;
  /** True while this template is being saved or switched. */
  busy: boolean;
  onToggle: () => void;
}) {
  if (view.kind === "none") {
    return (
      <p
        style={{
          marginTop: 14,
          fontSize: 13,
          color: "var(--color-text-secondary)",
        }}
      >
        {view.line}
      </p>
    );
  }
  const waits = !view.on && view.turnOnWaits != null;
  const disabled = busy || waits;
  return (
    <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14 }}>
      <span
        style={{
          fontSize: 13,
          color: view.on ? "var(--color-text-secondary)" : "var(--color-warning)",
        }}
      >
        {view.line}
      </span>
      {canEdit && (
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          style={{
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {view.on ? "Turn off" : "Turn on"}
        </button>
      )}
      {canEdit && waits && (
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {view.turnOnWaits}
        </span>
      )}
    </div>
  );
}
