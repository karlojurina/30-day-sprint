"use client";

import { useEffect } from "react";

interface Region {
  id: string;
  name: string;
  subtitle: string | null;
  order_num: number;
}

interface Lesson {
  id: string;
  region_id: string;
  day: number;
  sort_order: number;
  title: string;
  type: string;
  requires_action: boolean;
}

interface Completion {
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
}

interface DiscountRequest {
  status: string;
  promo_code: string | null;
}

interface MonthReview {
  total_lessons_completed: number;
  total_lessons: number;
  longest_streak: number;
  ad_submissions: number;
  days_to_finish: number | null;
}

interface JournalViewProps {
  student: { id: string; name: string | null; joined_at: string; longest_streak: number };
  regions: Region[];
  lessons: Lesson[];
  completions: Completion[];
  discountRequest: DiscountRequest | null;
  monthReview: MonthReview | null;
}

export function JournalView({
  student,
  regions,
  lessons,
  completions,
  discountRequest,
  monthReview,
}: JournalViewProps) {
  // Print-stylesheet trigger — let the user open the page and decide
  // when to print, but provide a button.
  useEffect(() => {
    document.title = `Field Journal — ${student.name ?? "Student"}`;
  }, [student.name]);

  const startDate = new Date(student.joined_at);
  const completionByLesson = new Map(
    completions.map((c) => [c.lesson_id, c])
  );

  const lessonsByRegion = regions.reduce<Record<string, Lesson[]>>((acc, r) => {
    acc[r.id] = lessons.filter((l) => l.region_id === r.id);
    return acc;
  }, {});

  const completionStatus = (l: Lesson): string => {
    const c = completionByLesson.get(l.id);
    if (!c) return "—";
    if (l.requires_action) {
      const w = c.completed_at != null;
      const a = c.action_completed_at != null;
      if (w && a) return "Both done";
      if (w) return "Watched";
      if (a) return "Shipped";
      return "—";
    }
    return c.completed_at ? "Done" : "—";
  };

  return (
    <div className="journal-root">
      <style>{PRINT_CSS}</style>

      <div className="journal-controls no-print">
        <button onClick={() => window.print()}>Print to PDF</button>
        <a href="/dashboard-mockup">← Back to map</a>
      </div>

      {/* Cover */}
      <section className="journal-page cover">
        <div className="cover-mark">EcomTalent · 30-Day Sprint</div>
        <h1 className="cover-title">Field Journal</h1>
        <div className="cover-name">
          {student.name ? `Compiled by ${student.name}` : "Field Journal"}
        </div>
        <div className="cover-date">
          {startDate.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </div>
        {monthReview && (
          <div className="cover-stats">
            <div>
              <span className="num">{monthReview.total_lessons_completed}</span>
              <span className="lbl">lessons</span>
            </div>
            <div>
              <span className="num">{monthReview.longest_streak}d</span>
              <span className="lbl">longest streak</span>
            </div>
            <div>
              <span className="num">{monthReview.ad_submissions}</span>
              <span className="lbl">ads shipped</span>
            </div>
          </div>
        )}
      </section>

      {/* Per-region sections */}
      {regions.map((region) => {
        const regionLessons = lessonsByRegion[region.id] ?? [];
        return (
          <section className="journal-page region-page" key={region.id}>
            <div className="region-header">
              <span className="region-num">Region {region.order_num}</span>
              <h2 className="region-title">{region.name}</h2>
              {region.subtitle && (
                <p className="region-sub">{region.subtitle}</p>
              )}
            </div>

            <div className="lesson-list">
              {regionLessons.map((lesson) => {
                const status = completionStatus(lesson);
                return (
                  <div className="lesson-row" key={lesson.id}>
                    <div className="lesson-meta">
                      <span className="lesson-day">Day {lesson.day}</span>
                      <span className={`lesson-status status-${status.replace(/\s/g, "-").toLowerCase()}`}>
                        {status}
                      </span>
                    </div>
                    <h3 className="lesson-title">{lesson.title}</h3>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Closing */}
      <section className="journal-page closing">
        <div className="closing-inner">
          <div className="cover-mark">Closing notes</div>
          <h2 className="cover-title">
            {discountRequest?.status === "approved"
              ? "30 days. Discount earned."
              : "30 days. Receipts in hand."}
          </h2>
          {discountRequest?.status === "approved" &&
            discountRequest.promo_code && (
              <div className="closing-promo">
                <span className="lbl">Your promo code</span>
                <code>{discountRequest.promo_code}</code>
              </div>
            )}
          <p className="closing-body">
            This journal is the receipt of the work you put in. Take it,
            keep going, and earn the next 30 days louder than this one.
          </p>
        </div>
      </section>
    </div>
  );
}

const PRINT_CSS = `
.journal-root {
  background: #f8f3e6;
  color: #1a1410;
  font-family: "Georgia", "Times New Roman", serif;
  min-height: 100vh;
  padding: 32px 0;
}
.journal-controls {
  position: sticky;
  top: 12px;
  z-index: 50;
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 24px;
}
.journal-controls button {
  padding: 8px 20px;
  background: #1a1410;
  color: #f8f3e6;
  border: none;
  border-radius: 4px;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  cursor: pointer;
}
.journal-controls a {
  padding: 8px 20px;
  background: transparent;
  color: #1a1410;
  text-decoration: none;
  border: 1px solid rgba(26, 20, 16, 0.32);
  border-radius: 4px;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
}
.journal-page {
  max-width: 720px;
  margin: 0 auto 64px;
  padding: 56px 56px;
  background: #fffcf2;
  border: 1px solid rgba(26, 20, 16, 0.12);
  box-shadow: 0 8px 30px rgba(26, 20, 16, 0.08);
  page-break-after: always;
}
.cover {
  text-align: center;
  padding: 120px 56px;
}
.cover-mark {
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.32em;
  font-size: 11px;
  color: rgba(26, 20, 16, 0.6);
  margin-bottom: 16px;
}
.cover-title {
  font-size: 64px;
  font-weight: 600;
  font-style: italic;
  margin: 0 0 24px;
  line-height: 1.05;
}
.cover-name {
  font-style: italic;
  font-size: 18px;
  color: rgba(26, 20, 16, 0.8);
  margin-bottom: 4px;
}
.cover-date {
  font-family: monospace;
  letter-spacing: 0.18em;
  font-size: 12px;
  color: rgba(26, 20, 16, 0.6);
  margin-bottom: 40px;
}
.cover-stats {
  display: flex;
  justify-content: center;
  gap: 36px;
  margin-top: 32px;
}
.cover-stats > div {
  text-align: center;
}
.cover-stats .num {
  display: block;
  font-size: 32px;
  font-weight: 600;
}
.cover-stats .lbl {
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  color: rgba(26, 20, 16, 0.6);
}
.region-header {
  margin-bottom: 32px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(26, 20, 16, 0.18);
}
.region-num {
  display: block;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 11px;
  color: rgba(26, 20, 16, 0.7);
  margin-bottom: 8px;
}
.region-title {
  font-size: 36px;
  font-style: italic;
  font-weight: 500;
  margin: 0 0 6px;
}
.region-sub {
  font-style: italic;
  color: rgba(26, 20, 16, 0.7);
  margin: 0;
}
.lesson-list {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.lesson-row {
  padding-bottom: 18px;
  border-bottom: 1px dashed rgba(26, 20, 16, 0.16);
}
.lesson-row:last-child {
  border-bottom: none;
}
.lesson-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.lesson-day {
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  color: rgba(26, 20, 16, 0.7);
}
.lesson-status {
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(26, 20, 16, 0.06);
  color: rgba(26, 20, 16, 0.6);
}
.lesson-status.status-done,
.lesson-status.status-both-done {
  background: rgba(160, 140, 80, 0.18);
  color: #6b5520;
}
.lesson-title {
  font-size: 18px;
  font-style: italic;
  margin: 4px 0 8px;
  font-weight: 500;
}
.lesson-note {
  margin: 10px 0 0 22px;
  padding: 12px 16px;
  background: rgba(160, 140, 80, 0.1);
  font-size: 14px;
  line-height: 1.55;
  color: rgba(26, 20, 16, 0.85);
  white-space: pre-wrap;
  font-style: italic;
}
.daily-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 24px;
}
.daily-entry {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: 1px dashed rgba(26, 20, 16, 0.14);
}
.daily-date {
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  color: rgba(26, 20, 16, 0.6);
  padding-top: 3px;
}
.daily-content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.closing {
  text-align: center;
  padding: 120px 56px;
}
.closing-inner {
  max-width: 480px;
  margin: 0 auto;
}
.closing-promo {
  margin: 24px 0;
  padding: 16px 20px;
  background: rgba(160, 140, 80, 0.12);
  border: 1px dashed rgba(160, 140, 80, 0.5);
  border-radius: 6px;
}
.closing-promo .lbl {
  display: block;
  font-family: monospace;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 10px;
  color: rgba(26, 20, 16, 0.6);
  margin-bottom: 6px;
}
.closing-promo code {
  font-family: monospace;
  font-size: 22px;
  letter-spacing: 0.08em;
  color: #6b5520;
}
.closing-body {
  font-style: italic;
  font-size: 16px;
  line-height: 1.6;
  color: rgba(26, 20, 16, 0.78);
}
@media print {
  @page {
    size: A4;
    margin: 24mm 18mm;
  }
  .no-print { display: none !important; }
  .journal-root {
    background: #fffcf2;
    padding: 0;
  }
  .journal-page {
    margin: 0;
    box-shadow: none;
    border: none;
    background: #fffcf2;
  }
}
`;
