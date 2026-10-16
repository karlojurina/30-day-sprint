"use client";

/**
 * /admin/cutover — the course switch evening's status page (cutover PRD,
 * WI-10, C15).
 *
 * Says in plain lines what the RUNNING build and the database hold, and
 * what is wrong if anything is. The build's values (home, catalog shape,
 * catalog table, Whop course) are build-time or server-only, so no other
 * page can show them; /api/admin/cutover-status reads them from inside the
 * deployment that answers. Look again after every redeploy.
 *
 * Founder + admin only, like the route behind it.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Pill,
  Button,
  RestrictedPage,
  T,
} from "@/components/admin/ui";

interface CutoverStatus {
  ok: boolean;
  phase: "before" | "after";
  problems: string[];
  build: {
    studentHome: string;
    worldLive: boolean;
    catalogIsV2: boolean;
    catalogTable: string;
    tableSuffix: string;
    whopCourseIdSet: boolean;
    whopCourseIdTail: string | null;
    deploymentId: string | null;
    commit: string | null;
  };
  db: {
    resetAt: string | null;
    regionIds: string[];
    lessons: number;
    countingLessons: number;
    lessonsWithWhopId: number;
  };
}

export default function CutoverStatusPage() {
  const { teamMember } = useAuth();
  if (teamMember?.role === "csm") {
    return <RestrictedPage title="Course switch" />;
  }
  return <CutoverStatusBody />;
}

function CutoverStatusBody() {
  const [status, setStatus] = useState<CutoverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in. Reload the page and sign in again.");
      const res = await fetch("/api/admin/cutover-status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `The status could not be read (HTTP ${res.status}).`);
      }
      setStatus(body as CutoverStatus);
    } catch (e) {
      // Never keep an older answer on screen under a failed check.
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminPage>
      <PageHeader
        title="Course switch"
        description="What the running build and the database hold right now. Look again after every redeploy."
        meta={checkedAt ? `Checked ${checkedAt.toLocaleTimeString()}` : undefined}
        actions={
          <Button onClick={() => void load()} busy={loading}>
            Check again
          </Button>
        }
      />

      {loading && !status && !error ? (
        <div className="flex items-center justify-center" style={{ padding: 48 }}>
          <div
            className="rounded-full animate-spin"
            style={{
              width: 22,
              height: 22,
              border: "2px solid var(--color-accent-dark)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      ) : error ? (
        <Card padding={20} style={{ borderLeft: "3px solid var(--color-danger)" }}>
          <p style={{ ...T.cardTitle, color: "var(--color-danger)" }}>
            The status could not be checked
          </p>
          <p style={{ ...T.bodyDim, marginTop: 6 }}>{error}</p>
        </Card>
      ) : status ? (
        <StatusView status={status} />
      ) : null}
    </AdminPage>
  );
}

function StatusView({ status }: { status: CutoverStatus }) {
  const { build, db } = status;
  return (
    <>
      <Section>
        <Card
          padding={20}
          style={{
            borderLeft: `3px solid ${status.ok ? "var(--color-success)" : "var(--color-danger)"}`,
          }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p style={T.heading}>
              {status.ok ? "All good" : problemCount(status.problems.length)}
            </p>
            <Pill tone={status.phase === "after" ? "accent" : "neutral"}>
              {status.phase === "after"
                ? "After the switch"
                : "Before the switch"}
            </Pill>
          </div>
          {status.ok ? (
            <p style={{ ...T.bodyDim, marginTop: 6 }}>
              {status.phase === "after"
                ? "The build and the database agree on the new course. The Whop course is not checked here (below)."
                : "The old course is live. The values the switch needs are checked once it has run. The Whop course is not checked here (below)."}
            </p>
          ) : (
            <ul style={{ marginTop: 10, paddingLeft: 18, listStyle: "disc" }}>
              {status.problems.map((p) => (
                <li key={p} style={{ ...T.body, marginTop: 4 }}>
                  {p}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
        <Section eyebrow="Running build">
          <Card padding={0}>
            <FactRow label="Student home" value={build.studentHome} />
            <FactRow
              label="World open to everyone"
              value={build.worldLive ? "Yes" : "No"}
            />
            <FactRow
              label="Catalog shape"
              value={build.catalogIsV2 ? "v2 (the new course)" : "v1 (the old course)"}
            />
            <FactRow
              label="Catalog table"
              value={
                build.tableSuffix
                  ? `${build.catalogTable} (CATALOG_TABLE_SUFFIX is ${build.tableSuffix})`
                  : build.catalogTable
              }
            />
            <FactRow
              label="Whop course"
              value={
                !build.whopCourseIdSet
                  ? "Not set"
                  : build.whopCourseIdTail
                    ? `Set, ends in ${build.whopCourseIdTail}`
                    : "Set"
              }
            />
            <FactRow
              label="Deployment"
              value={
                build.deploymentId || build.commit
                  ? [build.deploymentId, build.commit && `commit ${build.commit}`]
                      .filter(Boolean)
                      .join(" · ")
                  : "Not reported"
              }
              last
            />
          </Card>
        </Section>

        <Section eyebrow="Database">
          <Card padding={0}>
            <FactRow
              label="Course switch"
              value={
                db.resetAt
                  ? `Ran ${new Date(db.resetAt).toLocaleString()}`
                  : "Not run"
              }
            />
            <FactRow
              label="Areas"
              value={
                db.regionIds.length > 0
                  ? `${db.regionIds.length}: ${db.regionIds.join(", ")}`
                  : "None"
              }
            />
            <FactRow label="Lessons" value={String(db.lessons)} />
            <FactRow
              label="Counting toward progress"
              value={String(db.countingLessons)}
            />
            <FactRow
              label="With a Whop lesson id"
              value={`${db.lessonsWithWhopId} of ${db.lessons}`}
              last
            />
          </Card>
        </Section>
      </div>

      <WhopCourseNotChecked phase={status.phase} lessons={db.lessons} />
    </>
  );
}

/**
 * Which course WHOP_COURSE_ID names is not checked: the route makes no
 * Whop call. The check it needs is written in the route's header. A
 * wrong course fails with no error anywhere (the backfill matches 0 and
 * writes no error), so "All good" must not read as covering it.
 */
function WhopCourseNotChecked({
  phase,
  lessons,
}: {
  phase: "before" | "after";
  lessons: number;
}) {
  return (
    <Section eyebrow="Not checked here">
      <Card padding={20}>
        <p style={T.cardTitle}>Which course the Whop course id names</p>
        <p style={{ ...T.bodyDim, marginTop: 6 }}>
          This page makes no call to Whop, so it cannot tell which course
          WHOP_COURSE_ID is. Checking it means reading that course&apos;s
          lessons from Whop and finding their ids in the lessons table.
        </p>
        <p style={{ ...T.body, marginTop: 10 }}>
          {phase === "before"
            ? "Before the switch, production's value must still be the old course: the old dashboard's Whop sync reads it."
            : `After the switch its lessons should be the same ${lessons} as the lessons table. Until this page checks it, finish one lesson on Whop and see it lit on /world.`}
        </p>
      </Card>
    </Section>
  );
}

function problemCount(n: number): string {
  return n === 1 ? "1 problem" : `${n} problems`;
}

function FactRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{
        gap: 16,
        padding: "12px 16px",
        borderBottom: last ? "none" : "1px solid var(--color-border)",
      }}
    >
      <span style={T.bodyDim}>{label}</span>
      <span
        style={{
          ...T.body,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </span>
    </div>
  );
}
