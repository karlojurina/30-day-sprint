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
  EmptyState,
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

const daysUntil = (s: string | null) =>
  s ? Math.round((new Date(s).getTime() - Date.now()) / 86_400_000) : null;

export default function BrandOwnersPage() {
  const supabase = createClient();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  async function mint(owner: Owner) {
    setBusy(owner.whopUserId);
    try {
      const res = await fetch("/api/admin/etfb/links", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ownerWhopUserId: owner.whopUserId }),
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

  async function decide(seat: ReviewSeat, decision: "keep" | null) {
    setBusy(seat.membershipId);
    try {
      const res = await fetch(
        `/api/admin/etfb/seats/${seat.membershipId}/decision`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await token()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision, planId: seat.linkPlanId }),
        },
      );
      if (!res.ok) {
        const j = (await readJson(res)) as { error?: string };
        setToast(j.error ?? "Could not save that");
      } else {
        await load();
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
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

  const ownersNoLink = snap.owners.filter((o) => !o.link);
  const endingSoon = snap.owners.filter((o) => {
    const d = daysUntil(o.cycleEndIso);
    return o.cancelScheduled && d !== null && d <= 14;
  });

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
        <Stat label="Paying owners" value={snap.counts.payingOwners} />
        <Stat
          label="Owners without a link"
          value={snap.counts.ownersWithoutLink}
          tone={snap.counts.ownersWithoutLink > 0 ? "warn" : "default"}
        />
        <Stat
          label="Seats to review"
          value={snap.counts.seatsToReview}
          sublabel="owner no longer paying"
          tone={snap.counts.seatsToReview > 0 ? "danger" : "default"}
        />
      </div>

      <Section eyebrow="Needs review" count={snap.reviewSeats.length}>
        <div style={{ ...T.bodyDim, marginBottom: 10 }}>
          People with <strong>free course access</strong> whose brand owner has
          stopped paying. Remove them in Whop and they drop off this list
          automatically. <strong>Keep</strong> means leave this person alone —
          it is reversible, and kept people move to their own section below.
        </div>
        {snap.reviewSeats.length === 0 ? (
          <EmptyState
            title="Nobody to remove"
            description="Every live team seat belongs to an owner who is still paying."
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {snap.reviewSeats.map((s) => (
              <div
                key={s.membershipId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={T.body}>{s.email || s.membershipId}</div>
                  <div style={{ ...T.meta, marginTop: 2 }}>
                    {/* || not ?? — Whop stores an EMPTY STRING for names it
                        does not have, which ?? does not fall through. 14 of the
                        seeded owners are in that state and rendered blank. */}
                    via{" "}
                    <strong>
                      {s.ownerName || s.ownerEmail || "owner not recorded"}
                    </strong>{" "}
                    (no longer paying) · this person joined {fmtDate(s.joinedIso)}
                    {s.discordUsername ? ` · @${s.discordUsername}` : ""}
                  </div>
                  {/* The membership id is the ONLY unambiguous handle for the
                      person about to lose access. Without it the removal is
                      done by searching an email in Whop, which can resolve to
                      several memberships including a live paid subscription. */}
                  <div style={{ ...T.meta, marginTop: 2 }}>
                    link label in Whop:{" "}
                    <strong>{s.linkLabel || "(blank)"}</strong> · matched by{" "}
                    {HOW_MATCHED[s.attributionMethod] ?? s.attributionMethod}
                  </div>
                  <div
                    style={{ ...T.meta, marginTop: 2, opacity: 0.7, userSelect: "all" }}
                  >
                    {s.membershipId} · seat on {s.linkPlanId}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {s.heldBy === "unknown_link" && (
                    <Pill tone="danger">link not recorded here</Pill>
                  )}
                  {s.attributionConfidence === "confirm" && (
                    <>
                      <Pill tone="warning">matched by name</Pill>
                      <Button
                        size="sm"
                        variant="subtle"
                        busy={busy === `/api/admin/etfb/links/${s.linkPlanId}/owner`}
                        title={`Confirm that this link really belongs to ${s.ownerName || s.ownerEmail || "this owner"}`}
                        onClick={() =>
                          void post(
                            `/api/admin/etfb/links/${s.linkPlanId}/owner`,
                            { ownerWhopUserId: s.ownerWhopUserId, confirm: true },
                            "Owner confirmed",
                          )
                        }
                      >
                        Confirm owner
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="subtle"
                    busy={busy === s.membershipId}
                    onClick={() => void decide(s, "keep")}
                    title="Leave this person alone; stop showing them here"
                  >
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Copies this person's membership id. Paste it into Whop's member search — it is the only unambiguous handle for the exact access to cancel."
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(s.membershipId)
                        .then(() => setToast(`Copied ${s.membershipId} — paste it into Whop's member search`))
                        .catch(() => setToast(s.membershipId));
                    }}
                  >
                    Copy ID
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section eyebrow="Owners without a team link" count={ownersNoLink.length}>
        {ownersNoLink.length === 0 ? (
          <EmptyState title="Every paying owner has a link" />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {ownersNoLink.map((o) => (
              <div
                key={o.whopUserId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={T.body}>{o.email || o.whopUserId}</div>
                  <div style={{ ...T.meta, marginTop: 2 }}>
                    renews {fmtDate(o.cycleEndIso)}
                  </div>
                </div>
                <Button
                  size="sm"
                  busy={busy === o.whopUserId}
                  onClick={() => void mint(o)}
                >
                  Create link
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {endingSoon.length > 0 && (
        <Section eyebrow="Cancelling — cycle ends soon" count={endingSoon.length}>
          <div style={{ display: "grid", gap: 6 }}>
            {endingSoon.map((o) => (
              <div key={o.whopUserId} style={T.body}>
                {o.email || o.whopUserId}{" "}
                <span style={T.meta}>
                  · access ends {fmtDate(o.cycleEndIso)} ·{" "}
                  {o.link ? `${o.link.seatsUsed} on their link` : "no link"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {snap.linksToClose.length > 0 && (
        <Section eyebrow="Links to close" count={snap.linksToClose.length}>
          <div style={{ ...T.bodyDim, marginBottom: 10 }}>
            These owners have stopped paying but their link is still live in
            Whop and can still be redeemed. Closing stops new redemptions. It
            does <strong>not</strong> remove anyone already on the link — those
            people stay in Needs review until they are cancelled in Whop.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {snap.linksToClose.map((l) => (
              <div
                key={l.planId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={T.body}>
                    {l.ownerName || l.ownerEmail || l.planId}
                  </div>
                  <div style={{ ...T.meta, marginTop: 2 }}>
                    link label in Whop: <strong>{l.linkLabel || "(blank)"}</strong>
                  </div>
                  <div style={{ ...T.meta, marginTop: 2, opacity: 0.7 }}>
                    {l.seatsUsed} on this link · {l.planId}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {l.attributionConfidence === "confirm" && (
                    <Pill tone="warning">owner matched by name</Pill>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    busy={busy === `/api/admin/etfb/links/${l.planId}/archive`}
                    onClick={() =>
                      void post(
                        `/api/admin/etfb/links/${l.planId}/archive`,
                        {},
                        "Link closed",
                      )
                    }
                  >
                    Close link
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {snap.keptSeats.length > 0 && (
        <Section eyebrow="Kept — excluded from review" count={snap.keptSeats.length}>
          <div style={{ ...T.bodyDim, marginBottom: 10 }}>
            Someone marked these people &ldquo;keep&rdquo;, so they no longer
            appear in Needs review. Undo puts them back.
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
                <div style={T.body}>
                  {k.email || k.membershipId}{" "}
                  <span style={T.meta}>· {k.membershipId}</span>
                </div>
                <Button
                  size="sm"
                  variant="subtle"
                  busy={busy === `/api/admin/etfb/seats/${k.membershipId}/decision`}
                  onClick={() =>
                    void post(
                      `/api/admin/etfb/seats/${k.membershipId}/decision`,
                      { decision: null },
                      "Back in the review list",
                    )
                  }
                >
                  Undo keep
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section eyebrow="Housekeeping">
        <div style={{ display: "grid", gap: 6 }}>
          <div style={T.body}>
            {snap.needsConfirm}{" "}
            <span style={T.bodyDim}>
              link{snap.needsConfirm === 1 ? "" : "s"} matched by name only,
              awaiting confirmation
            </span>
          </div>
          <div style={T.body}>
            {snap.needsOwner.length}{" "}
            <span style={T.bodyDim}>link(s) with no owner recorded</span>
          </div>
          {snap.counts.seatsOnUnrecordedLinks > 0 && (
            <div style={T.body}>
              {snap.counts.seatsOnUnrecordedLinks}{" "}
              <span style={T.bodyDim}>
                seat(s) above sit on a link we have no owner record for — shown
                flagged rather than hidden
              </span>
            </div>
          )}
          {snap.unresolvedPlans.length > 0 && (
            <div style={{ ...T.body, color: "var(--color-danger, #dc2626)" }}>
              {snap.unresolvedPlans.length}{" "}
              <span style={T.bodyDim}>
                plan(s) could not be resolved from Whop. Owners on those plans
                may be wrongly shown as not paying — do not action their rows
                until this is zero.
              </span>
            </div>
          )}
          <div style={T.body}>
            {snap.unrecordedLinks.length}{" "}
            <span style={T.bodyDim}>
              link(s) that exist in Whop but not here — if this is ever above 0,
              a link was created outside this tool
            </span>
          </div>
        </div>
      </Section>

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
