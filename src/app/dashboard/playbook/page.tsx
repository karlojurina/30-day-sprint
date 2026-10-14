"use client";

/**
 * /dashboard/playbook — Map 2.
 *
 * Post-sprint hub. Unlocks the moment the student completes l078
 * "How I Approach Research / Coming Up With Ad Ideas" — the last
 * watch lesson in R4 (day 28). Bounty Access is a separate parallel
 * milestone and does NOT unlock the Playbook on its own (corrected
 * v72.7 - see PLAYBOOK_UNLOCK_LESSON_ID in src/lib/constants.ts).
 *
 * v72 (lovro-brief-playbook-articles): 3 always-on cards -
 * pb_submit_bounties, pb_build_portfolio, pb_apply_job_board. The
 * pb_land_first_client milestone node + its crowned celebration were
 * dropped. Each card opens a sheet that renders a full standalone
 * HTML article in an iframe.
 *
 *   • The course stays one click away: "Back to the climb" →
 *     /dashboard?map=1 while the home is /dashboard, "Back to the map" →
 *     the home once it moves (cutover WI-8)
 *   • No completion state - all 3 cards are always-on
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { createClient } from "@/lib/supabase-browser";
import { HOME_IS_DASHBOARD, STUDENT_HOME } from "@/lib/world/access";
import type { PlaybookNode } from "@/types/database";
import { PlaybookHub } from "@/components/playbook/PlaybookHub";
import { PlaybookNodeSheet } from "@/components/playbook/PlaybookNodeSheet";
import { PlaybookWelcomeOverlay } from "@/components/playbook/PlaybookWelcomeOverlay";

/** Where the back link and a locked student go: the old map while it is the home, else the home (/world). */
const COURSE_HREF = HOME_IS_DASHBOARD ? "/dashboard?map=1" : STUDENT_HOME;
const COURSE_LABEL = HOME_IS_DASHBOARD ? "Back to the climb" : "Back to the map";

export default function PlaybookPage() {
  const { student } = useAuth();
  const {
    loading: studentLoading,
    playbookUnlocked,
    playbookWelcomeSeenAt,
    dismissPlaybookWelcome,
  } = useStudent();
  const router = useRouter();

  // The gate is StudentContext's playbookUnlocked (isPlaybookUnlocked in
  // src/lib/progress.ts): the switch's stamp, the unlock lesson (l078 on
  // the old course), or the legacy auto-unlock (30+ days since the first
  // payment AND 80% complete). It is false until the student's data has
  // loaded, so nobody is sent away before then: from /world this page
  // mounts a fresh provider, which starts empty.
  useEffect(() => {
    if (student && !studentLoading && !playbookUnlocked) {
      router.replace(COURSE_HREF);
    }
  }, [student, studentLoading, playbookUnlocked, router]);

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
  // the session AND any future load. Gated on playbookUnlocked (l078
  // completed) so it only fires when the student has actually earned
  // access, not when bounty was claimed independently.
  const showWelcome = playbookUnlocked && !playbookWelcomeSeenAt;

  // A locked student sees the spinner until the effect above sends them on.
  if (!student || loading || studentLoading || !playbookUnlocked) {
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
        className="px-5 py-4 sm:px-8 sm:py-5"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Link
          href={COURSE_HREF}
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
          {COURSE_LABEL}
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

        {/* Spacer to balance the back-link width on desktop — keeps the
            page label centered without a second nav item. Hidden on
            phone to avoid eating space. */}
        <div className="hidden sm:block" style={{ width: 180 }} />
      </header>

      {/* Hub — 3 cards */}
      <main
        className="py-8 sm:py-12"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          className="text-center mb-8 sm:mb-10 px-5 sm:px-8"
        >
          <h1
            className="text-[26px] sm:text-4xl"
            style={{
              fontWeight: 600,
              letterSpacing: "-0.028em",
              lineHeight: 1.1,
              color: "rgba(255,255,255,0.96)",
              marginBottom: 12,
            }}
          >
            You&rsquo;re a marketer now.
          </h1>
          <p
            className="text-[14px] sm:text-base"
            style={{
              color: "rgba(255,255,255,0.62)",
              maxWidth: 640,
              margin: "0 auto",
              lineHeight: 1.55,
            }}
          >
            Three playbooks. Always open. Work through them until the
            income is real.
          </p>
        </div>

        <PlaybookHub nodes={nodes} onOpenNode={setOpenNodeId} />
      </main>

      <PlaybookNodeSheet node={openNode} onClose={() => setOpenNodeId(null)} />

      <PlaybookWelcomeOverlay
        open={showWelcome}
        onDismiss={() => void dismissPlaybookWelcome()}
      />
    </div>
  );
}
