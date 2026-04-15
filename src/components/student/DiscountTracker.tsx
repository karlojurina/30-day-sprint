"use client";

import { useStudent } from "@/contexts/StudentContext";
import { ProgressBar } from "./ProgressBar";
import { DISCOUNT_REQUIRED_TASKS } from "@/lib/constants";

export function DiscountTracker() {
  const {
    discountTasksCompleted,
    discountEligible,
    discountRequest,
    requestDiscount,
  } = useStudent();

  const percent = Math.round(
    (discountTasksCompleted / DISCOUNT_REQUIRED_TASKS) * 100
  );

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">30% Discount</h3>
        <span className="text-xs text-text-secondary">
          {discountTasksCompleted}/{DISCOUNT_REQUIRED_TASKS} tasks
        </span>
      </div>

      <ProgressBar value={percent} size="sm" />

      <p className="text-xs text-text-secondary">
        Complete all Week 1 + Week 2 tasks to unlock 30% off your next month
      </p>

      {/* Status */}
      {discountRequest?.status === "approved" && discountRequest.promo_code ? (
        <div className="bg-success/10 border border-success/20 rounded-lg px-3 py-2">
          <p className="text-xs text-success font-medium">Discount approved!</p>
          <p className="text-sm font-mono font-bold text-success mt-1">
            {discountRequest.promo_code}
          </p>
        </div>
      ) : discountRequest?.status === "pending" ? (
        <div className="bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          <p className="text-xs text-warning">
            Your discount request is being reviewed
          </p>
        </div>
      ) : discountRequest?.status === "rejected" ? (
        <div className="bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
          <p className="text-xs text-danger">
            Request not approved
            {discountRequest.rejection_reason &&
              `: ${discountRequest.rejection_reason}`}
          </p>
        </div>
      ) : discountEligible ? (
        <button
          onClick={requestDiscount}
          className="w-full px-4 py-2 text-sm font-semibold rounded-lg bg-accent hover:bg-accent-dark transition-colors"
        >
          Request Discount
        </button>
      ) : null}
    </div>
  );
}
