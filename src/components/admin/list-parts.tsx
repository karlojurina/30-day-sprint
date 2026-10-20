"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Pill, T } from "@/components/admin/ui";
import type { PillTone } from "@/components/admin/ui";
import { dayLabel } from "@/lib/admin/croatia-dates";
import type { LastContact } from "@/lib/admin/thirty-view";

/**
 * Pieces the rebuilt list pages share (admin rebuild PRD): the 30% page
 * (thirty/ThirtyView.tsx) and Today. They read the dark look's tokens
 * (admin-tokens.module.css) and sit inside it.
 *
 *   ListPage          the page's frame: ui.tsx's AdminPage, with the kit's
 *                     16px side gutter on a phone
 *   ListHeader        the title with Refresh beside it, the description, and
 *                     "Updated 09:30" at 12px
 *   DiscordReach      C7: how to reach a student
 *   lastContactText   C12: "Messaged Tue 20 Oct by Robin, no reply yet"
 *   timeLeftText      "3 days left", "5 hours left"
 *   WhopNotPulled     C14: the student has had no Whop backfill since the switch
 *   MembershipPill    the membership status, in words
 *   SkeletonRows      what a list shows while it loads (skeletons, not spinners)
 *   LoadError         what a list shows when it could not load, with Retry
 *   NoticeStack       what a row's button did, or what went wrong, in a fixed
 *                     place at the bottom of the window, where it is seen
 *                     wherever the click was
 *
 * Every tap target here is at least 44px tall (the kit's touch target).
 */

/** The kit's touch target. */
export const TAP = 44;

/**
 * A pill that is pressed or not: Today's reason chips and plan choice, the
 * 30% page's tabs. Raised surface and hairline; pressed in Airy Blue.
 */
export function pressPill(pressed: boolean): React.CSSProperties {
  return {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: TAP,
    padding: "0 14px",
    borderRadius: "var(--radius-pill)",
    border: `1px solid ${pressed ? "var(--color-accent-dark)" : "var(--color-border)"}`,
    background: pressed ? "var(--color-accent-glow)" : "var(--color-bg-elevated)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    fontWeight: pressed ? 600 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  };
}

/** The raised pill of ui.tsx's Button (variant "raised", size "md"), for a link that leaves the app. */
const RAISED_LINK: React.CSSProperties = {
  padding: "0 16px",
  minHeight: TAP,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.005em",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
};

/**
 * The page's frame: AdminPage's width and rhythm (ui.tsx), with a 16px side
 * gutter on a phone instead of 32px, so a row at 390px wide keeps room for
 * its words.
 */
export function ListPage({ children }: { children: React.ReactNode }) {
  return (
    // pb-28: room under the last row for the notices fixed at the bottom of the window.
    <div className="px-4 sm:px-8 lg:px-12 pt-4 sm:pt-10 pb-28" style={{ maxWidth: 1180, margin: "0 auto" }}>
      {children}
    </div>
  );
}

/**
 * The page's header. The title and its one action (Refresh) share a line on
 * every width, so on a phone the action does not take a line of its own; the
 * description and the meta line ("Updated 09:30", 12px, the kit's floor for
 * text that is not an eyebrow) follow.
 */
export function ListHeader({
  title,
  description,
  meta,
  action,
}: {
  title: string;
  description: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-4 sm:mb-8">
      <div className="flex items-center justify-between" style={{ gap: 12 }}>
        <h1 style={{ ...T.display, minWidth: 0 }}>{title}</h1>
        {action}
      </div>
      <p style={{ ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }}>{description}</p>
      {meta && (
        <p style={{ marginTop: 4, fontSize: 12, color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </p>
      )}
    </header>
  );
}

/**
 * How long until a deadline, from `now` (the moment the list was read, so a
 * row and the list agree): "3 days left", "5 hours left", "under 1 hour
 * left", "deadline passed". Null when either date is missing.
 */
export function timeLeftText(deadline: string | null | undefined, now: string): string | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - Date.parse(now);
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "deadline passed";
  const hours = ms / 3_600_000;
  if (hours < 1) return "under 1 hour left";
  if (hours < 48) {
    const h = Math.floor(hours);
    return `${h} ${h === 1 ? "hour" : "hours"} left`;
  }
  return `${Math.floor(hours / 24)} days left`;
}

/** The first word of a team member's name: "Messaged by Robin". */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * C7: "Open in Discord" when Discord's id for the student is known, else
 * "Copy @name" (discord_username can hold a Whop username, so it is a
 * fallback only), else "No Discord linked" with nothing to copy.
 */
export function DiscordReach({ discord }: { discord: { userId: string | null; username: string | null } }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (discord.userId) {
    return (
      <a
        href={`https://discord.com/users/${encodeURIComponent(discord.userId)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={RAISED_LINK}
      >
        Open in Discord
      </a>
    );
  }
  if (discord.username) {
    const handle = `@${discord.username.replace(/^@/, "")}`;
    return (
      <Button
        variant="raised"
        size="md"
        title="Copies the name, to find the student in Discord"
        onClick={async () => {
          let ok = false;
          try {
            await navigator.clipboard.writeText(handle);
            ok = true;
          } catch {
            ok = false;
          }
          setCopied(ok ? "yes" : "failed");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(null), 1500);
        }}
      >
        {copied === "yes" ? "Copied" : copied === "failed" ? "Couldn't copy" : `Copy ${handle}`}
      </Button>
    );
  }
  return <span style={{ ...T.bodyDim, whiteSpace: "nowrap" }}>No Discord linked</span>;
}

/** C12: the newest message the team marked as sent, from Today or the Tasks queue. */
export function lastContactText(contact: LastContact | null): string {
  if (!contact) return "No message yet";
  const by = firstName(contact.by?.name);
  const outcome =
    contact.outcome === "replied" ? "replied" : contact.outcome === "no_reply" ? "no reply" : "no reply yet";
  return `Messaged ${dayLabel(contact.at)}${by ? ` by ${by}` : ""}, ${outcome}`;
}

/** C14: no Whop backfill since the switch, so the student's Whop watching is not counted yet. */
export function WhopNotPulled() {
  return <Pill tone="warning">Whop progress not pulled yet</Pill>;
}

const MEMBERSHIP: Record<string, { tone: PillTone; text: string }> = {
  active: { tone: "success", text: "Active" },
  past_due: { tone: "warning", text: "Payment failed" },
  canceled: { tone: "danger", text: "Canceled" },
  expired: { tone: "neutral", text: "Expired" },
};

/** The membership status in words (membership_status), never colour alone. */
export function MembershipPill({ status }: { status: string }) {
  const m = MEMBERSHIP[status] ?? { tone: "neutral" as const, text: status || "No membership" };
  return <Pill tone={m.tone}>{m.text}</Pill>;
}

/** Grey bars in the shape of the rows, while a list loads. */
export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <Card padding={0}>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="list-row"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: 16 }}
          >
            <SkeletonBar width="38%" height={14} />
            <SkeletonBar width="72%" />
            <SkeletonBar width="54%" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SkeletonBar({ width, height = 10 }: { width: string; height?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ width, height, borderRadius: 6, background: "var(--color-fill-secondary)" }}
    />
  );
}

/** A list that could not load: what happened, in a sentence, and Retry. */
export function LoadError({
  title,
  detail,
  onRetry,
  busy,
}: {
  title: string;
  detail?: string | null;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <Card padding={20}>
      <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <p style={{ ...T.body, fontSize: 15, fontWeight: 600 }}>{title}</p>
        {detail && <p style={T.bodyDim}>{detail}</p>}
        <Button variant="raised" size="md" busy={busy} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

/** A button that copies `text` and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      variant="raised"
      size="md"
      onClick={async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          ok = false;
        }
        setCopied(ok ? "yes" : "failed");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1500);
      }}
    >
      {copied === "yes" ? "Copied" : copied === "failed" ? "Couldn't copy" : label}
    </Button>
  );
}

export interface Notice {
  /** A new number for each notice: a success notice hides itself NOTICE_SECONDS after it shows, and a newer one keeps its own time. */
  id: number;
  /** success hides itself; danger (something to act on) and warning (the list may be out of date) stay until dismissed. */
  tone: "success" | "danger" | "warning";
  text: string;
  /** One button beside the words (the Undo after a mark); pressing it calls the stack's onAction with the notice's id. */
  action?: { label: string; busy?: boolean };
  /** Something in the words to copy: a Whop code. */
  copy?: { label: string; text: string };
}

/** How long a success notice stays: time to press its Undo. */
export const NOTICE_SECONDS = 15;

const NOTICE_DOT: Record<Notice["tone"], string> = {
  success: "var(--color-success)",
  danger: "var(--color-danger)",
  warning: "var(--color-warning)",
};

/**
 * What a row's button did, or what went wrong, fixed at the bottom of the
 * window (the Toast pattern of ui.tsx). A click low on a long list sees its
 * answer where it is: a notice at the top of the page would be out of view,
 * and the row it was about may be gone after the list is read again.
 */
export function NoticeStack({
  notices,
  onClose,
  onAction,
}: {
  notices: Notice[];
  onClose: (id: number) => void;
  /** A notice's action button was pressed. */
  onAction?: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        // The strip between the cards lets clicks through to the page.
        pointerEvents: "none",
      }}
    >
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} onClose={onClose} onAction={onAction} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  onClose,
  onAction,
}: {
  notice: Notice;
  onClose: (id: number) => void;
  onAction?: (id: number) => void;
}) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const busy = notice.action?.busy === true;
  useEffect(() => {
    if (notice.tone !== "success" || busy) return;
    const t = setTimeout(() => close.current(notice.id), NOTICE_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [notice.id, notice.tone, busy]);
  return (
    <div
      role={notice.tone === "success" ? "status" : "alert"}
      style={{
        pointerEvents: "auto",
        width: "100%",
        maxWidth: 600,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
        padding: "10px 10px 10px 14px",
        borderRadius: "var(--radius-card)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-strong)",
      }}
    >
      <p style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: "1 1 260px", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: NOTICE_DOT[notice.tone] }}
        />
        <span style={{ ...T.body, lineHeight: 1.5, overflowWrap: "anywhere" }}>{notice.text}</span>
      </p>
      <div className="flex flex-wrap items-center" style={{ gap: 8, marginLeft: "auto" }}>
        {notice.copy && <CopyButton text={notice.copy.text} label={notice.copy.label} />}
        {notice.action && onAction && (
          <Button variant="raised" size="md" busy={notice.action.busy} onClick={() => onAction(notice.id)}>
            {notice.action.label}
          </Button>
        )}
        <Button variant="ghost" size="md" onClick={() => onClose(notice.id)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** The one line a list shows while what it shows may be out of date (a read after a change failed). */
export const STALE_TEXT = "Couldn't refresh the list, so it may be out of date. Press Refresh.";
