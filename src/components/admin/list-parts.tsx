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
 *   DiscordReach      C7: how to reach a student
 *   lastContactText   C12: "Messaged Tue 20 Oct by Robin, no reply yet"
 *   timeLeftText      "3 days left", "5 hours left"
 *   WhopNotPulled     C14: the student has had no Whop backfill since the switch
 *   MembershipPill    the membership status, in words
 *   SkeletonRows      what a list shows while it loads (skeletons, not spinners)
 *   LoadError         what a list shows when it could not load, with Retry
 *   NoticeBar         one line about the last thing done, or what went wrong
 */

/** The raised pill of ui.tsx's Button (variant "raised", size "md"), for a link that leaves the app. */
const RAISED_LINK: React.CSSProperties = {
  padding: "8px 16px",
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
    <div className="px-4 sm:px-8 lg:px-12 pt-6 sm:pt-10 pb-16" style={{ maxWidth: 1180, margin: "0 auto" }}>
      {children}
    </div>
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

export interface Notice {
  tone: "success" | "danger" | "neutral";
  text: string;
}

const NOTICE_DOT: Record<Notice["tone"], string> = {
  success: "var(--color-success)",
  danger: "var(--color-danger)",
  neutral: "var(--color-neutral)",
};

/**
 * One line at the top of a list: what the last action did, or what went
 * wrong. `action` adds one button beside it (Today's Undo after a mark).
 */
export function NoticeBar({
  notice,
  onClose,
  action,
}: {
  notice: Notice;
  onClose: () => void;
  action?: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px 10px 14px",
        marginBottom: 16,
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 8,
          height: 8,
          marginTop: 6,
          borderRadius: 999,
          background: NOTICE_DOT[notice.tone],
        }}
      />
      <p style={{ ...T.body, flex: 1, minWidth: 0, lineHeight: 1.5, overflowWrap: "anywhere" }}>{notice.text}</p>
      {action && (
        <Button variant="raised" busy={action.busy} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Dismiss
      </Button>
    </div>
  );
}
