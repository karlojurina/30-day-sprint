"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import { FailedMeta, ListHeader, ListPage, LoadError, MembershipPill, PILL_ROW, SkeletonRows, pressPill } from "@/components/admin/list-parts";
import { ActivityPill, Meter, SearchField } from "@/components/admin/people-parts";
import { ProblemNotice } from "@/components/admin/review-parts";
import { StudentName } from "@/components/admin/student-name";
import type { Answer } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import { agoText } from "@/lib/admin/people-common";
import { peopleTransport, type PeopleTransport } from "@/lib/admin/people-transport";
import {
  STATUS_FILTERS,
  filterStudents,
  sortStudents,
  type StatusFilter,
  type StudentListRow,
  type StudentSort,
  type StudentsList,
} from "@/lib/admin/students-list";

/**
 * All students, /admin/students (admin rebuild 2, D9), in the brand kit's
 * dark look: the course's members on a $97 monthly plan who have paid at
 * least once (the owner's answer of 2026-10-21), newest first payment first,
 * and the header's line says so. The rules and the reads are in
 * src/lib/admin/students-list.ts; this file shows them.
 *
 * Username is students.discord_username, which holds a Whop or a Discord
 * username (their writers differ), so it is not called Discord. A read that
 * failed says so: the list's own read is the page's error, with Retry; a
 * failed progress or course read shows "Couldn't load" in its column and a
 * line above the list, why in plain words with the database's own behind
 * Details (review-parts.tsx). No plan on any row: the header names the $97
 * plan once, as who is listed.
 *
 * The rows come 100 at a time ("Show 100 more"), so a phone is not handed
 * every student at once; the search and the filters work on all of them.
 *
 * The render review's fix round: a row's name looks as on every admin page
 * (student-name.tsx; the whole row is the link to the student's page), a
 * student with no username has an empty Username cell (a screen reader
 * hears "No username"; it read "None"), the filters and the sorts stay on one
 * line that scrolls on a phone (PILL_ROW), and a failed read says so in the
 * header too.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: StudentsList };

const SORTS: Array<{ value: StudentSort; label: string }> = [
  { value: "paid", label: "Newest payment" },
  { value: "name", label: "Name" },
  { value: "progress", label: "Progress" },
  { value: "active", label: "Last active" },
];

const PAGE = 100;

/** The grid of a row on a wide screen; on a phone each row stacks. */
const GRID = "minmax(0, 2.2fr) minmax(0, 1.2fr) 112px 112px minmax(120px, 1fr) 104px 128px";

export function StudentsView({ transport = peopleTransport }: { transport?: PeopleTransport }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<StudentSort>("paid");
  const [shown, setShown] = useState(PAGE);
  /** A refresh of the list on screen that failed: the list stays, and a line says it may be out of date. */
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchList = useCallback(async (): Promise<Answer<StudentsList> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadStudents();
    return mine === seq.current ? r : null;
  }, [transport]);

  useEffect(() => {
    let alive = true;
    void fetchList().then((r) => {
      if (alive && r) setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [fetchList]);

  async function refresh() {
    setBusy(true);
    const r = await fetchList();
    setBusy(false);
    if (!r) return;
    if (r.ok) {
      setLoaded({ kind: "ready", data: r.data });
      setRefreshError(null);
    } else if (loaded.kind === "ready") {
      setRefreshError(r.error);
    } else {
      setLoaded({ kind: "error", error: r.error });
    }
  }

  const header = (data: StudentsList | null, count: number | null) => (
    <ListHeader
      title="All students"
      description="Course members on a $97 monthly plan who have paid at least once, newest first payment first."
      meta={
        data ? (
          `Updated ${clockLabel(data.generatedAt)}${busy ? " · Updating" : ""} · ${count} ${count === 1 ? "student" : "students"}`
        ) : loaded.kind === "error" ? (
          <FailedMeta />
        ) : (
          "Loading"
        )
      }
      // Kept while the list loads or failed, so the header never jumps (the review's fix round).
      action={
        <Button variant="raised" size="md" busy={busy || loaded.kind === "loading"} disabled={loaded.kind === "loading"} onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header(null, null)}
        <SkeletonRows rows={5} label="Loading the students" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null, null)}
        <LoadError title="Couldn't load the students." detail={loaded.error} onRetry={() => void refresh()} busy={busy} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const filtered = sortStudents(filterStudents(data.rows, search, status), sort);
  const countOf = (v: StatusFilter) => (v === "all" ? data.rows.length : data.rows.filter((r) => r.status === v).length);
  const nowMs = Date.parse(data.generatedAt);

  return (
    <ListPage>
      {header(data, data.rows.length)}

      {refreshError && <ProblemNotice text="Couldn't refresh the list, so it may be out of date. Press Refresh." raw={refreshError} />}
      {data.problems.map((p) => (
        <ProblemNotice key={p.text} text={p.text} raw={p.error} />
      ))}

      <div className="flex flex-col" style={{ gap: 12, marginBottom: 16 }}>
        <div style={{ maxWidth: 420 }}>
          <SearchField
            label="Search the students"
            placeholder="Search by name, email or username"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setShown(PAGE);
            }}
          />
        </div>
        <div role="group" aria-label="Membership" className={PILL_ROW} style={{ gap: 8 }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => {
                setStatus(f.value);
                setShown(PAGE);
              }}
              style={pressPill(status === f.value)}
            >
              {f.label}
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{countOf(f.value)}</span>
            </button>
          ))}
        </div>
        <div role="group" aria-label="Sort" className={`${PILL_ROW} items-center`} style={{ gap: 8 }}>
          <span style={{ ...T.bodyDim, fontSize: 12, flex: "none" }}>Sort by</span>
          {SORTS.map((s) => (
            <button key={s.value} type="button" aria-pressed={sort === s.value} onClick={() => setSort(s.value)} style={pressPill(sort === s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={data.rows.length === 0 ? "No course member on a $97 monthly plan has paid yet." : "No student matches."}
            description={data.rows.length === 0 ? undefined : "Clear the search or pick another membership."}
          />
        </Card>
      ) : (
        <Card padding={0}>
          <div
            aria-hidden="true"
            className="hidden lg:grid"
            style={{
              gridTemplateColumns: GRID,
              gap: 12,
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
            }}
          >
            <span>Name</span>
            <span>Username</span>
            <span>First paid</span>
            <span>Activity</span>
            <span>Progress</span>
            <span>Last active</span>
            <span>Membership</span>
          </div>
          {filtered.slice(0, shown).map((r) => (
            <StudentRow key={r.id} row={r} nowMs={nowMs} courseIsNew={data.courseIsNew} />
          ))}
        </Card>
      )}
      {filtered.length > shown && (
        <div className="flex flex-wrap items-center" style={{ gap: 12, marginTop: 12 }}>
          <Button variant="raised" size="md" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - shown)} more
          </Button>
          <span style={{ ...T.bodyDim, fontSize: 12 }}>
            Showing {shown} of {filtered.length}
          </span>
        </div>
      )}
    </ListPage>
  );
}

function StudentRow({ row, nowMs, courseIsNew }: { row: StudentListRow; nowMs: number; courseIsNew: boolean | null }) {
  const activity =
    row.activity != null ? (
      <ActivityPill label={row.activity} />
    ) : (
      <span style={{ ...T.bodyDim, fontSize: 12 }}>{courseIsNew === null ? "Couldn't load" : "Old course"}</span>
    );
  return (
    <Link
      href={`/admin/students/${encodeURIComponent(row.id)}`}
      className="list-row"
      style={{ display: "block", padding: "12px 16px", textDecoration: "none", color: "inherit" }}
    >
      {/* Wide: one line of columns. */}
      <div className="hidden lg:grid" style={{ gridTemplateColumns: GRID, gap: 12, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          {/* The name as on every admin page; the row itself is the link, so no second one inside it. Cut short
              with an ellipsis, it has the whole name in its title. */}
          <p title={row.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <StudentName id={row.id} name={row.name} size={13} asText />
          </p>
          {row.email && row.email !== row.name && (
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.email}
            </p>
          )}
        </div>
        <span
          title={row.username ? `@${row.username}` : undefined}
          style={{ ...T.bodyDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {row.username ? `@${row.username}` : <span className="sr-only">No username</span>}
        </span>
        <div>
          <p style={{ ...T.body, fontVariantNumeric: "tabular-nums" }}>{dayLabel(row.firstPaidAt)}</p>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Day {row.day}</p>
        </div>
        <div>{activity}</div>
        <Meter value={row.progress} />
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{agoText(row.lastActiveAt, nowMs)}</span>
        <div>
          <MembershipPill status={row.status} />
        </div>
      </div>
      {/* Narrow: the name, then the pills, then the facts and the bar. Its display is
          in the class names only: an inline display would beat lg:hidden. */}
      <div className="flex flex-col lg:hidden" style={{ gap: 8 }}>
        <div className="flex flex-wrap items-baseline" style={{ gap: "2px 8px" }}>
          <StudentName id={row.id} name={row.name} username={row.username} asText />
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
          <MembershipPill status={row.status} />
          {activity}
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          Paid {dayLabel(row.firstPaidAt)} · Day {row.day} · Last active {row.lastActiveAt ? agoText(row.lastActiveAt, nowMs) : "never"}
        </p>
        <Meter value={row.progress} />
      </div>
    </Link>
  );
}
