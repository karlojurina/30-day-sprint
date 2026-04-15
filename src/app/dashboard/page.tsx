"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { ProgressBar } from "@/components/student/ProgressBar";
import { PlaybookChecklist } from "@/components/student/PlaybookChecklist";
import { DiscountTracker } from "@/components/student/DiscountTracker";
import { DailyNoteInput } from "@/components/student/DailyNoteInput";
import { TOTAL_TASKS } from "@/lib/constants";

export default function DashboardPage() {
  const { student, signOut } = useAuth();
  const { overallProgress, completedTaskIds, loading } = useStudent();

  if (loading || !student) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const dayNumber = getDayNumber(student.joined_at);
  const daysLeft = Math.max(0, 30 - dayNumber);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-bg-primary/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {student.avatar_url ? (
              <img
                src={student.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center text-accent text-sm font-bold">
                {(student.name || "?")[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold">
                {student.name || "Student"}
              </p>
              <p className="text-xs text-text-secondary">
                Day {dayNumber} of 30
                {daysLeft > 0 && ` — ${daysLeft} days left`}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Overall progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">30-Day Sprint</h1>
            <span className="text-sm text-text-secondary">
              {completedTaskIds.size}/{TOTAL_TASKS} tasks
            </span>
          </div>
          <ProgressBar value={overallProgress} label="Overall progress" />
        </div>

        {/* Playbook */}
        <PlaybookChecklist />

        {/* Discount tracker */}
        <DiscountTracker />

        {/* Daily notes */}
        <DailyNoteInput />

        {/* Post Month 1 content */}
        {overallProgress === 100 && (
          <div className="bg-bg-card border border-success/20 rounded-xl p-5 space-y-3">
            <h3 className="text-base font-bold text-success">
              You finished the sprint!
            </h3>
            <div className="text-sm text-text-secondary space-y-3 leading-relaxed">
              <p>
                You&apos;ve gone through the entire program, submitted action
                items, started applying to the job board, and submitted your
                first ad bounties. Now what?
              </p>
              <p className="font-semibold text-text-primary">
                Month 1 job board mindset: Get experience, not rich.
              </p>
              <p>
                If you&apos;re brand new — no prior experience working with
                brands — your biggest win right now is simply getting hired.
                What you&apos;re earning isn&apos;t money yet. You&apos;re
                earning experience, knowledge, and proof that you can actually
                do the work.
              </p>
              <p className="font-semibold text-text-primary">
                Month 2+: Your bounties become your leverage.
              </p>
              <p>
                Take that winning bounty. Screenshot the stats. Add it to your
                portfolio. Now when you apply to job board posts, you&apos;re
                not just saying &quot;I can make ads.&quot; You&apos;re saying:
                &quot;Here&apos;s how much revenue it generated.&quot;
              </p>
              <p className="font-semibold text-text-primary">
                The pattern from here:
              </p>
              <ul className="list-disc list-inside space-y-1 text-text-secondary">
                <li>Keep submitting ad bounties every week</li>
                <li>Keep applying to job board posts</li>
                <li>Keep attending weekly calls and engaging in Discord</li>
                <li>
                  Watch your portfolio grow and your rates go up
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
