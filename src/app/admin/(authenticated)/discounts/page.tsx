"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { DiscountRequest, Student } from "@/types/database";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

type RequestWithStudent = DiscountRequest & { student: Student };

export default function DiscountsPage() {
  const [requests, setRequests] = useState<RequestWithStudent[]>([]);
  const [filter, setFilter] = useState<string>("pending");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const supabase = createClient();
  const { teamMember } = useAuth();

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  async function fetchRequests() {
    setLoading(true);
    let query = supabase
      .from("discount_requests")
      .select("*, student:students(*)")
      .order("created_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setRequests((data as RequestWithStudent[]) || []);
    setLoading(false);
  }

  async function handleApprove(requestId: string) {
    setProcessing(requestId);

    try {
      // Call our API route to create the Whop promo code
      const res = await fetch("/api/discounts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });

      if (res.ok) {
        fetchRequests();
      } else {
        const data = await res.json();
        alert(`Failed to approve: ${data.error || "Unknown error"}`);
      }
    } catch {
      alert("Failed to approve discount");
    }

    setProcessing(null);
  }

  async function handleReject(requestId: string) {
    const reason = prompt("Rejection reason (optional):");
    setProcessing(requestId);

    const { error } = await supabase
      .from("discount_requests")
      .update({
        status: "rejected",
        reviewed_by: teamMember?.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason || null,
      })
      .eq("id", requestId);

    if (!error) {
      fetchRequests();
    }

    setProcessing(null);
  }

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
    <div
      className="px-12 pt-12 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "var(--color-text-primary)",
          }}
        >
          Discount applications
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            marginTop: 4,
            letterSpacing: "-0.005em",
          }}
        >
          Review applications. Approval requires the student&rsquo;s ad
          submissions to be verified on their detail page first.
        </p>
      </header>

      {/* Segmented filter */}
      <div
        style={{
          display: "inline-flex",
          background: "var(--color-bg-elevated)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 24,
          gap: 1,
        }}
      >
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: "none",
              background: filter === f ? "var(--color-bg-card)" : "transparent",
              color:
                filter === f
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
              fontSize: 13,
              fontWeight: filter === f ? 600 : 500,
              letterSpacing: "-0.005em",
              textTransform: "capitalize",
              cursor: "pointer",
              boxShadow:
                filter === f
                  ? "0 1px 2px rgba(20,20,24,0.06), 0 0 0 0.5px rgba(20,20,24,0.04)"
                  : "none",
              transition:
                "background 150ms cubic-bezier(0.25,0.1,0.25,1), color 150ms cubic-bezier(0.25,0.1,0.25,1)",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            fontSize: 14,
            color: "var(--color-text-secondary)",
          }}
        >
          No {filter === "all" ? "" : filter} applications.
        </div>
      ) : (
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {requests.map((req) => (
            <div
              key={req.id}
              className="list-row"
              style={{
                padding: "16px",
                alignItems: "flex-start",
                gap: 12,
                flexDirection: "column",
              }}
            >
              <div className="flex items-start justify-between w-full">
                <div className="min-w-0">
                  <Link
                    href={`/admin/students/${req.student_id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.011em",
                      textDecoration: "none",
                    }}
                  >
                    {req.student?.name || "Unknown"}
                  </Link>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    Applied {new Date(req.created_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusPill status={req.status} />
              </div>

              {req.promo_code && (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    color: "var(--color-success)",
                    background: "rgba(46,139,87,0.10)",
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontWeight: 600,
                  }}
                >
                  {req.promo_code}
                </div>
              )}

              {req.rejection_reason && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-danger)",
                  }}
                >
                  Reason: {req.rejection_reason}
                </p>
              )}

              {req.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(req.id)}
                    disabled={processing === req.id}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: "var(--color-accent)",
                      color: "#FFFFFF",
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: "-0.005em",
                      cursor:
                        processing === req.id ? "default" : "pointer",
                      opacity: processing === req.id ? 0.6 : 1,
                      transition:
                        "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
                    }}
                  >
                    {processing === req.id ? "Processing…" : "Approve"}
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    disabled={processing === req.id}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      color: "var(--color-text-secondary)",
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                      cursor:
                        processing === req.id ? "default" : "pointer",
                      opacity: processing === req.id ? 0.6 : 1,
                      transition:
                        "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? { color: "var(--color-success)", bg: "rgba(46,139,87,0.10)" }
      : status === "pending"
        ? { color: "var(--color-warning)", bg: "rgba(212,162,76,0.12)" }
        : { color: "var(--color-danger)", bg: "rgba(200,74,74,0.10)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: tone.color,
        background: tone.bg,
        letterSpacing: "-0.005em",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}
