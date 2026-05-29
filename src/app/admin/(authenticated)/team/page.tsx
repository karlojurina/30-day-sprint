"use client";

/**
 * /admin/team - team-member management.
 *
 * Founder-only. The page hides itself for non-founders (returns a 403
 * stub) and the API routes also enforce the role server-side, so a
 * direct URL request still won't leak data.
 *
 * v75.2 - replaces "log in to Supabase, run UPDATE on team_members"
 * for everyday role + roster management.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminPage, PageHeader, T, Card } from "@/components/admin/ui";

interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: "founder" | "admin" | "csm";
  created_at: string;
}

const ROLE_OPTIONS: Array<{ value: TeamMember["role"]; label: string; description: string }> = [
  {
    value: "founder",
    label: "Founder",
    description: "Full access including team management.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Full access to the admin dashboard. Cannot manage team.",
  },
  {
    value: "csm",
    label: "CSM",
    description: "Customer success: tasks, students, journey.",
  },
];

export default function AdminTeamPage() {
  const { teamMember, session } = useAuth();
  const isFounder = teamMember?.role === "founder";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("admin");
  const [inviting, setInviting] = useState(false);
  const [inviteFlash, setInviteFlash] = useState<string | null>(null);

  // Row-level pending state so two ops don't collide.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const authHeader = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team-members", {
        headers: authHeader(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMembers((data.teamMembers ?? []) as TeamMember[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [authHeader]);

  useEffect(() => {
    if (isFounder) void load();
  }, [isFounder, load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviting) return;
    setInviting(true);
    setInviteFlash(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/team-members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteName,
          role: inviteRole,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setInviteFlash(`Invited ${inviteEmail}. They'll get an email to set their password.`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("admin");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setInviting(false);
  }

  async function handleRoleChange(id: string, role: TeamMember["role"]) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team-members/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        body: JSON.stringify({ role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setPendingId(null);
  }

  async function handleRemove(id: string, email: string) {
    if (
      !window.confirm(
        `Remove ${email}?\n\nTheir Supabase auth account will also be deleted. This cannot be undone.`,
      )
    )
      return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team-members/${id}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setPendingId(null);
  }

  if (!teamMember) return null;

  if (!isFounder) {
    return (
      <AdminPage>
        <PageHeader
          title="Team"
          description="Manage team members and their roles."
        />
        <Card padding={28}>
          <p style={T.bodyDim}>
            Only founders can manage team members. Ask whoever invited
            you for the role bump.
          </p>
        </Card>
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title="Team"
        description="Manage who has access to the admin dashboard. Invites email a magic link."
      />

      {/* Invite form */}
      <Card padding={20}>
        <p
          className="section-label"
          style={{ marginBottom: 12 }}
        >
          Invite team member
        </p>
        <form
          onSubmit={handleInvite}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 160px auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <Field label="Email">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@ecomtalent.com"
              style={inputStyle}
            />
          </Field>
          <Field label="Full name">
            <input
              type="text"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="First Last"
              style={inputStyle}
            />
          </Field>
          <Field label="Role">
            <select
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as TeamMember["role"])
              }
              style={inputStyle}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            disabled={inviting}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              background: inviting
                ? "rgba(255,255,255,0.06)"
                : "var(--color-accent-dark)",
              color: inviting
                ? "rgba(255,255,255,0.4)"
                : "var(--color-bg-primary)",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              cursor: inviting ? "wait" : "pointer",
              height: 36,
            }}
          >
            {inviting ? "Inviting…" : "Send invite"}
          </button>
        </form>
        {inviteFlash && (
          <p
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--color-success)",
              letterSpacing: "-0.003em",
            }}
          >
            {inviteFlash}
          </p>
        )}
        <p
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            lineHeight: 1.5,
            letterSpacing: "-0.003em",
          }}
        >
          The invitee gets an email with a magic link. After they click
          it they set a password and can log in at /admin/login.
        </p>
      </Card>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.32)",
            fontSize: 13,
            color: "var(--color-danger)",
          }}
        >
          {error}
        </div>
      )}

      {/* Members list */}
      <div style={{ marginTop: 18 }}>
        <p
          style={{
            ...T.eyebrow,
            marginBottom: 10,
          }}
        >
          {loading ? "Loading…" : `${members.length} team member${members.length === 1 ? "" : "s"}`}
        </p>
        <div
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {members.map((m, idx) => {
            const isSelf = m.id === teamMember.id;
            const isPending = pendingId === m.id;
            return (
              <div
                key={m.id}
                style={{
                  borderTop:
                    idx === 0
                      ? "none"
                      : "1px solid var(--color-border)",
                  padding: "14px 16px",
                  display: "grid",
                  gridTemplateColumns: "1fr 200px 200px auto",
                  alignItems: "center",
                  gap: 12,
                  opacity: isPending ? 0.6 : 1,
                  transition: "opacity 120ms ease",
                }}
              >
                <div>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.005em",
                      lineHeight: 1.3,
                    }}
                  >
                    {m.full_name || "—"}
                    {isSelf && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          color: "var(--color-text-tertiary)",
                          fontWeight: 500,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        you
                      </span>
                    )}
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-tertiary)",
                      letterSpacing: "-0.003em",
                      lineHeight: 1.3,
                    }}
                  >
                    {m.email}
                  </p>
                </div>
                <select
                  value={m.role}
                  onChange={(e) =>
                    handleRoleChange(
                      m.id,
                      e.target.value as TeamMember["role"],
                    )
                  }
                  disabled={isPending || (isSelf && m.role === "founder")}
                  style={{
                    ...inputStyle,
                    fontWeight: 500,
                    cursor:
                      isPending || (isSelf && m.role === "founder")
                        ? "not-allowed"
                        : "pointer",
                  }}
                  title={
                    isSelf && m.role === "founder"
                      ? "You cannot demote your own founder role"
                      : "Change role"
                  }
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-tertiary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  Added{" "}
                  {new Date(m.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(m.id, m.email)}
                  disabled={isPending || isSelf}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    background: "transparent",
                    color: isSelf
                      ? "var(--color-text-tertiary)"
                      : "var(--color-danger)",
                    border: "1px solid",
                    borderColor: isSelf
                      ? "var(--color-border)"
                      : "rgba(200,74,74,0.32)",
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "-0.003em",
                    cursor: isSelf || isPending ? "not-allowed" : "pointer",
                  }}
                  title={isSelf ? "You cannot remove yourself" : "Remove"}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {!loading && members.length === 0 && (
            <p
              style={{
                ...T.bodyDim,
                padding: "24px 16px",
                textAlign: "center",
              }}
            >
              No team members yet — that's weird (you must be one).
            </p>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 12px",
  borderRadius: 8,
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-primary)",
  fontSize: 13,
  letterSpacing: "-0.005em",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
