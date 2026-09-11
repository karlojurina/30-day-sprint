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
  Stat,
  Pill,
  Button,
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

/** The three groups, in the order the work actually happens: act, watch, ignore. */
const GROUPS = [
  {
    state: "canceled" as const,
    eyebrow: "Cancelled — remove their people",
    blurb:
      "These brands have stopped paying. Close the link so nobody new can use it, then remove the people below in Whop. They drop off this list automatically once removed.",
  },
  {
    state: "canceling" as const,
    eyebrow: "Cancelling — nothing to do yet",
    blurb:
      "These brands have cancelled but still have access until their cycle ends. Their team keeps access until then. They will move to Cancelled on their own.",
  },
  {
    state: "active" as const,
    eyebrow: "Active",
    blurb:
      "Paying brands. Nothing to do unless one has no link yet — then create one and send it to them.",
  },
];

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
  whop_username_label: "Whop username in the label",
  discord_handle_label: "Discord handle in the label",
  owner_redeemed_own_link: "the owner used this link themselves",
  exact_owner_name: "name match only — please verify",
  minted_by_app: "created here, owner certain",
  manual: "set by hand",
  unrecorded_link: "no link record",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";


export default function BrandOwnersPage() {
  const supabase = createClient();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
      setSnap(JSON.parse(raw) as Snapshot);
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


  return (
    <AdminPage>
      <PageHeader
        title="Brand Owners"
        description="EcomTalent for Brands owners, their team links, and who is on them."
        meta={`Live from Whop · ${new Date(snap.generatedAt).toLocaleTimeString()}`}
        actions={<Button onClick={() => void load()} busy={loading}>Refresh</Button>}
      />

      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 12, marginBottom: 20 }}
      >
        <Stat
          label="Cancelled"
          value={snap.counts.canceledOwners}
          sublabel={`${snap.counts.seatsToReview} people to remove`}
          tone={snap.counts.seatsToReview > 0 ? "danger" : "default"}
        />
        <Stat
          label="Cancelling"
          value={snap.counts.cancelingOwners}
          sublabel="access ends at cycle end"
          tone={snap.counts.cancelingOwners > 0 ? "warn" : "default"}
        />
        <Stat
          label="Active"
          value={snap.counts.activeOwners}
          sublabel={
            snap.counts.ownersWithoutLink > 0
              ? `${snap.counts.ownersWithoutLink} still need a link`
              : "all have a link"
          }
        />
      </div>

      {GROUPS.map(({ state, eyebrow, blurb }) => {
        const rows = snap.ownerRows.filter((o) => o.state === state);
        if (rows.length === 0) return null;
        return (
          <Section key={state} eyebrow={eyebrow} count={rows.length}>
            <div style={{ ...T.bodyDim, marginBottom: 10 }}>{blurb}</div>
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((o) => {
                const open = expanded.has(o.whopUserId);
                const who = o.name || o.email || o.whopUserId;
                return (
                  <div
                    key={o.whopUserId}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                      onClick={() => toggle(o.whopUserId)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={T.body}>
                          <span style={{ opacity: 0.5, marginRight: 8 }}>
                            {open ? "▾" : "▸"}
                          </span>
                          {who}
                        </div>
                        <div style={{ ...T.meta, marginTop: 2, paddingLeft: 20 }}>
                          {o.state === "canceled" &&
                            (o.seats.length > 0
                              ? `${o.seats.length} ${o.seats.length === 1 ? "person" : "people"} to remove`
                              : "nobody on their link")}
                          {o.state === "canceling" &&
                            `access ends ${fmtDate(o.cycleEndIso)}`}
                          {o.state === "active" &&
                            (o.link ? "link sent" : "no link yet")}
                        </div>
                      </div>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.link?.attributionConfidence === "confirm" && (
                          <Pill tone="warning">owner unconfirmed</Pill>
                        )}
                        {o.state === "canceled" && o.link?.canClose && (
                          <Button
                            size="sm"
                            variant="danger"
                            busy={busy === `/api/admin/etfb/links/${o.link.planId}/archive`}
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
                        )}
                        {o.state === "active" && !o.link && (
                          <Button
                            size="sm"
                            busy={busy === o.whopUserId}
                            onClick={() => void mint(o.whopUserId)}
                          >
                            Create link
                          </Button>
                        )}
                      </div>
                    </div>

                    {open && (
                      <div
                        style={{
                          borderTop: "1px solid var(--color-border)",
                          padding: "10px 12px",
                          background: "var(--color-surface-2, rgba(0,0,0,0.02))",
                        }}
                      >
                        <div style={{ ...T.meta, marginBottom: 8 }}>
                          {o.email ? `${o.email} · ` : ""}
                          {o.link ? (
                            <>
                              link labelled <strong>{o.link.label || "(blank)"}</strong>{" "}
                              · owner identified by{" "}
                              {HOW_MATCHED[o.link.attributionMethod] ??
                                o.link.attributionMethod}
                              {o.link.attributionConfidence === "confirm" && (
                                <>
                                  {" "}
                                  <Button
                                    size="sm"
                                    variant="subtle"
                                    busy={busy === `/api/admin/etfb/links/${o.link.planId}/owner`}
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
                                </>
                              )}
                            </>
                          ) : (
                            "no team link"
                          )}
                        </div>

                        {o.seats.length === 0 && o.protectedSeats.length === 0 && (
                          <div style={T.bodyDim}>Nobody has used this link.</div>
                        )}

                        {o.seats.map((p) => (
                          <div
                            key={p.membershipId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "6px 0",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={T.body}>{p.email || p.membershipId}</div>
                              <div
                                style={{ ...T.meta, opacity: 0.7, userSelect: "all" }}
                              >
                                {p.membershipId} · joined {fmtDate(p.joinedIso)}
                                {p.discordUsername ? ` · @${p.discordUsername}` : ""}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Copy this membership id to paste into Whop"
                                onClick={() => {
                                  void navigator.clipboard
                                    ?.writeText(p.membershipId)
                                    .then(() => setToast(`Copied ${p.membershipId}`))
                                    .catch(() => setToast(p.membershipId));
                                }}
                              >
                                Copy ID
                              </Button>
                              <Button
                                size="sm"
                                variant="subtle"
                                busy={busy === `/api/admin/etfb/seats/${p.membershipId}/decision`}
                                title="Leave this person alone — reversible"
                                onClick={() =>
                                  void post(
                                    `/api/admin/etfb/seats/${p.membershipId}/decision`,
                                    { decision: "keep", planId: o.link?.planId },
                                    "Kept",
                                  )
                                }
                              >
                                Keep
                              </Button>
                            </div>
                          </div>
                        ))}

                        {o.protectedSeats.length > 0 && (
                          <div style={{ ...T.meta, marginTop: 8, opacity: 0.8 }}>
                            Not offered for removal:{" "}
                            {o.protectedSeats
                              .map((x) => `${x.email || x.membershipId} (${x.why})`)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}

      {snap.keptSeats.length > 0 && (
        <Section eyebrow="Kept" count={snap.keptSeats.length}>
          <div style={{ ...T.bodyDim, marginBottom: 10 }}>
            Deliberately left alone. Undo puts them back in their owner&rsquo;s list.
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {snap.keptSeats.map((k) => (
              <div
                key={k.membershipId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={T.body}>{k.email || k.membershipId}</div>
                <Button
                  size="sm"
                  variant="subtle"
                  busy={busy === `/api/admin/etfb/seats/${k.membershipId}/decision`}
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
        </Section>
      )}

      {(snap.unresolvedPlans.length > 0 ||
        snap.unrecordedLinks.length > 0 ||
        snap.counts.seatsOnUnrecordedLinks > 0) && (
        <Section eyebrow="Needs attention">
          {snap.unresolvedPlans.length > 0 && (
            <div style={{ ...T.body, color: "var(--color-danger, #dc2626)" }}>
              {snap.unresolvedPlans.length} plan(s) could not be read from Whop.
              Some owners may be shown as cancelled when they are not — do not
              act on this page until this reads zero.
            </div>
          )}
          {snap.unrecordedLinks.length > 0 && (
            <div style={T.body}>
              {snap.unrecordedLinks.length} link(s) exist in Whop but are not
              recorded here, holding {snap.counts.seatsOnUnrecordedLinks} people.
            </div>
          )}
        </Section>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface, #111)",
            ...T.body,
          }}
        >
          {toast}
        </div>
      )}

    </AdminPage>
  );
}
