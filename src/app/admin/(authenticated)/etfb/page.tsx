"use client";

/**
 * /admin/etfb — Brand Owners.
 *
 * Every EcomTalent for Brands owner, their subscription state, the free team
 * link minted for them, and the people who redeemed it. When an owner stops
 * paying, their people surface in "Needs review" for Astrid to remove in Whop.
 *
 * TEAM-WIDE. No founderOnly / csmHidden anywhere — this is Astrid's tool and
 * she is role='csm'.
 *
 * NO REVOKE BUTTON, deliberately. v1 tells you who; a human does it in Whop.
 * A wrong click here removes a paying customer's staff, so the button waits
 * until the list has been right for a while. The schema already carries the
 * 'revoked' state so adding it later needs no migration.
 *
 * EVERY FIGURE IS LIVE from Whop. If that read fails this page renders an
 * explicit error, never an empty list — an empty list reads as "nothing to do"
 * and would quietly hide people who should have lost access.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import {
  AdminPage,
  PageHeader,
  Section,
  Button,
  Toast,
  T,
} from "@/components/admin/ui";

interface OwnerLink {
  planId: string;
  checkoutUrl: string;
  seatsUsed: number;
  attributionMethod: string;
  attributionConfidence: string;
  needsConfirm: boolean;
  linkStatus: string;
}
interface Owner {
  whopUserId: string;
  name: string | null;
  email: string | null;
  discordUsername: string | null;
  status: string;
  cancelScheduled: boolean;
  cycleEndIso: string | null;
  link: OwnerLink | null;
}
interface ReviewSeat {
  membershipId: string;
  email: string | null;
  discordUsername: string | null;
  joinedIso: string | null;
  linkPlanId: string;
  ownerWhopUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  attributionMethod: string;
  attributionConfidence: string;
  linkLabel: string | null;
  heldBy: "unknown_person" | "self_paying_owner" | "unknown_link";
}
interface OwnerSeat {
  membershipId: string;
  email: string | null;
  discordUsername: string | null;
  joinedIso: string | null;
}
interface OwnerRow {
  whopUserId: string;
  name: string | null;
  email: string | null;
  state: "active" | "canceling" | "canceled";
  cycleEndIso: string | null;
  link: {
    planId: string;
    label: string | null;
    checkoutUrl: string;
    attributionMethod: string;
    attributionConfidence: string;
    linkStatus: string;
    canClose: boolean;
  } | null;
  seats: OwnerSeat[];
  protectedSeats: { membershipId: string; email: string | null; why: string }[];
}

type Snapshot =
  | { state: "no_data"; reason: string }
  | {
      state: "ok";
      generatedAt: string;
      owners: Owner[];
      reviewSeats: ReviewSeat[];
      needsOwner: { planId: string; note: string | null }[];
      needsConfirm: number;
      unrecordedLinks: { planId: string; internalNotes: string | null }[];
      unresolvedPlans: string[];
      ownerRows: OwnerRow[];
      linksToClose: {
        planId: string;
        ownerName: string | null;
        ownerEmail: string | null;
        seatsUsed: number;
        attributionConfidence: string;
        linkLabel: string | null;
      }[];
      keptSeats: {
        membershipId: string;
        email: string | null;
        linkPlanId: string;
        reason: string | null;
      }[];
      counts: {
        payingOwners: number;
        ownersWithoutLink: number;
        seatsToReview: number;
        seatsOnUnrecordedLinks: number;
        linksToClose: number;
        keptSeats: number;
        canceledOwners: number;
        cancelingOwners: number;
        activeOwners: number;
      };
    }
  | { state: "error"; message: string };

/** Plain-language version of attribution_method, so the evidence on the row is
 *  legible to someone who has never read the schema. */
const HOW_MATCHED: Record<string, string> = {
  whop_username_label: "matched on the Whop username in the label",
  discord_handle_label: "matched on the Discord handle in the label",
  owner_redeemed_own_link: "the owner redeemed it themselves",
  exact_owner_name: "matched on the name only, please verify",
  minted_by_app: "created here, so the owner is certain",
  manual: "the owner was set by hand",
  unrecorded_link: "no link record exists",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";


export default function BrandOwnersPage() {
  const supabase = createClient();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Membership ids ticked off during this session. Local only, never sent —
   *  the app still changes nobody's access. It exists so that coming back from
   *  Whop you can see where you got to. A tick clears itself once a refresh
   *  proves that person is actually gone. */
  const [done, setDone] = useState<Set<string>>(new Set());
  const markDone = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** Cancelling and Active are reference, not work. Collapsed by default. */
  const [refOpen, setRefOpen] = useState(false);

  const token = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }, [supabase]);

  /** Never let an HTML error page or a gateway timeout throw past the caller.
   *  A silent failure here shows Astrid a stopped spinner and no message, and
   *  the obvious retry is what mints a duplicate link. */
  async function readJson(res: Response): Promise<Record<string, unknown>> {
    const raw = await res.text();
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `The server replied with something that was not JSON (HTTP ${res.status}). ` +
          `It may have timed out mid-request.`,
      );
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/etfb", {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const raw = await res.text();
      const next = JSON.parse(raw) as Snapshot;
      setSnap(next);
      if (next.state === "ok") {
        const live = new Set(
          next.ownerRows.flatMap((o) => o.seats.map((x) => x.membershipId)),
        );
        setDone((prev) => new Set([...prev].filter((id) => live.has(id))));
      }
    } catch (err) {
      setSnap({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint(ownerWhopUserId: string) {
    setBusy(ownerWhopUserId);
    try {
      const res = await fetch("/api/admin/etfb/links", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ownerWhopUserId }),
      });
      const json = (await readJson(res)) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setToast(json.error ?? "Could not create the link");
      } else {
        await navigator.clipboard?.writeText(json.checkoutUrl ?? "").catch(() => {});
        setToast("Link created and copied to your clipboard");
        await load();
      }
    } catch (err) {
      // The dangerous case: Whop may already have created the plan before the
      // request died. Retrying blind is how an owner ends up with two live
      // links, so say so instead of showing nothing.
      setToast(
        `${err instanceof Error ? err.message : String(err)} — the link may ` +
          `still have been created. Refresh and check Housekeeping for an ` +
          `unrecorded link BEFORE trying again.`,
      );
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 6000);
    }
  }


  async function post(url: string, body: unknown, okMsg: string) {
    setBusy(url);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = (await readJson(res)) as { error?: string; note?: string };
      setToast(!res.ok ? (json.error ?? "That did not work") : (json.note ?? okMsg));
      if (res.ok) await load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 8000);
    }
  }

  if (loading && !snap) {
    return (
      <AdminPage>
        <PageHeader title="Brand Owners" description="Reading live from Whop…" />
      </AdminPage>
    );
  }

  // Distinct from both "ok" and "error": we reached the server, but the link
  // table is empty, so nothing on this page can be trusted. Rendering the
  // normal empty state here would be a false all-clear.
  if (snap?.state === "no_data") {
    return (
      <AdminPage>
        <PageHeader
          title="Brand Owners"
          description="Not ready yet."
          actions={<Button onClick={() => void load()}>Try again</Button>}
        />
        <Section eyebrow="No link data">
          <div style={T.body}>{snap.reason}</div>
        </Section>
      </AdminPage>
    );
  }

  // Explicit error state. Never an empty list — see the file header.
  if (!snap || snap.state === "error") {
    return (
      <AdminPage>
        <PageHeader
          title="Brand Owners"
          description="Could not read from Whop."
          actions={<Button onClick={() => void load()}>Try again</Button>}
        />
        <Section eyebrow="Error">
          <div style={{ ...T.body, color: "var(--color-danger, #dc2626)" }}>
            {snap?.state === "error" ? snap.message : "No response."}
          </div>
          <div style={{ ...T.bodyDim, marginTop: 10 }}>
            Nothing is shown rather than a partial list, on purpose. A short list
            here would look like &ldquo;nothing to do&rdquo; and hide people who
            should have lost access.
          </div>
        </Section>
      </AdminPage>
    );
  }


  /* ── Derived view state ──────────────────────────────────────────────
     Only "cancelled" is work. Cancelling is explicitly nothing-to-do-yet and
     Active is nothing-to-do, so they sit below a divider as reference. */

  const untrustworthy = snap.unresolvedPlans.length > 0;

  const cancelled = snap.ownerRows
    .filter((o) => o.state === "canceled")
    .sort((a, b) => b.seats.length - a.seats.length);
  const watching = snap.ownerRows.filter((o) => o.state === "canceling");
  const activeRows = snap.ownerRows
    .filter((o) => o.state === "active")
    .sort((a, b) => Number(!!a.link) - Number(!!b.link));

  const peopleLeft = cancelled.reduce(
    (n, o) => n + o.seats.filter((x) => !done.has(x.membershipId)).length,
    0,
  );
  const readAt = new Date(snap.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const jobLine =
    cancelled.length === 0
      ? "Every brand owner with a team link is paying."
      : `${cancelled.length} ${cancelled.length === 1 ? "owner" : "owners"} to clear · ` +
        `${peopleLeft} ${peopleLeft === 1 ? "person" : "people"} to remove in Whop`;

  const copyAll = (o: OwnerRow) => {
    void navigator.clipboard
      ?.writeText(o.seats.map((x) => x.membershipId).join("\n"))
      .then(() => setToast(`Copied ${o.seats.length} membership ids`))
      .catch(() => setToast("Could not reach the clipboard"));
  };

  const refCount = watching.length + activeRows.length + snap.keptSeats.length;

  return (
    <AdminPage>
      <PageHeader
        title="Brand Owners"
        description={jobLine}
        meta={`Read live from Whop at ${readAt}`}
        actions={
          <Button onClick={() => void load()} busy={loading}>
            Refresh
          </Button>
        }
      />

      {/* The one thing that has to be read before anything is clicked. It used
          to render at the very bottom of the page, under every action button —
          a warning you reach only after the mistake is available. */}
      {untrustworthy && (
        <div
          role="alert"
          style={{
            border: "1px solid var(--color-danger)",
            background: "color-mix(in oklab, var(--color-danger) 7%, transparent)",
            borderRadius: "var(--radius-card)",
            padding: "14px 16px",
            marginBottom: 24,
          }}
        >
          <div style={{ ...T.body, fontWeight: 600, color: "var(--color-danger)" }}>
            {snap.unresolvedPlans.length}{" "}
            {snap.unresolvedPlans.length === 1 ? "plan" : "plans"} could not be
            read from Whop.
          </div>
          <div style={{ ...T.bodyDim, marginTop: 4, maxWidth: "68ch" }}>
            Some owners may be showing as cancelled when they are not. Closing a
            link or pulling someone out of Whop right now could cut off a brand
            that is still paying, so every action on this page is off until this
            clears. Refresh; if it persists, the Whop read is the problem.
          </div>
        </div>
      )}

      {cancelled.length === 0 ? (
        <Section eyebrow="Nothing to remove">
          <div style={T.body}>{jobLine}</div>
          <div style={{ ...T.bodyDim, marginTop: 4 }}>
            This is a live read from Whop at {readAt}, not a cached or empty
            list.
          </div>
        </Section>
      ) : (
        <Section
          eyebrow="Cancelled — remove their people in Whop"
          count={cancelled.length}
        >
          <div style={{ display: "grid", gap: 12 }}>
            {cancelled.map((o) => {
              const who = o.name || o.email || o.whopUserId;
              const unconfirmed =
                o.link?.attributionConfidence === "confirm";
              const alreadyClosed = !!o.link && !o.link.canClose;
              const remaining = o.seats.filter(
                (x) => !done.has(x.membershipId),
              ).length;
              return (
                <div
                  key={o.whopUserId}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-card)",
                    background: "var(--color-bg-card)",
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={T.cardTitle}>{who}</div>
                      {o.email && o.email !== who && (
                        <div style={{ ...T.bodyDim, marginTop: 2 }}>
                          {o.email}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {alreadyClosed ? (
                        <span style={T.meta}>
                          Link closed
                          {remaining > 0
                            ? ` · ${remaining} still to remove in Whop`
                            : ""}
                        </span>
                      ) : (
                        o.link && (
                          <Button
                            size="sm"
                            variant="subtle"
                            disabled={untrustworthy || unconfirmed}
                            title={
                              unconfirmed
                                ? "Confirm the owner before closing their link"
                                : untrustworthy
                                  ? "Off until the unreadable plans clear"
                                  : "Stops anyone new redeeming it. Nobody loses access."
                            }
                            busy={
                              busy ===
                              `/api/admin/etfb/links/${o.link.planId}/archive`
                            }
                            onClick={() =>
                              void post(
                                `/api/admin/etfb/links/${o.link!.planId}/archive`,
                                {},
                                "Link closed — nobody new can use it",
                              )
                            }
                          >
                            Close link
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* The evidence. This is the line you read to decide whether
                      this link really belongs to this owner, so it is set as
                      content rather than as 11px tertiary meta. */}
                  <div style={{ ...T.bodyDim, marginTop: 12 }}>
                    {o.link ? (
                      <>
                        Link{" "}
                        <strong style={{ color: "var(--color-text-primary)" }}>
                          {o.link.label || "(no label)"}
                        </strong>{" "}
                        ·{" "}
                        {HOW_MATCHED[o.link.attributionMethod] ??
                          o.link.attributionMethod}{" "}
                        · {o.seats.length}{" "}
                        {o.seats.length === 1 ? "person" : "people"}
                      </>
                    ) : (
                      "No team link was ever minted for this owner."
                    )}
                  </div>

                  {unconfirmed && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "12px 14px",
                        borderRadius: "var(--radius-chip)",
                        background: "var(--color-bg-elevated)",
                        border: "1px solid var(--color-border-strong)",
                      }}
                    >
                      <div style={{ ...T.body, fontWeight: 600 }}>
                        Not certain this link is theirs.
                      </div>
                      <div
                        style={{ ...T.bodyDim, marginTop: 2, maxWidth: "62ch" }}
                      >
                        It was matched on the name alone. Confirm it before
                        closing anything or removing anyone — if the match is
                        wrong, these are somebody else&rsquo;s staff.
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={untrustworthy}
                          busy={
                            busy ===
                            `/api/admin/etfb/links/${o.link!.planId}/owner`
                          }
                          onClick={() =>
                            void post(
                              `/api/admin/etfb/links/${o.link!.planId}/owner`,
                              { ownerWhopUserId: o.whopUserId, confirm: true },
                              "Owner confirmed",
                            )
                          }
                        >
                          Confirm this is right
                        </Button>
                      </div>
                    </div>
                  )}

                  {o.seats.length === 0 ? (
                    <div style={{ ...T.bodyDim, marginTop: 12 }}>
                      Nobody ever used this link.
                    </div>
                  ) : (
                    <div
                      style={{
                        marginTop: 12,
                        borderTop: "1px solid var(--color-border)",
                      }}
                    >
                      {o.seats.map((x, i) => {
                        const isDone = done.has(x.membershipId);
                        return (
                          <div
                            key={x.membershipId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "10px 0",
                              borderBottom:
                                i === o.seats.length - 1
                                  ? "none"
                                  : "1px solid var(--color-border)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => markDone(x.membershipId)}
                              aria-label={`Mark ${x.email || x.membershipId} as removed in Whop`}
                              title="Tick once you have removed them in Whop"
                              style={{
                                width: 16,
                                height: 16,
                                flexShrink: 0,
                                cursor: "pointer",
                                accentColor: "var(--color-accent-dark)",
                              }}
                            />
                            <div
                              style={{
                                minWidth: 0,
                                flex: 1,
                                opacity: isDone ? 0.45 : 1,
                              }}
                            >
                              <div
                                style={{
                                  ...T.body,
                                  textDecoration: isDone
                                    ? "line-through"
                                    : "none",
                                }}
                              >
                                {x.email || x.membershipId}
                              </div>
                              <div
                                style={{
                                  ...T.meta,
                                  marginTop: 2,
                                  userSelect: "all",
                                }}
                              >
                                {x.membershipId} · joined {fmtDate(x.joinedIso)}
                                {x.discordUsername
                                  ? ` · @${x.discordUsername}`
                                  : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Copy this membership id to paste into Whop"
                                onClick={() => {
                                  void navigator.clipboard
                                    ?.writeText(x.membershipId)
                                    .then(() =>
                                      setToast(`Copied ${x.membershipId}`),
                                    )
                                    .catch(() => setToast(x.membershipId));
                                }}
                              >
                                Copy ID
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={untrustworthy}
                                busy={
                                  busy ===
                                  `/api/admin/etfb/seats/${x.membershipId}/decision`
                                }
                                title="Leave this person alone — reversible"
                                onClick={() =>
                                  void post(
                                    `/api/admin/etfb/seats/${x.membershipId}/decision`,
                                    { decision: "keep", planId: o.link?.planId },
                                    "Kept",
                                  )
                                }
                              >
                                Keep
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          marginTop: 10,
                        }}
                      >
                        <span style={T.meta}>
                          {remaining === 0
                            ? "All ticked off."
                            : `${remaining} of ${o.seats.length} still to remove`}
                        </span>
                        {o.seats.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyAll(o)}
                          >
                            Copy all {o.seats.length} IDs
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {o.protectedSeats.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={T.eyebrow}>Not offered for removal</div>
                      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                        {o.protectedSeats.map((x) => (
                          <div key={x.membershipId} style={T.meta}>
                            {x.email || x.membershipId} — {x.why}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Reference. Neither group is work, so neither competes with it. ── */}
      {refCount > 0 && (
        <Section
          eyebrow="Reference — nothing to do here"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefOpen((v) => !v)}
            >
              {refOpen ? "Hide" : `Show ${refCount}`}
            </Button>
          }
          style={{ borderTop: "1px solid var(--color-border)", paddingTop: 24 }}
        >
          {refOpen && (
            <div style={{ display: "grid", gap: 24 }}>
              {watching.length > 0 && (
                <div>
                  <div style={T.eyebrow}>Cancelling · {watching.length}</div>
                  <div
                    style={{ ...T.bodyDim, margin: "6px 0 8px", maxWidth: "68ch" }}
                  >
                    Cancelled, but still inside a cycle they paid for. Their team
                    keeps access until it ends, then they move up to Cancelled on
                    their own.
                  </div>
                  {watching.map((o) => (
                    <div
                      key={o.whopUserId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "6px 0",
                      }}
                    >
                      <span style={T.body}>
                        {o.name || o.email || o.whopUserId}
                      </span>
                      <span style={T.meta}>
                        access ends {fmtDate(o.cycleEndIso)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {activeRows.length > 0 && (
                <div>
                  <div style={T.eyebrow}>Active · {activeRows.length}</div>
                  <div
                    style={{ ...T.bodyDim, margin: "6px 0 8px", maxWidth: "68ch" }}
                  >
                    Paying. The only thing to do here is mint a link for anyone
                    who has not got one yet.
                  </div>
                  {activeRows.map((o) => (
                    <div
                      key={o.whopUserId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "6px 0",
                      }}
                    >
                      <span style={T.body}>
                        {o.name || o.email || o.whopUserId}
                      </span>
                      {o.link ? (
                        <span style={T.meta}>link sent</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={untrustworthy}
                          busy={busy === o.whopUserId}
                          onClick={() => void mint(o.whopUserId)}
                        >
                          Create link
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {snap.keptSeats.length > 0 && (
                <div>
                  <div style={T.eyebrow}>Kept · {snap.keptSeats.length}</div>
                  <div
                    style={{ ...T.bodyDim, margin: "6px 0 8px", maxWidth: "68ch" }}
                  >
                    Deliberately left alone. Undo puts them back in their
                    owner&rsquo;s list.
                  </div>
                  {snap.keptSeats.map((k) => (
                    <div
                      key={k.membershipId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "6px 0",
                      }}
                    >
                      <span style={T.body}>{k.email || k.membershipId}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={untrustworthy}
                        busy={
                          busy ===
                          `/api/admin/etfb/seats/${k.membershipId}/decision`
                        }
                        onClick={() =>
                          void post(
                            `/api/admin/etfb/seats/${k.membershipId}/decision`,
                            { decision: null },
                            "Back in the list",
                          )
                        }
                      >
                        Undo
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {(snap.unrecordedLinks.length > 0 ||
                snap.counts.seatsOnUnrecordedLinks > 0) && (
                <div>
                  <div style={T.eyebrow}>Unrecorded links</div>
                  <div style={{ ...T.bodyDim, marginTop: 6, maxWidth: "68ch" }}>
                    {snap.unrecordedLinks.length} link(s) exist in Whop but are
                    not recorded here, holding{" "}
                    {snap.counts.seatsOnUnrecordedLinks} people. Nobody on them
                    can be attributed to an owner, so they never appear above.
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {toast && <Toast message={toast} />}
    </AdminPage>
  );
}
