"use client";

/**
 * /admin/feedback/survey - discount application survey.
 *
 * Every student who applies for the 30% discount answers the v29
 * 6-question feedback survey. This groups those answers by application,
 * newest first, with an NPS average across all scale answers on top.
 *
 * Reads: discount_feedback_questions, discount_feedback_responses, and
 * discount_requests (+ student). RLS already grants team SELECT on all
 * three, so the page queries Supabase directly via the team session.
 *
 * Unlike /admin/discounts (the operational approval queue, cohort-
 * filtered), this shows ALL collected feedback — it's about the survey
 * content, not the discount workflow.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { useAuth } from "@/contexts/AuthContext";
import type {
  DiscountFeedbackQuestion,
  DiscountFeedbackResponse,
} from "@/types/database";
import {
  AdminPage,
  PageHeader,
  Card,
  EmptyState,
  RestrictedPage,
} from "@/components/admin/ui";
import { DiscountFeedbackResponses } from "@/components/admin/DiscountFeedbackResponses";

interface RequestRow {
  id: string;
  status: string;
  created_at: string;
  student: { id: string; name: string | null; email: string | null } | null;
}

interface Group {
  request: RequestRow;
  responses: DiscountFeedbackResponse[];
}

export default function FeedbackSurveyPage() {
  const { teamMember } = useAuth();
  // Match the lessons page: feedback surfaces are hidden from CSMs.
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Feedback" />;
  }
  return <SurveyInner />;
}

function SurveyInner() {
  const [questions, setQuestions] = useState<DiscountFeedbackQuestion[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const [qRes, respRes] = await Promise.all([
        supabase
          .from("discount_feedback_questions")
          .select("*")
          .order("order_num"),
        // Paginated: 6 rows per application, so this clears 1000 rows
        // at ~167 applications. fetchAllRowsPaginated keeps it whole.
        fetchAllRowsPaginated<DiscountFeedbackResponse>(() =>
          supabase
            .from("discount_feedback_responses")
            .select("*")
            .order("created_at", { ascending: false }),
        ),
      ]);

      const qs = (qRes.data ?? []) as DiscountFeedbackQuestion[];
      const responses = respRes.data ?? [];

      // Group responses by application.
      const byRequest = new Map<string, DiscountFeedbackResponse[]>();
      for (const r of responses) {
        const arr = byRequest.get(r.discount_request_id);
        if (arr) arr.push(r);
        else byRequest.set(r.discount_request_id, [r]);
      }
      const requestIds = [...byRequest.keys()];

      // Pull the application + student for each.
      let requests: RequestRow[] = [];
      if (requestIds.length > 0) {
        const { data } = await supabase
          .from("discount_requests")
          .select("id, status, created_at, student:students(id, name, email)")
          .in("id", requestIds);
        requests = (data ?? []) as unknown as RequestRow[];
      }
      const requestById = new Map(requests.map((r) => [r.id, r]));

      // Build display groups, newest application first. Skip orphans
      // (a response whose request didn't come back) rather than render
      // a card with no student.
      const built: Group[] = requestIds
        .map((id) => {
          const request = requestById.get(id);
          if (!request) return null;
          return { request, responses: byRequest.get(id)! };
        })
        .filter((g): g is Group => g !== null)
        .sort(
          (a, b) =>
            new Date(b.request.created_at).getTime() -
            new Date(a.request.created_at).getTime(),
        );

      setQuestions(qs);
      setGroups(built);
      setLoading(false);
    })();
  }, []);

  // NPS = average of every scale answer (Q1 is the 1–10 recommend score).
  const { npsAvg, scaleCount } = useMemo(() => {
    const scaleQIds = new Set(
      questions.filter((q) => q.question_type === "scale").map((q) => q.id),
    );
    let sum = 0;
    let n = 0;
    for (const g of groups) {
      for (const r of g.responses) {
        if (scaleQIds.has(r.question_id) && r.answer_scale != null) {
          sum += r.answer_scale;
          n += 1;
        }
      }
    }
    return { npsAvg: n > 0 ? sum / n : null, scaleCount: n };
  }, [questions, groups]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="rounded-full animate-spin"
          style={{
            width: 24,
            height: 24,
            border: "2px solid var(--color-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Discount survey"
        description="Feedback every student leaves when they apply for the 30% discount, grouped by application."
        meta={
          groups.length > 0 ? (
            <div className="flex items-center" style={{ gap: 20 }}>
              <Stat label="Applications" value={String(groups.length)} />
              <Stat
                label="Avg recommend (1–10)"
                value={
                  npsAvg != null
                    ? `${npsAvg.toFixed(1)}`
                    : "—"
                }
                hint={scaleCount > 0 ? `${scaleCount} ratings` : undefined}
              />
            </div>
          ) : undefined
        }
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="No survey responses yet"
            description="Once students start applying for the discount, their answers show up here."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Card key={g.request.id}>
              <div
                className="flex items-start justify-between"
                style={{ marginBottom: 12, gap: 12 }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {g.request.student?.name?.trim() || "Unknown student"}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {g.request.student?.email || "—"}
                  </div>
                </div>
                <div
                  className="flex items-center"
                  style={{ gap: 10, flexShrink: 0 }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {new Date(g.request.created_at).toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "short", day: "numeric" },
                    )}
                  </span>
                  <SurveyStatusPill status={g.request.status} />
                </div>
              </div>
              <DiscountFeedbackResponses
                responses={g.responses}
                questions={questions}
              />
            </Card>
          ))}
        </div>
      )}
    </AdminPage>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
        {hint ? ` · ${hint}` : ""}
      </span>
    </div>
  );
}

function SurveyStatusPill({ status }: { status: string }) {
  const tone =
    status === "applied"
      ? { color: "var(--color-text-secondary)", bg: "var(--color-bg-elevated)" }
      : status === "approved"
        ? { color: "#3fae7a", bg: "rgba(63,174,122,0.12)" }
        : status === "rejected"
          ? { color: "#d36", bg: "rgba(221,51,102,0.12)" }
          : { color: "#7d8be8", bg: "rgba(88,101,242,0.12)" };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        color: tone.color,
        background: tone.bg,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}
