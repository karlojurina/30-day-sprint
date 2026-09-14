"use client";

/**
 * /admin/etfb — Brand Owners.
 *
 * THE UNIT IS THE LINK. This is Lovro's Whop checkout-links screen plus the one
 * column Whop cannot give him: is that link's owner still paying. He identifies
 * a link by its Notes value, checks the subscription, and if it is dead he opens
 * Whop's membership list filtered to that link and terminates people one by one.
 *
 * So a row is a link, labelled by its Note, and clicking it goes straight to
 * that filtered Whop view. Filters are exclusive: pick one, see only that.
 *
 * Earlier versions were seat-first (v87.2) then owner-first (v87.3). Both
 * modelled the data instead of the job.
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
  Tabs,
  Pill,
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
type LinkState =
  | "needs_removal"
  | "cancelling"
  | "active"
  | "archived"
  | "unknown_owner";

interface LinkRow {
  planId: string;
  /** Whop's "Notes" field — what identifies a link on Whop's own screen. */
  label: string | null;
  /** Whop's membership list filtered to this link. Verified by paste, not guessed. */
  whopUrl: string;
  checkoutUrl: string;
  state: LinkState;
  owner: {
    whopUserId: string;
    name: string | null;
    email: string | null;
    cycleEndIso: string | null;
  } | null;
  attributionMethod: string;
  attributionConfidence: string;
  seats: OwnerSeat[];
  seatsTotal: number;
  protectedSeats: { membershipId: string; email: string | null; why: string }[];
  sharesDomainWithPayingOwner: {
    membershipId: string;
    email: string | null;
    matchesOwnerEmail: string;
  }[];
}

type TabKey = LinkState | "new";

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
      linkRows: LinkRow[];
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
        needsRemoval: number;
        peopleToRemove: number;
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
  /** Exclusive filters — pick one, see only that. Defaults to the work. */
  const [tab, setTab] = useState<TabKey>("needs_removal");

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
     One list of LINKS, five exclusive filters. "New" is the odd one out: it is
     owners with no link at all, so there is nothing to click through to and the
     action is Create rather than Review. It gets its own row shape. */

  const untrustworthy = snap.unresolvedPlans.length > 0;

  const byState = (st: LinkState) => snap.linkRows.filter((l) => l.state === st);
  const needsRemoval = byState("needs_removal");
  const unknownOwner = byState("unknown_owner");
  const cancelling = byState("cancelling");
  const activeLinks = byState("active");
  const archivedLinks = byState("archived");
  const newOwners = snap.ownerRows.filter((o) => o.state === "active" && !o.link);

  const peopleLeft = needsRemoval.reduce((n, l) => n + l.seats.length, 0);
  const readAt = new Date(snap.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const TABS: { value: TabKey; label: string; count: number }[] = [
    { value: "needs_removal", label: "Need to remove", count: needsRemoval.length + unknownOwner.length },
    { value: "new", label: "New", count: newOwners.length },
    { value: "cancelling", label: "Cancelling", count: cancelling.length },
    { value: "active", label: "Active", count: activeLinks.length },
    { value: "archived", label: "Archived", count: archivedLinks.length },
  ];

  /* Inside the work tab, links with people and links without are two different
     jobs: one is "remove these people", the other is "close this, nobody used
     it". 27 of 49 were empty, which made the tab misdescribe itself. Same tab,
     two blocks, so the filter set stays as specified. */
  const withPeople = [...needsRemoval, ...unknownOwner].filter(
    (l) => l.seats.length > 0,
  );
  const emptyDead = [...needsRemoval, ...unknownOwner].filter(
    (l) => l.seats.length === 0,
  );

  const rows: LinkRow[] =
    tab === "needs_removal"
      ? [...needsRemoval, ...unknownOwner]
      : tab === "cancelling"
        ? cancelling
        : tab === "active"
          ? activeLinks
          : tab === "archived"
            ? archivedLinks
            : [];

  const renderLink = (l: LinkRow) => {
    const unconfirmed = l.attributionConfidence === "confirm";
    return (
      <div
        key={l.planId}
        onClick={() => window.open(l.whopUrl, "_blank", "noopener")}
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {/* The Notes value — what identifies a link on Whop's own screen.
              A real anchor so middle-click, copy-link and keyboard all work. */}
          <a
            href={l.whopUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ ...T.heading, textDecoration: "none", display: "block" }}
          >
            {l.label || "(no note)"}
          </a>

          {/* 13px, not 11px. This is the line that carries the judgement, and
              it was set as byline meta. */}
          <div style={{ ...T.bodyDim, marginTop: 4 }}>
            {l.owner?.email ?? "owner not established"}
            {/* "not paying" is dropped inside Need to remove — the tab already
                says it — and the "of N" total is noise next to the count. */}
            {l.state === "needs_removal" &&
              ` · ${l.seats.length} to remove`}
            {l.state === "cancelling" &&
              ` · access ends ${fmtDate(l.owner?.cycleEndIso ?? null)}`}
            {l.state === "active" && ` · paying · ${l.seatsTotal} on this link`}
            {l.state === "archived" && ` · closed · ${l.seatsTotal} still on it`}
            {l.state === "unknown_owner" && ` · ${l.seatsTotal} on this link`}
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill tone={unconfirmed ? "warning" : "neutral"}>
              {HOW_MATCHED[l.attributionMethod] ?? l.attributionMethod}
            </Pill>
            {l.protectedSeats.length > 0 && (
              <Pill tone="success">
                {l.protectedSeats.length} kept back
              </Pill>
            )}
            {l.sharesDomainWithPayingOwner.length > 0 && (
              <Pill tone="danger">check: same company as a paying brand</Pill>
            )}
          </div>

          {/* The partner case. Shown in full because acting on it wrongly cuts
              off someone whose business partner is still paying. */}
          {l.sharesDomainWithPayingOwner.length > 0 && (
            <div style={{ ...T.bodyDim, marginTop: 6, maxWidth: "70ch" }}>
              {l.sharesDomainWithPayingOwner
                .map(
                  (x) =>
                    `${x.email} shares a company domain with ${x.matchesOwnerEmail}, who is still paying`,
                )
                .join(" · ")}
              . Check whether they are the same business before removing anyone.
            </div>
          )}

          {l.protectedSeats.length > 0 && (
            <div style={{ ...T.meta, marginTop: 6, maxWidth: "70ch" }}>
              Already kept back:{" "}
              {l.protectedSeats
                .map((x) => `${x.email || x.membershipId} (${x.why})`)
                .join(" · ")}
            </div>
          )}
        </div>

        <div
          style={{ display: "flex", alignItems: "center", gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          {l.seats.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={untrustworthy}
              title="Copy every membership id on this link"
              onClick={() => copyAll(l)}
            >
              Copy {l.seats.length} IDs
            </Button>
          )}
          {unconfirmed && l.owner && (
            <Button
              size="sm"
              variant="subtle"
              disabled={untrustworthy}
              busy={busy === `/api/admin/etfb/links/${l.planId}/owner`}
              onClick={() =>
                void post(
                  `/api/admin/etfb/links/${l.planId}/owner`,
                  { ownerWhopUserId: l.owner!.whopUserId, confirm: true },
                  "Owner confirmed",
                )
              }
            >
              Confirm owner
            </Button>
          )}
          {(l.state === "needs_removal" || l.state === "unknown_owner") && (
            <Button
              size="sm"
              variant="subtle"
              disabled={untrustworthy || unconfirmed}
              busy={busy === `/api/admin/etfb/links/${l.planId}/archive`}
              title={
                unconfirmed
                  ? "This owner was matched by name only. Confirm it before closing the link."
                  : "Stops anyone new using this link. Does not remove the people already on it."
              }
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
          )}
        </div>
      </div>
    );
  };

  const copyAll = (l: LinkRow) => {
    void navigator.clipboard
      ?.writeText(l.seats.map((x) => x.membershipId).join("\n"))
      .then(() => setToast(`Copied ${l.seats.length} membership ids`))
      .catch(() => setToast("Could not reach the clipboard"));
  };

  return (
    <AdminPage>
      <PageHeader
        title="Brand Owners"
        description={
          needsRemoval.length === 0
            ? "Every live team link belongs to a paying brand."
            : `${needsRemoval.length} ${needsRemoval.length === 1 ? "link" : "links"} to close · ${peopleLeft} ${peopleLeft === 1 ? "person" : "people"} to remove in Whop`
        }
        meta={`Read live from Whop at ${readAt}`}
        actions={
          <Button onClick={() => void load()} busy={loading}>
            Refresh
          </Button>
        }
      />

      {/* Has to be read before anything is clicked. It used to render at the
          very bottom of the page, under every action button. */}
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
            Some owners may be showing as not paying when they are. Closing a
            link or pulling someone out of Whop right now could cut off a brand
            that is still paying, so every action here is off until this clears.
            Refresh; if it persists, the Whop read is the problem.
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "needs_removal" ? (
        <>
          <Section
            eyebrow="Remove these people in Whop"
            count={withPeople.length}
          >
            {withPeople.length === 0 ? (
              <div style={T.body}>
                Nobody to remove. Every open link belonging to a brand that
                stopped paying is empty.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {withPeople.map(renderLink)}
              </div>
            )}
          </Section>

          {emptyDead.length > 0 && (
            <Section eyebrow="Just close these — nobody used them" count={emptyDead.length}>
              <div style={{ ...T.bodyDim, marginBottom: 10 }}>
                The brand stopped paying and nobody ever redeemed the link.
                Nothing to remove; closing it stops it being used later.
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {emptyDead.map(renderLink)}
              </div>
            </Section>
          )}
        </>
      ) : tab === "new" ? (
        <Section eyebrow="Paying, no link yet" count={newOwners.length}>
          {newOwners.length === 0 ? (
            <div style={T.body}>Every paying brand has a link.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {newOwners.map((o) => (
                <div
                  key={o.whopUserId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-card)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={T.cardTitle}>{o.email || o.whopUserId}</div>
                    <div style={{ ...T.meta, marginTop: 3 }}>
                      paying · renews {fmtDate(o.cycleEndIso)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={untrustworthy}
                    busy={busy === o.whopUserId}
                    onClick={() => void mint(o.whopUserId)}
                  >
                    Create link
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : (
        <Section
          eyebrow={TABS.find((t) => t.value === tab)?.label ?? ""}
          count={rows.length}
        >
          {rows.length === 0 ? (
            <div style={T.body}>Nothing here.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map(renderLink)}
            </div>
          )}
        </Section>
      )}

      {toast && <Toast message={toast} />}
    </AdminPage>
  );
}
