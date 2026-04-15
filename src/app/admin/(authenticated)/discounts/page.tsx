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
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Discount Requests</h1>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1 w-fit">
        {["pending", "approved", "rejected", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
              filter === f
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-text-secondary bg-bg-card border border-border rounded-xl p-8 text-center">
          No {filter === "all" ? "" : filter} requests
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-bg-card border border-border rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <Link
                    href={`/admin/students/${req.student_id}`}
                    className="text-sm font-medium hover:text-accent-light transition-colors"
                  >
                    {req.student?.name || "Unknown"}
                  </Link>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Requested{" "}
                    {new Date(req.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                    req.status === "approved"
                      ? "bg-success/15 text-success"
                      : req.status === "pending"
                      ? "bg-warning/15 text-warning"
                      : "bg-danger/15 text-danger"
                  }`}
                >
                  {req.status}
                </span>
              </div>

              {req.promo_code && (
                <p className="text-sm font-mono font-bold text-success">
                  Code: {req.promo_code}
                </p>
              )}

              {req.rejection_reason && (
                <p className="text-xs text-danger">
                  Reason: {req.rejection_reason}
                </p>
              )}

              {req.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(req.id)}
                    disabled={processing === req.id}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
                  >
                    {processing === req.id ? "Processing..." : "Approve"}
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    disabled={processing === req.id}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-danger/15 text-danger hover:bg-danger/25 transition-colors disabled:opacity-50"
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
