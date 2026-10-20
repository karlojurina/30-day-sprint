"use client";

/**
 * The on/off line of one template on /admin/templates. Where the switch works
 * it says whether the template is on, and founders and admins get Turn on /
 * Turn off; Turn on waits, with the reason beside it, while the view gives
 * one. Where the switch would not stop the template's tasks, it shows the
 * view's one line and no button. src/lib/template-on-off.ts decides which.
 *
 * In the brand kit's dark look since admin rebuild 2 (WI-8): the button is
 * the raised pill, 44px tall, and the line reads at 13px.
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
          fontSize: 13,
          lineHeight: 1.5,
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
    <div className="flex items-center gap-3 flex-wrap">
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: view.on ? "var(--color-text-primary)" : "var(--color-warning)",
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
            minHeight: 44,
            padding: "0 16px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: "var(--radius-pill)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            opacity: disabled ? 0.4 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {view.on ? "Turn off" : "Turn on"}
        </button>
      )}
      {canEdit && waits && (
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
          {view.turnOnWaits}
        </span>
      )}
    </div>
  );
}
