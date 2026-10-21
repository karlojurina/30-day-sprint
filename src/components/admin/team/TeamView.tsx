"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, T } from "@/components/admin/ui";
import { FailedMeta, ListHeader, ListPage, LoadError, NoticeStack, SkeletonRows } from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { Field, INPUT } from "@/components/admin/templates/form-parts";
import { dayLabel } from "@/lib/admin/croatia-dates";
import { INVITE_PLACEHOLDER, ROLE_OPTIONS, canRemove, inviteProblem, roleLocked } from "@/lib/admin/team-data";
import type { InviteFields, TeamRole, TeamRow, TeamTransport } from "@/lib/admin/team-data";

/**
 * /admin/team (admin rebuild 2, WI-9), in the brand kit's dark look and
 * laid out for a phone as well: who has a login to the admin, their role,
 * an invite, a role change, a removal. Founders only; the routes check that
 * again.
 *
 * Every call goes through `transport` (src/lib/admin/team-data.ts), so the
 * dev page /dev/admin/team renders this same component with made-up data.
 *
 * "Send invite" is the page's one ink button; "Yes, remove", which deletes a
 * login, the danger one. A founder's own role, which no one can change here,
 * is a "Founder" pill, never a select that looks live but does nothing (the
 * review's fix round).
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; members: TeamRow[] };

const EMPTY_INVITE: InviteFields = { email: "", full_name: "", role: "admin" };

export function TeamView({
  transport,
  me,
}: {
  transport: TeamTransport;
  me: { id: string; role: TeamRole };
}) {
  const isFounder = me.role === "founder";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const seq = useRef(0);
  const noticeSeq = useRef(0);

  const notify = useCallback((tone: Notice["tone"], text: string) => {
    setNotices([{ id: ++noticeSeq.current, tone, text }]);
  }, []);

  /** One read of the list; null when a newer read started meanwhile (that one's answer wins). */
  const fetchList = useCallback(async (): Promise<Loaded | null> => {
    const mine = ++seq.current;
    const r = await transport.list();
    if (mine !== seq.current) return null;
    return r.ok ? { kind: "ready", members: r.data } : { kind: "error", error: r.error };
  }, [transport]);

  const read = useCallback(async () => {
    const next = await fetchList();
    if (next) setLoaded(next);
  }, [fetchList]);

  useEffect(() => {
    if (!isFounder) return;
    let alive = true;
    void fetchList().then((next) => {
      if (alive && next) setLoaded(next);
    });
    return () => {
      alive = false;
    };
  }, [isFounder, fetchList]);

  if (!isFounder) {
    return (
      <ListPage>
        <ListHeader title="Team" description="Who can sign in to the admin, and their roles." />
        <Card padding={20}>
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
            Only founders can manage the team. Ask a founder if your role should change.
          </p>
        </Card>
      </ListPage>
    );
  }

  async function invite(fields: InviteFields): Promise<string | null> {
    const r = await transport.invite(fields);
    if (!r.ok) return r.error;
    notify("success", `Invited ${r.data.email}. They get an email with a link to set a password.`);
    await read();
    return null;
  }

  async function changeRole(m: TeamRow, role: TeamRole) {
    setPending(m.id);
    const r = await transport.changeRole(m.id, role);
    setPending(null);
    if (!r.ok) {
      notify("danger", `Couldn't change ${m.full_name || m.email}'s role: ${r.error}`);
      return;
    }
    // The row as the route saved it, at once; the read after it brings the rest.
    setLoaded((cur) =>
      cur.kind === "ready" ? { ...cur, members: cur.members.map((x) => (x.id === m.id ? r.data : x)) } : cur,
    );
    notify("success", `${r.data.full_name || r.data.email} is now ${roleLabel(r.data.role)}.`);
    await read();
  }

  async function remove(m: TeamRow): Promise<string | null> {
    setPending(m.id);
    const r = await transport.remove(m.id);
    setPending(null);
    if (!r.ok) return r.error;
    // Gone from the list as soon as the route says so, before the read after it.
    setLoaded((cur) => (cur.kind === "ready" ? { ...cur, members: cur.members.filter((x) => x.id !== m.id) } : cur));
    if (r.data.warning) notify("warning", `Removed ${m.email} from the team, but their login could not be deleted: ${r.data.warning}`);
    else notify("success", `Removed ${m.email}. Their login is deleted too.`);
    await read();
    return null;
  }

  const header = (meta: React.ReactNode) => (
    <ListHeader
      title="Team"
      description="Who can sign in to the admin, and their roles. Founders only."
      meta={meta}
    />
  );

  return (
    <ListPage>
      {header(
        loaded.kind === "ready" ? (
          `${loaded.members.length} ${loaded.members.length === 1 ? "member" : "members"}`
        ) : loaded.kind === "error" ? (
          <FailedMeta />
        ) : (
          "Loading"
        ),
      )}
      <InviteCard onInvite={invite} />
      <h2 style={{ ...T.eyebrow, color: "var(--color-text-secondary)", margin: "24px 0 8px" }}>Members</h2>
      {loaded.kind === "loading" && <SkeletonRows rows={3} label="Loading the team" />}
      {loaded.kind === "error" && (
        <LoadError
          title="Couldn't load the team."
          detail={loaded.error}
          busy={retrying}
          onRetry={async () => {
            setRetrying(true);
            await read();
            setRetrying(false);
          }}
        />
      )}
      {loaded.kind === "ready" &&
        (loaded.members.length === 0 ? (
          <Card>
            <EmptyState title="No team members to show." />
          </Card>
        ) : (
          <Card padding={0}>
            {loaded.members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                meId={me.id}
                busy={pending === m.id}
                onRole={(role) => void changeRole(m, role)}
                onRemove={() => remove(m)}
              />
            ))}
          </Card>
        ))}
      <NoticeStack notices={notices} onClose={(id) => setNotices((n) => n.filter((x) => x.id !== id))} />
    </ListPage>
  );
}

const roleLabel = (r: TeamRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

function InviteCard({ onInvite }: { onInvite: (f: InviteFields) => Promise<string | null> }) {
  const id = useId();
  const [fields, setFields] = useState<InviteFields>(EMPTY_INVITE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof InviteFields>(k: K, v: InviteFields[K]) => {
    setFields((f) => ({ ...f, [k]: v }));
    setError(null);
  };
  const role = ROLE_OPTIONS.find((o) => o.value === fields.role);

  return (
    <Card padding={20}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = inviteProblem(fields);
          if (problem) {
            setError(problem);
            return;
          }
          setBusy(true);
          const said = await onInvite(fields);
          setBusy(false);
          if (said) setError(said);
          else setFields(EMPTY_INVITE);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div>
          <h2 style={T.cardTitle}>Invite a team member</h2>
          <p style={{ ...T.bodyDim, marginTop: 4, lineHeight: 1.5 }}>
            They get an email with a link to set a password, then sign in at /admin/login.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14 }}>
          <Field label="Email" htmlFor={`${id}-email`}>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="off"
              value={fields.email}
              placeholder={INVITE_PLACEHOLDER}
              onChange={(e) => set("email", e.target.value)}
              style={INPUT}
            />
          </Field>
          <Field label="Full name" htmlFor={`${id}-name`}>
            <input
              id={`${id}-name`}
              type="text"
              autoComplete="off"
              value={fields.full_name}
              placeholder="First Last"
              onChange={(e) => set("full_name", e.target.value)}
              style={INPUT}
            />
          </Field>
          <Field label="Role" htmlFor={`${id}-role`} hint={role?.description}>
            <select
              id={`${id}-role`}
              value={fields.role}
              onChange={(e) => set("role", e.target.value as TeamRole)}
              style={INPUT}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && (
          <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
            {error}
          </p>
        )}
        <div>
          <Button variant="ink" size="md" type="submit" busy={busy}>
            {busy ? "Sending the invite" : "Send invite"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MemberRow({
  member: m,
  meId,
  busy,
  onRole,
  onRemove,
}: {
  member: TeamRow;
  meId: string;
  busy: boolean;
  onRole: (role: TeamRole) => void;
  onRemove: () => Promise<string | null>;
}) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = m.id === meId;
  const locked = roleLocked(m, meId);
  const removable = canRemove(m, meId);

  return (
    <div className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 }}>
      <div className="flex flex-wrap items-center" style={{ gap: "12px 16px" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <p className="flex flex-wrap items-center" style={{ ...T.body, fontSize: 15, fontWeight: 600, gap: 8 }}>
            <span style={{ overflowWrap: "anywhere" }}>{m.full_name || "No name on file"}</span>
            {self && <Pill tone="accent">You</Pill>}
          </p>
          <p style={{ ...T.bodyDim, overflowWrap: "anywhere" }}>{m.email}</p>
          <p style={{ ...T.bodyDim, marginTop: 2 }}>Added {dayLabel(m.created_at)}</p>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          {locked ? (
            <span data-role-locked="">
              <Pill tone="neutral">{roleLabel(m.role)}</Pill>
            </span>
          ) : (
            <>
              <label htmlFor={`${id}-role`} className="sr-only">
                Role of {m.full_name || m.email}
              </label>
              <select
                id={`${id}-role`}
                value={m.role}
                disabled={busy}
                onChange={(e) => onRole(e.target.value as TeamRole)}
                style={{ ...INPUT, width: "auto", minWidth: 140 }}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
          {removable && !asking && (
            <Button variant="ghost" size="md" disabled={busy} onClick={() => setAsking(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {locked && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>You can&apos;t change your own founder role.</p>}
      {asking && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p style={{ ...T.body, lineHeight: 1.5 }}>
            Remove {m.email}? Their login is deleted too. This cannot be undone.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="danger"
              size="md"
              busy={busy}
              onClick={async () => {
                const said = await onRemove();
                if (said) setError(said);
                setAsking(false);
              }}
            >
              Yes, remove
            </Button>
            <Button variant="ghost" size="md" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" style={{ ...T.body, lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  );
}
