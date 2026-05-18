"use client";

/**
 * /dashboard/playbook — Map 2.
 *
 * Post-sprint hub. Loads as the default surface for any student
 * whose `sprint_completed_at` is set (auto-redirect from /dashboard).
 * 4 always-on cards: pb_submit_bounties, pb_build_portfolio,
 * pb_apply_job_board, pb_land_first_client (milestone).
 *
 * Step 4 ships the page + hub + per-node sheet + welcome overlay.
 * Step 5 wires the mark-complete + crowned celebration onto the
 * milestone card.
 *
 * Per the brief (04-map2-playbook.md):
 *   • Map 1 stays accessible via "Back to the climb" → /dashboard?map=1
 *   • No completion state for the 3 always-on cards
 *   • Hub stays open even after the milestone fires
 *   • v1 placeholder visual; full Map 2 visual set is P2 (Karlo)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { createClient } from "@/lib/supabase-browser";
import type { PlaybookNode } from "@/types/database";
import { PlaybookHub } from "@/components/playbook/PlaybookHub";
import { PlaybookNodeSheet } from "@/components/playbook/PlaybookNodeSheet";
import { PlaybookWelcomeOverlay } from "@/components/playbook/PlaybookWelcomeOverlay";
import { FirstClientLandedCelebration } from "@/components/playbook/FirstClientLandedCelebration";

export default function PlaybookPage() {
  const { student } = useAuth();
  const {
    sprintCompletedAt,
    playbookWelcomeSeenAt,
    dismissPlaybookWelcome,
    firstClientLandedAt,
    firstClientJustLanded,
    markFirstClient,
    dismissFirstClientCelebration,
  } = useStudent();
  const router = useRouter();

  // Gate: if the student hasn't actually finished the sprint, send
  // them back to Map 1. Map 2 is a post-sprint surface.
  useEffect(() => {
    if (student && !sprintCompletedAt) {
      router.replace("/dashboard?map=1");
    }
  }, [student, sprintCompletedAt, router]);

  const [nodes, setNodes] = useState<PlaybookNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    void (async () => {
      const { data } = await sb
        .from("playbook_nodes")
        .select("*")
        .order("position");
      setNodes((data as PlaybookNode[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const openNode = useMemo(
    () => nodes.find((n) => n.id === openNodeId) ?? null,
    [nodes, openNodeId],
  );

  // Welcome overlay fires once per student. We rely on the timestamp
  // being null — when the student dismisses, dismissPlaybookWelcome
  // patches the local row so the overlay disappears for the rest of
  // the session AND any future load.
  const showWelcome =
    Boolean(sprintCompletedAt) && !playbookWelcomeSeenAt;

  if (!student || loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: "var(--color-bg-primary)" }}
      >
        <div
          aria-hidden="true"
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: "2px solid var(--color-gold)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg-primary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar — Back to the climb (left) + page label (center) */}
      <header
        style={{
          padding: "20px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Link
          href="/dashboard?map=1"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            color: "rgba(255,255,255,0.62)",
            letterSpacing: "0.06em",
            textDecoration: "none",
            padding: "8px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to the climb
        </Link>

        <p
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--color-gold-light)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          The Playbook
        </p>

        {/* Spacer to balance the back-link width — keeps the page
            label centered without a second nav item. */}
        <div style={{ width: 180 }} />
      </header>

      {/* Hub — 4 cards */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingTop: 48,
          paddingBottom: 48,
        }}
      >
        <div
          style={{
            textAlign: "center",
            marginBottom: 40,
            padding: "0 32px",
          }}
        >
          <h1
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: "-0.028em",
              lineHeight: 1.1,
              color: "rgba(255,255,255,0.96)",
              marginBottom: 12,
            }}
          >
            {/* TODO(karlo): hub headline */}
            You&rsquo;re a marketer now.
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.62)",
              maxWidth: 640,
              margin: "0 auto",
              lineHeight: 1.55,
            }}
          >
            {/* TODO(karlo): hub sub-copy */}
            Four activities. Always open. Rotate through them until
            the income is real.
          </p>
        </div>

        <PlaybookHub
          nodes={nodes}
          firstClientLandedAt={student.first_client_landed_at}
          onOpenNode={setOpenNodeId}
        />
      </main>

      <PlaybookNodeSheet
        node={openNode}
        onClose={() => setOpenNodeId(null)}
        // Step 5 — milestone CTA. Pre-landing: the self-report
        // button. Post-landing: a "Landed · {date}" confirmation
        // panel that keeps the sheet useful as a re-readable record.
        milestoneSlot={
          openNode?.is_milestone ? (
            firstClientLandedAt ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 12,
                  background: "rgba(230,192,122,0.10)",
                  border: "1px solid rgba(230,192,122,0.4)",
                  marginBottom: 16,
                }}
              >
                <p
                  className="font-mono uppercase"
                  style={{
                    fontSize: 11,
                    color: "var(--color-gold-light)",
                    letterSpacing: "0.18em",
                    marginBottom: 6,
                  }}
                >
                  Landed
                </p>
                <p
                  style={{
                    fontSize: 14,
                    color: "rgba(255,255,255,0.78)",
                    lineHeight: 1.5,
                  }}
                >
                  {new Date(firstClientLandedAt).toLocaleDateString(
                    undefined,
                    { month: "long", day: "numeric", year: "numeric" },
                  )}
                  . The promise of the program — delivered.
                </p>
              </div>
            ) : (
              <button
                onClick={() => {
                  void markFirstClient();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  marginBottom: 16,
                  padding: "16px 20px",
                  borderRadius: 12,
                  background: "var(--color-gold)",
                  color: "var(--color-bg-primary)",
                  border: "none",
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-0.011em",
                  cursor: "pointer",
                }}
              >
                {/* TODO(karlo): final CTA */}
                I just landed my first client
              </button>
            )
          ) : undefined
        }
      />

      <PlaybookWelcomeOverlay
        open={showWelcome}
        onDismiss={() => void dismissPlaybookWelcome()}
      />

      {/* v42 — crowned celebration. Fires on first-client-landed
          (single use). Larger than the Map 1 celebrations per
          brief §4: the moment the entire program promise is
          delivered on. */}
      <FirstClientLandedCelebration
        open={firstClientJustLanded}
        onDismiss={dismissFirstClientCelebration}
      />
    </div>
  );
}
